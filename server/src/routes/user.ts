import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { enabledBoardTypes } from "../services/siteSettings";
import { FORUM_CONFIRM_TEXT, resolveForumAccess } from "../services/forumAccess";
import { releaseExpiredMutes } from "../services/userModeration";
import { buildPublicUser, buildSelfUser } from "../utils/publicUser";
import { decodeTopicForViewer } from "../services/forumPresentation";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { forumContentVisibilityWhere } from "../services/forumSubmission";
import { isVipActive, VIP_PROFILE_FRAMES, VIP_PROFILE_THEMES } from "../services/vip";
import { deleteManagedUserAvatar, storeUserAvatarDataUrl } from "../services/userAvatarStorage";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import { normalizeNicknameSubmission, scheduleNicknameReview } from "../services/nicknameReview";

export const userRouter = Router();

userRouter.get("/me", authRequired, async (req, res, next) => {
  try {
    await releaseExpiredMutes();
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw Errors.notFound("用户不存在");
    ok(res, buildSelfUser(user));
  } catch (e) { next(e); }
});

userRouter.patch("/me", authRequired, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    for (const k of ["bio", "college", "enrollYear"]) {
      if (body[k] !== undefined) allowed[k] = body[k];
    }
    const previous = body.avatar !== undefined || body.nickname !== undefined
      ? await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { avatar: true, nickname: true, pendingNickname: true, nicknameReviewStatus: true },
        })
      : null;
    if ((body.avatar !== undefined || body.nickname !== undefined) && !previous) throw Errors.notFound("用户不存在");
    let nicknameQueued = false;
    if (body.nickname !== undefined) {
      const nickname = normalizeNicknameSubmission(body.nickname);
      if (nickname === previous!.nickname.trim()) {
        if (previous!.pendingNickname) {
          Object.assign(allowed, {
            pendingNickname: null,
            nicknameReviewStatus: "none",
            nicknameReviewReason: null,
            nicknameReviewDetail: null,
            nicknameReviewModel: null,
            nicknameReviewRequestedAt: null,
            nicknameReviewedAt: null,
          });
        }
      } else if (!(previous!.nicknameReviewStatus === "checking" && previous!.pendingNickname === nickname)) {
        Object.assign(allowed, {
          pendingNickname: nickname,
          nicknameReviewStatus: "checking",
          nicknameReviewReason: "昵称已提交，正在后台审核",
          nicknameReviewDetail: "",
          nicknameReviewModel: null,
          nicknameReviewRequestedAt: new Date(),
          nicknameReviewedAt: null,
        });
        nicknameQueued = true;
      }
    }
    if (body.avatar !== undefined) {
      if (body.avatar === null || body.avatar === "") {
        allowed.avatar = null;
      } else if (typeof body.avatar === "string" && body.avatar.trim().startsWith("data:image/")) {
        try {
          allowed.avatar = await storeUserAvatarDataUrl(req.user!.userId, body.avatar);
        } catch (error: any) {
          throw Errors.badRequest(String(error?.message || "头像保存失败"));
        }
      } else if (typeof body.avatar === "string") {
        allowed.avatar = body.avatar.trim();
      } else {
        throw Errors.badRequest("头像数据格式不正确");
      }
    }
    if (body.profileTheme !== undefined || body.profileFrame !== undefined) {
      const current = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { isVip: true },
      });
      if (!isVipActive(current)) throw Errors.forbidden("VIP 用户才能使用个性化资料装扮");
      if (body.profileTheme !== undefined) {
        if (typeof body.profileTheme !== "string" || !VIP_PROFILE_THEMES.includes(body.profileTheme as any)) {
          throw Errors.badRequest("不支持的资料主题");
        }
        allowed.profileTheme = body.profileTheme;
      }
      if (body.profileFrame !== undefined) {
        if (typeof body.profileFrame !== "string" || !VIP_PROFILE_FRAMES.includes(body.profileFrame as any)) {
          throw Errors.badRequest("不支持的头像框");
        }
        allowed.profileFrame = body.profileFrame;
      }
    }
    if (body.dataAuthAgreed === true) {
      allowed.dataAuthAgreedAt = new Date();
    }
    const u = await prisma.user.update({ where: { id: req.user!.userId }, data: allowed });
    if (nicknameQueued) scheduleNicknameReview(u.id);
    if (body.avatar !== undefined && previous?.avatar !== u.avatar) {
      if (previous?.avatar) await deleteManagedUserAvatar(previous.avatar).catch(() => false);
      await invalidateForumCaches();
    }
    ok(res, buildSelfUser(u));
  } catch (e) { next(e); }
});

// 修改自己的密码 —— SSO 账号无站内密码，拒绝
const passwordSchema = z.object({
  oldPassword: z.string().min(1, "请输入原密码"),
  newPassword: z.string().min(6, "新密码至少 6 位").max(64),
});
userRouter.patch("/password", authRequired, validate(passwordSchema), async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw Errors.notFound("用户不存在");
    if (user.studentSso) {
      throw Errors.badRequest("该账号通过学校认证登录，无需设置站内密码");
    }
    const okOld = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!okOld) throw Errors.badRequest("原密码错误");
    if (oldPassword === newPassword) throw Errors.badRequest("新密码不能与原密码相同");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

const forumAccessEnableSchema = z.object({
  confirmText: z.string().trim().min(1).max(20),
});
userRouter.post("/forum-access/enable", authRequired, validate(forumAccessEnableSchema), async (req, res, next) => {
  try {
    if (req.body.confirmText !== FORUM_CONFIRM_TEXT) {
      throw Errors.badRequest(`请输入“${FORUM_CONFIRM_TEXT}”后再继续`);
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        forumEnabled: true,
        forumEnabledAt: new Date(),
      },
    });
    ok(res, buildSelfUser(user));
  } catch (e) { next(e); }
});

userRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound();
    ok(res, buildPublicUser(user, req.user));
  } catch (e) { next(e); }
});

userRouter.get("/:id/topics", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const forumAccessEnabled = await resolveForumAccess(req.user?.userId, req.user?.role);
    if (!forumAccessEnabled) return ok(res, []);
    const canSeeAnonymous = req.user?.userId === id || req.user?.role === "admin" || req.user?.role === "mod";
    const list = await prisma.topic.findMany({
      where: {
        authorId: id,
        ...forumContentVisibilityWhere(req.user?.userId === id ? id : null),
        board: { type: { in: enabledBoardTypes() }, ...visibleBoardSlugFilter() },
        ...(canSeeAnonymous ? {} : { isAnonymous: false }),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        board: { select: { slug: true, name: true, color: true, type: true } },
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true } },
        tags: { include: { tag: true } },
      },
    });
    ok(res, list.map((topic: any) => decodeTopicForViewer(topic, req.user)));
  } catch (e) { next(e); }
});
