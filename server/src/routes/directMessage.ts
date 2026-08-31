import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { ensureUserCanSpeak } from "../services/userModeration";
import { buildUserPreview } from "../utils/publicUser";
import { ensureCanReadBoardType } from "../services/forumAccess";
import { isRetiredBoardSlug } from "../services/retiredBoards";
import { featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { presentAnonymousAlias } from "../services/userTrust";
import {
  DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES,
  directMessageVisibilityWhere,
} from "../services/directMessageModeration";
import { scheduleDirectMessageSubmissionReview } from "../services/directMessageSubmissionReview";
import { shouldBypassAiReviewForUser, shouldRunAiReview } from "../services/topicAiReview";
import {
  anonymousForumDirectScope,
  canonicalDirectParticipants,
  directCounterpartId,
  directParticipantAlias,
  DIRECT_MESSAGE_DEFAULT_SCOPE,
  presentDirectParticipantId,
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
  scopeKey: string;
  participantLowAlias: string | null;
  participantHighAlias: string | null;
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

function anonymousDirectUser(alias: string) {
  return {
    id: 0,
    nickname: alias,
    avatar: null,
    role: "anonymous",
    anonymous: true,
    vipActive: false,
    profileTheme: null,
    profileFrame: null,
  };
}

function directCounterpart(conversation: any, viewerId: number) {
  const counterpartId = directCounterpartId(conversation, viewerId);
  const alias = directParticipantAlias(conversation, counterpartId);
  if (alias) return anonymousDirectUser(alias);
  const user = conversation.participantLowId === counterpartId
    ? conversation.participantLow
    : conversation.participantHigh;
  return buildUserPreview(user);
}

function serializeDirectMessage(message: any, conversation: any, viewerId: number) {
  if (!message) return null;
  return {
    ...message,
    senderId: presentDirectParticipantId(conversation, viewerId, message.senderId),
  };
}

function serializeConversation(
  conversation: any,
  viewerId: number,
  initiatorMessageCount: number,
  unreadCount = 0,
) {
  return {
    id: conversation.id,
    initiatedById: presentDirectParticipantId(conversation, viewerId, conversation.initiatedById),
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
    prisma.user.findUnique({ where: { id: senderId }, select: { id: true, nickname: true, role: true, status: true, mutedUntil: true } }),
    prisma.user.findUnique({ where: { id: recipientId }, select: directUserSelect }),
  ]);
  if (!sender) throw Errors.unauthorized();
  await ensureUserCanSpeak(senderId);
  if (!recipient || recipient.status === "banned") throw Errors.notFound("用户不存在或暂时无法接收私聊");
  if (recipient.role === "bot") throw Errors.badRequest("不能向系统账号发起私聊");
  return { sender, recipient };
}

async function findConversationForUsers(
  firstUserId: number,
  secondUserId: number,
  scopeKey = DIRECT_MESSAGE_DEFAULT_SCOPE,
  viewerId = firstUserId,
) {
  const pair = canonicalDirectParticipants(firstUserId, secondUserId);
  return prisma.directConversation.findFirst({
    where: {
      ...pair,
      scopeKey,
      messages: { some: directMessageVisibilityWhere(viewerId) },
    },
    include: directConversationInclude,
  });
}

type ForumDirectKind = "topic" | "reply";

function parseForumDirectKind(raw: string): ForumDirectKind {
  if (raw === "topic" || raw === "reply") return raw;
  throw Errors.badRequest("帖子类型不正确");
}

async function resolveForumDirectTarget(
  viewerId: number,
  viewerRole: string,
  kind: ForumDirectKind,
  postId: number,
) {
  const raw = kind === "topic"
    ? await prisma.topic.findUnique({
        where: { id: postId },
        select: {
          id: true,
          authorId: true,
          isAnonymous: true,
          anonymousAlias: true,
          hidden: true,
          author: { select: directUserSelect },
          board: { select: { slug: true, type: true } },
        },
      })
    : await prisma.reply.findUnique({
        where: { id: postId },
        select: {
          id: true,
          topicId: true,
          authorId: true,
          isAnonymous: true,
          anonymousAlias: true,
          hidden: true,
          author: { select: directUserSelect },
          topic: {
            select: {
              id: true,
              authorId: true,
              hidden: true,
              board: { select: { slug: true, type: true } },
            },
          },
        },
      });
  if (!raw) throw Errors.notFound("帖子或回复不存在");

  const post = raw as any;
  const topic = kind === "topic" ? post : post.topic;
  const isStaff = viewerRole === "admin" || viewerRole === "mod";
  if (topic.hidden && topic.authorId !== viewerId && !isStaff) throw Errors.notFound("帖子或回复不存在");
  if (post.hidden && post.authorId !== viewerId && !isStaff) throw Errors.notFound("帖子或回复不存在");
  if (isRetiredBoardSlug(topic.board?.slug)) throw Errors.notFound("帖子或回复不存在");
  if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
  await ensureCanReadBoardType(topic.board?.type, viewerId, viewerRole);

  if (post.authorId === viewerId) throw Errors.badRequest("不能与自己私聊");
  if (!post.author || post.author.status === "banned") throw Errors.notFound("用户不存在或暂时无法接收私聊");
  if (post.author.role === "bot") throw Errors.badRequest("不能向系统账号发起私聊");

  const alias = post.isAnonymous ? presentAnonymousAlias(post.anonymousAlias) : null;
  const topicId = Number(topic.id);
  return {
    recipientId: Number(post.authorId),
    recipient: post.author,
    recipientAlias: alias,
    scopeKey: alias ? anonymousForumDirectScope(topicId, alias) : DIRECT_MESSAGE_DEFAULT_SCOPE,
  };
}

type DirectMessageContext = {
  scopeKey?: string;
  recipientAlias?: string | null;
};

async function sendDirectMessage(
  senderId: number,
  recipientId: number,
  content: string,
  context: DirectMessageContext = {},
) {
  const { sender } = await requireDirectMessageTarget(senderId, recipientId);
  const shouldReview = shouldRunAiReview() && !await shouldBypassAiReviewForUser(senderId, sender.role);
  const pair = canonicalDirectParticipants(senderId, recipientId);
  const scopeKey = context.scopeKey || DIRECT_MESSAGE_DEFAULT_SCOPE;
  const recipientAlias = String(context.recipientAlias || "").trim() || null;
  const participantLowAlias = pair.participantLowId === recipientId ? recipientAlias : null;
  const participantHighAlias = pair.participantHighId === recipientId ? recipientAlias : null;

  const result = await prisma.$transaction(async (tx) => {
    // INSERT ... ON CONFLICT 会锁住这一对用户在当前身份作用域里的唯一会话行；后续计数和写入在同一事务内，
    // 即使用户并发点击发送，也不能越过“回复前两条”的服务端限制。
    const rows = await tx.$queryRaw<DirectConversationRow[]>`
      INSERT INTO "DirectConversation" (
        "participantLowId", "participantHighId", "scopeKey",
        "participantLowAlias", "participantHighAlias", "initiatedById",
        "lastMessageAt", "createdAt", "updatedAt"
      ) VALUES (
        ${pair.participantLowId}, ${pair.participantHighId}, ${scopeKey},
        ${participantLowAlias}, ${participantHighAlias}, ${senderId},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("participantLowId", "participantHighId", "scopeKey")
      DO UPDATE SET "updatedAt" = "DirectConversation"."updatedAt"
      RETURNING *
    `;
    const conversation = rows[0];
    if (!conversation) throw Errors.server("私聊会话创建失败");

    const initiatorMessageCount = conversation.initiatedById === senderId
      ? await tx.directMessage.count({
        where: {
          conversationId: conversation.id,
          senderId: conversation.initiatedById,
          aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] },
        },
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
      data: {
        conversationId: conversation.id,
        senderId,
        content,
        hidden: shouldReview,
        aiReviewStatus: shouldReview ? "checking" : "auto_passed",
        aiRiskLevel: shouldReview ? null : "low",
        aiRiskScore: shouldReview ? null : 0,
        aiReviewReason: shouldReview ? "消息已进入后台 AI 内容审核，通过后对方才会收到。" : "无需 AI 审核",
        aiReviewedAt: shouldReview ? null : new Date(),
      },
    });
    if (!shouldReview) {
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
          title: `${directParticipantAlias(conversation, senderId) || sender.nickname || "有用户"} 发来私聊`,
          content: "有一条新私聊消息，进入站内私聊查看。",
          link: `/messages?tab=private&conversation=${conversation.id}`,
          source: "站内私聊",
          payload: JSON.stringify({ type: "direct-message", conversationId: conversation.id, messageId: message.id }),
        },
      });
    }
    return { conversationId: conversation.id, message };
  });

  if (shouldReview) scheduleDirectMessageSubmissionReview(result.message.id);

  const conversation = await prisma.directConversation.findUnique({
    where: { id: result.conversationId },
    include: directConversationInclude,
  });
  if (!conversation) throw Errors.server("私聊会话读取失败");
  const initiatorMessageCount = conversation.initiatedById === senderId
    ? await prisma.directMessage.count({
      where: {
        conversationId: conversation.id,
        senderId,
        aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] },
      },
    })
    : 0;
  return {
    conversation: serializeConversation(conversation, senderId, initiatorMessageCount),
    message: serializeDirectMessage(result.message, conversation, senderId),
  };
}

