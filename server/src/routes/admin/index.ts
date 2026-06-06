import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../prisma";
import { Errors, ok } from "../../utils/response";
import { adminOnly, modOrAbove } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { resetSourceAndRun, runAllOnce } from "../../services/schoolCrawler";
import {
  getFeatures,
  isGlobalPinnedTopic,
  getSiteConfig,
  getSitePromptDefaults,
  removeTopicFromGlobalPins,
  setFeature,
  setSiteFilingNumber,
  setTopicGlobalPinned,
  setAiReviewConfig,
  setCommunityTrustConfig,
  setSiteOrigin,
  ALL_FEATURES,
  type FeatureKey,
} from "../../services/siteSettings";
import { refreshTopicSubmissionLock } from "../../services/topicAiReview";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../../services/forumStats";
import {
  notifyManualReplyReviewDecision,
  notifyManualReviewDecision,
  resolveReplyManualReviewAdminNotifications,
  resolveTopicManualReviewAdminNotifications,
} from "../../services/topicAiReview";
import { parseMutedUntil, releaseExpiredMutes } from "../../services/userModeration";
import { buildUserTrustSnapshot, currentAnonymousWeekKey, freezeAnonymousCredits } from "../../services/userTrust";
import { buildEpayCallbackUrls, buildEpaySubmitPayload, getEpayConfig, resolvePaymentOrigin, updateEpayConfig } from "../../services/epay";
import { amountCentsToMoney } from "../../services/epay";
import {
  invalidateBoardCaches,
  invalidateForumCaches,
  invalidateSiteSettingCaches,
} from "../../services/cacheInvalidation";
import { decodeTopicForViewer } from "../../services/forumPresentation";
import {
  calcSponsorOrderExpiresAt,
  closeExpiredSponsorOrders,
  formatSponsorOrder,
  getSponsorConfig,
  updateSponsorConfig,
} from "../../services/sponsor";
import { applyManualForumImageReview, backfillForumImageAssetsAndTriggerModeration, listForumImageAssetsForContent } from "../../services/imageModeration";
import {
  applyManualForumVideoReview,
  backfillForumVideoAssetsAndTriggerModeration,
  listForumVideoAssetsForContent,
  listForumVideoQueue,
} from "../../services/videoModeration";
import {
  cleanupDatabaseBackupSnapshot,
  createDatabaseBackupSnapshot,
  databaseRestoreUploadLimitBytes,
  getDatabaseBackupStatus,
  restoreDatabaseBackupSnapshot,
} from "../../services/databaseBackup";
import {
  getMediaStorageAdminConfig,
  updateMediaStorageAdminConfig,
} from "../../services/storageConfig";
import {
  buildOneDriveChinaAuthorization,
  disconnectOneDriveChinaAuthorization,
  listOneDriveChinaDriveOptions,
  saveOneDriveChinaDriveSelection,
  validateOneDriveChinaClientCredentials,
} from "../../services/oneDriveChina";
import {
  cleanupMigratedLocalMediaAssets,
  listMediaStorageAdminInventory,
  migrateLocalMediaAssetsToRemote,
} from "../../services/mediaStorage";
import {
  buildCloudDriveAccessUrl,
  cloudDriveProxyUploadLimitBytes,
  completeCloudDriveUpload,
  createCloudDriveFolder,
  deleteCloudDriveEntry,
  listCloudDriveDirectory,
  prepareCloudDriveUpload,
  renameCloudDriveEntry,
  saveCloudDriveFile,
} from "../../services/cloudDrive";
import { qqBotAdminRouter } from "./qqbot";
import {
  createWeiwallTokenAuthSession,
  getWeiwallSyncAdminConfig,
  getWeiwallTokenAuthStatus,
  runWeiwallSyncNow,
  updateWeiwallSyncConfig,
} from "../../services/weiwallSync";

export const adminRouter = Router();
const DATABASE_RESTORE_UPLOAD_DIR = path.join(tmpdir(), "cpu-web-db-restore-upload");
mkdirSync(DATABASE_RESTORE_UPLOAD_DIR, { recursive: true });

const databaseRestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DATABASE_RESTORE_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 20);
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: databaseRestoreUploadLimitBytes() },
});

const cloudDriveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cloudDriveProxyUploadLimitBytes() },
});

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

adminRouter.use("/qqbot", adminOnly, qqBotAdminRouter);

adminRouter.get("/database/status", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await getDatabaseBackupStatus());
  } catch (e) { next(e); }
});

adminRouter.get("/database/backup", adminOnly, async (_req, res, next) => {
  let snapshot: Awaited<ReturnType<typeof createDatabaseBackupSnapshot>> | null = null;
  try {
    snapshot = await createDatabaseBackupSnapshot();
    res.setHeader("Content-Type", snapshot.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${snapshot.fileName}"; filename*=UTF-8''${encodeURIComponent(snapshot.fileName)}`
    );
    res.sendFile(snapshot.filePath, async (error) => {
      if (snapshot) await cleanupDatabaseBackupSnapshot(snapshot);
      if (error && !res.headersSent) next(error);
    });
  } catch (e) {
    if (snapshot) await cleanupDatabaseBackupSnapshot(snapshot);
    next(e);
  }
});

adminRouter.post("/database/restore", adminOnly, (req, res, next) => {
  databaseRestoreUpload.single("file")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") {
      return next(Errors.badRequest("恢复备份文件过大，请分卷压缩或改用命令行恢复"));
    }
    return next(error);
  });
}, async (req, res, next) => {
  const file = req.file;
  try {
    if (!file?.path || !file.size) throw Errors.badRequest("请先选择要恢复的数据库备份文件");
    ok(res, await restoreDatabaseBackupSnapshot({
      filePath: file.path,
      fileName: file.originalname || file.filename,
      fileSizeBytes: file.size,
    }));
  } catch (e: any) {
    if (e?.message === "数据库当前正在维护中，请稍后再试") {
      next(Errors.conflict(e.message));
      return;
    }
    if (
      e?.message === "当前服务端只支持 PostgreSQL 在线恢复"
      || String(e?.message || "").includes("无法恢复 PostgreSQL 备份")
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  } finally {
    if (file?.path) await unlink(file.path).catch(() => undefined);
  }
});

// ============ 用户管理 ============

adminRouter.get("/users", modOrAbove, async (req, res, next) => {
  try {
    await releaseExpiredMutes();
    const q = String(req.query.q ?? "").trim();
    const role = req.query.role ? String(req.query.role) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const loginClient = req.query.loginClient ? String(req.query.loginClient) : undefined;
    const usedClient = req.query.usedClient ? String(req.query.usedClient) : undefined;
    const usedIosClient = req.query.usedIosClient === "1" ? true : req.query.usedIosClient === "0" ? false : undefined;
    const usedAndroidClient = req.query.usedAndroidClient === "1" ? true : req.query.usedAndroidClient === "0" ? false : undefined;
    const usedHarmonyClient = req.query.usedHarmonyClient === "1" ? true : req.query.usedHarmonyClient === "0" ? false : undefined;
    const forumEnabled = req.query.forumEnabled === "1" ? true : req.query.forumEnabled === "0" ? false : undefined;
    const loginFrom = String(req.query.loginFrom ?? "").trim();
    const loginTo = String(req.query.loginTo ?? "").trim();
    const sort = String(req.query.sort ?? "login-desc");
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size ?? 30)));

    const where: any = {};
    if (q) where.OR = [
      { username: { contains: q } },
      { nickname: { contains: q } },
      { email: { contains: q } },
    ];
    if (role) where.role = role;
    if (status) where.status = status;
    if (loginClient && loginClient !== "all") {
      if (loginClient === "none") where.lastLoginAt = null;
      else if (["ios", "android", "harmony", "web", "unknown"].includes(loginClient)) where.lastLoginClient = loginClient;
    }
    if (usedClient === "ios") where.usedIosClient = true;
    if (usedClient === "android") where.usedAndroidClient = true;
    if (usedClient === "harmony") where.usedHarmonyClient = true;
    if (typeof usedIosClient === "boolean") where.usedIosClient = usedIosClient;
    if (typeof usedAndroidClient === "boolean") where.usedAndroidClient = usedAndroidClient;
    if (typeof usedHarmonyClient === "boolean") where.usedHarmonyClient = usedHarmonyClient;
    if (typeof forumEnabled === "boolean") where.forumEnabled = forumEnabled;
    if (loginFrom || loginTo) {
      const loginAtFilter: any = where.lastLoginAt && typeof where.lastLoginAt === "object" ? where.lastLoginAt : {};
      if (loginFrom) {
        const start = new Date(`${loginFrom}T00:00:00`);
        if (!Number.isNaN(start.getTime())) loginAtFilter.gte = start;
      }
      if (loginTo) {
        const end = new Date(`${loginTo}T23:59:59.999`);
        if (!Number.isNaN(end.getTime())) loginAtFilter.lte = end;
      }
      if (Object.keys(loginAtFilter).length) where.lastLoginAt = loginAtFilter;
    }

    const orderBy = sort === "id-asc"
      ? [{ id: "asc" as const }]
      : sort === "id-desc"
        ? [{ id: "desc" as const }]
        : [{ lastLoginAt: { sort: "desc" as const, nulls: "last" as const } }, { id: "desc" as const }];

    const [list, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true, username: true, nickname: true, email: true, avatar: true,
          college: true, enrollYear: true, role: true, studentSso: true, status: true,
          mutedUntil: true,
          postCount: true, replyCount: true, reputation: true,
          forumEnabled: true, forumEnabledAt: true,
          anonymousCredits: true, anonymousWeekKey: true, anonymousCreditsFrozen: true,
          aiReviewWhitelisted: true,
          lastSeenAt: true, lastLoginAt: true, lastLoginClient: true, usedIosClient: true, usedAndroidClient: true, usedHarmonyClient: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    ok(res, {
      page,
      size,
      total,
      list: list.map((user) => {
        const trust = buildUserTrustSnapshot(user as any);
        return {
          ...user,
          reputation: trust.reputation,
          reputationLevel: trust.reputationLevel,
          reputationBreakdown: trust.reputationBreakdown,
          anonymousState: trust.anonymousState,
        };
      }),
    });
  } catch (e) { next(e); }
});

