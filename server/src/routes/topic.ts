import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import {
  enabledBoardTypes,
  featureClosedMessage,
  featureForBoardType,
  getSiteConfig,
  isBoardTypeEnabled,
  isFeatureOn,
  removeTopicFromGlobalPins,
  setTopicGlobalPinned,
} from "../services/siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../services/forumStats";
import {
  ensureUserCanSubmitTopic,
  generateTopicAiTags,
  refreshTopicSubmissionLock,
  requestManualTopicReview,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
  syncTopicAiTags,
} from "../services/topicAiReview";
import { autoFormatTopicContent } from "../services/topicAiFormat";
import {
  SMART_POST_MAX_FILES,
  SMART_POST_MAX_FILE_BYTES,
  estimateSmartPostQuota,
} from "../services/topicSmartPost";
import {
  acknowledgeSmartPostJob,
  enqueueSmartPostJob,
  getLatestSmartPostJob,
  getSmartPostJob,
} from "../services/topicSmartPostJob";
import { ensureCanReadBoardType, ensureForumAccessEnabled, resolveForumAccess } from "../services/forumAccess";
import { ensureUserCanSpeak, releaseExpiredMutes } from "../services/userModeration";
import { consumeAnonymousCredit, createAnonymousAlias } from "../services/userTrust";
import { allowsCampusLifeCampaignAnonymousPost } from "../services/forumAds";
import { decodeReplyForViewer, decodeReplyForViewerWithImages, decodeTopicForViewer, decodeTopicForViewerWithImages, decodeTopicsForViewerForList } from "../services/forumPresentation";
import { ensureForumImageAssetsForContent, summarizeForumImageModerationForContent } from "../services/imageModeration";
import { ensureForumVideoAssetsForContent, summarizeForumVideoModerationForContent } from "../services/videoModeration";
import { invalidateCourseCaches, invalidateForumCaches } from "../services/cacheInvalidation";
import { compactTopicAuthors } from "../utils/publicAvatar";
import { isRetiredBoardSlug, visibleBoardSlugFilter } from "../services/retiredBoards";
import {
  encodeTopicEditReviewContext,
  forumContentVisibilityWhere,
  forumSubmissionResultForReview,
  isForumSubmissionUniqueConflict,
  normalizeForumSubmissionId,
  scheduleForumBackgroundTask,
} from "../services/forumSubmission";
import { scheduleTopicSubmissionReview } from "../services/forumSubmissionReview";
import {
  acceptQuestionAnswer,
  normalizeQuestionMetadataForWrite,
} from "../services/questionBounty";

export const topicRouter = Router();

const smartPostUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SMART_POST_MAX_FILE_BYTES, files: SMART_POST_MAX_FILES, fields: 10 },
  fileFilter: (_req, file, callback) => {
    if (/\.(?:pdf|docx|pptx|txt|md|png|jpe?g|webp|gif)$/iu.test(String(file.originalname || ""))) return callback(null, true);
    callback(new Error("仅支持 PDF、DOCX、PPTX、TXT、Markdown、PNG、JPEG、WebP 或 GIF 文件"));
  },
});

function smartPostUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  smartPostUpload.fields([
    { name: "files", maxCount: SMART_POST_MAX_FILES },
    { name: "file", maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(Errors.badRequest("单个附件不能超过 15MB，图片不能超过 8MB"));
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
      return next(Errors.badRequest(`最多上传 ${SMART_POST_MAX_FILES} 个附件`));
    }
    return next(Errors.badRequest(error instanceof Error ? error.message : "文件上传失败"));
  });
}

function smartPostRequestFiles(req: Request) {
  const grouped = req.files as Record<string, Express.Multer.File[]> | undefined;
  return [...(grouped?.files || []), ...(grouped?.file || [])];
}

const smartPostSchema = z.object({
  title: z.string().max(120).optional().default(""),
  content: z.string().max(20000).optional().default(""),
  instruction: z.string().max(1000).optional().default(""),
  operation: z.enum(["compose", "polish", "format"]).optional().default("compose"),
  boardSlug: z.string().min(1).max(80).optional(),
  returnPath: z.string().max(300).optional(),
});

