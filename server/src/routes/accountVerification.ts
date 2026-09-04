import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { adminOnly } from "../middleware/admin";
import { Errors, ok } from "../utils/response";
import { publicAvatarValue } from "../utils/publicAvatar";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import {
  ACCOUNT_VERIFICATION_STATUSES,
  ACCOUNT_VERIFICATION_SUBMISSION_LIMIT,
  ACCOUNT_VERIFICATION_TYPES,
  accountVerificationSubmissionBlock,
  accountVerificationWindowStart,
  buildAccountVerification,
  normalizedVerificationExpiry,
} from "../services/accountVerification";

export const accountVerificationRouter = Router();
export const accountVerificationAdminRouter = Router();

const applicationSchema = z.object({
  type: z.enum(ACCOUNT_VERIFICATION_TYPES),
  requestedLabel: z.string().trim().min(2, "认证说明至少 2 个字").max(30, "认证说明最多 30 个字"),
  identityDescription: z.string().trim().min(10, "请更具体地说明需要认证的身份").max(500),
  evidence: z.string().trim().min(10, "请提供可核验的证明线索").max(1200),
  contact: z.string().trim().max(120).optional().default(""),
  acknowledged: z.literal(true),
});

const removeSchema = z.object({
  confirmation: z.literal("REMOVE_VERIFICATION"),
});

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    approvedLabel: z.string().trim().min(2).max(30).optional(),
    reviewNote: z.string().trim().max(500).optional().default(""),
    expiresAt: z.string().trim().max(64).nullable().optional(),
  }),
  z.object({
    action: z.literal("reject"),
    reviewNote: z.string().trim().min(2, "请填写未通过原因").max(500),
  }),
]);

const revokeSchema = z.object({
  reason: z.string().trim().min(2, "请填写撤销原因").max(500),
  confirmation: z.literal("REVOKE_VERIFICATION"),
});

const candidateSearchSchema = z.object({
  q: z.string().trim().min(1, "请输入账号、昵称或用户 ID").max(60),
});

const grantSchema = z.object({
  userId: z.coerce.number().int().positive(),
  approvedLabel: z.string().trim().min(2, "认证说明至少 2 个字").max(30, "认证说明最多 30 个字"),
  reviewNote: z.string().trim().min(2, "请填写核验依据").max(500),
  expiresAt: z.string().trim().max(64).nullable().optional(),
});

function parseId(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("认证申请 ID 不正确");
  return id;
}

function serializeApplication(application: any) {
  return {
    id: application.id,
    userId: application.userId,
    source: application.source || "user_application",
    type: application.type,
    requestedLabel: application.requestedLabel,
    identityDescription: application.identityDescription,
    evidence: application.evidence,
    contact: application.contact,
    status: application.status,
    approvedLabel: application.approvedLabel,
    reviewNote: application.reviewNote,
    reviewedAt: application.reviewedAt,
    expiresAt: application.expiresAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    ...(application.user ? {
      user: {
        id: application.user.id,
        username: application.user.username,
        nickname: application.user.nickname,
        avatar: publicAvatarValue(application.user),
        college: application.user.college,
        enrollYear: application.user.enrollYear,
        studentSso: application.user.studentSso,
        role: application.user.role,
        currentVerification: buildAccountVerification(application.user),
      },
    } : {}),
    ...(application.reviewer ? {
      reviewer: {
        id: application.reviewer.id,
        nickname: application.reviewer.nickname,
      },
    } : {}),
  };
}

async function notifyUser(userId: number, title: string, content: string) {
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "strong",
      title,
      content,
      link: "/profile/verification",
      source: "账号认证",
      payload: JSON.stringify({ type: "account-verification" }),
    },
  }).catch(() => null);
}

