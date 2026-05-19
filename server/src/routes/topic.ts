import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  enabledBoardTypes,
  featureClosedMessage,
  featureForBoardType,
  getSiteConfig,
  isBoardTypeEnabled,
  isFeatureOn,
} from "../services/siteSettings";
import {
  ensureUserCanSubmitTopic,
  notifyTopicAiBlocked,
  refreshTopicSubmissionLock,
  requestManualTopicReview,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "../services/topicAiReview";

export const topicRouter = Router();

/**
 * 列表：?board=slug&page=1&size=20&sort=hot|new
 */
topicRouter.get("/", async (req, res, next) => {
  try {
    const boardSlug = req.query.board ? String(req.query.board) : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(5, Number(req.query.size ?? 20)));
    const sort = String(req.query.sort ?? "new");

    let boardId: number | undefined;
    if (boardSlug && boardSlug !== "all") {
      const b = await prisma.board.findUnique({ where: { slug: boardSlug } });
      if (!b) throw Errors.notFound("板块不存在");
      if (!isBoardTypeEnabled(b.type)) throw Errors.forbidden(featureClosedMessage(b.type));
      boardId = b.id;
    }

    const where: any = { hidden: false };
    if (boardId) where.boardId = boardId;
    else where.board = { type: { in: enabledBoardTypes() } };

    const orderBy: any = sort === "hot"
      ? [{ pinned: "desc" }, { likeCount: "desc" }, { lastReplyAt: "desc" }]
      : [{ pinned: "desc" }, { lastReplyAt: "desc" }, { createdAt: "desc" }];

    const [list, total] = await Promise.all([
      prisma.topic.findMany({
        where,
        orderBy,
        skip: (page - 1) * size,
        take: size,
        include: {
          author: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
          board: { select: { id: true, slug: true, name: true, color: true, type: true } },
        },
      }),
      prisma.topic.count({ where }),
    ]);

    ok(res, {
      page, size, total,
      list: list.map(decodeTopic),
    });
  } catch (e) { next(e); }
});

topicRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? "";
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, bio: true } },
        board: { select: { id: true, slug: true, name: true, type: true, readOnly: true } },
      },
    });
    if (!topic) throw Errors.notFound();
    const canSeeHidden = Boolean(requesterId && (requesterId === topic.authorId || requesterRole === "admin" || requesterRole === "mod"));
    if (topic.hidden && !canSeeHidden) throw Errors.notFound();
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    // 浏览数 +1（异步，失败也无所谓）
    if (!topic.hidden) prisma.topic.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
    ok(res, decodeTopic(topic));
  } catch (e) { next(e); }
});

const createSchema = z.object({
  boardSlug: z.string().min(1),
  title: z.string().min(2).max(120),
  content: z.string().min(1).max(20000),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string().max(20)).optional(),
});

topicRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { boardSlug, title, content, metadata, tags } = req.body;
    await ensureUserCanSubmitTopic(userId);
    const board = await prisma.board.findUnique({ where: { slug: boardSlug } });
    if (!board) throw Errors.notFound("板块不存在");
    if (board.readOnly && req.user!.role !== "bot" && req.user!.role !== "admin") {
      throw Errors.forbidden("该板块为只读公告板，禁止发帖");
    }
    // 功能开关：admin 可一键关闭论坛 / 二手 / 课评 整块功能
    // type=announce 由系统/爬虫机器人发，不受用户开关约束
    if (board.type !== "announce" && req.user!.role !== "admin") {
      const featureKey = featureForBoardType(board.type) ?? "forum";
      if (!isFeatureOn(featureKey)) {
        throw Errors.forbidden("该板块当前不可发帖，已被站方临时关闭");
      }
    }

    const now = new Date();
    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const shouldReview = shouldRunAiReview() && !bypassAiReview && board.type !== "announce";
    const aiResult = shouldReview
      ? await reviewTopicContent({
          title,
          content,
          boardName: board.name,
          boardType: board.type,
          metadata: metadata ?? {},
        })
      : null;
    const hiddenByAi = aiResult?.status === "blocked_ai";
    const manualLocked = aiResult?.riskLevel === "medium" || aiResult?.riskScore === undefined ? false : false;
    const topic = await prisma.topic.create({
      data: {
        boardId: board.id,
        authorId: userId,
        title,
        content,
        metadata: JSON.stringify(metadata ?? {}),
        aiReviewStatus: aiResult?.status ?? "auto_passed",
        aiRiskLevel: aiResult?.riskLevel ?? "low",
        aiRiskScore: aiResult?.riskScore ?? 0,
        aiReviewReason: aiResult?.reason ?? "",
        aiReviewDetail: aiResult?.detail ?? "",
        aiModel: aiResult?.model ?? null,
        aiReviewedAt: aiResult ? now : null,
        hidden: hiddenByAi,
        lastReplyAt: now,
        lastReplyById: userId,
      },
    });

    if (tags?.length) {
      for (const name of tags) {
        const tag = await prisma.tag.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        await prisma.topicTag.create({ data: { topicId: topic.id, tagId: tag.id } }).catch(() => {});
      }
    }

    // 课评：写入 CourseRating 派生表
    if (board.type === "coursereview" && metadata?.courseId && metadata?.ratings) {
      const r = metadata.ratings;
      const courseId = Number(metadata.courseId);

      // 解析"针对哪位老师"：
      //   - 优先用 metadata.courseTeacherId（前端已选的 CourseTeacher 关联 id）
      //   - 否则若给了 teacherName 字符串，自助 upsert Teacher + CourseTeacher
      //   - 都没给则 null（旧行为兼容）
      let courseTeacherId: number | null = null;
      if (metadata.courseTeacherId) {
        const ct = await prisma.courseTeacher.findFirst({
          where: { id: Number(metadata.courseTeacherId), courseId },
        });
        if (ct) courseTeacherId = ct.id;
      } else if (typeof metadata.teacherName === "string" && metadata.teacherName.trim()) {
        const name = metadata.teacherName.trim().slice(0, 40);
        const teacher = await prisma.teacher.upsert({
          where: { name },
          update: {},
          create: { name, createdById: userId },
        });
        const ct = await prisma.courseTeacher.upsert({
          where: { courseId_teacherId: { courseId, teacherId: teacher.id } },
          update: {},
          create: { courseId, teacherId: teacher.id, source: "user-add" },
        });
        courseTeacherId = ct.id;
      }

      await prisma.courseRating.create({
        data: {
          topicId: topic.id,
          courseId,
          courseTeacherId,
          authorId: userId,
          difficulty: clampInt(r.difficulty, 1, 5),
          reward: clampInt(r.reward, 1, 5),
          recommend: clampInt(r.recommend, 1, 5),
          givingScore: clampInt(r.givingScore ?? r.score, 1, 5),
          semester: metadata.semester ?? null,
        },
      }).catch(() => {});
      await refreshCourseStats(courseId);
    }

    if (!hiddenByAi) {
      await prisma.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
      await prisma.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
    } else if (aiResult) {
      await notifyTopicAiBlocked({
        topicId: topic.id,
        userId,
        title,
        reason: aiResult.reason,
        riskScore: aiResult.riskScore,
      });
    }

    ok(res, {
      ...decodeTopic({ ...topic, board: { slug: board.slug, name: board.name, type: board.type } }),
      submissionResult: hiddenByAi
        ? {
            status: "blocked_ai",
            riskLevel: aiResult?.riskLevel,
            riskScore: aiResult?.riskScore,
            reason: aiResult?.reason,
          }
        : {
            status: "published",
          },
    });
  } catch (e) { next(e); }
});