directMessageRouter.get("/conversations", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const list = await prisma.directConversation.findMany({
      where: {
        AND: [
          { OR: [{ participantLowId: userId }, { participantHighId: userId }] },
          { messages: { some: directMessageVisibilityWhere(userId) } },
        ],
      },
      include: {
        ...directConversationInclude,
        messages: { where: directMessageVisibilityWhere(userId), orderBy: { id: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    const conversationIds = list.map((item) => item.id);
    const [sentCounts, unreadCounts] = conversationIds.length
      ? await Promise.all([
        prisma.directMessage.groupBy({
          by: ["conversationId"],
          where: {
            conversationId: { in: conversationIds },
            senderId: userId,
            aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] },
          },
          _count: { _all: true },
        }),
        prisma.directMessage.groupBy({
          by: ["conversationId"],
          where: { conversationId: { in: conversationIds }, senderId: { not: userId }, hidden: false, readAt: null },
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
      lastMessageAt: conversation.messages[0]?.createdAt || conversation.lastMessageAt,
      lastMessage: serializeDirectMessage(conversation.messages[0], conversation, userId),
    })).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
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
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: userId, aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] } } }),
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: { not: userId }, hidden: false, readAt: null } }),
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
    const result = await sendDirectMessage(req.user!.userId, recipientId, req.body.content);
    if (result.message.aiReviewStatus === "checking") res.status(202);
    ok(res, result);
  } catch (error) { next(error); }
});