const userPatchSchema = z.object({
  status: z.enum(["active", "banned", "muted"]).optional(),
  role: z.enum(["user", "mod", "admin", "bot"]).optional(),
  nickname: z.string().min(1).max(20).optional(),
  aiReviewWhitelisted: z.boolean().optional(),
  mutedUntil: z.string().trim().max(64).nullable().optional(),
  anonymousCredits: z.number().int().min(0).max(999).optional(),
  anonymousCreditsFrozen: z.boolean().optional(),
});

adminRouter.patch("/users/:id", modOrAbove, validate(userPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    if (id === req.user!.userId && req.body.role && req.body.role !== "admin") {
      throw Errors.badRequest("不能给自己降级");
    }
    // 改角色仅 admin 可做
    if (req.body.role !== undefined && req.user!.role !== "admin") {
      throw Errors.forbidden("仅管理员可修改角色");
    }
    if (req.body.aiReviewWhitelisted !== undefined && req.user!.role !== "admin") {
      throw Errors.forbidden("仅管理员可修改 AI 审核白名单");
    }
    if ((req.body.anonymousCredits !== undefined || req.body.anonymousCreditsFrozen !== undefined) && req.user!.role !== "admin") {
      throw Errors.forbidden("仅管理员可调整匿名积分");
    }
    const current = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mutedUntil: true,
        createdAt: true,
        postCount: true,
        replyCount: true,
        forumEnabled: true,
        forumEnabledAt: true,
        anonymousCredits: true,
        anonymousWeekKey: true,
        anonymousCreditsFrozen: true,
      },
    });
    if (!current) throw Errors.notFound("用户不存在");

    const data: any = {};
    if (req.body.role !== undefined) data.role = req.body.role;
    if (req.body.nickname !== undefined) data.nickname = req.body.nickname;
    if (req.body.aiReviewWhitelisted !== undefined) data.aiReviewWhitelisted = req.body.aiReviewWhitelisted;
    if (req.body.anonymousCredits !== undefined) {
      data.anonymousCredits = req.body.anonymousCredits;
      data.anonymousWeekKey = currentAnonymousWeekKey();
    }
    if (req.body.anonymousCreditsFrozen !== undefined) {
      data.anonymousCreditsFrozen = req.body.anonymousCreditsFrozen;
      if (req.body.anonymousCreditsFrozen) data.anonymousCredits = 0;
    }

    const parsedMutedUntil = parseMutedUntil(req.body.mutedUntil);
    if (req.body.status !== undefined || req.body.mutedUntil !== undefined) {
      const nextStatus = req.body.status ?? current.status;
      const nextMutedUntil = parsedMutedUntil !== undefined ? parsedMutedUntil : current.mutedUntil;
      if (nextStatus === "muted") {
        if (nextMutedUntil && nextMutedUntil.getTime() <= Date.now()) {
          throw Errors.badRequest("禁言截止时间必须晚于当前时间");
        }
        data.status = "muted";
        data.mutedUntil = nextMutedUntil ?? null;
      } else {
        data.status = nextStatus;
        data.mutedUntil = null;
      }
      if (nextStatus === "muted" || nextStatus === "banned") {
        data.anonymousCreditsFrozen = true;
        data.anonymousCredits = 0;
      }
    }

    const u = await prisma.user.update({ where: { id }, data });
    const trust = buildUserTrustSnapshot(u as any);
    ok(res, {
      id: u.id,
      role: u.role,
      status: u.status,
      mutedUntil: u.mutedUntil,
      nickname: u.nickname,
      aiReviewWhitelisted: u.aiReviewWhitelisted,
      anonymousCredits: u.anonymousCredits,
      anonymousCreditsFrozen: u.anonymousCreditsFrozen,
      anonymousState: trust.anonymousState,
      reputation: trust.reputation,
      reputationLevel: trust.reputationLevel,
    });
  } catch (e) { next(e); }
});

// 新建用户（仅 admin）—— 用于给新生 / 毕业生 / 站务 等无法走 SSO 的用户开站内账号
const userCreateSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许英文/数字/下划线"),
  password: z.string().min(6).max(64),
  nickname: z.string().min(1).max(20),
  role: z.enum(["user", "mod", "admin", "bot"]).optional(),
  college: z.string().max(40).optional(),
  enrollYear: z.number().int().min(2000).max(2100).optional(),
});

adminRouter.post("/users", adminOnly, validate(userCreateSchema), async (req, res, next) => {
  try {
    const { username, password, nickname, role, college, enrollYear } = req.body;
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw Errors.conflict("该用户名已被占用");
    const passwordHash = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({
      data: {
        username, passwordHash, nickname,
        role: role ?? "user",
        college, enrollYear,
        // studentSso 留 false：让该用户走站内独立账号密码登录
      },
    });
    await prisma.messageSetting.create({ data: { userId: u.id } }).catch(() => {});
    ok(res, {
      id: u.id, username: u.username, nickname: u.nickname, role: u.role,
      college: u.college, enrollYear: u.enrollYear, createdAt: u.createdAt,
    });
  } catch (e) { next(e); }
});

// 重置某用户密码（仅 admin）—— 用户忘记密码时由管理员介入
const resetPasswordSchema = z.object({
  newPassword: z.string().min(6).max(64),
});
adminRouter.patch("/users/:id/password", adminOnly, validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw Errors.notFound("用户不存在");
    if (target.studentSso) {
      throw Errors.badRequest("该账号走学校认证，无站内密码可重置");
    }
    const passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

adminRouter.delete("/users/:id", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("用户 ID 不合法");
    if (id === req.user!.userId) throw Errors.badRequest("不能删除当前登录的自己");

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw Errors.notFound("用户不存在");
    if (target.role === "admin") {
      const adminCount = await prisma.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) throw Errors.badRequest("不能删除最后一个管理员");
    }
    const feedCount = await prisma.schoolFeedSource.count({ where: { botUserId: id } });
    if (feedCount > 0) throw Errors.badRequest("该账号仍被学校公告爬虫源使用，请先更换爬虫机器人账号");

    const result = await prisma.$transaction(async (tx) => {
      const topics = await tx.topic.findMany({ where: { authorId: id }, select: { id: true, boardId: true } });
      const topicIds = topics.map((t) => t.id);
      const boardIds = Array.from(new Set(topics.map((t) => t.boardId)));
      const ratings = await tx.courseRating.findMany({
        where: topicIds.length ? { OR: [{ authorId: id }, { topicId: { in: topicIds } }] } : { authorId: id },
        select: { courseId: true },
      });
      const affectedCourseIds = Array.from(new Set(ratings.map((r) => r.courseId)));

      const replies = await tx.reply.findMany({ where: { authorId: id }, select: { id: true, topicId: true } });
      const replyIds = replies.map((r) => r.id);
      const affectedTopicIds = Array.from(new Set(replies.map((r) => r.topicId).filter((topicId) => !topicIds.includes(topicId))));

      if (replyIds.length) {
        await tx.reply.updateMany({
          where: { parentReplyId: { in: replyIds } },
          data: { parentReplyId: null },
        });
      }

      if (topicIds.length) {
        await tx.courseRating.deleteMany({ where: { OR: [{ authorId: id }, { topicId: { in: topicIds } }] } });
        await tx.schoolFeedItem.deleteMany({ where: { topicId: { in: topicIds } } });
      } else {
        await tx.courseRating.deleteMany({ where: { authorId: id } });
      }

      if (replyIds.length) {
        await tx.reply.deleteMany({ where: { id: { in: replyIds } } });
      }
      if (topicIds.length) {
        await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
      }

      await tx.notificationRead.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.messageSetting.deleteMany({ where: { userId: id } });
      await tx.userCourse.deleteMany({ where: { userId: id } });
      await tx.like.deleteMany({ where: { userId: id } });

      for (const topicId of affectedTopicIds) {
        const [replyCount, lastReply] = await Promise.all([
          tx.reply.count({ where: { topicId, hidden: false } }),
          tx.reply.findFirst({
            where: { topicId, hidden: false },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, authorId: true },
          }),
        ]);
        await tx.topic.update({
          where: { id: topicId },
          data: {
            replyCount,
            lastReplyAt: lastReply?.createdAt ?? null,
            lastReplyById: lastReply?.authorId ?? null,
          },
        });
      }

      for (const boardId of boardIds) {
        const count = await tx.topic.count({ where: { boardId, hidden: false } });
        await tx.board.update({ where: { id: boardId }, data: { topicCount: count } });
      }

      for (const courseId of affectedCourseIds) {
        const agg = await tx.courseRating.aggregate({
          where: { courseId },
          _count: true,
          _avg: { difficulty: true, reward: true, recommend: true, givingScore: true },
        });
        await tx.course.update({
          where: { id: courseId },
          data: {
            ratingCount: agg._count,
            avgDifficulty: agg._avg.difficulty ?? 0,
            avgReward: agg._avg.reward ?? 0,
            avgRecommend: agg._avg.recommend ?? 0,
            avgScore: agg._avg.givingScore ?? 0,
          },
        });
      }

      await tx.user.delete({ where: { id } });

      return {
        deletedUserId: id,
        deletedTopics: topicIds.length,
        deletedReplies: replyIds.length,
      };
    });

    ok(res, result);
  } catch (e) { next(e); }
});

