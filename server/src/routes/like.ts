import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { ensureCanReadBoardType } from "../services/forumAccess";

export const likeRouter = Router();
const LIKE_NOTIFICATION_DEDUP_MS = 24 * 60 * 60 * 1000;

likeRouter.post("/topic/:id", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const topicId = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { type: true } } },
    });
    if (!t || t.hidden) throw Errors.notFound();
    const mirroredTopic = await prisma.weiwallTopicMap.findUnique({ where: { localTopicId: topicId }, select: { id: true } });
    if (mirroredTopic) throw Errors.badRequest("逛逛镜像为只读同步内容，暂不支持站内点赞");
    if (!isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    await ensureCanReadBoardType(t.board?.type, userId, req.user?.role);
    const existing = await prisma.like.findFirst({ where: { userId, topicId } });
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      const u = await prisma.topic.update({ where: { id: topicId }, data: { likeCount: { decrement: 1 } } });
      await invalidateForumCaches({ includeBoards: false });
      return ok(res, { liked: false, likeCount: u.likeCount });
    }
    const u = await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { userId, topicId } });
      const updated = await tx.topic.update({ where: { id: topicId }, data: { likeCount: { increment: 1 } } });
      if (t.authorId !== userId) {
        const payload = JSON.stringify({ type: "topic-like", topicId, actorUserId: userId });
        const duplicated = await hasRecentLikeNotification(tx, {
          recipientUserId: t.authorId,
          actorUserId: userId,
          topicId,
          type: "topic-like",
        });
        if (!duplicated) {
          await tx.notification.create({
            data: {
              userId: t.authorId,
              category: "like",
              level: "weak",
              title: "有人赞了你的帖子",
              content: `${await likerDisplayName(tx, userId)} 赞了「${t.title}」`,
              link: `/forum/topic/${topicId}`,
              source: "论坛",
              payload,
            },
          });
        }
      }
      return updated;
    });
    await invalidateForumCaches({ includeBoards: false });
    ok(res, { liked: true, likeCount: u.likeCount });
  } catch (e) { next(e); }
});

likeRouter.post("/reply/:id", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const replyId = Number(req.params.id);
    const r = await prisma.reply.findUnique({
      where: { id: replyId },
      include: { topic: { include: { board: { select: { type: true } } } } },
    });
    if (!r || r.hidden || r.topic?.hidden) throw Errors.notFound();
    const mirroredTopic = await prisma.weiwallTopicMap.findUnique({ where: { localTopicId: r.topicId }, select: { id: true } });
    if (mirroredTopic) throw Errors.badRequest("逛逛镜像为只读同步内容，暂不支持站内点赞");
    if (!isBoardTypeEnabled(r.topic?.board?.type)) throw Errors.forbidden(featureClosedMessage(r.topic?.board?.type));
    await ensureCanReadBoardType(r.topic?.board?.type, userId, req.user?.role);
    const existing = await prisma.like.findFirst({ where: { userId, replyId } });
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      const u = await prisma.reply.update({ where: { id: replyId }, data: { likeCount: { decrement: 1 } } });
      await invalidateForumCaches({ includeBoards: false });
      return ok(res, { liked: false, likeCount: u.likeCount });
    }
    const u = await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { userId, replyId } });
      const updated = await tx.reply.update({ where: { id: replyId }, data: { likeCount: { increment: 1 } } });
      if (r.authorId !== userId) {
        const payload = JSON.stringify({ type: "reply-like", topicId: r.topicId, replyId, actorUserId: userId });
        const duplicated = await hasRecentLikeNotification(tx, {
          recipientUserId: r.authorId,
          actorUserId: userId,
          topicId: r.topicId,
          replyId,
          type: "reply-like",
        });
        if (!duplicated) {
          await tx.notification.create({
            data: {
              userId: r.authorId,
              category: "like",
              level: "weak",
              title: "有人赞了你的回复",
              content: `${await likerDisplayName(tx, userId)} 赞了你在「${r.topic.title}」下的回复`,
              link: `/forum/topic/${r.topicId}#reply-${replyId}`,
              source: "论坛",
              payload,
            },
          });
        }
      }
      return updated;
    });
    await invalidateForumCaches({ includeBoards: false });
    ok(res, { liked: true, likeCount: u.likeCount });
  } catch (e) { next(e); }
});

likeRouter.get("/mine", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const topicIds = req.query.topics ? String(req.query.topics).split(",").map(Number).filter(Boolean) : [];
    const replyIds = req.query.replies ? String(req.query.replies).split(",").map(Number).filter(Boolean) : [];
    const [t, r] = await Promise.all([
      topicIds.length ? prisma.like.findMany({ where: { userId, topicId: { in: topicIds } }, select: { topicId: true } }) : [],
      replyIds.length ? prisma.like.findMany({ where: { userId, replyId: { in: replyIds } }, select: { replyId: true } }) : [],
    ]);
    ok(res, {
      topics: t.map((x) => x.topicId).filter(Boolean) as number[],
      replies: r.map((x) => x.replyId).filter(Boolean) as number[],
    });
  } catch (e) { next(e); }
});

async function likerDisplayName(tx: { user: typeof prisma.user }, userId: number) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { nickname: true, username: true },
  });
  return user?.nickname?.trim() || user?.username || "有同学";
}

async function hasRecentLikeNotification(
  tx: { notification: typeof prisma.notification },
  input: {
    recipientUserId: number;
    actorUserId: number;
    topicId: number;
    replyId?: number;
    type: "topic-like" | "reply-like";
  },
) {
  const since = new Date(Date.now() - LIKE_NOTIFICATION_DEDUP_MS);
  const clauses = [
    { payload: { contains: `"type":"${input.type}"` } },
    { payload: { contains: `"actorUserId":${input.actorUserId}` } },
    { payload: { contains: `"topicId":${input.topicId}` } },
  ] as Array<Record<string, any>>;
  if (input.replyId) {
    clauses.push({ payload: { contains: `"replyId":${input.replyId}` } });
  }
  const existed = await tx.notification.findFirst({
    where: {
      userId: input.recipientUserId,
      category: "like",
      createdAt: { gte: since },
      AND: clauses,
    },
    select: { id: true },
  });
  return Boolean(existed);
}
