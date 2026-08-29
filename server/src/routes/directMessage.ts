import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { ensureUserCanSpeak } from "../services/userModeration";
import { buildUserPreview } from "../utils/publicUser";
import {
  canonicalDirectParticipants,
  resolveDirectMessageSendState,
} from "../services/directMessagePolicy";

export const directMessageRouter = Router();

const directUserSelect = {
  id: true,
  nickname: true,
  avatar: true,
  role: true,
  status: true,
  isVip: true,
  profileTheme: true,
  profileFrame: true,
} as const;

const directConversationInclude = {
  participantLow: { select: directUserSelect },
  participantHigh: { select: directUserSelect },
} as const;

const sendSchema = z.object({
  content: z.string().trim().min(1, "消息不能为空").max(2000, "单条消息不能超过 2000 字"),
});

const pageQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

type DirectConversationRow = {
  id: number;
  participantLowId: number;
  participantHighId: number;
  initiatedById: number;
  recipientRepliedAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function parsePositiveId(raw: string, label: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest(`${label}不正确`);
  return id;
}

function directCounterpart(conversation: any, viewerId: number) {
  const user = conversation.participantLowId === viewerId
    ? conversation.participantHigh
    : conversation.participantLow;
  return buildUserPreview(user);
}

function serializeConversation(
  conversation: any,
  viewerId: number,
  initiatorMessageCount: number,
  unreadCount = 0,
) {
  return {
    id: conversation.id,
    initiatedById: conversation.initiatedById,
    recipientRepliedAt: conversation.recipientRepliedAt,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    counterpart: directCounterpart(conversation, viewerId),
    unreadCount,
    sendState: resolveDirectMessageSendState({
      viewerIsInitiator: conversation.initiatedById === viewerId,
      recipientReplied: Boolean(conversation.recipientRepliedAt),
      initiatorMessageCount,
    }),
  };
}

async function requireDirectMessageTarget(senderId: number, recipientId: number) {
  if (senderId === recipientId) throw Errors.badRequest("不能与自己私聊");
  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId }, select: { id: true, nickname: true, status: true, mutedUntil: true } }),
    prisma.user.findUnique({ where: { id: recipientId }, select: directUserSelect }),
  ]);
  if (!sender) throw Errors.unauthorized();
  await ensureUserCanSpeak(senderId);
  if (!recipient || recipient.status === "banned") throw Errors.notFound("用户不存在或暂时无法接收私聊");
  if (recipient.role === "bot") throw Errors.badRequest("不能向系统账号发起私聊");
  return { sender, recipient };
}

async function findConversationForUsers(firstUserId: number, secondUserId: number) {
  const pair = canonicalDirectParticipants(firstUserId, secondUserId);
  return prisma.directConversation.findUnique({
    where: { participantLowId_participantHighId: pair },
    include: directConversationInclude,
  });
}

async function sendDirectMessage(senderId: number, recipientId: number, content: string) {
  const { sender } = await requireDirectMessageTarget(senderId, recipientId);
  const pair = canonicalDirectParticipants(senderId, recipientId);

  const result = await prisma.$transaction(async (tx) => {
    // INSERT ... ON CONFLICT 会锁住这一对用户唯一的会话行；后续计数和写入在同一事务内，
    // 即使用户并发点击发送，也不能越过“回复前两条”的服务端限制。
    const rows = await tx.$queryRaw<DirectConversationRow[]>`
      INSERT INTO "DirectConversation" (
        "participantLowId", "participantHighId", "initiatedById",
        "lastMessageAt", "createdAt", "updatedAt"
      ) VALUES (
        ${pair.participantLowId}, ${pair.participantHighId}, ${senderId},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("participantLowId", "participantHighId")
      DO UPDATE SET "updatedAt" = "DirectConversation"."updatedAt"
      RETURNING *
    `;
    const conversation = rows[0];
    if (!conversation) throw Errors.server("私聊会话创建失败");

    const initiatorMessageCount = conversation.initiatedById === senderId
      ? await tx.directMessage.count({
        where: { conversationId: conversation.id, senderId: conversation.initiatedById },
      })
      : 0;
    const sendState = resolveDirectMessageSendState({
      viewerIsInitiator: conversation.initiatedById === senderId,
      recipientReplied: Boolean(conversation.recipientRepliedAt),
      initiatorMessageCount,
    });
    if (!sendState.canSend) {
      throw Errors.conflict("对方回复前最多发送两条消息，请等待对方回复");
    }

    const message = await tx.directMessage.create({
      data: { conversationId: conversation.id, senderId, content },
    });
    const isFirstRecipientReply = conversation.initiatedById !== senderId && !conversation.recipientRepliedAt;
    await tx.directConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        ...(isFirstRecipientReply ? { recipientRepliedAt: message.createdAt } : {}),
      },
    });
    await tx.notification.create({
      data: {
        userId: recipientId,
        category: "direct-message",
        level: "normal",
        title: `${sender.nickname || "有用户"} 发来私聊`,
        content: "有一条新私聊消息，进入站内私聊查看。",
        link: `/messages?tab=private&conversation=${conversation.id}`,
        source: "站内私聊",
        payload: JSON.stringify({ type: "direct-message", conversationId: conversation.id, messageId: message.id }),
      },
    });
    return { conversationId: conversation.id, message };
  });

  const conversation = await prisma.directConversation.findUnique({
    where: { id: result.conversationId },
    include: directConversationInclude,
  });
  if (!conversation) throw Errors.server("私聊会话读取失败");
  const initiatorMessageCount = conversation.initiatedById === senderId
    ? await prisma.directMessage.count({ where: { conversationId: conversation.id, senderId } })
    : 0;
  return {
    conversation: serializeConversation(conversation, senderId, initiatorMessageCount),
    message: result.message,
  };
}