// ============ 帖子管理 ============

adminRouter.get("/topics", modOrAbove, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const boardSlug = req.query.board ? String(req.query.board) : undefined;
    const hidden = req.query.hidden === "1" ? true : req.query.hidden === "0" ? false : undefined;
    const reviewStatus = req.query.reviewStatus ? String(req.query.reviewStatus) : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(10, Number(req.query.size ?? 20)));

    const where: any = {};
    if (q) where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
    ];
    if (typeof hidden === "boolean") where.hidden = hidden;
    if (reviewStatus) where.aiReviewStatus = reviewStatus;
    if (boardSlug) {
      const b = await prisma.board.findUnique({ where: { slug: boardSlug } });
      if (b) where.boardId = b.id;
    }

    const [list, total] = await Promise.all([
      prisma.topic.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: {
          author: { select: { id: true, username: true, nickname: true, role: true } },
          board: { select: { id: true, slug: true, name: true } },
        },
      }),
      prisma.topic.count({ where }),
    ]);
    ok(res, {
      page,
      size,
      total,
      list: list.map((item: any) => decodeTopicForViewer({
        ...item,
        globalPinned: isGlobalPinnedTopic(item.id),
      }, req.user)),
    });
  } catch (e) { next(e); }
});

adminRouter.get("/review-targets/:kind/:id", modOrAbove, async (req, res, next) => {
  try {
    const kind = String(req.params.kind);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("审核对象 ID 不合法");
    if (kind === "topic") {
      const topic = await prisma.topic.findUnique({
        where: { id },
        select: { id: true, title: true, aiReviewStatus: true, hidden: true, boardId: true },
      });
      if (!topic) throw Errors.notFound("帖子不存在");
      return ok(res, {
        kind,
        id: topic.id,
        title: topic.title,
        aiReviewStatus: topic.aiReviewStatus,
        hidden: topic.hidden,
        reviewable: topic.aiReviewStatus === "manual_requested" || topic.aiReviewStatus === "manual_reviewing",
      });
    }
    if (kind === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { id },
        select: { id: true, content: true, aiReviewStatus: true, hidden: true, topicId: true },
      });
      if (!reply) throw Errors.notFound("回复不存在");
      return ok(res, {
        kind,
        id: reply.id,
        title: reply.content.slice(0, 80),
        aiReviewStatus: reply.aiReviewStatus,
        hidden: reply.hidden,
        topicId: reply.topicId,
        reviewable: reply.aiReviewStatus === "manual_requested" || reply.aiReviewStatus === "manual_reviewing",
      });
    }
    throw Errors.badRequest("不支持的审核对象类型");
  } catch (e) { next(e); }
});

adminRouter.get("/review-targets/:kind/:id/images", modOrAbove, async (req, res, next) => {
  try {
    const kind = String(req.params.kind);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("审核对象 ID 不合法");
    if (kind === "topic") {
      const topic = await prisma.topic.findUnique({
        where: { id },
        select: { id: true, content: true },
      });
      if (!topic) throw Errors.notFound("帖子不存在");
      return ok(res, {
        kind,
        id: topic.id,
        list: await listForumImageAssetsForContent(topic.content),
      });
    }
    if (kind === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { id },
        select: { id: true, content: true, topicId: true },
      });
      if (!reply) throw Errors.notFound("回复不存在");
      return ok(res, {
        kind,
        id: reply.id,
        topicId: reply.topicId,
        list: await listForumImageAssetsForContent(reply.content),
      });
    }
    throw Errors.badRequest("不支持的审核对象类型");
  } catch (e) { next(e); }
});

adminRouter.get("/review-targets/:kind/:id/videos", modOrAbove, async (req, res, next) => {
  try {
    const kind = String(req.params.kind);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("审核对象 ID 不合法");
    if (kind === "topic") {
      const topic = await prisma.topic.findUnique({
        where: { id },
        select: { id: true, content: true },
      });
      if (!topic) throw Errors.notFound("帖子不存在");
      return ok(res, {
        kind,
        id: topic.id,
        list: await listForumVideoAssetsForContent(topic.content),
      });
    }
    if (kind === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { id },
        select: { id: true, content: true, topicId: true },
      });
      if (!reply) throw Errors.notFound("回复不存在");
      return ok(res, {
        kind,
        id: reply.id,
        topicId: reply.topicId,
        list: await listForumVideoAssetsForContent(reply.content),
      });
    }
    throw Errors.badRequest("不支持的审核对象类型");
  } catch (e) { next(e); }
});

const topicPatchSchema = z.object({
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  globalPinned: z.boolean().optional(),
  locked: z.boolean().optional(),
  boardSlug: z.string().optional(), // 转板块
  aiReviewStatus: z.enum(["manual_reviewing", "approved_manual", "rejected_manual"]).optional(),
  manualReviewNote: z.string().max(500).optional(),
});

const replyPatchSchema = z.object({
  aiReviewStatus: z.enum(["manual_reviewing", "approved_manual", "rejected_manual"]).optional(),
  manualReviewNote: z.string().max(500).optional(),
});

const forumImagePatchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  manualReviewNote: z.string().max(500).optional(),
});

const forumVideoPatchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  manualReviewNote: z.string().max(500).optional(),
});

