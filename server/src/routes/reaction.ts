import { z } from "zod";
import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ensureCanReadBoardType } from "../services/forumAccess";
import { getReactionSummary, getVipReaction, isUserVip, VIP_REACTION_CATALOG } from "../services/vip";
import { isBoardTypeEnabled, featureClosedMessage } from "../services/siteSettings";
import { isRetiredBoardSlug } from "../services/retiredBoards";
import { invalidateForumCaches } from "../services/cacheInvalidation";

export const reactionRouter = Router();

const reactionSchema = z.object({ key: z.string().min(1).max(32) });

reactionRouter.get("/catalog", (_req, res) => {
  ok(res, VIP_REACTION_CATALOG);
});

reactionRouter.post("/topic/:id", authRequired, validate(reactionSchema), async (req, res, next) => {
  try {
    const topicId = Number(req.params.id);
    const userId = req.user!.userId;
    const reaction = getVipReaction(req.body.key);
    if (!reaction) throw Errors.badRequest("不支持的 VIP 表情");
    if (!(await isUserVip(userId))) throw Errors.forbidden("VIP 用户才能使用专属表情");
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { slug: true, type: true } } },
    });
    if (!topic || topic.hidden || isRetiredBoardSlug(topic.board?.slug)) throw Errors.notFound();
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, userId, req.user?.role);
    const existing = await prisma.forumReaction.findFirst({ where: { userId, topicId, kind: reaction.key } });
    if (existing) await prisma.forumReaction.delete({ where: { id: existing.id } });
    else await prisma.forumReaction.create({ data: { userId, topicId, kind: reaction.key } });
    await invalidateForumCaches({ includeBoards: false });
    ok(res, { active: !existing, reactions: await getReactionSummary({ topicId }, userId) });
  } catch (e) { next(e); }
});

reactionRouter.post("/reply/:id", authRequired, validate(reactionSchema), async (req, res, next) => {
  try {
    const replyId = Number(req.params.id);
    const userId = req.user!.userId;
    const reaction = getVipReaction(req.body.key);
    if (!reaction) throw Errors.badRequest("不支持的 VIP 表情");
    if (!(await isUserVip(userId))) throw Errors.forbidden("VIP 用户才能使用专属表情");
    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      include: { topic: { include: { board: { select: { slug: true, type: true } } } } },
    });
    if (!reply || reply.hidden || reply.topic?.hidden || isRetiredBoardSlug(reply.topic?.board?.slug)) throw Errors.notFound();
    if (!isBoardTypeEnabled(reply.topic?.board?.type)) throw Errors.forbidden(featureClosedMessage(reply.topic?.board?.type));
    await ensureCanReadBoardType(reply.topic?.board?.type, userId, req.user?.role);
    const existing = await prisma.forumReaction.findFirst({ where: { userId, replyId, kind: reaction.key } });
    if (existing) await prisma.forumReaction.delete({ where: { id: existing.id } });
    else await prisma.forumReaction.create({ data: { userId, replyId, kind: reaction.key } });
    await invalidateForumCaches({ includeBoards: false });
    ok(res, { active: !existing, reactions: await getReactionSummary({ replyId }, userId) });
  } catch (e) { next(e); }
});

reactionRouter.get("/mine", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const topicIds = String(req.query.topics ?? "").split(",").map(Number).filter(Boolean).slice(0, 100);
    const replyIds = String(req.query.replies ?? "").split(",").map(Number).filter(Boolean).slice(0, 500);
    const rows = await prisma.forumReaction.findMany({
      where: {
        userId,
        OR: [
          ...(topicIds.length ? [{ topicId: { in: topicIds } }] : []),
          ...(replyIds.length ? [{ replyId: { in: replyIds } }] : []),
        ],
      },
      select: { topicId: true, replyId: true, kind: true },
    });
    const topics: Record<string, string[]> = {};
    const replies: Record<string, string[]> = {};
    for (const row of rows) {
      if (row.topicId) (topics[String(row.topicId)] ??= []).push(row.kind);
      if (row.replyId) (replies[String(row.replyId)] ??= []).push(row.kind);
    }
    ok(res, { topics, replies });
  } catch (e) { next(e); }
});