directMessageRouter.get("/forum/:kind/:postId", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const kind = parseForumDirectKind(req.params.kind);
    const postId = parsePositiveId(req.params.postId, kind === "topic" ? "帖子" : "回复");
    const target = await resolveForumDirectTarget(userId, req.user!.role, kind, postId);
    const conversation = await findConversationForUsers(userId, target.recipientId, target.scopeKey);
    const counterpart = target.recipientAlias
      ? anonymousDirectUser(target.recipientAlias)
      : buildUserPreview(target.recipient);
    if (!conversation) return ok(res, { counterpart, conversation: null });
    const [sentCount, unreadCount] = await Promise.all([
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: userId, aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] } } }),
      prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: { not: userId }, hidden: false, readAt: null } }),
    ]);
    ok(res, {
      counterpart,
      conversation: serializeConversation(conversation, userId, sentCount, unreadCount),
    });
  } catch (error) { next(error); }
});

directMessageRouter.post("/forum/:kind/:postId/messages", validate(sendSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const kind = parseForumDirectKind(req.params.kind);
    const postId = parsePositiveId(req.params.postId, kind === "topic" ? "帖子" : "回复");
    const target = await resolveForumDirectTarget(userId, req.user!.role, kind, postId);
    const result = await sendDirectMessage(userId, target.recipientId, req.body.content, {
      scopeKey: target.scopeKey,
      recipientAlias: target.recipientAlias,
    });
    if (result.message.aiReviewStatus === "checking") res.status(202);
    ok(res, result);
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
        ...directMessageVisibilityWhere(userId),
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
        where: { conversationId, senderId: { not: userId }, hidden: false, readAt: null },
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
      ? await prisma.directMessage.count({ where: { conversationId, senderId: userId, aiReviewStatus: { in: [...DIRECT_MESSAGE_PRE_REPLY_COUNT_STATUSES] } } })
      : 0;
    ok(res, {
      conversation: serializeConversation(conversation, userId, initiatorMessageCount, 0),
      messages: pageRows.map((message) => serializeDirectMessage({
        ...message,
        readAt: message.senderId !== userId && !message.readAt ? now : message.readAt,
      }, conversation, userId)),
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
    const result = await sendDirectMessage(userId, recipientId, req.body.content, {
      scopeKey: conversation.scopeKey,
    });
    if (result.message.aiReviewStatus === "checking") res.status(202);
    ok(res, result);
  } catch (error) { next(error); }
});