adminRouter.patch("/topics/:id", modOrAbove, validate(topicPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        title: true,
        hidden: true,
        isAnonymous: true,
        aiReviewStatus: true,
        pinned: true,
        locked: true,
        board: { select: { type: true } },
      },
    });
    if (!existing) throw Errors.notFound("帖子不存在");
    const data: any = {};
    if (typeof req.body.hidden === "boolean") data.hidden = req.body.hidden;
    if (typeof req.body.pinned === "boolean") data.pinned = req.body.pinned;
    if (typeof req.body.locked === "boolean") data.locked = req.body.locked;
    const wantsGlobalPinned = typeof req.body.globalPinned === "boolean" ? req.body.globalPinned : undefined;
    if (req.body.boardSlug) {
      const target = await prisma.board.findUnique({ where: { slug: req.body.boardSlug } });
      if (!target) throw Errors.notFound("目标板块不存在");
      if (target.readOnly) throw Errors.badRequest("不能转入只读板块");
      data.boardId = target.id;
      if (wantsGlobalPinned && target.type === "announce") {
        throw Errors.badRequest("公告板帖子不能设为全局置顶");
      }
    }
    if (wantsGlobalPinned && (existing.hidden || data.hidden === true)) {
      throw Errors.badRequest("隐藏帖子不能设为全局置顶");
    }
    if (wantsGlobalPinned && existing.board?.type === "announce") {
      throw Errors.badRequest("公告板帖子不能设为全局置顶");
    }
    if (req.body.aiReviewStatus) {
      if (!["manual_requested", "manual_reviewing"].includes(existing.aiReviewStatus)) {
        throw Errors.badRequest("该帖子当前不处于待人工审核状态");
      }
      data.aiReviewStatus = req.body.aiReviewStatus;
      data.manualReviewedById = req.user!.userId;
      data.manualReviewedAt = new Date();
      data.manualReviewNote = req.body.manualReviewNote ?? "";
      if (req.body.aiReviewStatus === "approved_manual") {
        data.hidden = false;
      }
      if (req.body.aiReviewStatus === "rejected_manual") {
        data.hidden = true;
      }
    }
    const hiddenChanged = typeof data.hidden === "boolean" && data.hidden !== existing.hidden;
    const boardChanged = typeof data.boardId === "number" && data.boardId !== existing.boardId;
    const u = await prisma.$transaction(async (tx) => {
      const updated = await tx.topic.update({ where: { id }, data });
      if (hiddenChanged || boardChanged) {
        const refreshJobs: Promise<unknown>[] = [
          refreshBoardTopicCounts([existing.boardId, updated.boardId], tx),
        ];
        if (hiddenChanged) {
          refreshJobs.push(refreshUserPostCount(updated.authorId, tx));
        }
        await Promise.all(refreshJobs);
      }
      return updated;
    });
    if (wantsGlobalPinned !== undefined) {
      await setTopicGlobalPinned(u.id, wantsGlobalPinned);
    } else if (u.hidden) {
      await removeTopicFromGlobalPins(u.id);
    }
    if (req.body.aiReviewStatus) {
      await refreshTopicSubmissionLock(u.authorId);
      if (req.body.aiReviewStatus === "rejected_manual" && existing.isAnonymous) {
        await freezeAnonymousCredits(u.authorId);
      }
      if (req.body.aiReviewStatus === "approved_manual" || req.body.aiReviewStatus === "rejected_manual") {
        await notifyManualReviewDecision({
          topicId: u.id,
          userId: u.authorId,
          approved: req.body.aiReviewStatus === "approved_manual",
          title: u.title,
          note: req.body.manualReviewNote ?? "",
        });
        await resolveTopicManualReviewAdminNotifications({
          topicId: u.id,
          approved: req.body.aiReviewStatus === "approved_manual",
          note: req.body.manualReviewNote ?? "",
        });
      }
    }
    await invalidateForumCaches({ includeCourses: true });
    ok(res, {
      id: u.id,
      hidden: u.hidden,
      pinned: u.pinned,
      globalPinned: isGlobalPinnedTopic(u.id),
      locked: u.locked,
      boardId: u.boardId,
    });
  } catch (e) { next(e); }
});

adminRouter.delete("/topics/:id", modOrAbove, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const hard = req.query.hard === "1" || req.query.hard === "true";
    const topic = await prisma.topic.findUnique({ where: { id }, select: { boardId: true, hidden: true, authorId: true } });
    if (!topic) throw Errors.notFound("帖子不存在");
    if (hard) {
      await prisma.$transaction(async (tx) => {
        await tx.schoolFeedItem.deleteMany({ where: { topicId: id } });
        await tx.topic.delete({ where: { id } });
        await Promise.all([
          refreshBoardTopicCounts([topic.boardId], tx),
          refreshUserPostCount(topic.authorId, tx),
        ]);
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.topic.update({ where: { id }, data: { hidden: true } });
        if (!topic.hidden) {
          await Promise.all([
            refreshBoardTopicCounts([topic.boardId], tx),
            refreshUserPostCount(topic.authorId, tx),
          ]);
        }
      });
    }
    await removeTopicFromGlobalPins(id);
    await invalidateForumCaches({ includeCourses: true });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

adminRouter.patch("/replies/:id", modOrAbove, validate(replyPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.reply.findUnique({
      where: { id },
      select: { id: true, topicId: true, authorId: true, content: true, hidden: true, floor: true, isAnonymous: true, aiReviewStatus: true, createdAt: true },
    });
    if (!existing) throw Errors.notFound("回复不存在");
    const data: any = {};
    if (req.body.aiReviewStatus) {
      if (!["manual_requested", "manual_reviewing"].includes(existing.aiReviewStatus)) {
        throw Errors.badRequest("该回复当前不处于待人工审核状态");
      }
      data.aiReviewStatus = req.body.aiReviewStatus;
      data.aiReviewedAt = new Date();
      if (req.body.aiReviewStatus === "approved_manual") {
        const last = await prisma.reply.findFirst({
          where: { topicId: existing.topicId, hidden: false },
          orderBy: { floor: "desc" },
          select: { floor: true },
        });
        data.hidden = false;
        data.floor = (last?.floor ?? 0) + 1;
      }
      if (req.body.aiReviewStatus === "rejected_manual") {
        data.hidden = true;
      }
    }
    const updated = await prisma.reply.update({ where: { id }, data });
    if (req.body.aiReviewStatus === "approved_manual" && existing.hidden) {
      const now = new Date();
      await prisma.topic.update({
        where: { id: existing.topicId },
        data: {
          replyCount: { increment: 1 },
          lastReplyAt: now,
          lastReplyById: existing.authorId,
        },
      }).catch(() => {});
      await prisma.user.update({
        where: { id: existing.authorId },
        data: { replyCount: { increment: 1 } },
      }).catch(() => {});
    }
    if (req.body.aiReviewStatus === "approved_manual" || req.body.aiReviewStatus === "rejected_manual") {
      if (req.body.aiReviewStatus === "rejected_manual" && existing.isAnonymous) {
        await freezeAnonymousCredits(updated.authorId);
      }
      await notifyManualReplyReviewDecision({
        replyId: updated.id,
        topicId: updated.topicId,
        userId: updated.authorId,
        approved: req.body.aiReviewStatus === "approved_manual",
        content: updated.content,
        note: req.body.manualReviewNote ?? "",
      });
      await resolveReplyManualReviewAdminNotifications({
        replyId: updated.id,
        approved: req.body.aiReviewStatus === "approved_manual",
        note: req.body.manualReviewNote ?? "",
      });
    }
    await invalidateForumCaches({ includeBoards: false });
    ok(res, {
      id: updated.id,
      topicId: updated.topicId,
      hidden: updated.hidden,
      floor: updated.floor,
      aiReviewStatus: updated.aiReviewStatus,
    });
  } catch (e) { next(e); }
});

adminRouter.patch("/forum-images/:id", modOrAbove, validate(forumImagePatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("图片 ID 不合法");
    const updated = await applyManualForumImageReview({
      assetId: id,
      reviewerId: req.user!.userId,
      approved: req.body.status === "approved",
      note: req.body.manualReviewNote ?? "",
    });
    if (!updated) throw Errors.notFound("图片不存在");
    await invalidateForumCaches({ includeBoards: false });
    ok(res, {
      id: updated.id,
      url: updated.url,
      status: updated.status,
      reason: updated.reason,
      detail: updated.detail,
      reviewedAt: updated.reviewedAt,
      manualReviewedAt: updated.manualReviewedAt,
      manualReviewNote: updated.manualReviewNote,
      manualReviewedBy: updated.manualReviewedBy,
    });
  } catch (e) { next(e); }
});

adminRouter.get("/forum-videos", adminOnly, async (req, res, next) => {
  try {
    ok(res, await listForumVideoQueue({
      status: req.query.status ? String(req.query.status) as any : undefined,
      page: Number(req.query.page ?? 1),
      size: Number(req.query.size ?? 20),
    }));
  } catch (e) { next(e); }
});

adminRouter.patch("/forum-videos/:id", modOrAbove, validate(forumVideoPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("视频 ID 不合法");
    const updated = await applyManualForumVideoReview({
      assetId: id,
      reviewerId: req.user!.userId,
      approved: req.body.status === "approved",
      note: req.body.manualReviewNote ?? "",
    });
    if (!updated) throw Errors.notFound("视频不存在");
    await invalidateForumCaches({ includeBoards: false });
    ok(res, {
      id: updated.id,
      url: updated.url,
      status: updated.status,
      reason: updated.reason,
      detail: updated.detail,
      reviewedAt: updated.reviewedAt,
      manualReviewedAt: updated.manualReviewedAt,
      manualReviewNote: updated.manualReviewNote,
      manualReviewedBy: updated.manualReviewedBy,
      durationMs: updated.durationMs,
      width: updated.width,
      height: updated.height,
      hasAudio: updated.hasAudio,
      transcriptStatus: updated.transcriptStatus,
    });
  } catch (e) { next(e); }
});

// ============ 板块管理 ============

adminRouter.get("/boards", adminOnly, async (_req, res, next) => {
  try {
    const list = await prisma.board.findMany({
      orderBy: [{ order: "asc" }, { id: "asc" }],
      include: {
        feedSource: { select: { id: true, name: true } },
      },
    });
    ok(res, list);
  } catch (e) { next(e); }
});

const boardTypeSchema = z.enum(["normal", "question", "market", "coursereview"]);
const boardCreateSchema = z.object({
  slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "slug 仅支持小写字母、数字和中划线"),
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(140).optional(),
  icon: z.string().trim().max(8).optional(),
  color: z.string().trim().max(20).optional(),
  order: z.number().int().min(0).max(9999).optional(),
  type: boardTypeSchema,
  anonymousEnabled: z.boolean().optional(),
});

