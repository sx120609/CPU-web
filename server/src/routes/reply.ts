import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { ensureCanReadBoardType, ensureForumAccessEnabled } from "../services/forumAccess";
import { requestManualReplyReview, shouldBypassAiReviewForUser, shouldRunAiReview } from "../services/topicAiReview";
import { ensureUserCanSpeak } from "../services/userModeration";
import { refreshUserReplyCount } from "../services/forumStats";
import { consumeAnonymousCredit, createAnonymousAlias, refreshAnonymousCreditsIfNeeded } from "../services/userTrust";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import { decodeReplyForViewer, decodeReplyForViewerWithImages } from "../services/forumPresentation";
import { ensureForumImageAssetsForContent, summarizeForumImageModerationForContent } from "../services/imageModeration";
import { ensureForumVideoAssetsForContent, summarizeForumVideoModerationForContent } from "../services/videoModeration";
import { isRetiredBoardSlug } from "../services/retiredBoards";
import {
  forumSubmissionResultForReview,
  isForumSubmissionUniqueConflict,
  normalizeForumSubmissionId,
} from "../services/forumSubmission";
import { scheduleReplySubmissionReview } from "../services/forumSubmissionReview";

export const replyRouter = Router();

const replySubmissionInclude = {
  author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, vipLevel: true, vipExpiresAt: true, profileTheme: true, profileFrame: true } },
} as const;

async function findReplySubmission(userId: number, submissionId: string) {
  return prisma.reply.findUnique({
    where: { authorId_submissionId: { authorId: userId, submissionId } },
    include: replySubmissionInclude,
  });
}

async function presentReplySubmission(reply: any, requestUser: any, replayed = false) {
  const submissionResult = forumSubmissionResultForReview({
    aiReviewStatus: reply.aiReviewStatus,
    hidden: reply.hidden,
    riskLevel: reply.aiRiskLevel,
    riskScore: reply.aiRiskScore,
    reason: reply.aiReviewReason,
    replayed,
  });
  if (submissionResult.status === "pending" || submissionResult.status === "failed") {
    return {
      ...decodeReplyForViewer(reply, requestUser),
      blocked: false,
      submissionResult,
    };
  }
  const [imageReview, videoReview] = await Promise.all([
    summarizeForumImageModerationForContent(reply.content).catch(() => null),
    summarizeForumVideoModerationForContent(reply.content).catch(() => null),
  ]);
  return {
    ...(await decodeReplyForViewerWithImages(reply, requestUser)),
    blocked: submissionResult.status === "blocked_ai",
    imageReview,
    videoReview,
    submissionResult: submissionResult.status === "blocked_ai"
      ? submissionResult
      : { status: "published", replayed },
  };
}

const createSchema = z.object({
  topicId: z.number().int().positive(),
  content: z.string().min(1).max(10000),
  parentReplyId: z.number().int().positive().optional(),
  anonymous: z.boolean().optional(),
  submissionId: z.string().min(8).max(80).optional(),
});

const updateSchema = z.object({
  content: z.string().min(1).max(10000),
});

replyRouter.get("/submissions/:submissionId", authRequired, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const submissionId = normalizeForumSubmissionId(req.params.submissionId, "reply");
    if (!submissionId) throw Errors.badRequest("发布操作 ID 不合法");
    const reply = await findReplySubmission(req.user!.userId, submissionId);
    if (!reply) throw Errors.notFound("尚未找到这次回复结果");
    ok(res, await presentReplySubmission(reply, req.user, true));
  } catch (e) { next(e); }
});

replyRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const userId = req.user!.userId;
    const { topicId, content, parentReplyId, anonymous = false, submissionId: rawSubmissionId } = req.body;
    const submissionId = normalizeForumSubmissionId(rawSubmissionId, "reply");
    if (rawSubmissionId && !submissionId) throw Errors.badRequest("发布操作 ID 不合法");
    await ensureForumAccessEnabled(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    if (submissionId) {
      const existing = await findReplySubmission(userId, submissionId);
      if (existing) {
        if (existing.aiReviewStatus === "checking" && existing.hidden) scheduleReplySubmissionReview(existing.id);
        if (existing.aiReviewStatus === "review_failed" && existing.hidden) {
          await prisma.reply.update({
            where: { id: existing.id },
            data: { aiReviewStatus: "checking", aiReviewReason: "内容已重新进入后台审核队列", aiReviewDetail: "", aiReviewedAt: null },
          });
          scheduleReplySubmissionReview(existing.id);
          const retried = await findReplySubmission(userId, submissionId);
          return ok(res.status(202), await presentReplySubmission(retried ?? existing, req.user, true));
        }
        return ok(res, await presentReplySubmission(existing, req.user, true));
      }
    }
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { slug: true, type: true, name: true, anonymousEnabled: true } } },
    });
    const canSeeHiddenTopic = Boolean(req.user?.userId && (req.user.userId === topic?.authorId || req.user.role === "admin" || req.user.role === "mod"));
    if (!topic || (topic.hidden && !canSeeHiddenTopic)) throw Errors.notFound("帖子不存在");
    if (isRetiredBoardSlug(topic.board?.slug)) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, userId, req.user?.role);
    if (topic.locked) throw Errors.forbidden("帖子已锁定，无法回复");
    if (anonymous && !topic.board?.anonymousEnabled) {
      throw Errors.forbidden("当前板块暂不支持匿名回复");
    }

    const parentReply = parentReplyId
      ? await prisma.reply.findUnique({
          where: { id: parentReplyId },
          select: { id: true, topicId: true, authorId: true, content: true, hidden: true },
        })
      : null;
    if (parentReplyId && (!parentReply || parentReply.hidden || parentReply.topicId !== topicId)) {
      throw Errors.badRequest("引用的回复不存在");
    }

    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const existingAnonymousReply = anonymous
      ? await prisma.reply.findFirst({
          where: { topicId, authorId: userId, isAnonymous: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { anonymousAlias: true },
        })
      : null;
    const reuseTopicAnonymousIdentity = Boolean(
      anonymous &&
      topic.isAnonymous &&
      topic.authorId === userId
    );
    const reuseExistingAnonymousIdentity = Boolean(reuseTopicAnonymousIdentity || existingAnonymousReply);
    const shouldConsumeAnonymousCredit = Boolean(anonymous && !reuseExistingAnonymousIdentity);
    if (anonymous && reuseExistingAnonymousIdentity) {
      const { trust } = await refreshAnonymousCreditsIfNeeded(userId);
      if (trust.anonymousState.frozen) {
        throw Errors.forbidden("你的匿名积分当前已被冻结，请联系管理员");
      }
    }
    const anonymousAlias = anonymous
      ? (
          reuseTopicAnonymousIdentity
            ? (topic.anonymousAlias || createAnonymousAlias())
            : (existingAnonymousReply?.anonymousAlias || createAnonymousAlias())
        )
      : null;
    const shouldReview = shouldRunAiReview() && !bypassAiReview;
    if (shouldReview) {
      let pendingReply;
      try {
        pendingReply = await prisma.$transaction(async (tx) => {
          if (shouldConsumeAnonymousCredit) await consumeAnonymousCredit(userId, tx);
          return tx.reply.create({
            data: {
              topicId,
              authorId: userId,
              submissionId,
              content,
              parentReplyId,
              floor: 0,
              hidden: true,
              aiReviewStatus: "checking",
              aiReviewReason: "内容已进入后台审核队列",
              isAnonymous: anonymous,
              anonymousAlias,
            },
            include: replySubmissionInclude,
          });
        });
      } catch (error) {
        if (submissionId && isForumSubmissionUniqueConflict(error)) {
          const existing = await findReplySubmission(userId, submissionId);
          if (existing) return ok(res, await presentReplySubmission(existing, req.user, true));
        }
        throw error;
      }
      scheduleReplySubmissionReview(pendingReply.id);
      return ok(res.status(202), await presentReplySubmission(pendingReply, req.user));
    }

    // 当前楼层
    const last = await prisma.reply.findFirst({
      where: { topicId },
      orderBy: { floor: "desc" },
      select: { floor: true },
    });
    const floor = (last?.floor ?? 0) + 1;
    let reply;
    try {
      reply = await prisma.$transaction(async (tx) => {
        if (shouldConsumeAnonymousCredit) {
          await consumeAnonymousCredit(userId, tx);
        }
        const created = await tx.reply.create({
          data: {
            topicId,
            authorId: userId,
            submissionId,
            content,
            parentReplyId,
            floor,
            aiReviewStatus: "auto_passed",
            isAnonymous: anonymous,
            anonymousAlias,
          },
          include: replySubmissionInclude,
        });
        await tx.topic.update({
          where: { id: topicId },
          data: {
            replyCount: { increment: 1 },
            lastReplyAt: created.createdAt,
            lastReplyById: userId,
          },
        });
        await tx.user.update({ where: { id: userId }, data: { replyCount: { increment: 1 } } });
        return created;
      });
    } catch (error) {
      if (submissionId && isForumSubmissionUniqueConflict(error)) {
        const existing = await findReplySubmission(userId, submissionId);
        if (existing) return ok(res, await presentReplySubmission(existing, req.user, true));
      }
      throw error;
    }

    const replyLink = `/forum/topic/${topicId}#reply-${reply.id}`;
    const notifications: Array<{
      userId: number;
      category: string;
      level: string;
      title: string;
      content: string;
      payload: string;
      link: string;
      source: string;
    }> = [];

    if (parentReply && parentReply.authorId !== userId) {
      notifications.push({
        userId: parentReply.authorId,
        category: "reply",
        level: "normal",
        title: "有人回复了你的回复",
        content: content.slice(0, 80),
        payload: JSON.stringify({ type: "reply", topicId, replyId: reply.id, parentReplyId: parentReply.id }),
        link: replyLink,
        source: "论坛",
      });
    }

    if (topic.authorId !== userId && topic.authorId !== parentReply?.authorId) {
      notifications.push({
        userId: topic.authorId,
        category: "reply",
        level: "normal",
        title: "有人回复了你的帖子",
        content: content.slice(0, 80),
        payload: JSON.stringify({ type: "reply", topicId, replyId: reply.id }),
        link: replyLink,
        source: "论坛",
      });
    }

    const notificationWrite = notifications.length === 1
      ? prisma.notification.create({ data: notifications[0] })
      : notifications.length > 1
        ? prisma.notification.createMany({ data: notifications })
        : Promise.resolve();
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
    const [, mediaReview] = await Promise.all([
      notificationWrite,
      mediaRegistration,
      invalidateForumCaches(),
    ]);
    const { imageReview, videoReview } = mediaReview;
    ok(res, {
      ...(await decodeReplyForViewerWithImages(reply, req.user)),
      imageReview,
      videoReview,
      submissionResult: { status: "published", replayed: false },
    });
  } catch (e) { next(e); }
});

