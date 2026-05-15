import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";

export const likeRouter = Router();

likeRouter.post("/topic/:id", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const topicId = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { board: { select: { type: true } } },
    });
    if (!t || t.hidden) throw Errors.notFound();
    if (!isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    const existing = await prisma.like.findFirst({ where: { userId, topicId } });
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      const u = await prisma.topic.update({ where: { id: topicId }, data: { likeCount: { decrement: 1 } } });
      return ok(res, { liked: false, likeCount: u.likeCount });
    }
    await prisma.like.create({ data: { userId, topicId } });
    const u = await prisma.topic.update({ where: { id: topicId }, data: { likeCount: { increment: 1 } } });
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
    if (!r) throw Errors.notFound();
    if (!isBoardTypeEnabled(r.topic?.board?.type)) throw Errors.forbidden(featureClosedMessage(r.topic?.board?.type));
    const existing = await prisma.like.findFirst({ where: { userId, replyId } });
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      const u = await prisma.reply.update({ where: { id: replyId }, data: { likeCount: { decrement: 1 } } });
      return ok(res, { liked: false, likeCount: u.likeCount });
    }
    await prisma.like.create({ data: { userId, replyId } });
    const u = await prisma.reply.update({ where: { id: replyId }, data: { likeCount: { increment: 1 } } });
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