adminRouter.post("/boards", adminOnly, validate(boardCreateSchema), async (req, res, next) => {
  try {
    const created = await prisma.board.create({
      data: {
        slug: req.body.slug,
        name: req.body.name,
        description: req.body.description || null,
        icon: req.body.icon || null,
        color: req.body.color || null,
        order: req.body.order ?? 0,
        type: req.body.type,
        anonymousEnabled: req.body.anonymousEnabled ?? false,
        readOnly: false,
      },
    });
    await invalidateBoardCaches();
    await invalidateForumCaches();
    ok(res, created);
  } catch (e) { next(e); }
});

const boardPatchSchema = z.object({
  slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "slug 仅支持小写字母、数字和中划线").optional(),
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(140).optional(),
  icon: z.string().trim().max(8).optional(),
  color: z.string().trim().max(20).optional(),
  order: z.number().int().min(0).max(9999).optional(),
  type: boardTypeSchema.optional(),
  anonymousEnabled: z.boolean().optional(),
});

adminRouter.patch("/boards/:id", adminOnly, validate(boardPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.board.findUnique({ where: { id }, include: { feedSource: true } });
    if (!current) throw Errors.notFound("板块不存在");
    if (current.readOnly || current.feedSourceId) {
      throw Errors.badRequest("公告同步板块请通过公告源配置维护");
    }
    const updated = await prisma.board.update({
      where: { id },
      data: {
        slug: req.body.slug,
        name: req.body.name,
        description: req.body.description,
        icon: req.body.icon,
        color: req.body.color,
        order: req.body.order,
        type: req.body.type,
        anonymousEnabled: req.body.anonymousEnabled,
      },
    });
    await invalidateBoardCaches();
    await invalidateForumCaches();
    ok(res, updated);
  } catch (e) { next(e); }
});

adminRouter.delete("/boards/:id", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const board = await prisma.board.findUnique({ where: { id } });
    if (!board) throw Errors.notFound("板块不存在");
    if (board.readOnly || board.feedSourceId) throw Errors.badRequest("公告同步板块不能在这里删除");
    const topicCount = await prisma.topic.count({ where: { boardId: id } });
    if (topicCount > 0) throw Errors.badRequest("该板块下仍有帖子，不能删除");
    await prisma.board.delete({ where: { id } });
    await invalidateBoardCaches();
    await invalidateForumCaches();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

// ============ 爬虫管理 ============

adminRouter.get("/feeds", adminOnly, async (_req, res, next) => {
  try {
    const list = await prisma.schoolFeedSource.findMany({
      orderBy: { id: "asc" },
      include: { board: { select: { slug: true, name: true, topicCount: true } } },
    });
    ok(res, list);
  } catch (e) { next(e); }
});

adminRouter.patch("/feeds/:id", adminOnly, validate(z.object({
  enabled: z.boolean().optional(),
  cronMinutes: z.number().int().min(1).max(1440).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
})), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const u = await prisma.schoolFeedSource.update({ where: { id }, data: req.body });
    ok(res, u);
  } catch (e) { next(e); }
});

adminRouter.post("/feeds/run-all", adminOnly, async (_req, res, next) => {
  try {
    const r = await runAllOnce();
    ok(res, r);
  } catch (e) { next(e); }
});

adminRouter.post("/feeds/:id/run", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // 标记只跑这一个 —— 简化：临时禁用别的、跑全部、再恢复
    const all = await prisma.schoolFeedSource.findMany();
    const others = all.filter((s) => s.id !== id && s.enabled);
    await prisma.schoolFeedSource.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { enabled: false },
    });
    const r = await runAllOnce();
    // 恢复
    await prisma.schoolFeedSource.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { enabled: true },
    });
    ok(res, r.find((x) => x.slug === all.find((s) => s.id === id)?.slug) ?? r);
  } catch (e) { next(e); }
});

adminRouter.post("/feeds/:id/reset-run", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await resetSourceAndRun(id);
    ok(res, r);
  } catch (e) { next(e); }
});

// ============ 校园墙同步 ============

adminRouter.get("/weiwall-sync", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await getWeiwallSyncAdminConfig());
  } catch (e) { next(e); }
});

adminRouter.patch("/weiwall-sync", adminOnly, validate(z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(240).optional(),
  schoolEn: z.string().trim().max(40).optional(),
  tenantId: z.number().int().min(1).max(999999).optional(),
  token: z.string().trim().max(4000).optional(),
  clearToken: z.boolean().optional(),
  intervalSeconds: z.number().int().min(30).max(3600).optional(),
  topicPages: z.number().int().min(1).max(20).optional(),
  commentPageSize: z.number().int().min(5).max(20).optional(),
  maxCommentPages: z.number().int().min(1).max(50).optional(),
  maxReplyPages: z.number().int().min(1).max(50).optional(),
})), async (req, res, next) => {
  try {
    ok(res, await updateWeiwallSyncConfig(req.body));
  } catch (e) { next(e); }
});

adminRouter.post("/weiwall-sync/run", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await runWeiwallSyncNow());
  } catch (e) { next(e); }
});

adminRouter.post("/weiwall-sync/auth-link", adminOnly, async (req, res, next) => {
  try {
    ok(res, await createWeiwallTokenAuthSession(requestOrigin(req)));
  } catch (e) { next(e); }
});

adminRouter.get("/weiwall-sync/auth-status/:flowId", adminOnly, async (req, res, next) => {
  try {
    ok(res, await getWeiwallTokenAuthStatus(String(req.params.flowId || "")));
  } catch (e) { next(e); }
});

// ============ 站务公告 ============

adminRouter.get("/announcements", adminOnly, async (_req, res, next) => {
  try {
    const list = await prisma.notification.findMany({
      where: { userId: null, category: "system" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, list);
  } catch (e) { next(e); }
});

adminRouter.post("/announcements", adminOnly, validate(z.object({
  title: z.string().min(2).max(120),
  content: z.string().min(1).max(2000),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  link: z.string().max(500).optional(),
  source: z.string().max(40).optional(),
  targetClient: z.enum(["all", "ios", "android", "harmony"]).optional(),
})), async (req, res, next) => {
  try {
    const n = await prisma.notification.create({
      data: {
        userId: null, // 全站广播
        category: "system",
        targetClient: req.body.targetClient && req.body.targetClient !== "all" ? req.body.targetClient : null,
        level: req.body.level ?? "normal",
        title: req.body.title,
        content: req.body.content,
        link: req.body.link || null,
        source: req.body.source?.trim() || "站务组",
      },
    });
    ok(res, n);
  } catch (e) { next(e); }
});

const announcementPatchSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  content: z.string().min(1).max(2000).optional(),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  link: z.string().max(500).nullable().optional(),
  source: z.string().max(40).nullable().optional(),
  targetClient: z.enum(["all", "ios", "android", "harmony"]).optional(),
});

adminRouter.patch("/announcements/:id", adminOnly, validate(announcementPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("公告 ID 不合法");
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("公告不存在");
    if (existing.userId !== null || existing.category !== "system") {
      throw Errors.badRequest("只能编辑全站公告");
    }
    const updated = await prisma.notification.update({
      where: { id },
      data: {
        title: req.body.title,
        content: req.body.content,
        level: req.body.level,
        link: req.body.link === undefined ? undefined : (req.body.link || null),
        source: req.body.source === undefined ? undefined : (req.body.source?.trim() || "站务组"),
        targetClient: req.body.targetClient === undefined
          ? undefined
          : (req.body.targetClient === "all" ? null : req.body.targetClient),
      },
    });
    ok(res, updated);
  } catch (e) { next(e); }
});

adminRouter.delete("/announcements/:id", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n) throw Errors.notFound();
    if (n.userId !== null) throw Errors.badRequest("不能删除非全局通知");
    await prisma.notification.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

// ============ 支付对接：易支付 ============

adminRouter.get("/epay-config", adminOnly, async (req, res, next) => {
  try {
    ok(res, await getEpayConfig(requestOrigin(req)));
  } catch (e) { next(e); }
});

const epayConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  gatewayUrl: z.string().trim().max(240).optional(),
  pid: z.string().trim().max(80).optional(),
  merchantKey: z.string().trim().max(240).optional(),
  clearMerchantKey: z.boolean().optional(),
  signType: z.enum(["MD5"]).optional(),
  defaultType: z.enum(["alipay", "wxpay", "qqpay", "bank", "jdpay"]).optional(),
  enabledTypes: z.array(z.enum(["alipay", "wxpay", "qqpay", "bank", "jdpay"])).min(1).optional(),
});