replyRouter.post("/:id/request-manual-review", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("回复 ID 不合法");
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await requestManualReplyReview(id, req.user!.userId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

replyRouter.patch("/:id", authRequired, validate(updateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("回复 ID 不合法");
    const reply = await prisma.reply.findUnique({
      where: { id },
      include: {
        topic: {
          select: {
            id: true,
            locked: true,
            hidden: true,
            board: { select: { slug: true, type: true } },
          },
        },
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, vipLevel: true, vipExpiresAt: true, profileTheme: true, profileFrame: true } },
      },
    });
    if (!reply || !reply.topic || reply.hidden || reply.topic.hidden) throw Errors.notFound("回复不存在");
    if (isRetiredBoardSlug(reply.topic.board?.slug)) throw Errors.notFound("回复不存在");
    const isOwner = reply.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(reply.topic.board?.type)) throw Errors.forbidden(featureClosedMessage(reply.topic.board?.type));
    if (reply.topic.locked && !isMod) throw Errors.forbidden("帖子已锁定，无法修改回复");
    if (isOwner) {
      await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
      await ensureUserCanSpeak(req.user!.userId);
    }
    const updated = await prisma.reply.update({
      where: { id },
      data: { content: req.body.content },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, vipLevel: true, vipExpiresAt: true, profileTheme: true, profileFrame: true } },
      },
    });
    await Promise.all([
      ensureForumImageAssetsForContent(req.body.content, req.user!.userId).catch(() => null),
      ensureForumVideoAssetsForContent(req.body.content, req.user!.userId).catch(() => null),
    ]);
    const imageReview = await summarizeForumImageModerationForContent(req.body.content).catch(() => null);
    const videoReview = await summarizeForumVideoModerationForContent(req.body.content).catch(() => null);
    await invalidateForumCaches();
    ok(res, {
      ...(await decodeReplyForViewerWithImages(updated, req.user)),
      imageReview,
      videoReview,
    });
  } catch (e) { next(e); }
});

replyRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.reply.findUnique({
      where: { id },
      include: { topic: { select: { id: true, authorId: true, createdAt: true, board: { select: { slug: true, type: true } } } } },
    });
    if (!r) throw Errors.notFound();
    if (isRetiredBoardSlug(r.topic?.board?.slug)) throw Errors.notFound();
    const isOwner = r.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(r.topic?.board?.type)) throw Errors.forbidden(featureClosedMessage(r.topic?.board?.type));
    if (isOwner) await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await prisma.$transaction(async (tx) => {
      await tx.reply.update({ where: { id }, data: { hidden: true } });
      if (!r.hidden) {
        const [replyCount, lastReply] = await Promise.all([
          tx.reply.count({ where: { topicId: r.topicId, hidden: false } }),
          tx.reply.findFirst({
            where: { topicId: r.topicId, hidden: false },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, authorId: true },
          }),
        ]);
        await tx.topic.update({
          where: { id: r.topicId },
          data: {
            replyCount,
            lastReplyAt: lastReply?.createdAt ?? r.topic?.createdAt ?? null,
            lastReplyById: lastReply?.authorId ?? r.topic?.authorId ?? null,
          },
        });
        await refreshUserReplyCount(r.authorId, tx);
      }
    });
    await invalidateForumCaches();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});