const smartPostEstimateSchema = z.object({
  textLength: z.number().int().min(0).max(25_000).optional().default(0),
  operation: z.enum(["compose", "polish", "format"]).optional().default("compose"),
  files: z.array(z.object({
    name: z.string().min(1).max(180),
    size: z.number().int().min(0).max(SMART_POST_MAX_FILE_BYTES),
  })).max(SMART_POST_MAX_FILES).optional().default([]),
});

const topicSubmissionInclude = {
  board: { select: { id: true, slug: true, name: true, type: true, color: true } },
  author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
  tags: { include: { tag: true } },
} as const;

async function findTopicSubmission(userId: number, submissionId: string) {
  return prisma.topic.findUnique({
    where: { authorId_submissionId: { authorId: userId, submissionId } },
    include: topicSubmissionInclude,
  });
}

async function presentTopicSubmission(topic: any, requestUser: any, replayed = false) {
  const submissionResult = forumSubmissionResultForReview({
    aiReviewStatus: topic.aiReviewStatus,
    hidden: topic.hidden,
    riskLevel: topic.aiRiskLevel,
    riskScore: topic.aiRiskScore,
    reason: topic.aiReviewReason,
    replayed,
  });
  if (submissionResult.status === "pending" || submissionResult.status === "failed") {
    return {
      ...decodeTopicForViewer(topic, requestUser),
      submissionResult,
    };
  }
  const [imageReview, videoReview] = await Promise.all([
    summarizeForumImageModerationForContent(topic.content).catch(() => null),
    summarizeForumVideoModerationForContent(topic.content).catch(() => null),
  ]);
  return {
    ...(await decodeTopicForViewerWithImages(topic, requestUser)),
    submissionResult: submissionResult.status === "blocked_ai"
      ? {
          ...submissionResult,
          imageReview,
          videoReview,
        }
      : { status: "published", imageReview, videoReview, replayed },
  };
}

function scheduleTopicAiTags(input: Parameters<typeof generateTopicAiTags>[0], topicId: number) {
  scheduleForumBackgroundTask(`topic ${topicId} AI tags`, async () => {
    const aiTags = await generateTopicAiTags(input);
    await syncTopicAiTags(topicId, aiTags);
    await invalidateForumCaches();
  });
}

/**
 * 列表：?board=slug&page=1&size=20&sort=hot|new
 * 二手板块还支持 marketKind/category/campus 结构化筛选。
 */
