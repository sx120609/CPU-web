import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { ensureCanReadBoardType } from "../services/forumAccess";
import { lockUserPair } from "../services/userBlock";
import { directCounterpartId, directParticipantAlias } from "../services/directMessagePolicy";
import { requestSchoolId } from "../schools/modules";
import { topicBelongsToSchool } from "../schools/forumScope";

export const userBlockRouter = Router();
const schema = z.object({ targetType: z.enum(["user", "topic", "reply", "conversation"]), targetId: z.number().int().positive() });

userBlockRouter.get("/", async (req, res, next) => {
  try {
    ok(res, await prisma.userBlock.findMany({ where: { ownerId: req.user!.userId }, select: { id: true, label: true, createdAt: true }, orderBy: { createdAt: "desc" } }));
  } catch (error) { next(error); }
});

userBlockRouter.post("/", validate(schema), async (req, res, next) => {
  try {
    const ownerId = req.user!.userId;
    const { targetType, targetId } = req.body as z.infer<typeof schema>;
    let resolvedId = targetId;
    let anonymous = false;
    if (targetType === "conversation") {
      const conversation = await prisma.directConversation.findUnique({ where: { id: targetId } });
      if (!conversation || ![conversation.participantLowId, conversation.participantHighId].includes(ownerId)) throw Errors.notFound("会话不存在");
      resolvedId = directCounterpartId(conversation, ownerId);
      anonymous = Boolean(directParticipantAlias(conversation, resolvedId));
    } else if (targetType === "topic" || targetType === "reply") {
      const post = targetType === "topic"
        ? await prisma.topic.findUnique({ where: { id: targetId }, include: { board: true } })
        : await prisma.reply.findUnique({ where: { id: targetId }, include: { topic: { include: { board: true } } } });
      if (!post || post.hidden) throw Errors.notFound("内容不存在");
      const topic = "topic" in post ? post.topic : post;
      if (topic.hidden || !topicBelongsToSchool(topic, requestSchoolId(req))) throw Errors.notFound("内容不存在");
      await ensureCanReadBoardType(topic.board.type, ownerId, req.user!.role);
      resolvedId = post.authorId;
      anonymous = post.isAnonymous;
    }
    if (resolvedId === ownerId) throw Errors.badRequest("不能屏蔽自己");
    const target = await prisma.user.findUnique({ where: { id: resolvedId }, select: { nickname: true, status: true } });
    if (!target || ["deleting", "deleted"].includes(target.status)) throw Errors.notFound("用户不存在");
    await prisma.$transaction(async (tx) => {
      await lockUserPair(tx, ownerId, resolvedId);
      const block = await tx.userBlock.upsert({
        where: { ownerId_targetId: { ownerId, targetId: resolvedId } },
        create: { ownerId, targetId: resolvedId, label: anonymous ? "已屏蔽的匿名用户" : target.nickname || "用户" }, update: anonymous ? { label: "已屏蔽的匿名用户" } : {},
        select: { id: true, label: true, createdAt: true },
      });
      const conversations = await tx.directConversation.findMany({ where: { participantLowId: Math.min(ownerId, resolvedId), participantHighId: Math.max(ownerId, resolvedId) }, select: { id: true } });
      await tx.directMessage.updateMany({ where: { conversationId: { in: conversations.map((row) => row.id) }, senderId: resolvedId, readAt: null }, data: { readAt: new Date() } });
      await tx.notification.deleteMany({ where: { userId: ownerId, category: "direct-message", link: { in: conversations.map((row) => `/messages?tab=private&conversation=${row.id}`) } } });
      return block;
    });
    ok(res, { blocked: true });
  } catch (error) { next(error); }
});

userBlockRouter.delete("/:id", async (req, res, next) => {
  try {
    const block = await prisma.userBlock.findFirst({ where: { id: req.params.id, ownerId: req.user!.userId } });
    if (block) await prisma.$transaction(async (tx) => {
      await lockUserPair(tx, block.ownerId, block.targetId);
      await tx.userBlock.deleteMany({ where: { id: block.id, ownerId: req.user!.userId } });
    });
    ok(res, { deleted: true });
  } catch (error) { next(error); }
});