async function notifyReviewers(applicationId: number, nickname: string, label: string) {
  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["admin", "mod"] }, status: { not: "banned" } },
    select: { id: true },
  });
  if (!reviewers.length) return;
  await prisma.notification.createMany({
    data: reviewers.map((reviewer) => ({
      userId: reviewer.id,
      category: "system",
      level: "normal",
      title: "收到新的账号认证申请",
      content: `${nickname} 申请认证“${label}”，请核验后处理。`,
      link: `/admin?tab=account-verifications&application=${applicationId}`,
      source: "账号认证",
      payload: JSON.stringify({ type: "account-verification-review", applicationId }),
    })),
  }).catch(() => null);
}

accountVerificationRouter.get("/me", async (req, res, next) => {
  try {
    const [user, applications, recentSubmissionCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user!.userId } }),
      prisma.userVerificationApplication.findMany({
        where: { userId: req.user!.userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        include: { reviewer: { select: { id: true, nickname: true } } },
      }),
      prisma.userVerificationApplication.count({
        where: { userId: req.user!.userId, source: "user_application", createdAt: { gte: accountVerificationWindowStart() } },
      }),
    ]);
    if (!user) throw Errors.notFound("用户不存在");
    ok(res, {
      verification: buildAccountVerification(user),
      applications: applications.map(serializeApplication),
      submission: {
        limit: ACCOUNT_VERIFICATION_SUBMISSION_LIMIT,
        used: recentSubmissionCount,
        remaining: Math.max(0, ACCOUNT_VERIFICATION_SUBMISSION_LIMIT - recentSubmissionCount),
        hasPending: applications.some((application) => application.status === "pending"),
      },
    });
  } catch (error) { next(error); }
});

accountVerificationRouter.post(
  "/applications",
  securityRateLimit("account-verification-application", 10, 60 * 60 * 1000),
  validate(applicationSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      const [user, pending, recentSubmissionCount] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, status: true } }),
        prisma.userVerificationApplication.findFirst({ where: { userId, status: "pending" }, select: { id: true } }),
        prisma.userVerificationApplication.count({
          where: { userId, source: "user_application", createdAt: { gte: accountVerificationWindowStart() } },
        }),
      ]);
      if (!user) throw Errors.notFound("用户不存在");
      if (user.status === "banned") throw Errors.forbidden("账号已被封禁，暂时不能申请认证");
      const blocked = accountVerificationSubmissionBlock({
        hasPending: Boolean(pending),
        recentSubmissionCount,
      });
      if (blocked) throw Errors.conflict(blocked);
      const application = await prisma.userVerificationApplication.create({
        data: {
          userId,
          source: "user_application",
          type: req.body.type,
          requestedLabel: req.body.requestedLabel,
          identityDescription: req.body.identityDescription,
          evidence: req.body.evidence,
          contact: req.body.contact,
        },
      });
      void notifyReviewers(application.id, user.nickname, application.requestedLabel).catch(() => undefined);
      ok(res, serializeApplication(application));
    } catch (error) { next(error); }
  },
);

accountVerificationRouter.post("/remove", validate(removeSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, verificationApplicationId: true, verificationLabel: true },
    });
    if (!user?.verificationApplicationId || !user.verificationLabel) throw Errors.badRequest("当前账号没有生效中的认证");
    await prisma.$transaction([
      prisma.userVerificationApplication.updateMany({
        where: { id: user.verificationApplicationId, userId: user.id, status: "approved" },
        data: { status: "withdrawn" },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          verificationType: null,
          verificationLabel: null,
          verificationVerifiedAt: null,
          verificationExpiresAt: null,
          verificationApplicationId: null,
        },
      }),
    ]);
    await invalidateForumCaches();
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