topicRouter.get("/", async (req, res, next) => {
  try {
    const boardSlug = req.query.board ? String(req.query.board) : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(5, Number(req.query.size ?? 20)));
    const sort = String(req.query.sort ?? "new");
    const pinnedMode = req.query.pinned ? String(req.query.pinned) : "include";
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const marketKind = req.query.marketKind ? String(req.query.marketKind) : "";
    const marketCategory = req.query.category ? String(req.query.category) : "";
    const marketCampus = req.query.campus ? String(req.query.campus).trim().slice(0, 40) : "";
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? null;

    const marketKinds = new Set(["sell", "wanted", "discuss"]);
    const marketCategories = new Set(["books", "digital", "dorm", "fashion", "sports", "tickets", "digital_goods", "other"]);
    if (marketKind && !marketKinds.has(marketKind)) throw Errors.badRequest("二手发布类型不合法");
    if (marketCategory && !marketCategories.has(marketCategory)) throw Errors.badRequest("二手物品分类不合法");
    if ((marketKind || marketCategory || marketCampus) && boardSlug !== "market") {
      throw Errors.badRequest("二手筛选仅适用于二手交流板块");
    }

    let boardId: number | undefined;
    if (boardSlug && boardSlug !== "all") {
      const b = await prisma.board.findUnique({ where: { slug: boardSlug } });
      if (!b) throw Errors.notFound("板块不存在");
      if (isRetiredBoardSlug(b.slug)) throw Errors.notFound("板块不存在");
      if (!isBoardTypeEnabled(b.type)) throw Errors.forbidden(featureClosedMessage(b.type));
      await ensureCanReadBoardType(b.type, requesterId, requesterRole);
      boardId = b.id;
    }

    if (!boardId) {
      const forumAccessEnabled = await resolveForumAccess(requesterId, requesterRole);
      if (!forumAccessEnabled) throw Errors.forbidden(requesterId ? "请先开启论坛功能并确认使用须知" : "请先登录并开启论坛功能");
    }

    const where: any = { ...forumContentVisibilityWhere(requesterId) };
    if (boardId) where.boardId = boardId;
    else where.board = { type: { in: enabledBoardTypes() }, ...visibleBoardSlugFilter() };
    if (pinnedMode === "only") where.pinned = true;
    else if (pinnedMode === "exclude") where.pinned = false;
    const structuredFilters: any[] = [];
    if (q) {
      structuredFilters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { content: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    if (marketKind) {
      structuredFilters.push({
        OR: [
          { metadata: { contains: `\"marketKind\":\"${marketKind}\"` } },
          { metadata: { contains: `\"listingType\":\"${marketKind}\"` } },
        ],
      });
    }
    if (marketCategory) {
      structuredFilters.push({ metadata: { contains: `\"category\":\"${marketCategory}\"` } });
    }
    if (marketCampus) {
      structuredFilters.push({ metadata: { contains: `\"campus\":\"${marketCampus}\"` } });
    }
    if (structuredFilters.length) {
      where.AND = structuredFilters;
    }

    const orderBy: any = pinnedMode === "only"
      ? [{ createdAt: "desc" }]
      : sort === "hot"
        ? [{ pinned: "desc" }, { likeCount: "desc" }, { lastReplyAt: "desc" }]
        : [{ pinned: "desc" }, { createdAt: "desc" }];

    const cached = await withCache(
      "forum-list",
      [
        "topic-list-v5",
        requesterId ? `viewer-${requesterId}` : "public",
        boardSlug || "all",
        page,
        size,
        sort,
        pinnedMode,
        q || "all",
        marketKind || "all-kinds",
        marketCategory || "all-categories",
        marketCampus || "all-campuses",
      ],
      60_000,
      async () => {
        const [list, total] = await Promise.all([
          prisma.topic.findMany({
            where,
            orderBy,
            skip: (page - 1) * size,
            take: size,
            include: {
              author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
              board: { select: { id: true, slug: true, name: true, color: true, type: true } },
              tags: { include: { tag: true } },
            },
          }),
          prisma.topic.count({ where }),
        ]);
        return { list: compactTopicAuthors(list), total };
      },
    );

    ok(res, {
      page,
      size,
      total: cached.total,
      list: await decodeTopicsForViewerForList(cached.list, req.user),
    });
  } catch (e) { next(e); }
});

topicRouter.get("/submissions/:submissionId", authRequired, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const submissionId = normalizeForumSubmissionId(req.params.submissionId, "topic");
    if (!submissionId) throw Errors.badRequest("发布操作 ID 不合法");
    const topic = await findTopicSubmission(req.user!.userId, submissionId);
    if (!topic) throw Errors.notFound("尚未找到这次发布结果");
    ok(res, await presentTopicSubmission(topic, req.user, true));
  } catch (e) { next(e); }
});

const topicImpressionsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(40),
});

topicRouter.post(
  "/impressions",
  securityRateLimit("forum-impressions", 300, 60_000),
  validate(topicImpressionsSchema),
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const ids = Array.from(new Set<number>(req.body.ids));
      const visible = await prisma.topic.findMany({
        where: {
          id: { in: ids },
          hidden: false,
          board: { type: { in: enabledBoardTypes() }, ...visibleBoardSlugFilter() },
        },
        select: { id: true },
      });
      const visibleIds = visible.map((item) => item.id);
      if (!visibleIds.length) return ok(res, { views: [] });

      await prisma.topic.updateMany({
        where: { id: { in: visibleIds }, hidden: false },
        data: { viewCount: { increment: 1 } },
      });
      const updated = await prisma.topic.findMany({
        where: { id: { in: visibleIds } },
        select: { id: true, viewCount: true },
      });
      ok(res, { views: updated });
    } catch (e) { next(e); }
  },
);

