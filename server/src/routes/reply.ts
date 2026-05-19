import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { requestManualReplyReview, reviewReplyContent, shouldBypassAiReviewForUser, shouldRunAiReview } from "../services/topicAiReview";

export const replyRouter = Router();

const createSchema = z.object({
  topicId: z.number().int().positive(),
  content: z.string().min(1).max(10000),
  parentReplyId: z.number().int().positive().optional(),
});

replyRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { topicId, content, parentReplyId } = req.body;
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { type: true, name: true } } },
    });
    const canSeeHiddenTopic = Boolean(req.user?.userId && (req.user.userId === topic?.authorId || req.user.role === "admin" || req.user.role === "mod"));
    if (!topic || (topic.hidden && !canSeeHiddenTopic)) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    if (topic.locked) throw Errors.forbidden("帖子已锁定，无法回复");

    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
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
        const blockedReply = await prisma.reply.create({
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
          },
        });
        return ok(res, {
          id: blockedReply.id,
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

    const reply = await prisma.reply.create({
      data: {
        topicId,
        authorId: userId,
        content,
        parentReplyId,
        floor,
        aiReviewStatus: "auto_passed",
      },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
      },
    });

    await prisma.topic.update({
      where: { id: topicId },
      data: {
        replyCount: { increment: 1 },
        lastReplyAt: reply.createdAt,
        lastReplyById: userId,
      },
    });
    await prisma.user.update({ where: { id: userId }, data: { replyCount: { increment: 1 } } });

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

    ok(res, reply);
  } catch (e) { next(e); }
});

replyRouter.post("/:id/request-manual-review", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("回复 ID 不合法");
    await requestManualReplyReview(id, req.user!.userId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

replyRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.reply.findUnique({
      where: { id },
      include: { topic: { include: { board: { select: { type: true } } } } },
    });
    if (!r) throw Errors.notFound();
    const isOwner = r.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(r.topic?.board?.type)) throw Errors.forbidden(featureClosedMessage(r.topic?.board?.type));
    await prisma.reply.update({ where: { id }, data: { hidden: true } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});