accountVerificationAdminRouter.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status || "pending");
    if (status !== "all" && !ACCOUNT_VERIFICATION_STATUSES.includes(status as any)) {
      throw Errors.badRequest("认证申请状态不正确");
    }
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size || 30)));
    const where: any = {};
    if (status !== "all") where.status = status;
    if (q) {
      where.OR = [
        { requestedLabel: { contains: q, mode: "insensitive" } },
        { identityDescription: { contains: q, mode: "insensitive" } },
        { user: { is: { OR: [
          { username: { contains: q, mode: "insensitive" } },
          { nickname: { contains: q, mode: "insensitive" } },
        ] } } },
      ];
    }
    const [list, total, pending] = await Promise.all([
      prisma.userVerificationApplication.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * size,
        take: size,
        include: {
          user: true,
          reviewer: { select: { id: true, nickname: true } },
        },
      }),
      prisma.userVerificationApplication.count({ where }),
      prisma.userVerificationApplication.count({ where: { status: "pending" } }),
    ]);
    ok(res, { page, size, total, pending, list: list.map(serializeApplication) });
  } catch (error) { next(error); }
});

accountVerificationAdminRouter.get(
  "/candidates",
  adminOnly,
  validate(candidateSearchSchema, "query"),
  async (req, res, next) => {
    try {
      const q = req.query.q as string;
      const numericId = Number(q);
      const users = await prisma.user.findMany({
        where: {
          status: { not: "banned" },
          OR: [
            ...(Number.isInteger(numericId) && numericId > 0 ? [{ id: numericId }] : []),
            { username: { contains: q, mode: "insensitive" } },
            { nickname: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar: true,
          college: true,
          enrollYear: true,
          studentSso: true,
          role: true,
          verificationType: true,
          verificationLabel: true,
          verificationVerifiedAt: true,
          verificationExpiresAt: true,
        },
      });
      ok(res, users.map((user) => ({
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: publicAvatarValue(user),
        college: user.college,
        enrollYear: user.enrollYear,
        studentSso: user.studentSso,
        role: user.role,
        currentVerification: buildAccountVerification(user),
      })));
    } catch (error) { next(error); }
  },
);

accountVerificationAdminRouter.post(
  "/grant",
  adminOnly,
  validate(grantSchema),
  async (req, res, next) => {
    try {
      const reviewerId = req.user!.userId;
      const userId = req.body.userId;
      if (userId === reviewerId) throw Errors.forbidden("不能为自己的账号主动添加认证");
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nickname: true, status: true },
      });
      if (!user) throw Errors.notFound("用户不存在");
      if (user.status === "banned") throw Errors.forbidden("不能为已封禁账号添加认证");

      const now = new Date();
      let expiresAt: Date | null;
      try {
        expiresAt = normalizedVerificationExpiry(req.body.expiresAt, now);
      } catch (error) {
        throw Errors.badRequest(String((error as Error)?.message || "认证有效期不正确"));
      }

      const application = await prisma.$transaction(async (tx) => {
        await tx.userVerificationApplication.updateMany({
          where: { userId, status: "approved" },
          data: { status: "superseded" },
        });
        await tx.userVerificationApplication.updateMany({
          where: { userId, status: "pending" },
          data: {
            status: "superseded",
            reviewerId,
            reviewNote: "管理员已主动完成组织认证",
            reviewedAt: now,
          },
        });
        const created = await tx.userVerificationApplication.create({
          data: {
            userId,
            source: "admin_grant",
            type: "campus_organization",
            requestedLabel: req.body.approvedLabel,
            identityDescription: "由站点管理员主动授予组织认证",
            evidence: req.body.reviewNote,
            status: "approved",
            approvedLabel: req.body.approvedLabel,
            reviewerId,
            reviewNote: req.body.reviewNote,
            reviewedAt: now,
            expiresAt,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            verificationType: "campus_organization",
            verificationLabel: req.body.approvedLabel,
            verificationVerifiedAt: now,
            verificationExpiresAt: expiresAt,
            verificationApplicationId: created.id,
          },
        });
        return created;
      });
      await invalidateForumCaches();
      await notifyUser(
        userId,
        "管理员已添加组织认证",
        `你的账号已认证为“${req.body.approvedLabel}”。如认证信息有误，可在组织认证页面解除并联系管理员。`,
      );
      ok(res, serializeApplication(application));
    } catch (error) { next(error); }
  },
);