topicRouter.post(
  "/smart-compose/estimate",
  authRequired,
  securityRateLimit("forum-smart-post-estimate", 120, 60 * 60_000),
  (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const parsed = smartPostEstimateSchema.safeParse(req.body || {});
      if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message || "额度估算参数不合法");
      const config = getSiteConfig();
      if (!config.smartPostEnabled) throw Errors.forbidden("智慧发帖功能当前未开放");
      ok(res, estimateSmartPostQuota({
        ...parsed.data,
        tokensPerQuota: config.smartPostTokensPerQuota,
      }));
    } catch (error) {
      next(error);
    }
  },
);

topicRouter.get(
  "/smart-compose/current",
  authRequired,
  securityRateLimit("forum-smart-post-current", 360, 60 * 60_000),
  (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      ok(res, getLatestSmartPostJob(req.user!.userId));
    } catch (error) {
      next(error);
    }
  },
);

topicRouter.post(
  "/smart-compose",
  authRequired,
  securityRateLimit("forum-smart-post", 20, 60 * 60_000),
  smartPostUploadMiddleware,
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const parsed = smartPostSchema.safeParse(req.body || {});
      if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message || "智慧发帖参数不合法");
      const uploadFiles = smartPostRequestFiles(req);
      if (parsed.data.operation !== "compose" && !parsed.data.content.trim()) {
        throw Errors.badRequest("请先填写需要处理的正文");
      }
      if (parsed.data.operation === "compose" && !parsed.data.content.trim() && !uploadFiles.length) {
        throw Errors.badRequest("请填写文字，或上传图片、PPT、Word、PDF 等材料");
      }
      await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
      await ensureUserCanSpeak(req.user!.userId);
      const board = parsed.data.boardSlug
        ? await prisma.board.findUnique({
            where: { slug: parsed.data.boardSlug },
            select: { name: true, type: true },
          })
        : null;
      if (parsed.data.boardSlug && !board) throw Errors.notFound("板块不存在");
      ok(res.status(202), enqueueSmartPostJob({
        userId: req.user!.userId,
        title: parsed.data.title,
        content: parsed.data.content,
        instruction: parsed.data.instruction,
        operation: parsed.data.operation,
        boardName: board?.name,
        boardType: board?.type,
        returnPath: parsed.data.returnPath,
        files: (parsed.data.operation === "format" ? [] : uploadFiles).map((file) => ({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        })),
      }));
    } catch (error) {
      next(error);
    }
  },
);

topicRouter.post(
  "/smart-compose/:jobId/acknowledge",
  authRequired,
  securityRateLimit("forum-smart-post-acknowledge", 120, 60 * 60_000),
  (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      ok(res, acknowledgeSmartPostJob(String(req.params.jobId || ""), req.user!.userId));
    } catch (error) {
      next(error);
    }
  },
);

topicRouter.get(
  "/smart-compose/:jobId",
  authRequired,
  securityRateLimit("forum-smart-post-status", 900, 60 * 60_000),
  (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      ok(res, getSmartPostJob(String(req.params.jobId || ""), req.user!.userId));
    } catch (error) {
      next(error);
    }
  },
);

topicRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? "";
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, bio: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
        board: { select: { id: true, slug: true, name: true, type: true, readOnly: true, anonymousEnabled: true } },
        tags: { include: { tag: true } },
      },
    });
    if (!topic) throw Errors.notFound();
    if (isRetiredBoardSlug(topic.board?.slug)) throw Errors.notFound();
    const canSeeHidden = Boolean(requesterId && (requesterId === topic.authorId || requesterRole === "admin" || requesterRole === "mod"));
    if (topic.hidden && !canSeeHidden) throw Errors.notFound();
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, requesterId, requesterRole);
    const [presented, updatedViews] = await Promise.all([
      decodeTopicForViewerWithImages(topic, req.user),
      topic.hidden
        ? Promise.resolve(null)
        : prisma.topic.update({
            where: { id },
            data: { viewCount: { increment: 1 } },
            select: { viewCount: true },
          }).catch(() => null),
    ]);
    ok(res, {
      ...presented,
      viewCount: updatedViews?.viewCount ?? topic.viewCount,
    });
  } catch (e) { next(e); }
});

const createSchema = z.object({
  boardSlug: z.string().min(1),
  title: z.string().min(2).max(120),
  content: z.string().min(1).max(20000),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string().max(20)).optional(),
  anonymous: z.boolean().optional(),
  submissionId: z.string().min(8).max(80).optional(),
});