directMessageRouter.get("/conversations", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const list = await prisma.directConversation.findMany({
      where: { OR: [{ participantLowId: userId }, { participantHighId: userId }] },
      include: {
        ...directConversationInclude,
        messages: { orderBy: { id: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    const conversationIds = list.map((item) => item.id);
    const [sentCounts, unreadCounts] = conversationIds.length
      ? await Promise.all([
        prisma.directMessage.groupBy({
          by: ["conversationId"],
          where: { conversationId: { in: conversationIds }, senderId: userId },
          _count: { _all: true },
        }),
        prisma.directMessage.groupBy({
          by: ["conversationId"],
          where: { conversationId: { in: conversationIds }, senderId: { not: userId }, readAt: null },
          _count: { _all: true },
        }),
      ])
      : [[], []];
    const sentByConversation = new Map(sentCounts.map((item) => [item.conversationId, item._count._all]));
    const unreadByConversation = new Map(unreadCounts.map((item) => [item.conversationId, item._count._all]));
    const conversations = list.map((conversation) => ({
      ...serializeConversation(
        conversation,
        userId,
        sentByConversation.get(conversation.id) || 0,
        unreadByConversation.get(conversation.id) || 0,
      ),
      lastMessage: conversation.messages[0] || null,
    }));
    ok(res, {
      conversations,
      totalUnread: [...unreadByConversation.values()].reduce((sum, count) => sum + count, 0),
    });
  } catch (error) { next(error); }
});

directMessageRouter.get("/with/:userId", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const counterpartId = parsePositiveId(req.params.userId, "用户");
    if (counterpartId === userId) throw Errors.badRequest("不能与自己私聊");
    const counterpart = await prisma.user.findUnique({ where: { id: counterpartId }, select: directUserSelect });
    if (!counterpart || counterpart.status === "banned") throw Errors.notFound("用户不存在或暂时无法接收私聊");
    if (counterpart.role === "bot") throw Errors.badRequest("不能向系统账号发起私聊");
    const conversation = await findConversationForUsers(userId, counterpartId);
    if (!conversation) return ok(res, { counterpart: buildUserPreview(counterpart), conversation: null });
    const [sentCount, unreadCount] = await Promise.all([
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: userId } }),
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: { not: userId }, readAt: null } }),
    ]);
    ok(res, {
      counterpart: buildUserPreview(counterpart),
      conversation: serializeConversation(conversation, userId, sentCount, unreadCount),
    });
  } catch (error) { next(error); }
});

directMessageRouter.post("/with/:userId/messages", validate(sendSchema), async (req, res, next) => {
  try {
    const recipientId = parsePositiveId(req.params.userId, "用户");
    ok(res, await sendDirectMessage(req.user!.userId, recipientId, req.body.content));
  } catch (error) { next(error); }
});

directMessageRouter.get("/conversations/:id/messages", validate(pageQuerySchema, "query"), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const conversationId = parsePositiveId(req.params.id, "会话");
    const conversation = await prisma.directConversation.findUnique({
      where: { id: conversationId },
      include: directConversationInclude,
    });
    if (!conversation || (conversation.participantLowId !== userId && conversation.participantHighId !== userId)) {
      throw Errors.notFound("会话不存在");
    }
    const limit = req.query.limit as unknown as number;
    const before = req.query.before as unknown as number | undefined;
    const rows = await prisma.directMessage.findMany({
      where: {
        conversationId,
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    const now = new Date();
    await prisma.$transaction([
      prisma.directMessage.updateMany({
        where: { conversationId, senderId: { not: userId }, readAt: null },
        data: { readAt: now },
      }),
      prisma.notification.updateMany({
        where: {
          userId,
          readAt: null,
          category: "direct-message",
          link: `/messages?tab=private&conversation=${conversationId}`,
        },
        data: { readAt: now },
      }),
    ]);
    const initiatorMessageCount = conversation.initiatedById === userId
      ? await prisma.directMessage.count({ where: { conversationId, senderId: userId } })
      : 0;
    ok(res, {
      conversation: serializeConversation(conversation, userId, initiatorMessageCount, 0),
      messages: pageRows.map((message) => ({
        ...message,
        readAt: message.senderId !== userId && !message.readAt ? now : message.readAt,
      })),
      nextCursor: hasMore ? pageRows[0]?.id || null : null,
    });
  } catch (error) { next(error); }
});

directMessageRouter.post("/conversations/:id/messages", validate(sendSchema), async (req, res, next) => {
  try {
    const conversationId = parsePositiveId(req.params.id, "会话");
    const userId = req.user!.userId;
    const conversation = await prisma.directConversation.findUnique({ where: { id: conversationId } });
    if (!conversation || (conversation.participantLowId !== userId && conversation.participantHighId !== userId)) {
      throw Errors.notFound("会话不存在");
    }
    const recipientId = conversation.participantLowId === userId
      ? conversation.participantHighId
      : conversation.participantLowId;
    ok(res, await sendDirectMessage(userId, recipientId, req.body.content));
  } catch (error) { next(error); }
});