adminRouter.patch("/epay-config", adminOnly, validate(epayConfigPatchSchema), async (req, res, next) => {
  try {
    ok(res, await updateEpayConfig(req.body, requestOrigin(req)));
  } catch (e: any) {
    if (
      e?.message === "易支付网关地址格式不正确"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

const epayPreviewSchema = z.object({
  outTradeNo: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  money: z.string().trim().min(1).max(20),
  type: z.enum(["alipay", "wxpay", "qqpay", "bank", "jdpay"]).optional(),
  notifyUrl: z.string().trim().max(500).optional(),
  returnUrl: z.string().trim().max(500).optional(),
  clientIp: z.string().trim().max(80).optional(),
  device: z.string().trim().max(40).optional(),
  param: z.string().trim().max(200).optional(),
});

adminRouter.post("/epay-config/preview", adminOnly, validate(epayPreviewSchema), async (req, res, next) => {
  try {
    const origin = resolvePaymentOrigin(requestOrigin(req));
    const callbacks = buildEpayCallbackUrls(origin);
    ok(res, await buildEpaySubmitPayload({ ...req.body, ...callbacks }));
  } catch (e: any) {
    if (
      e?.message === "支付金额不正确" ||
      e?.message === "该支付方式未启用" ||
      e?.message === "易支付尚未启用" ||
      e?.message === "易支付网关地址未配置" ||
      e?.message === "易支付商户 ID 未配置" ||
      e?.message === "易支付商户密钥未配置" ||
      e?.message === "商户订单号不能为空" ||
      e?.message === "商品名称不能为空" ||
      e?.message === "异步通知地址未配置" ||
      e?.message === "同步跳转地址未配置"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

// ============ 赞助管理 ============

adminRouter.get("/sponsor-config", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await getSponsorConfig());
  } catch (e) { next(e); }
});

const sponsorConfigPatchSchema = z.object({
  title: z.string().trim().max(40).optional(),
  description: z.string().trim().max(300).optional(),
  presetAmounts: z.array(z.union([z.string(), z.number()])).min(1).max(8).optional(),
  minAmount: z.union([z.string(), z.number()]).optional(),
  maxAmount: z.union([z.string(), z.number()]).optional(),
  wallEnabled: z.boolean().optional(),
  allowMessage: z.boolean().optional(),
});

adminRouter.patch("/sponsor-config", adminOnly, validate(sponsorConfigPatchSchema), async (req, res, next) => {
  try {
    ok(res, await updateSponsorConfig(req.body));
  } catch (e: any) {
    if (e?.message === "支付金额不正确") {
      next(Errors.badRequest("赞助金额配置不正确"));
      return;
    }
    next(e);
  }
});

adminRouter.get("/sponsor-overview", adminOnly, async (_req, res, next) => {
  try {
    await closeExpiredSponsorOrders();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const [paid, today, month, pending, closed, sponsors, payTypes] = await Promise.all([
      prisma.sponsorOrder.aggregate({ where: { status: "paid" }, _sum: { amountCents: true }, _count: true }),
      prisma.sponsorOrder.aggregate({ where: { status: "paid", paidAt: { gte: todayStart } }, _sum: { amountCents: true }, _count: true }),
      prisma.sponsorOrder.aggregate({ where: { status: "paid", paidAt: { gte: monthStart } }, _sum: { amountCents: true }, _count: true }),
      prisma.sponsorOrder.count({ where: { status: "pending" } }),
      prisma.sponsorOrder.count({ where: { status: "closed" } }),
      prisma.sponsorOrder.groupBy({ by: ["userId"], where: { status: "paid" }, _sum: { amountCents: true } }),
      prisma.sponsorOrder.groupBy({ by: ["payType"], where: { status: "paid" }, _sum: { amountCents: true }, _count: true }),
    ]);
    ok(res, {
      totalAmount: amountCentsToMoney(paid._sum.amountCents ?? 0),
      totalPaidOrders: paid._count,
      todayAmount: amountCentsToMoney(today._sum.amountCents ?? 0),
      todayPaidOrders: today._count,
      monthAmount: amountCentsToMoney(month._sum.amountCents ?? 0),
      monthPaidOrders: month._count,
      pendingOrders: pending,
      closedOrders: closed,
      sponsorCount: sponsors.length,
      payTypes: payTypes.map((item) => ({
        payType: item.payType,
        count: item._count,
        amount: amountCentsToMoney(item._sum.amountCents ?? 0),
      })),
    });
  } catch (e) { next(e); }
});

adminRouter.get("/sponsor-orders", adminOnly, async (req, res, next) => {
  try {
    await closeExpiredSponsorOrders();
    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size ?? 20)));
    const where: any = {};
    if (status && status !== "all") where.status = status;
    if (q) {
      where.OR = [
        { outTradeNo: { contains: q } },
        { tradeNo: { contains: q } },
        { user: { is: { username: { contains: q } } } },
        { user: { is: { nickname: { contains: q } } } },
      ];
    }
    const [list, total] = await Promise.all([
      prisma.sponsorOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
      }),
      prisma.sponsorOrder.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map(formatSponsorOrder) });
  } catch (e) { next(e); }
});

const sponsorOrderPatchSchema = z.object({
  status: z.enum(["pending", "paid", "closed"]).optional(),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(["public", "anonymous", "hidden"]).optional(),
});

adminRouter.patch("/sponsor-orders/:id", adminOnly, validate(sponsorOrderPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.sponsorOrder.findUnique({ where: { id }, include: { user: true } });
    if (!current) throw Errors.notFound("订单不存在");
    const data: any = {
      message: req.body.message,
      displayMode: req.body.displayMode,
    };
    if (req.body.status && req.body.status !== current.status) {
      if (req.body.status === "paid") {
        data.status = "paid";
        data.paidAt = current.paidAt ?? new Date();
        data.closedAt = null;
        data.expiresAt = current.expiresAt ?? calcSponsorOrderExpiresAt(current.createdAt ?? new Date());
      } else if (req.body.status === "closed") {
        data.status = "closed";
        data.closedAt = current.closedAt ?? new Date();
      } else {
        data.status = "pending";
        data.closedAt = null;
        data.expiresAt = calcSponsorOrderExpiresAt();
      }
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.sponsorOrder.update({ where: { id }, data, include: { user: true } });
      if (req.body.status && req.body.status !== current.status) {
        if (current.status !== "paid" && req.body.status === "paid") {
          await tx.user.update({ where: { id: current.userId }, data: { sponsorTotalCents: { increment: current.amountCents } } });
        }
        if (current.status === "paid" && req.body.status !== "paid") {
          await tx.user.update({
            where: { id: current.userId },
            data: { sponsorTotalCents: { decrement: current.amountCents } },
          });
        }
      }
      return row;
    });
    ok(res, formatSponsorOrder(updated));
  } catch (e) { next(e); }
});

adminRouter.get("/sponsor-logs", adminOnly, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const signOk = req.query.signOk === "1" ? true : req.query.signOk === "0" ? false : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size ?? 20)));
    const where: any = {};
    if (q) where.OR = [{ outTradeNo: { contains: q } }, { result: { contains: q } }];
    if (typeof signOk === "boolean") where.signOk = signOk;
    const [list, total] = await Promise.all([
      prisma.sponsorPaymentLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: { order: { select: { id: true, amountCents: true, status: true } } },
      }),
      prisma.sponsorPaymentLog.count({ where }),
    ]);
    ok(res, { page, size, total, list });
  } catch (e) { next(e); }
});

// ============ 概览 / 健康 ============

adminRouter.get("/overview", modOrAbove, async (_req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const regularUserWhere = { role: "user" as const };

    const [
      users,
      banned,
      topics,
      hiddenTopics,
      replies,
      todayTopics,
      feeds,
      boards,
      iosClients,
      androidClients,
      harmonyClients,
      recentLogins,
      forumEligibleUsers,
      forumEnabledUsers,
      forumEnabledToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "banned" } }),
      prisma.topic.count({ where: { hidden: false } }),
      prisma.topic.count({ where: { hidden: true } }),
      prisma.reply.count({ where: { hidden: false } }),
      prisma.topic.count({
        where: { createdAt: { gte: todayStart }, hidden: false },
      }),
      prisma.schoolFeedSource.count({ where: { enabled: true } }),
      prisma.board.count(),
      prisma.user.count({ where: { usedIosClient: true } }),
      prisma.user.count({ where: { usedAndroidClient: true } }),
      prisma.user.count({ where: { usedHarmonyClient: true } }),
      prisma.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: regularUserWhere }),
      prisma.user.count({ where: { ...regularUserWhere, forumEnabled: true } }),
      prisma.user.count({ where: { ...regularUserWhere, forumEnabled: true, forumEnabledAt: { gte: todayStart } } }),
    ]);
    const forumPendingUsers = Math.max(0, forumEligibleUsers - forumEnabledUsers);
    ok(res, {
      users,
      banned,
      topics,
      hiddenTopics,
      replies,
      todayTopics,
      feeds,
      boards,
      iosClients,
      androidClients,
      harmonyClients,
      recentLogins,
      forumEligibleUsers,
      forumEnabledUsers,
      forumPendingUsers,
      forumEnabledToday,
    });
  } catch (e) { next(e); }
});

// ============ 站点功能开关 ============

adminRouter.get("/site-config", adminOnly, (_req, res) => {
  ok(res, getSiteConfig());
});