const formatSchema = z.object({
  title: z.string().max(120).optional(),
  content: z.string().min(1).max(20000),
  boardSlug: z.string().min(1).optional(),
  editorMode: z.enum(["visual", "markup"]).optional(),
});

topicRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const userId = req.user!.userId;
    const { boardSlug, title, content, metadata, tags, anonymous = false, submissionId: rawSubmissionId } = req.body;
    const submissionId = normalizeForumSubmissionId(rawSubmissionId, "topic");
    if (rawSubmissionId && !submissionId) throw Errors.badRequest("发布操作 ID 不合法");
    await ensureForumAccessEnabled(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    if (submissionId) {
      const existing = await findTopicSubmission(userId, submissionId);
      if (existing) {
        if (existing.aiReviewStatus === "checking" && existing.hidden) scheduleTopicSubmissionReview(existing.id);
        if (existing.aiReviewStatus === "review_failed" && existing.hidden) {
          await prisma.topic.update({
            where: { id: existing.id },
            data: { aiReviewStatus: "checking", aiReviewReason: "内容已重新进入后台审核队列", aiReviewDetail: "", aiReviewedAt: null },
          });
          await invalidateForumCaches();
          scheduleTopicSubmissionReview(existing.id);
          const retried = await findTopicSubmission(userId, submissionId);
          return ok(res.status(202), await presentTopicSubmission(retried ?? existing, req.user, true));
        }
        return ok(res, await presentTopicSubmission(existing, req.user, true));
      }
    }
    await ensureUserCanSubmitTopic(userId);
    const board = await prisma.board.findUnique({ where: { slug: boardSlug } });
    if (!board) throw Errors.notFound("板块不存在");
    if (isRetiredBoardSlug(board.slug)) throw Errors.notFound("板块不存在");
    if (board.readOnly && req.user!.role !== "bot" && req.user!.role !== "admin") {
      throw Errors.forbidden("该板块为只读公告板，禁止发帖");
    }
    // 功能开关：admin 可一键关闭论坛 / 二手交流 / 课评整块功能
    // type=announce 由系统/爬虫机器人发，不受用户开关约束
    if (board.type !== "announce" && req.user!.role !== "admin") {
      const featureKey = featureForBoardType(board.type) ?? "forum";
      if (!isFeatureOn(featureKey)) {
        throw Errors.forbidden("该板块当前不可发帖，已被站方临时关闭");
      }
    }
    const effectiveMetadata = board.type === "question"
      ? normalizeQuestionMetadataForWrite(metadata)
      : (metadata ?? {});
    const activityAllowsAnonymous = anonymous
      && !board.anonymousEnabled
      && await allowsCampusLifeCampaignAnonymousPost(board.slug, effectiveMetadata);
    if (anonymous && !board.anonymousEnabled && !activityAllowsAnonymous) {
      throw Errors.forbidden("该板块暂不支持匿名发布");
    }

    const now = new Date();
    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const shouldReview = shouldRunAiReview() && !bypassAiReview;
    const anonymousAlias = anonymous ? createAnonymousAlias() : null;
    let topic;
    try {
      topic = await prisma.$transaction(async (tx) => {
        if (anonymous) {
          await consumeAnonymousCredit(userId, tx);
        }
        const created = await tx.topic.create({
          data: {
            boardId: board.id,
            authorId: userId,
            submissionId,
            title,
            content,
            metadata: JSON.stringify(effectiveMetadata),
            aiReviewStatus: shouldReview ? "checking" : "auto_passed",
            aiRiskLevel: shouldReview ? null : "low",
            aiRiskScore: shouldReview ? null : 0,
            aiReviewReason: shouldReview ? "内容已进入后台审核队列" : "",
            aiReviewDetail: "",
            aiModel: null,
            aiReviewedAt: shouldReview ? null : now,
            hidden: shouldReview,
            lastReplyAt: now,
            lastReplyById: userId,
            isAnonymous: anonymous,
            anonymousAlias,
          },
        });
        if (!shouldReview) {
          await tx.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
          await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
        }
        return created;
      });
    } catch (error) {
      if (submissionId && isForumSubmissionUniqueConflict(error)) {
        const existing = await findTopicSubmission(userId, submissionId);
        if (existing) return ok(res, await presentTopicSubmission(existing, req.user, true));
      }
      throw error;
    }

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

    if (shouldReview) {
      await invalidateForumCaches({ includeCourses: board.type === "coursereview" });
      scheduleTopicSubmissionReview(topic.id);
      const pendingTopic = await prisma.topic.findUnique({ where: { id: topic.id }, include: topicSubmissionInclude });
      return ok(res.status(202), await presentTopicSubmission(
        pendingTopic ?? { ...topic, board: { slug: board.slug, name: board.name, type: board.type }, tags: [] },
        req.user,
      ));
    }

    scheduleTopicAiTags({
      title,
      content,
      boardName: board.name,
      boardType: board.type,
      metadata: effectiveMetadata,
    }, topic.id);

    // 课评：写入 CourseRating 派生表
    if (board.type === "coursereview" && effectiveMetadata?.courseId && effectiveMetadata?.ratings) {
      const r = effectiveMetadata.ratings;
      const courseId = Number(effectiveMetadata.courseId);

      // 解析"针对哪位老师"：
      //   - 优先用 metadata.courseTeacherId（前端已选的 CourseTeacher 关联 id）
      //   - 否则若给了 teacherName 字符串，自助 upsert Teacher + CourseTeacher
      //   - 都没给则 null（旧行为兼容）
      let courseTeacherId: number | null = null;
      if (effectiveMetadata.courseTeacherId) {
        const ct = await prisma.courseTeacher.findFirst({
          where: { id: Number(effectiveMetadata.courseTeacherId), courseId },
        });
        if (ct) courseTeacherId = ct.id;
      } else if (typeof effectiveMetadata.teacherName === "string" && effectiveMetadata.teacherName.trim()) {
        const name = effectiveMetadata.teacherName.trim().slice(0, 40);
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
          semester: effectiveMetadata.semester ?? null,
        },
      }).catch(() => {});
      await refreshCourseStats(courseId);
    }

    const mediaRegistration = Promise.all([
      ensureForumImageAssetsForContent(content, userId).catch(() => null),
      ensureForumVideoAssetsForContent(content, userId).catch(() => null),
    ]).then(async () => {
      const [imageReview, videoReview] = await Promise.all([
        summarizeForumImageModerationForContent(content).catch(() => null),
        summarizeForumVideoModerationForContent(content).catch(() => null),
      ]);
      return { imageReview, videoReview };
    });
    const [topicWithTags, mediaReview] = await Promise.all([
      prisma.topic.findUnique({ where: { id: topic.id }, include: topicSubmissionInclude }),
      mediaRegistration,
      invalidateForumCaches({ includeCourses: board.type === "coursereview" }),
    ]);
    const { imageReview, videoReview } = mediaReview;
    ok(res, {
      ...(await decodeTopicForViewerWithImages(topicWithTags ?? { ...topic, board: { slug: board.slug, name: board.name, type: board.type }, tags: [] }, req.user)),
      submissionResult: {
        status: "published",
        imageReview,
        videoReview,
        replayed: false,
      },
    });
  } catch (e) { next(e); }
});