topicRouter.post("/:id/request-manual-review", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("稿件 ID 不合法");
    await requestManualTopicReview(id, req.user!.userId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

topicRouter.patch("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true } } },
    });
    if (!t) throw Errors.notFound();
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));

    const body = req.body as any;
    const data: any = {};
    const nextTitle = typeof body.title === "string" && isOwner ? body.title : t.title;
    const nextContent = typeof body.content === "string" && isOwner ? body.content : t.content;
    const nextMetadataRaw = typeof body.metadata === "object" && body.metadata ? JSON.stringify(body.metadata) : t.metadata;
    if (typeof body.title === "string" && isOwner) data.title = body.title;
    if (typeof body.content === "string" && isOwner) data.content = body.content;
    if (typeof body.metadata === "object" && body.metadata) data.metadata = nextMetadataRaw;
    if (typeof body.pinned === "boolean" && isMod) data.pinned = body.pinned;
    if (typeof body.locked === "boolean" && isMod) data.locked = body.locked;
    if (typeof body.hidden === "boolean" && isMod) data.hidden = body.hidden;

    if (isOwner && (typeof body.title === "string" || typeof body.content === "string")) {
      const similarityThreshold = getSiteConfig().aiEditSimilarityThreshold ?? 0;
      if (similarityThreshold > 0) {
        const similarity = computeEditSimilarity(
          `${t.title}\n${t.content}`,
          `${nextTitle}\n${nextContent}`
        );
        if (similarity < similarityThreshold) {
          throw Errors.badRequest(`修改后的内容与原内容相似度过低（${Math.round(similarity * 100)}%），未达到站点要求`);
        }
      }
      const bypassAiReview = await shouldBypassAiReviewForUser(req.user!.userId, req.user!.role);
      const boardInfo = await prisma.board.findUnique({
        where: { id: t.boardId },
        select: { name: true, type: true },
      });
      if (shouldRunAiReview() && !bypassAiReview && boardInfo?.type !== "announce") {
        const aiResult = await reviewTopicContent({
          title: nextTitle,
          content: nextContent,
          boardName: boardInfo?.name,
          boardType: boardInfo?.type,
          metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : safeJson(t.metadata),
        });
        if (aiResult.status === "blocked_ai") {
          return ok(res, {
            ...decodeTopic(t),
            submissionResult: {
              status: "blocked_ai",
              riskLevel: aiResult.riskLevel,
              riskScore: aiResult.riskScore,
              reason: aiResult.reason,
            },
          });
        }
        data.aiReviewStatus = "auto_passed";
        data.aiRiskLevel = aiResult.riskLevel;
        data.aiRiskScore = aiResult.riskScore;
        data.aiReviewReason = aiResult.reason;
        data.aiReviewDetail = aiResult.detail;
        data.aiModel = aiResult.model;
        data.aiReviewedAt = new Date();
      }
    }

    if (
      isOwner &&
      Object.keys(data).length &&
      (
        (typeof body.title === "string" && body.title !== t.title) ||
        (typeof body.content === "string" && body.content !== t.content) ||
        (typeof body.metadata === "object" && body.metadata && nextMetadataRaw !== t.metadata)
      )
    ) {
      data.editCount = { increment: 1 };
    }

    const u = await prisma.topic.update({ where: { id }, data });
    ok(res, {
      ...decodeTopic(u),
      submissionResult: { status: "published" },
    });
  } catch (e) { next(e); }
});

topicRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true } } },
    });
    if (!t) throw Errors.notFound();
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    await prisma.topic.update({ where: { id }, data: { hidden: true } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

/** 帖子的回复列表 */
topicRouter.get("/:id/replies", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true } } },
    });
    if (!topic || topic.hidden) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    const list = await prisma.reply.findMany({
      where: { topicId: id, hidden: false },
      orderBy: { floor: "asc" },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
      },
    });
    ok(res, list);
  } catch (e) { next(e); }
});

function decodeTopic(t: any) {
  return {
    ...t,
    metadata: safeJson(t.metadata),
  };
}
function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
function clampInt(v: any, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function computeEditSimilarity(a: string, b: string) {
  const sa = normalizeSimilaritySource(a);
  const sb = normalizeSimilaritySource(b);
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  const aBigrams = buildBigrams(sa);
  const bBigrams = buildBigrams(sb);
  if (!aBigrams.length || !bBigrams.length) {
    return sa === sb ? 1 : 0;
  }
  const counts = new Map<string, number>();
  for (const item of aBigrams) counts.set(item, (counts.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of bBigrams) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * intersection) / (aBigrams.length + bBigrams.length);
}

function normalizeSimilaritySource(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function buildBigrams(value: string) {
  if (value.length < 2) return value ? [value] : [];
  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.push(value.slice(i, i + 2));
  }
  return grams;
}

async function refreshCourseStats(courseId: number) {
  const agg = await prisma.courseRating.aggregate({
    where: { courseId },
    _count: true,
    _avg: { difficulty: true, reward: true, recommend: true, givingScore: true },
  });
  await prisma.course.update({
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
