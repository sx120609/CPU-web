import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../prisma";
import { Errors, ok } from "../../utils/response";
import { adminOnly, modOrAbove } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { resetSourceAndRun, runAllOnce } from "../../services/schoolCrawler";
import { getFeatures, setFeature, ALL_FEATURES, type FeatureKey } from "../../services/siteSettings";

export const adminRouter = Router();

// ============ 用户管理 ============

adminRouter.get("/users", modOrAbove, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const role = req.query.role ? String(req.query.role) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const loginClient = req.query.loginClient ? String(req.query.loginClient) : undefined;
    const usedIosClient = req.query.usedIosClient === "1" ? true : req.query.usedIosClient === "0" ? false : undefined;
    const usedAndroidClient = req.query.usedAndroidClient === "1" ? true : req.query.usedAndroidClient === "0" ? false : undefined;
    const loginFrom = String(req.query.loginFrom ?? "").trim();
    const loginTo = String(req.query.loginTo ?? "").trim();
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
      else if (["ios", "android", "web", "unknown"].includes(loginClient)) where.lastLoginClient = loginClient;
    }
    if (typeof usedIosClient === "boolean") where.usedIosClient = usedIosClient;
    if (typeof usedAndroidClient === "boolean") where.usedAndroidClient = usedAndroidClient;
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

    const [list, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ lastLoginAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true, username: true, nickname: true, email: true, avatar: true,
          college: true, enrollYear: true, role: true, studentSso: true, status: true,
          postCount: true, replyCount: true, reputation: true,
          lastSeenAt: true, lastLoginAt: true, lastLoginClient: true, usedIosClient: true, usedAndroidClient: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    ok(res, { page, size, total, list });
  } catch (e) { next(e); }
});

const userPatchSchema = z.object({
  status: z.enum(["active", "banned", "muted"]).optional(),
  role: z.enum(["user", "mod", "admin", "bot"]).optional(),
  nickname: z.string().min(1).max(20).optional(),
});

adminRouter.patch("/users/:id", modOrAbove, validate(userPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user!.userId && req.body.role && req.body.role !== "admin") {
      throw Errors.badRequest("不能给自己降级");
    }
    // 改角色仅 admin 可做
    if (req.body.role !== undefined && req.user!.role !== "admin") {
      throw Errors.forbidden("仅管理员可修改角色");
    }
    const u = await prisma.user.update({ where: { id }, data: req.body });
    ok(res, { id: u.id, role: u.role, status: u.status, nickname: u.nickname });
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
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(10, Number(req.query.size ?? 20)));

    const where: any = {};
    if (q) where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
    ];
    if (typeof hidden === "boolean") where.hidden = hidden;
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
    ok(res, { page, size, total, list });
  } catch (e) { next(e); }
});

const topicPatchSchema = z.object({
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
  boardSlug: z.string().optional(), // 转板块
});

adminRouter.patch("/topics/:id", modOrAbove, validate(topicPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data: any = {};
    if (typeof req.body.hidden === "boolean") data.hidden = req.body.hidden;
    if (typeof req.body.pinned === "boolean") data.pinned = req.body.pinned;
    if (typeof req.body.locked === "boolean") data.locked = req.body.locked;
    if (req.body.boardSlug) {
      const target = await prisma.board.findUnique({ where: { slug: req.body.boardSlug } });
      if (!target) throw Errors.notFound("目标板块不存在");
      if (target.readOnly) throw Errors.badRequest("不能转入只读板块");
      data.boardId = target.id;
    }
    const u = await prisma.topic.update({ where: { id }, data });
    ok(res, { id: u.id, hidden: u.hidden, pinned: u.pinned, locked: u.locked, boardId: u.boardId });
  } catch (e) { next(e); }
});

adminRouter.delete("/topics/:id", modOrAbove, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const hard = req.query.hard === "1" || req.query.hard === "true";
    const topic = await prisma.topic.findUnique({ where: { id }, select: { boardId: true, hidden: true } });
    if (!topic) throw Errors.notFound("帖子不存在");
    if (hard) {
      await prisma.$transaction(async (tx) => {
        await tx.schoolFeedItem.deleteMany({ where: { topicId: id } });
        await tx.topic.delete({ where: { id } });
        const count = await tx.topic.count({ where: { boardId: topic.boardId, hidden: false } });
        await tx.board.update({ where: { id: topic.boardId }, data: { topicCount: count } });
      });
    } else {
      await prisma.topic.update({ where: { id }, data: { hidden: true } });
      if (!topic.hidden) {
        await prisma.board.update({ where: { id: topic.boardId }, data: { topicCount: { decrement: 1 } } }).catch(() => {});
      }
    }
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

// ============ 站务公告 ============

adminRouter.get("/announcements", modOrAbove, async (_req, res, next) => {
  try {
    const list = await prisma.notification.findMany({
      where: { userId: null, category: "system" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, list);
  } catch (e) { next(e); }
});

adminRouter.post("/announcements", modOrAbove, validate(z.object({
  title: z.string().min(2).max(120),
  content: z.string().min(1).max(2000),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  link: z.string().max(500).optional(),
})), async (req, res, next) => {
  try {
    const n = await prisma.notification.create({
      data: {
        userId: null, // 全站广播
        category: "system",
        level: req.body.level ?? "normal",
        title: req.body.title,
        content: req.body.content,
        link: req.body.link || null,
        source: "站务组",
      },
    });
    ok(res, n);
  } catch (e) { next(e); }
});

adminRouter.delete("/announcements/:id", modOrAbove, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n) throw Errors.notFound();
    if (n.userId !== null) throw Errors.badRequest("不能删除非全局通知");
    await prisma.notification.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

// ============ 概览 / 健康 ============

adminRouter.get("/overview", modOrAbove, async (_req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [users, banned, topics, hiddenTopics, replies, todayTopics, feeds, boards] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "banned" } }),
      prisma.topic.count({ where: { hidden: false } }),
      prisma.topic.count({ where: { hidden: true } }),
      prisma.reply.count({ where: { hidden: false } }),
      prisma.topic.count({
        where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, hidden: false },
      }),
      prisma.schoolFeedSource.count({ where: { enabled: true } }),
      prisma.board.count(),
    ]);
    const [iosClients, androidClients, recentLogins] = await Promise.all([
      prisma.user.count({ where: { usedIosClient: true } }),
      prisma.user.count({ where: { usedAndroidClient: true } }),
      prisma.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
    ]);
    ok(res, { users, banned, topics, hiddenTopics, replies, todayTopics, feeds, boards, iosClients, androidClients, recentLogins });
  } catch (e) { next(e); }
});

// ============ 站点功能开关 ============

adminRouter.get("/features", adminOnly, (_req, res) => {
  ok(res, getFeatures());
});

const featurePatchSchema = z.object({
  forum: z.boolean().optional(),
  market: z.boolean().optional(),
  coursereview: z.boolean().optional(),
});

adminRouter.patch("/features", adminOnly, validate(featurePatchSchema), async (req, res, next) => {
  try {
    for (const f of ALL_FEATURES) {
      if (typeof req.body[f] === "boolean") {
        await setFeature(f as FeatureKey, req.body[f]);
      }
    }
    ok(res, getFeatures());
  } catch (e) { next(e); }
});