topicRouter.post("/format", authRequired, validate(formatSchema), async (req, res, next) => {
  try {
    const { title, content, boardSlug, editorMode } = req.body;
    const board = boardSlug
      ? await prisma.board.findUnique({
          where: { slug: boardSlug },
          select: { name: true, type: true },
        })
      : null;
    const result = await autoFormatTopicContent({
      title,
      content,
      boardName: board?.name,
      boardType: board?.type,
      editorMode,
    });
    ok(res, result);
  } catch (e) { next(e); }
});

topicRouter.post("/:id/request-manual-review", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("稿件 ID 不合法");
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await requestManualTopicReview(id, req.user!.userId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

const acceptAnswerSchema = z.object({
  replyId: z.number().int().positive(),
});

topicRouter.post("/:id/accept-answer", authRequired, validate(acceptAnswerSchema), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const topicId = Number(req.params.id);
    if (!Number.isFinite(topicId) || topicId <= 0) throw Errors.badRequest("问题 ID 不合法");
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    const result = await acceptQuestionAnswer({
      topicId,
      replyId: req.body.replyId,
      actorUserId: req.user!.userId,
    });
    await invalidateForumCaches();
    ok(res, result);
  } catch (e) { next(e); }
});

topicRouter.patch("/:id", authRequired, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { slug: true, type: true } } },
    });
    if (!t) throw Errors.notFound();
    if (isRetiredBoardSlug(t.board?.slug)) throw Errors.notFound();
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    const canEditContent = isOwner || req.user!.role === "admin" || (req.user!.role === "mod" && t.board?.type !== "announce");
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    if (isOwner) await ensureForumAccessEnabled(req.user!.userId, req.user!.role);

    const body = req.body as any;
    const data: any = {};
    let aiTagInput: Parameters<typeof generateTopicAiTags>[0] | null = null;
    let queuedForReview = false;
    const nextTitle = typeof body.title === "string" && canEditContent ? body.title : t.title;
    const nextContent = typeof body.content === "string" && canEditContent ? body.content : t.content;
    const currentMetadata = parseJsonSafe(t.metadata);
    const requestedMetadata = typeof body.metadata === "object" && body.metadata ? body.metadata : currentMetadata;
    const nextMetadata = t.board?.type === "question"
      ? normalizeQuestionMetadataForWrite(requestedMetadata, currentMetadata)
      : requestedMetadata;
    const nextMetadataRaw = JSON.stringify(nextMetadata);
    if (typeof body.title === "string" && canEditContent) data.title = body.title;
    if (typeof body.content === "string" && canEditContent) data.content = body.content;
    if (typeof body.metadata === "object" && body.metadata && canEditContent) data.metadata = nextMetadataRaw;
    if (typeof body.pinned === "boolean" && isMod) data.pinned = body.pinned;
    if (typeof body.locked === "boolean" && isMod) data.locked = body.locked;
    if (typeof body.hidden === "boolean" && isMod) data.hidden = body.hidden;
    const wantsGlobalPinned = typeof body.globalPinned === "boolean" && isMod ? body.globalPinned : undefined;
    if (wantsGlobalPinned) {
      if (t.hidden || data.hidden === true) throw Errors.badRequest("隐藏帖子不能设为全局置顶");
      if (t.board?.type === "announce") throw Errors.badRequest("公告板帖子不能设为全局置顶");
    }

    const hasEditedContent = Boolean(
      canEditContent && (
        (typeof body.title === "string" && body.title !== t.title) ||
        (typeof body.content === "string" && body.content !== t.content) ||
        (typeof body.metadata === "object" && body.metadata && nextMetadataRaw !== t.metadata)
      )
    );

    if (isOwner && hasEditedContent) {
      await ensureUserCanSpeak(req.user!.userId);
      await ensureUserCanSubmitTopic(req.user!.userId);
      if (t.aiReviewStatus === "checking") {
        throw Errors.badRequest("这篇帖子正在审核，请等待本次审核完成后再修改");
      }
      const bypassAiReview = await shouldBypassAiReviewForUser(req.user!.userId, req.user!.role);
      const boardInfo = await prisma.board.findUnique({
        where: { id: t.boardId },
        select: { name: true, type: true },
      });
      const metadata = nextMetadata;
      queuedForReview = shouldRunAiReview() && !bypassAiReview;
      const similarityThreshold = getSiteConfig().aiEditSimilarityThreshold ?? 0;
      Object.assign(data, queuedForReview
        ? {
            aiReviewStatus: "checking",
            aiRiskLevel: null,
            aiRiskScore: null,
            aiReviewReason: "修改已进入后台审核队列",
            aiReviewDetail: similarityThreshold > 0
              ? encodeTopicEditReviewContext({
                  originalTitle: t.title,
                  originalContent: t.content,
                  similarityThreshold,
                })
              : "",
            aiModel: null,
            aiReviewedAt: null,
            manualReviewedById: null,
            manualReviewedAt: null,
            manualReviewNote: null,
            hidden: true,
          }
        : {
            aiReviewStatus: "auto_passed",
            aiRiskLevel: "low",
            aiRiskScore: 0,
            aiReviewReason: bypassAiReview ? "用户免审，修改已直接发布" : "AI 审核未开启",
            aiReviewDetail: "",
            aiModel: null,
            aiReviewedAt: new Date(),
            manualReviewedById: null,
            manualReviewedAt: null,
            manualReviewNote: null,
            hidden: false,
          });

      if (!queuedForReview) {
        aiTagInput = {
          title: nextTitle,
          content: nextContent,
          boardName: boardInfo?.name,
          boardType: boardInfo?.type,
          metadata,
        };
      }
    }

    if (hasEditedContent) {
      data.editCount = { increment: 1 };
      data.reportHiddenAt = null;
    }

    const hiddenChanged = typeof data.hidden === "boolean" && data.hidden !== t.hidden;
    const u = await prisma.$transaction(async (tx) => {
      const updated = await tx.topic.update({ where: { id }, data });
      if (hiddenChanged) {
        await Promise.all([
          refreshBoardTopicCounts([updated.boardId], tx),
          refreshUserPostCount(updated.authorId, tx),
        ]);
      }
      return updated;
    });
    if (wantsGlobalPinned !== undefined) {
      await setTopicGlobalPinned(id, wantsGlobalPinned);
    } else if (u.hidden) {
      await removeTopicFromGlobalPins(id);
    }
    if (queuedForReview) {
      await invalidateForumCaches({ includeCourses: t.board?.type === "coursereview" });
      scheduleTopicSubmissionReview(u.id);
      const pendingTopic = await prisma.topic.findUnique({ where: { id: u.id }, include: topicSubmissionInclude });
      return ok(res.status(202), await presentTopicSubmission(pendingTopic ?? u, req.user));
    }
    if (aiTagInput) scheduleTopicAiTags(aiTagInput, id);
    if (typeof body.content === "string" && canEditContent) {
      await Promise.all([
        ensureForumImageAssetsForContent(nextContent, req.user!.userId).catch(() => null),
        ensureForumVideoAssetsForContent(nextContent, req.user!.userId).catch(() => null),
      ]);
    }
    const topicWithTags = await prisma.topic.findUnique({
      where: { id: u.id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
        board: { select: { id: true, slug: true, name: true, color: true, type: true } },
        tags: { include: { tag: true } },
      },
    });
    if (t.board?.type === "coursereview") {
      await invalidateCourseCaches();
    }
    await invalidateForumCaches();
    ok(res, await presentTopicSubmission(topicWithTags ?? u, req.user));
  } catch (e) { next(e); }
});

topicRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { slug: true, type: true } } },
    });
    if (!t) throw Errors.notFound();
    if (isRetiredBoardSlug(t.board?.slug)) throw Errors.notFound();
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    if (isOwner) await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await prisma.$transaction(async (tx) => {
      await tx.topic.update({ where: { id }, data: { hidden: true, reportHiddenAt: null, aiReviewStatus: "deleted" } });
      if (!t.hidden) {
        await Promise.all([
          refreshBoardTopicCounts([t.boardId], tx),
          refreshUserPostCount(t.authorId, tx),
        ]);
      }
    });
    await removeTopicFromGlobalPins(id);
    if (t.board?.type === "coursereview") {
      await invalidateCourseCaches();
    }
    await invalidateForumCaches();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

/** 帖子的回复列表 */
topicRouter.get("/:id/replies", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { slug: true, type: true } } },
    });
    if (!topic) throw Errors.notFound("帖子不存在");
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? "";
    const canSeeHidden = Boolean(requesterId && (requesterId === topic.authorId || requesterRole === "admin" || requesterRole === "mod"));
    if (topic.hidden && !canSeeHidden) throw Errors.notFound("帖子不存在");
    if (isRetiredBoardSlug(topic.board?.slug)) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, req.user?.userId ?? null, req.user?.role ?? null);
    const list = await prisma.reply.findMany({
      where: { topicId: id, ...forumContentVisibilityWhere(requesterId) },
      orderBy: { floor: "asc" },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
      },
    });
    ok(res, await Promise.all(list.map((item) => decodeReplyForViewerWithImages(item, req.user))));
  } catch (e) { next(e); }
});
function parseJsonSafe(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
function clampInt(v: any, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
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