adminRouter.get("/site-config/prompt-defaults", adminOnly, (_req, res) => {
  ok(res, getSitePromptDefaults());
});

adminRouter.get("/media-storage", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await getMediaStorageAdminConfig());
  } catch (e) { next(e); }
});

const mediaStoragePatchSchema = z.object({
  mediaStorageProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageImageProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageVideoProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageRemotePrefixes: z.union([z.string().trim().max(200), z.array(z.string().trim().min(1).max(80)).max(10)]).optional(),
  oneDriveChinaClientId: z.string().trim().max(120).optional(),
  oneDriveChinaClientSecret: z.string().trim().max(240).optional(),
  clearOneDriveChinaClientSecret: z.boolean().optional(),
  oneDriveChinaSharepointUrl: z.string().trim().max(500).optional(),
  oneDriveChinaRootPath: z.string().trim().max(240).optional(),
});

adminRouter.patch("/media-storage", adminOnly, validate(mediaStoragePatchSchema), async (req, res, next) => {
  try {
    ok(res, await updateMediaStorageAdminConfig(req.body));
  } catch (e: any) {
    if (
      e?.message === "SharePoint 地址格式不正确" ||
      e?.message === "SharePoint 地址仅支持 http 或 https"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/media-storage/onedrive-cn/authorize", adminOnly, async (req, res, next) => {
  try {
    ok(res, await buildOneDriveChinaAuthorization({
      requestOrigin: requestOrigin(req),
      adminUserId: req.user!.userId,
    }));
  } catch (e: any) {
    if (
      e?.message === "请先填写 Azure 应用 ID" ||
      e?.message === "请先填写 Azure 应用密钥" ||
      e?.message === "请先填写 SharePoint 站点地址" ||
      e?.message === "当前请求缺少可用站点域名，无法生成回调地址"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/media-storage/onedrive-cn/validate-client", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await validateOneDriveChinaClientCredentials());
  } catch (e: any) {
    if (
      e?.message === "请先填写 Azure 应用 ID" ||
      e?.message === "请先填写 Azure 应用密钥" ||
      String(e?.message || "").startsWith("Azure 应用密钥校验失败：")
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.get("/media-storage/onedrive-cn/drives", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await listOneDriveChinaDriveOptions());
  } catch (e: any) {
    if (
      e?.message === "请先填写 SharePoint 站点地址" ||
      e?.message === "请先在后台点击登录授权" ||
      e?.message === "世纪互联 OneDrive / SharePoint 尚未完成授权"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

const mediaStorageDriveSchema = z.object({
  driveId: z.string().trim().min(1).max(160),
});

adminRouter.patch("/media-storage/onedrive-cn/drive", adminOnly, validate(mediaStorageDriveSchema), async (req, res, next) => {
  try {
    ok(res, await saveOneDriveChinaDriveSelection(req.body.driveId));
  } catch (e: any) {
    if (e?.message === "所选文档库不存在") {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.delete("/media-storage/onedrive-cn/authorization", adminOnly, async (_req, res, next) => {
  try {
    await disconnectOneDriveChinaAuthorization();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

adminRouter.get("/media-storage/files", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await listMediaStorageAdminInventory());
  } catch (e) { next(e); }
});

adminRouter.post("/media-storage/migrate", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await migrateLocalMediaAssetsToRemote());
  } catch (e: any) {
    if (
      e?.message === "请先将媒体存储后端切换为世纪互联 OneDrive / SharePoint"
      || e?.message === "请先至少将图片或视频中的一种媒体后端切换为世纪互联 OneDrive / SharePoint"
      || e?.message === "世纪互联 OneDrive / SharePoint 尚未完成授权或未选择文档库"
      || e?.message === "请先在后台点击登录授权"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/media-storage/cleanup-local", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await cleanupMigratedLocalMediaAssets());
  } catch (e: any) {
    if (
      e?.message === "请先将媒体存储后端切换为世纪互联 OneDrive / SharePoint"
      || e?.message === "请先至少将图片或视频中的一种媒体后端切换为世纪互联 OneDrive / SharePoint"
      || e?.message === "世纪互联 OneDrive / SharePoint 尚未完成授权或未选择文档库"
      || e?.message === "请先在后台点击登录授权"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

const cloudDrivePathSchema = z.object({
  path: z.string().trim().max(800).optional().default(""),
});

const cloudDriveFolderSchema = z.object({
  path: z.string().trim().max(800).optional().default(""),
  name: z.string().trim().min(1).max(255),
});

const cloudDriveRenameSchema = z.object({
  path: z.string().trim().min(1).max(800),
  name: z.string().trim().min(1).max(255),
});

const cloudDriveDeleteSchema = z.object({
  path: z.string().trim().min(1).max(800),
});

const cloudDriveAccessSchema = z.object({
  path: z.string().trim().min(1).max(800),
  download: z.boolean().optional(),
});

const cloudDriveUploadInitSchema = z.object({
  path: z.string().trim().max(800).optional().default(""),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(200).optional().default(""),
  fileSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
});

const cloudDriveUploadCompleteSchema = z.object({
  uploadToken: z.string().trim().min(1).max(2000),
});

adminRouter.get("/cloud-drive", adminOnly, validate(cloudDrivePathSchema, "query"), async (req, res, next) => {
  try {
    ok(res, await listCloudDriveDirectory(String(req.query.path || "")));
  } catch (e: any) {
    if (e?.message === "文件夹不存在" || e?.message === "当前路径不是文件夹") {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/cloud-drive/folders", adminOnly, validate(cloudDriveFolderSchema), async (req, res, next) => {
  try {
    ok(res, await createCloudDriveFolder(req.body.path || "", req.body.name));
  } catch (e: any) {
    if (e?.message === "同名文件或文件夹已存在" || e?.message === "名称不能为空" || e?.message === "名称不合法") {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.patch("/cloud-drive/rename", adminOnly, validate(cloudDriveRenameSchema), async (req, res, next) => {
  try {
    ok(res, await renameCloudDriveEntry(req.body.path, req.body.name));
  } catch (e: any) {
    if (
      e?.message === "文件或文件夹不存在"
      || e?.message === "同名文件或文件夹已存在"
      || e?.message === "名称不能为空"
      || e?.message === "名称不合法"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.delete("/cloud-drive", adminOnly, validate(cloudDriveDeleteSchema, "query"), async (req, res, next) => {
  try {
    ok(res, await deleteCloudDriveEntry(String(req.query.path || "")));
  } catch (e: any) {
    if (e?.message === "文件或文件夹不存在") {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/cloud-drive/access", adminOnly, validate(cloudDriveAccessSchema), async (req, res, next) => {
  try {
    ok(res, await buildCloudDriveAccessUrl({
      relativePath: req.body.path,
      adminUserId: req.user!.userId,
      download: Boolean(req.body.download),
    }));
  } catch (e: any) {
    if (e?.message === "路径不能为空" || e?.message === "路径不合法") {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/cloud-drive/upload/init", adminOnly, validate(cloudDriveUploadInitSchema), async (req, res, next) => {
  try {
    ok(res, await prepareCloudDriveUpload({
      parentPath: req.body.path || "",
      fileName: req.body.fileName,
      mimeType: req.body.mimeType,
      fileSize: req.body.fileSize,
      adminUserId: req.user!.userId,
    }));
  } catch (e: any) {
    if (
      e?.message === "同名文件或文件夹已存在"
      || e?.message === "名称不能为空"
      || e?.message === "名称不合法"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/cloud-drive/upload/complete", adminOnly, validate(cloudDriveUploadCompleteSchema), async (req, res, next) => {
  try {
    ok(res, await completeCloudDriveUpload(req.body.uploadToken, req.user!.userId));
  } catch (e: any) {
    if (
      e?.message === "上传会话与当前账号不匹配"
      || e?.message === "文件还没上传完成，请稍后再试"
      || e?.message === "上传令牌无效"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/cloud-drive/upload", adminOnly, (req, res, next) => {
  cloudDriveUpload.single("file")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") {
      return next(Errors.badRequest("当前本地兜底上传仅支持 200MB 以内单文件"));
    }
    return next(error);
  });
}, async (req, res, next) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) throw Errors.badRequest("请先选择要上传的文件");
    ok(res, await saveCloudDriveFile({
      parentPath: String(req.body.path || ""),
      fileName: file.originalname,
      buffer: file.buffer,
      contentType: file.mimetype,
    }));
  } catch (e: any) {
    if (
      e?.message === "当前后端请使用直传会话上传"
      || e?.message === "同名文件或文件夹已存在"
      || e?.message === "名称不能为空"
      || e?.message === "名称不合法"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

const siteConfigPatchSchema = z.object({
  siteOrigin: z.string().trim().max(240).optional(),
  siteFilingNumber: z.string().trim().max(120).optional(),
  aiReviewEnabled: z.boolean().optional(),
  aiReviewProvider: z.string().trim().max(40).optional(),
  aiReviewModel: z.string().trim().max(80).optional(),
  aiReviewFallbackModels: z.string().trim().max(400).optional(),
  aiReviewApiKey: z.string().trim().max(240).optional(),
  imageReviewEnabled: z.boolean().optional(),
  imageReviewApiUrl: z.string().trim().max(240).optional(),
  imageReviewModel: z.string().trim().max(80).optional(),
  imageReviewFallbackModels: z.string().trim().max(400).optional(),
  imageReviewApiKey: z.string().trim().max(240).optional(),
  imageReviewSystemPrompt: z.string().max(8000).optional(),
  imageReviewUserPrompt: z.string().max(12000).optional(),
  imageReviewConcurrency: z.number().int().min(1).max(8).optional(),
  imageReviewRequestGroupSize: z.number().int().min(1).max(6).optional(),
  videoReviewEnabled: z.boolean().optional(),
  videoReviewApiUrl: z.string().trim().max(240).optional(),
  videoReviewModel: z.string().trim().max(80).optional(),
  videoReviewFallbackModels: z.string().trim().max(400).optional(),
  videoReviewApiKey: z.string().trim().max(240).optional(),
  videoReviewSystemPrompt: z.string().max(8000).optional(),
  videoReviewUserPrompt: z.string().max(12000).optional(),
  videoReviewConcurrency: z.number().int().min(1).max(2).optional(),
  aiReviewThreshold: z.number().int().min(0).max(100).optional(),
  imageReviewThreshold: z.number().int().min(0).max(100).optional(),
  videoReviewThreshold: z.number().int().min(0).max(100).optional(),
  aiReviewAutoPassScore: z.number().int().min(0).max(100).optional(),
  aiReviewBlockScore: z.number().int().min(0).max(100).optional(),
  imageReviewAutoPassScore: z.number().int().min(0).max(100).optional(),
  imageReviewBlockScore: z.number().int().min(0).max(100).optional(),
  videoReviewAutoPassScore: z.number().int().min(0).max(100).optional(),
  videoReviewBlockScore: z.number().int().min(0).max(100).optional(),
  aiEditSimilarityThreshold: z.number().min(0).max(1).optional(),
  aiTopicReviewSystemPrompt: z.string().max(8000).optional(),
  aiTopicReviewUserPrompt: z.string().max(12000).optional(),
  aiReplyReviewSystemPrompt: z.string().max(8000).optional(),
  aiReplyReviewUserPrompt: z.string().max(12000).optional(),
  aiEditSimilaritySystemPrompt: z.string().max(8000).optional(),
  aiEditSimilarityUserPrompt: z.string().max(12000).optional(),
  anonymousMinReputation: z.number().int().min(0).max(9999).optional(),
  accountAgeDaysPerStep: z.number().int().min(1).max(3650).optional(),
  accountAgePointsPerStep: z.number().int().min(0).max(999).optional(),
  accountAgePointsCap: z.number().int().min(0).max(9999).optional(),
  postPointsPerTopic: z.number().int().min(0).max(999).optional(),
  postPointsCap: z.number().int().min(0).max(9999).optional(),
  replyPointsPerReply: z.number().int().min(0).max(999).optional(),
  replyPointsCap: z.number().int().min(0).max(9999).optional(),
  forumEnabledBonus: z.number().int().min(0).max(9999).optional(),
  anonymousTiers: z.array(z.object({
    reputation: z.number().int().min(0).max(9999),
    quota: z.number().int().min(0).max(999),
  })).length(4).optional(),
  reputationLevels: z.array(z.object({
    level: z.number().int().min(1).max(5),
    name: z.string().trim().min(1).max(20),
    minReputation: z.number().int().min(0).max(9999),
  })).length(5).optional(),
});

adminRouter.patch("/site-config", adminOnly, validate(siteConfigPatchSchema), async (req, res, next) => {
  try {
    if (
      req.body.aiReviewEnabled !== undefined ||
      req.body.aiReviewProvider !== undefined ||
      req.body.aiReviewModel !== undefined ||
      req.body.aiReviewFallbackModels !== undefined ||
      req.body.aiReviewApiKey !== undefined ||
      req.body.imageReviewEnabled !== undefined ||
      req.body.imageReviewApiUrl !== undefined ||
      req.body.imageReviewModel !== undefined ||
      req.body.imageReviewFallbackModels !== undefined ||
      req.body.imageReviewApiKey !== undefined ||
      req.body.imageReviewSystemPrompt !== undefined ||
      req.body.imageReviewUserPrompt !== undefined ||
      req.body.imageReviewConcurrency !== undefined ||
      req.body.imageReviewRequestGroupSize !== undefined ||
      req.body.videoReviewEnabled !== undefined ||
      req.body.videoReviewApiUrl !== undefined ||
      req.body.videoReviewModel !== undefined ||
      req.body.videoReviewFallbackModels !== undefined ||
      req.body.videoReviewApiKey !== undefined ||
      req.body.videoReviewSystemPrompt !== undefined ||
      req.body.videoReviewUserPrompt !== undefined ||
      req.body.videoReviewConcurrency !== undefined ||
      req.body.aiReviewThreshold !== undefined ||
      req.body.imageReviewThreshold !== undefined ||
      req.body.videoReviewThreshold !== undefined ||
      req.body.aiReviewAutoPassScore !== undefined ||
      req.body.aiReviewBlockScore !== undefined ||
      req.body.imageReviewAutoPassScore !== undefined ||
      req.body.imageReviewBlockScore !== undefined ||
      req.body.videoReviewAutoPassScore !== undefined ||
      req.body.videoReviewBlockScore !== undefined ||
      req.body.aiEditSimilarityThreshold !== undefined ||
      req.body.aiTopicReviewSystemPrompt !== undefined ||
      req.body.aiTopicReviewUserPrompt !== undefined ||
      req.body.aiReplyReviewSystemPrompt !== undefined ||
      req.body.aiReplyReviewUserPrompt !== undefined ||
      req.body.aiEditSimilaritySystemPrompt !== undefined ||
      req.body.aiEditSimilarityUserPrompt !== undefined
    ) {
      await setAiReviewConfig(req.body);
    }
    if (
      req.body.anonymousMinReputation !== undefined ||
      req.body.accountAgeDaysPerStep !== undefined ||
      req.body.accountAgePointsPerStep !== undefined ||
      req.body.accountAgePointsCap !== undefined ||
      req.body.postPointsPerTopic !== undefined ||
      req.body.postPointsCap !== undefined ||
      req.body.replyPointsPerReply !== undefined ||
      req.body.replyPointsCap !== undefined ||
      req.body.forumEnabledBonus !== undefined ||
      req.body.anonymousTiers !== undefined ||
      req.body.reputationLevels !== undefined
    ) {
      await setCommunityTrustConfig(req.body);
    }
    if (req.body.siteOrigin !== undefined) {
      await setSiteOrigin(req.body.siteOrigin ?? "");
    }
    if (req.body.siteFilingNumber !== undefined) {
      await setSiteFilingNumber(req.body.siteFilingNumber ?? "");
    }
    const config = getSiteConfig();
    await invalidateSiteSettingCaches();
    ok(res, config);
  } catch (e: any) {
    if (
      e?.message === "网站域名格式不正确" ||
      e?.message === "网站域名仅支持 http 或 https"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

adminRouter.post("/ai-review/images/sweep", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await backfillForumImageAssetsAndTriggerModeration());
  } catch (e) { next(e); }
});

adminRouter.post("/ai-review/videos/sweep", adminOnly, async (_req, res, next) => {
  try {
    ok(res, await backfillForumVideoAssetsAndTriggerModeration());
  } catch (e) { next(e); }
});

adminRouter.get("/ai-review/logs", adminOnly, async (req, res, next) => {
  try {
    const kind = String(req.query.kind ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size ?? 30)));
    const where: any = {};
    if (kind) where.kind = kind;
    if (status) where.status = status;
    const [list, total] = await Promise.all([
      prisma.aiReviewLog.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: {
          createdBy: { select: { id: true, nickname: true, username: true } },
        },
      }),
      prisma.aiReviewLog.count({ where }),
    ]);
    ok(res, { page, size, total, list });
  } catch (e) { next(e); }
});

adminRouter.get("/features", adminOnly, (_req, res) => {
  ok(res, getFeatures());
});

const featurePatchSchema = z.object({
  forum: z.boolean().optional(),
  market: z.boolean().optional(),
  coursereview: z.boolean().optional(),
  electric: z.boolean().optional(),
  sponsor: z.boolean().optional(),
});

adminRouter.patch("/features", adminOnly, validate(featurePatchSchema), async (req, res, next) => {
  try {
    for (const f of ALL_FEATURES) {
      if (typeof req.body[f] === "boolean") {
        await setFeature(f as FeatureKey, req.body[f]);
      }
    }
    await invalidateSiteSettingCaches();
    ok(res, getFeatures());
  } catch (e) { next(e); }
});
