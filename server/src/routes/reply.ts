import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { ensureCanReadBoardType, ensureForumAccessEnabled } from "../services/forumAccess";
import { requestManualReplyReview, reviewReplyContent, shouldBypassAiReviewForUser, shouldRunAiReview } from "../services/topicAiReview";
import { ensureUserCanSpeak } from "../services/userModeration";
import { refreshUserReplyCount } from "../services/forumStats";
import { consumeAnonymousCredit, createAnonymousAlias } from "../services/userTrust";
import { decodeReplyForViewer } from "../services/forumPresentation";

export const replyRouter = Router();

const createSchema = z.object({
  topicId: z.number().int().positive(),
  content: z.string().min(1).max(10000),
  parentReplyId: z.number().int().positive().optional(),
  anonymous: z.boolean().optional(),
});

replyRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { topicId, content, parentReplyId, anonymous = false } = req.body;
    await ensureForumAccessEnabled(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { type: true, name: true, anonymousEnabled: true } } },
    });
    const canSeeHiddenTopic = Boolean(req.user?.userId && (req.user.userId === topic?.authorId || req.user.role === "admin" || req.user.role === "mod"));
    if (!topic || (topic.hidden && !canSeeHiddenTopic)) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, userId, req.user?.role);
    if (topic.locked) throw Errors.forbidden("帖子已锁定，无法回复");
    if (anonymous && !topic.board?.anonymousEnabled) {
      throw Errors.forbidden("当前板块暂不支持匿名回复");
    }

    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const anonymousAlias = anonymous ? createAnonymousAlias() : null;
    if (shouldRunAiReview() && !bypassAiReview) {
      let parentContent = "";
      if (parentReplyId) {
        const parent = await prisma.reply.findUnique({
          where: { id: parentReplyId },
          select: { content: true, topicId: true },
        });
        if (!parent || parent.topicId !== topicId) throw Errors.badRequest("引用的回复不存在");
        parentContent = parent.content;
      }
      const aiResult = await reviewReplyContent({
        topicTitle: topic.title,
        boardName: (topic as any).board?.name ?? "",
        boardType: topic.board?.type ?? "",
        content,
        parentContent,
      });
      if (aiResult.status === "blocked_ai") {
        const blockedReply = await prisma.$transaction(async (tx) => {
          if (anonymous) {
            await consumeAnonymousCredit(userId, tx);
          }
          return tx.reply.create({
            data: {
              topicId,
              authorId: userId,
              content,
              parentReplyId,
              floor: 0,
              hidden: true,
              aiReviewStatus: "blocked_ai",
              aiRiskLevel: aiResult.riskLevel,
              aiRiskScore: aiResult.riskScore,
              aiReviewReason: aiResult.reason,
              aiReviewDetail: aiResult.detail,
              aiModel: aiResult.model,
              aiReviewedAt: new Date(),
              isAnonymous: anonymous,
              anonymousAlias,
            },
          });
        });
        return ok(res, {
          id: blockedReply.id,
          isAnonymous: blockedReply.isAnonymous,
          anonymousAlias: blockedReply.anonymousAlias,
          blocked: true,
          submissionResult: {
            status: "blocked_ai",
            riskLevel: aiResult.riskLevel,
            riskScore: aiResult.riskScore,
            reason: aiResult.reason,
          },
        } as any);
      }
    }

    // 当前楼层
    const last = await prisma.reply.findFirst({
      where: { topicId },
      orderBy: { floor: "desc" },
      select: { floor: true },
    });
    const floor = (last?.floor ?? 0) + 1;
    const reply = await prisma.$transaction(async (tx) => {
      if (anonymous) {
        await consumeAnonymousCredit(userId, tx);
      }
      const created = await tx.reply.create({
        data: {
          topicId,
          authorId: userId,
          content,
          parentReplyId,
          floor,
          aiReviewStatus: "auto_passed",
          isAnonymous: anonymous,
          anonymousAlias,
        },
        include: {
          author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
        },
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

    // 通知被回复人
    if (topic.authorId !== userId) {
      await prisma.notification.create({
        data: {
          userId: topic.authorId,
          category: "reply",
          level: "normal",
          title: `有人回复了你的帖子`,
          content: content.slice(0, 80),
          link: `/forum/topic/${topicId}`,
          source: "论坛",
        },
      });
    }

    ok(res, decodeReplyForViewer(reply, req.user));
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

replyRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.reply.findUnique({
      where: { id },
      include: { topic: { select: { id: true, authorId: true, createdAt: true, board: { select: { type: true } } } } },
    });
    if (!r) throw Errors.notFound();
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
    ok(res, { ok: true });
  } catch (e) { next(e); }
});