accountVerificationAdminRouter.patch("/:id/review", validate(reviewSchema), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const application = await prisma.userVerificationApplication.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!application) throw Errors.notFound("认证申请不存在");
    if (application.userId === req.user!.userId) throw Errors.forbidden("不能审核自己的认证申请");
    if (application.status !== "pending") throw Errors.conflict("该认证申请已经处理，请刷新列表");
    const now = new Date();
    if (req.body.action === "reject") {
      const changed = await prisma.userVerificationApplication.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "rejected",
          reviewerId: req.user!.userId,
          reviewNote: req.body.reviewNote,
          reviewedAt: now,
        },
      });
      if (changed.count !== 1) throw Errors.conflict("该认证申请已经处理，请刷新列表");
      await notifyUser(application.userId, "账号认证未通过", `认证“${application.requestedLabel}”暂未通过：${req.body.reviewNote}`);
      ok(res, { id, status: "rejected" });
      return;
    }

    let expiresAt: Date | null;
    try {
      expiresAt = normalizedVerificationExpiry(req.body.expiresAt, now);
    } catch (error) {
      throw Errors.badRequest(String((error as Error)?.message || "认证有效期不正确"));
    }
    const approvedLabel = req.body.approvedLabel?.trim() || application.requestedLabel;
    await prisma.$transaction(async (tx) => {
      const changed = await tx.userVerificationApplication.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "approved",
          approvedLabel,
          reviewerId: req.user!.userId,
          reviewNote: req.body.reviewNote,
          reviewedAt: now,
          expiresAt,
        },
      });
      if (changed.count !== 1) throw Errors.conflict("该认证申请已经处理，请刷新列表");
      await tx.userVerificationApplication.updateMany({
        where: { userId: application.userId, status: "approved", id: { not: id } },
        data: { status: "superseded" },
      });
      await tx.user.update({
        where: { id: application.userId },
        data: {
          verificationType: application.type,
          verificationLabel: approvedLabel,
          verificationVerifiedAt: now,
          verificationExpiresAt: expiresAt,
          verificationApplicationId: id,
        },
      });
    });
    await invalidateForumCaches();
    await notifyUser(application.userId, "账号认证已通过", `你的账号已认证为“${approvedLabel}”，认证标识现在会展示在论坛和个人主页。`);
    ok(res, { id, status: "approved", approvedLabel, expiresAt });
  } catch (error) { next(error); }
});

accountVerificationAdminRouter.post("/:id/revoke", validate(revokeSchema), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const application = await prisma.userVerificationApplication.findUnique({ where: { id } });
    if (!application) throw Errors.notFound("认证申请不存在");
    if (application.userId === req.user!.userId) throw Errors.forbidden("不能处理自己的认证");
    const user = await prisma.user.findUnique({
      where: { id: application.userId },
      select: { verificationApplicationId: true, verificationLabel: true },
    });
    if (application.status !== "approved" || user?.verificationApplicationId !== id) {
      throw Errors.conflict("该认证已不是账号当前生效的认证");
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.userVerificationApplication.update({
        where: { id },
        data: {
          status: "revoked",
          reviewerId: req.user!.userId,
          reviewNote: [application.reviewNote, `撤销原因：${req.body.reason}`].filter(Boolean).join("\n"),
          reviewedAt: now,
        },
      }),
      prisma.user.update({
        where: { id: application.userId },
        data: {
          verificationType: null,
          verificationLabel: null,
          verificationVerifiedAt: null,
          verificationExpiresAt: null,
          verificationApplicationId: null,
        },
      }),
    ]);
    await invalidateForumCaches();
    await notifyUser(application.userId, "账号认证已撤销", `认证“${user.verificationLabel || application.approvedLabel || application.requestedLabel}”已撤销：${req.body.reason}`);
    ok(res, { id, status: "revoked" });
  } catch (error) { next(error); }
});
