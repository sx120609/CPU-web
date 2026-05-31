import crypto from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { ensureForumAccessEnabled } from "./forumAccess";
import { getSiteOrigin, isBoardTypeEnabled, isFeatureOn, featureForBoardType, featureClosedMessage } from "./siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import { ensureUserCanSpeak } from "./userModeration";
import {
  ensureUserCanSubmitTopic,
  generateTopicAiTags,
  requestAiJson,
  notifyTopicAiBlocked,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
  syncTopicAiTags,
} from "./topicAiReview";

export type QqBotConfigView = {
  id: number;
  enabled: boolean;
  botQqId: string;
  napcatBaseUrl: string;
  hasAccessToken: boolean;
  accessTokenMasked: string;
  connectionStatus: "disabled" | "http" | "idle" | "connecting" | "connected" | "error";
  connectionError: string;
  webhookSecret: string;
  defaultBoardSlug: string;
  allowPrivatePost: boolean;
  allowGroupPost: boolean;
  notificationEnabled: boolean;
  notifyCategories: string[];
  webhookPath: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UserQqBotProfileView = {
  enabled: boolean;
  botQqId: string;
  defaultBoardSlug: string;
  allowPrivatePost: boolean;
  allowGroupPost: boolean;
  binding: null | {
    id: number;
    qqId: string;
    nickname: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  activeBindToken: null | {
    token: string;
    expiresAt: Date;
  };
  recentTopics: Array<{
    id: number;
    title: string;
    boardSlug: string;
    boardName: string;
    hidden: boolean;
    createdAt: Date;
  }>;
};

type OneBotEvent = {
  post_type?: string;
  self_id?: number | string;
  message_type?: "private" | "group";
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  message_id?: number | string;
  message?: unknown;
  raw_message?: string;
  sender?: { nickname?: string; card?: string; user_id?: number | string };
};

type QqConversationScene = "post" | "forward-post";
type QqConversationStep =
  | "await-title"
  | "collect-content"
  | "await-forward-confirm"
  | "await-forward-title"
  | "await-ai-post-confirm"
  | "await-submit-confirm";
type ParsedForwardPayload = {
  summary: string;
  content: string;
  sourceMessageId?: string;
};

type ForwardSource = "direct" | "reply";

type QqBotAiIntent =
  | { intent: "chat" }
  | { intent: "help" }
  | { intent: "status" }
  | { intent: "boards" }
  | { intent: "recent-posts" }
  | { intent: "start-post"; title?: string; content?: string; boardSlug?: string }
  | { intent: "reply"; message: string };

type QqBotAssistantReply = {
  reply: string;
  suggestedBoardSlug?: string;
  suggestedTitle?: string;
  suggestedContent?: string;
  confidence?: "low" | "medium" | "high";
};

const qqBotCooldowns = new Map<string, { cancelledAt?: number }>();

const CONFIG_ID = 1;
const DEFAULT_NOTIFY_CATEGORIES = ["reply", "mention", "like", "system"];
let pollerStarted = false;
let wsClient: any = null;
let wsConnecting = false;
let wsReconnectTimer: NodeJS.Timeout | null = null;
let wsLastError = "";
const wsPendingActions = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }>();

export async function getQqBotConfigRaw() {
  return prisma.qqBotConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID },
    update: {},
  });
}

export function formatQqBotConfig(config: Awaited<ReturnType<typeof getQqBotConfigRaw>>): QqBotConfigView {
  return {
    id: config.id,
    enabled: config.enabled,
    botQqId: config.botQqId,
    napcatBaseUrl: config.napcatBaseUrl,
    hasAccessToken: Boolean(config.accessToken),
    accessTokenMasked: maskSecret(config.accessToken),
    connectionStatus: getQqBotConnectionStatus(config),
    connectionError: getQqBotConnectionError(config),
    webhookSecret: config.webhookSecret,
    defaultBoardSlug: config.defaultBoardSlug || "general",
    allowPrivatePost: config.allowPrivatePost,
    allowGroupPost: config.allowGroupPost,
    notificationEnabled: config.notificationEnabled,
    notifyCategories: parseStringArray(config.notifyCategories, DEFAULT_NOTIFY_CATEGORIES),
    webhookPath: "/api/qqbot/webhook",
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function updateQqBotConfig(input: {
  enabled?: boolean;
  botQqId?: string;
  napcatBaseUrl?: string;
  accessToken?: string;
  clearAccessToken?: boolean;
  webhookSecret?: string;
  defaultBoardSlug?: string;
  allowPrivatePost?: boolean;
  allowGroupPost?: boolean;
  notificationEnabled?: boolean;
  notifyCategories?: string[];
}) {
  const data: any = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.botQqId !== undefined) data.botQqId = String(input.botQqId || "").trim().slice(0, 40);
  if (input.napcatBaseUrl !== undefined) data.napcatBaseUrl = normalizeBaseUrl(input.napcatBaseUrl);
  if (input.clearAccessToken) data.accessToken = "";
  else if (input.accessToken !== undefined && input.accessToken.trim()) data.accessToken = input.accessToken.trim();
  if (input.webhookSecret !== undefined) data.webhookSecret = input.webhookSecret.trim();
  if (input.defaultBoardSlug !== undefined) {
    const slug = input.defaultBoardSlug.trim() || "general";
    const board = await prisma.board.findUnique({ where: { slug }, select: { slug: true } });
    if (!board) throw Errors.badRequest("默认投稿板块不存在");
    data.defaultBoardSlug = slug;
  }
  if (input.allowPrivatePost !== undefined) data.allowPrivatePost = input.allowPrivatePost;
  if (input.allowGroupPost !== undefined) data.allowGroupPost = input.allowGroupPost;
  if (input.notificationEnabled !== undefined) data.notificationEnabled = input.notificationEnabled;
  if (input.notifyCategories !== undefined) {
    data.notifyCategories = JSON.stringify(input.notifyCategories.map((item) => item.trim()).filter(Boolean));
  }
  const updated = await prisma.qqBotConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...data },
    update: data,
  });
  resetQqBotWebSocket();
  setTimeout(() => connectQqBotWebSocket().catch(() => undefined), 300);
  return formatQqBotConfig(updated);
}

export async function createQqBindToken(userId: number) {
  const existingBinding = await prisma.qqBotBinding.findFirst({
    where: { userId, enabled: true },
    select: { id: true },
  });
  if (existingBinding) throw Errors.badRequest("当前账号已绑定 QQ，如需更换请先解绑。");
  const activeToken = await prisma.qqBotBindToken.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (activeToken) return { token: activeToken.token, expiresAt: activeToken.expiresAt };
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.qqBotBindToken.create({ data: { userId, token, expiresAt } });
  return { token, expiresAt };
}

export async function getUserQqBotProfile(userId: number): Promise<UserQqBotProfileView> {
  const [config, binding, activeToken, recentTopics] = await Promise.all([
    getQqBotConfigRaw(),
    prisma.qqBotBinding.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.qqBotBindToken.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.topic.findMany({
      where: {
        authorId: userId,
        metadata: { contains: "\"source\":\"qqbot\"" },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        board: { select: { slug: true, name: true } },
      },
    }),
  ]);

  return {
    enabled: config.enabled,
    botQqId: config.botQqId,
    defaultBoardSlug: config.defaultBoardSlug || "general",
    allowPrivatePost: config.allowPrivatePost,
    allowGroupPost: config.allowGroupPost,
    binding: binding ? {
      id: binding.id,
      qqId: binding.qqId,
      nickname: binding.nickname || "",
      enabled: binding.enabled,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    } : null,
    activeBindToken: !binding && activeToken ? {
      token: activeToken.token,
      expiresAt: activeToken.expiresAt,
    } : null,
    recentTopics: recentTopics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      boardSlug: topic.board.slug,
      boardName: topic.board.name,
      hidden: topic.hidden,
      createdAt: topic.createdAt,
    })),
  };
}

export async function deleteUserQqBinding(userId: number, bindingId?: number) {
  const binding = await prisma.qqBotBinding.findFirst({
    where: {
      userId,
      ...(bindingId ? { id: bindingId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!binding) throw Errors.notFound("当前没有可解绑的 QQ 绑定");
  await prisma.qqBotBinding.delete({ where: { id: binding.id } });
  return { ok: true };
}

export async function handleQqBotWebhook(event: OneBotEvent, secret?: string | null) {
  const config = await getQqBotConfigRaw();
  if (config.webhookSecret && secret !== config.webhookSecret) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "webhook",
      status: "error",
      result: "webhook secret 不匹配",
      rawPayload: event,
    });
    throw Errors.unauthorized("QQBot webhook 鉴权失败");
  }
  if (!config.enabled) {
    await logQqBotMessage({ direction: "inbound", eventType: "webhook", status: "ignored", result: "QQBot 未启用", rawPayload: event });
    return { ignored: true };
  }
  if (event.post_type !== "message") {
    await logQqBotMessage({ direction: "inbound", eventType: event.post_type || "event", status: "ignored", rawPayload: event });
    return { ignored: true };
  }

  const qqId = event.user_id ? String(event.user_id) : "";
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const messageText = extractMessageText(event.message ?? event.raw_message ?? "");
  const forwardPayload = await extractForwardPayload(event.message);
  const context = { config, event, qqId, groupId, messageText, forwardPayload };
  if (!qqId || !messageText.trim()) {
    await logQqBotMessage({ direction: "inbound", eventType: "message", status: "ignored", qqId, groupId, rawPayload: event });
    return { ignored: true };
  }

  const activeConversation = await getActiveConversation(qqId, groupId);
  if (activeConversation) {
    const handled = await handleConversationMessage(activeConversation, context);
    if (handled) return handled;
  }

  if (isCommandMessage(messageText) && isHelpCommand(messageText)) {
    await logHandledInboundMessage(context, "message", "assistant:help");
    await replyToEvent(context, renderHelp(config.defaultBoardSlug));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "板块")) && isBoardListCommand(normalizePrivatePlainCommand(messageText, "板块"))) {
    await logHandledInboundMessage(context, "message", "assistant:boards");
    await replyToEvent(context, await renderBoardList(config.defaultBoardSlug, groupId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "我的投稿")) && isMyPostsCommand(normalizePrivatePlainCommand(messageText, "我的投稿"))) {
    if (event.message_type === "group") {
      await replyToEvent(context, "群聊里不支持查询个人投稿记录，请私聊我后再使用这个功能。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:recent-posts");
    await replyToEvent(context, await renderRecentQqTopics(qqId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) && /^[/／]状态(?:\s|$)/.test(messageText.trim())) || isPrivatePlainCommand(messageText, "状态")) {
    if (event.message_type === "group") {
      await replyToEvent(context, "群聊里不展示个人绑定状态，请私聊我后再查看。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:status");
    await replyToEvent(context, await renderBindingStatus(qqId, config, groupId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "解绑")) && isUnbindCommand(normalizePrivatePlainCommand(messageText, "解绑"))) {
    if (event.message_type === "group") {
      await replyToEvent(context, "群聊里不支持解绑个人账号，请私聊我后再操作。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:unbind");
    await replyToEvent(context, await unbindQqAccount(qqId));
    return { ok: true };
  }
  const bindMatch = messageText.trim().match(/^(?:[/／])?绑定\s+([A-Z0-9]{6,16})$/i);
  if (bindMatch) {
    const result = await bindQqAccount({
      qqId,
      nickname: event.sender?.card || event.sender?.nickname || "",
      token: bindMatch[1].toUpperCase(),
    });
    await logHandledInboundMessage(context, "message", "assistant:bind");
    await replyToEvent(context, result);
    return { ok: true };
  }
  if (isCommandMessage(messageText) && /^[/／]投稿(?:\s|$)/.test(messageText.trim())) {
    if (event.message_type === "group") {
      await replyToEvent(
        context,
        "群聊投稿只支持“@bot + 合并转发内容”这一种方式。请先转发要投稿的内容，并在同一条消息里 @我 说明要投稿。",
      );
      return { ok: true };
    }
    const conversation = await startPostConversation(context);
    await logHandledInboundMessage(context, "message", "assistant:start-post");
    await replyToEvent(context, renderConversationPrompt(conversation, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"));
    return { ok: true };
  }
  if (!isCommandMessage(messageText) && forwardPayload && shouldHandleForwardPostInContext(context)) {
    const conversation = await startForwardPostConversation(context, forwardPayload);
    await logHandledInboundMessage(context, "message", "assistant:forward-detected");
    await replyToEvent(context, renderConversationPrompt(conversation));
    return { ok: true };
  }

  if (!isCommandMessage(messageText) && isGreetingMessage(messageText) && shouldAssistantAutoReply(context)) {
    await logHandledInboundMessage(context, "message", "assistant:greeting");
    await replyToEvent(context, renderGreetingReply(context.config.defaultBoardSlug));
    return { ok: true };
  }

  if (!isCommandMessage(messageText)) {
    const aiHandled = await handleNaturalLanguageMessage(context);
    if (aiHandled) return aiHandled;
  }

  if (event.message_type !== "group") {
    await logHandledInboundMessage(context, "message", "assistant:fallback");
    await replyToEvent(context, renderPrivateFallbackReply());
    return { ok: true };
  }

  await logQqBotMessage({
    direction: "inbound",
    eventType: "message",
    status: "ignored",
    qqId,
    groupId,
    messageId: event.message_id ? String(event.message_id) : undefined,
    content: messageText.slice(0, 500),
    rawPayload: event,
  });
  return { ignored: true };
}

async function handleNaturalLanguageMessage(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
  messageText: string;
  forwardPayload?: (ParsedForwardPayload & { source: ForwardSource }) | null;
}) {
  if (context.event.message_type === "group") {
    return null;
  }
  if (isRecentlyCancelled(context.qqId, context.groupId) && !isExplicitPostTrigger(context.event, context.messageText)) {
    return null;
  }
  if (!shouldRunAiReview()) return null;
  const intent = await inferQqBotIntent(context).catch(() => null);
  if (!intent) return null;
  if (intent.intent === "chat") {
    if (!shouldAssistantAutoReply(context)) return null;
    const assistantReply = await generateAssistantReply(context, "如果你想投稿、查板块、看状态，直接跟我说就行。").catch(() => null);
    if (!assistantReply?.reply?.trim()) return null;
    await logHandledInboundMessage(context, "message", "assistant:chat");
    await replyToEvent(context, assistantReply.reply.slice(0, 500));
    return { ok: true, ai: true };
  }
  if (intent.intent === "help") {
    await logHandledInboundMessage(context, "message", "assistant:help");
    await replyToEvent(context, renderHelp(context.config.defaultBoardSlug));
    return { ok: true, ai: true };
  }
  if (intent.intent === "status") {
    await logHandledInboundMessage(context, "message", "assistant:status");
    await replyToEvent(context, await renderBindingStatus(context.qqId, context.config, context.groupId));
    return { ok: true, ai: true };
  }
  if (intent.intent === "boards") {
    await logHandledInboundMessage(context, "message", "assistant:boards");
    await replyToEvent(context, await renderBoardList(context.config.defaultBoardSlug, context.groupId));
    return { ok: true, ai: true };
  }
  if (intent.intent === "recent-posts") {
    await logHandledInboundMessage(context, "message", "assistant:recent-posts");
    await replyToEvent(context, await renderRecentQqTopics(context.qqId));
    return { ok: true, ai: true };
  }
  if (intent.intent === "reply") {
    const assistantReply = await generateAssistantReply(context, intent.message).catch(() => null);
    await logHandledInboundMessage(context, "message", "assistant:reply");
    await replyToEvent(context, (assistantReply?.reply || intent.message).slice(0, 500));
    return { ok: true, ai: true };
  }
  if (intent.intent === "start-post") {
    const conversation = await startPostConversation(context);
    let nextConversation = conversation;
    const suggested = await generateAssistantReply(context, "请根据用户刚才的话整理投稿草稿").catch(() => null);
    const draftTitle = (intent.title || suggested?.suggestedTitle || "").trim();
    const draftContent = (intent.content || suggested?.suggestedContent || "").trim();
    const draftBoardSlug = (intent.boardSlug || suggested?.suggestedBoardSlug || "").trim();
    if (draftTitle) {
      const parsed = await parseConversationTitle(draftTitle, conversation.draftBoardSlug || context.config.defaultBoardSlug, context.groupId);
      nextConversation = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: {
          draftTitle: parsed.title,
          draftBoardSlug: draftBoardSlug || parsed.boardSlug,
          draftContent: draftContent,
          step: draftContent ? "await-ai-post-confirm" : "collect-content",
        },
      });
    }
    const reply = renderConversationPrompt(
      nextConversation,
      [suggested?.reply, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"].filter(Boolean).join("\n"),
    );
    await logHandledInboundMessage(context, "message", "assistant:start-post-ai");
    await replyToEvent(context, reply);
    return { ok: true, ai: true };
  }
  return null;
}

async function bindQqAccount(input: { qqId: string; nickname?: string; token: string }) {
  const row = await prisma.qqBotBindToken.findUnique({
    where: { token: input.token },
    include: { user: { select: { id: true, nickname: true, status: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return "绑定码不存在或已过期，请在站内重新生成。";
  if (row.user.status === "banned") return "这个站内账号已被封禁，不能绑定 QQ。";
  const existingBinding = await prisma.qqBotBinding.findFirst({
    where: { userId: row.userId, enabled: true },
    select: { qqId: true },
  });
  if (existingBinding && existingBinding.qqId !== input.qqId) {
    return `该站内账号已绑定 QQ ${existingBinding.qqId}，如需更换请先在站内解绑。`;
  }
  await prisma.$transaction([
    prisma.qqBotBinding.upsert({
      where: { qqId: input.qqId },
      create: { qqId: input.qqId, userId: row.userId, nickname: input.nickname || null },
      update: { userId: row.userId, nickname: input.nickname || null, enabled: true },
    }),
    prisma.qqBotBindToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  return [
    `绑定成功：${row.user.nickname}`,
    "之后可以这样发帖：",
    "投稿 标题",
    "正文",
  ].join("\n");
}

async function unbindQqAccount(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({ where: { qqId } });
  if (!binding) return "当前 QQ 还没有绑定站内账号。";
  await prisma.qqBotBinding.delete({ where: { id: binding.id } });
  return "已解绑当前 QQ。之后如需继续投稿，请回站内重新生成绑定码。";
}

async function startPostConversation(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
  messageText: string;
}) {
  await ensureQqPostingAllowed(context);
  await ensureQqBinding(context.qqId);
  const defaultBoardSlug = await resolveDefaultBoardSlug(context.config.defaultBoardSlug, context.groupId);
  return upsertConversation(context.qqId, context.groupId, {
    scene: "post",
    step: "await-title",
    draftTitle: "",
    draftContent: "",
    draftBoardSlug: defaultBoardSlug,
    sourceMessageId: context.event.message_id ? String(context.event.message_id) : undefined,
    sourceSummary: "",
    metadata: "{}",
  });
}

async function startForwardPostConversation(
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
  forwardPayload: ParsedForwardPayload,
) {
  await ensureQqPostingAllowed(context);
  await ensureQqBinding(context.qqId);
  const defaultBoardSlug = await resolveDefaultBoardSlug(context.config.defaultBoardSlug, context.groupId);
  return upsertConversation(context.qqId, context.groupId, {
    scene: "forward-post",
    step: "await-forward-confirm",
    draftTitle: "",
    draftContent: forwardPayload.content,
    draftBoardSlug: defaultBoardSlug,
    sourceMessageId: forwardPayload.sourceMessageId || (context.event.message_id ? String(context.event.message_id) : undefined),
    sourceSummary: forwardPayload.summary,
    metadata: JSON.stringify({ source: "forward" }),
  });
}

async function submitQqPost(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
  messageText: string;
}) {
  if (context.event.message_type === "group" && !context.config.allowGroupPost) {
    return { message: "群内投稿暂未开启，请私聊投稿。", topicId: null };
  }
  if (context.event.message_type !== "group" && !context.config.allowPrivatePost) {
    return { message: "私聊投稿暂未开启。", topicId: null };
  }

  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId: context.qqId },
    include: { user: { select: { id: true, username: true, nickname: true, role: true, status: true } } },
  });
  if (!binding?.enabled) return { message: "还没有绑定站内账号。请先在站内生成绑定码，然后发送：绑定 绑定码", topicId: null };
  const parsed = await parsePostCommand(context.messageText, context.config.defaultBoardSlug, context.groupId);
  const topic = await createTopicFromQq({
    user: {
      userId: binding.user.id,
      studentId: binding.user.username,
      role: binding.user.role,
      campus: "",
    },
    boardSlug: parsed.boardSlug,
    title: parsed.title,
    content: appendSourceFooter(parsed.content, context),
    qqId: context.qqId,
    groupId: context.groupId,
    messageId: context.event.message_id ? String(context.event.message_id) : undefined,
    rawPayload: context.event,
  });
  await logQqBotMessage({
    direction: "inbound",
    eventType: "post",
    status: topic.hidden ? "ok" : "ok",
    qqId: context.qqId,
    groupId: context.groupId,
    messageId: context.event.message_id ? String(context.event.message_id) : undefined,
    userId: binding.user.id,
    topicId: topic.id,
    command: "投稿",
    content: context.messageText.slice(0, 1000),
    result: topic.hidden ? `AI 初审未通过：${topic.aiReviewReason || ""}` : "已发布",
    rawPayload: context.event,
  });
  if (topic.hidden) {
    const topicLink = buildTopicLink(topic.id);
    return {
      message: [
        "已搬运到平台，但暂未通过 AI 初审",
        `原因：${topic.aiReviewReason || "需要人工复核"}`,
        topicLink ? `链接：${topicLink}` : `/forum/topic/${topic.id}`,
      ].join("\n"),
      topicId: topic.id,
    };
  }
  const topicLink = buildTopicLink(topic.id);
  return {
    message: [
      `已投稿到「${topic.board.name}」`,
      topic.title,
      topicLink ? `链接：${topicLink}` : `/forum/topic/${topic.id}`,
    ].join("\n"),
    topicId: topic.id,
  };
}

async function handleConversationMessage(
  conversation: any,
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
    forwardPayload?: (ParsedForwardPayload & { source: ForwardSource }) | null;
  },
) {
  const text = context.messageText.trim();
  if (isCancelMessage(text)) {
    markConversationCancelled(context.qqId, context.groupId);
    await finishConversation(conversation.id, "cancelled");
    await replyToEvent(context, "已取消这次投稿。");
    return { ok: true, cancelled: true };
  }

  if (conversation.step === "await-forward-confirm") {
    if (/^(是|要|好的|确认|投稿)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-forward-title" },
      });
      await replyToEvent(context, renderConversationPrompt(next));
      return { ok: true };
    }
    if (/^(否|不要|取消|算了)$/i.test(text)) {
      markConversationCancelled(context.qqId, context.groupId);
      await finishConversation(conversation.id, "cancelled");
      await replyToEvent(context, "好的，这条转发内容我先不投稿。");
      return { ok: true, cancelled: true };
    }
    await replyToEvent(context, "如果要投稿，请回复“是”；不想投稿就回复“否”或“/取消”。群聊里我只处理这种带合并转发的投稿。");
    return { ok: true };
  }

  if (conversation.step === "await-ai-post-confirm") {
    if (/^(是|好|好的|继续|发送|确认|就这样|可以)$/i.test(text)) {
      if ((conversation.draftContent || "").trim()) {
        try {
          const result = await submitConversationPost(conversation.id, context);
          await replyToEvent(context, result.message);
          return { ok: true, topicId: result.topicId };
        } catch (error: any) {
          const message = error?.message || "投稿失败";
          await replyToEvent(context, `投稿失败：${message}`);
          return { ok: false, error: message };
        }
      }
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToEvent(context, renderConversationPrompt(next, "好的，你继续把正文发给我。"));
      return { ok: true };
    }
    if (/^(改标题|重新标题|换标题)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-title" },
      });
      await replyToEvent(context, renderConversationPrompt(next, "好的，请发送新的标题。"));
      return { ok: true };
    }
    if (/^(补充|继续写|加正文)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToEvent(context, renderConversationPrompt(next, "好的，继续把正文补充给我。"));
      return { ok: true };
    }
    await replyToEvent(context, "如果这份草稿可以直接发，请回复“是”；想改标题就回复“改标题”；想继续补正文就直接发内容或回复“补充”。");
    return { ok: true };
  }

  if (conversation.step === "await-title" || conversation.step === "await-forward-title") {
    const normalizedText = context.messageText.trim();
    if (normalizedText.length < 2) {
      await replyToEvent(context, "标题至少 2 个字，请重新发送标题。");
      return { ok: true };
    }
    const [firstLine, ...restLines] = normalizedText.split(/\r?\n/);
    const titleCandidate = firstLine.trim();
    if (titleCandidate.length < 2) {
      await replyToEvent(context, "标题至少 2 个字，请重新发送标题。");
      return { ok: true };
    }
    const parsed = await parseConversationTitle(titleCandidate, conversation.draftBoardSlug || context.config.defaultBoardSlug, context.groupId);
    const draftContent = restLines.join("\n").trim();
    const mergedDraftContent = mergeConversationContent(conversation.draftContent || "", draftContent);
    const shouldReturnToConfirm = Boolean((conversation.draftContent || "").trim()) || conversation.step === "await-forward-title" || Boolean(draftContent);
    const next = await prisma.qqBotConversation.update({
      where: { id: conversation.id },
      data: {
        draftTitle: parsed.title,
        draftBoardSlug: parsed.boardSlug,
        draftContent: mergedDraftContent,
        step: shouldReturnToConfirm ? "await-submit-confirm" : "collect-content",
      },
    });
    await replyToEvent(context, renderConversationPrompt(
      next,
      conversation.step === "await-forward-title"
        ? `标题我记成「${parsed.title}」了，正文我会直接使用你刚才回复的那条合并转发内容。`
        : shouldReturnToConfirm
        ? `标题我已经改成「${parsed.title}」了，正文我继续沿用你刚才整理好的内容。`
        : draftContent
        ? `我把第一行当标题，后面的内容也一起收进正文了。标题是「${parsed.title}」。`
        : `我先帮你把标题定为「${parsed.title}」。`,
    ));
    return { ok: true };
  }

  if (conversation.step === "collect-content") {
    if (/(^|\n)\s*[/／]结束(?:\s|$)/m.test(context.messageText.trim())) {
      const normalizedText = context.messageText.replace(/(^|\n)\s*[/／]结束(?:\s|$)/m, "").trim();
      const mergedContent = normalizedText
        ? mergeConversationContent(conversation.draftContent || "", normalizedText)
        : (conversation.draftContent || "");
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: {
          draftContent: mergedContent,
          step: "await-submit-confirm",
        },
      });
      await replyToEvent(context, renderConversationPrompt(next, "我先帮你整理好，确认后再正式发布。"));
      return { ok: true };
    }

    if (shouldAssistantAutoReply(context) && /^(帮我润色|润色一下|优化一下|帮我整理一下|重写一下)/i.test(text)) {
      const polished = await polishConversationDraft(conversation, context).catch(() => null);
      if (polished) {
        await replyToEvent(context, polished);
        return { ok: true };
      }
    }

    const nextContent = mergeConversationContent(conversation.draftContent || "", context.messageText);
    await prisma.qqBotConversation.update({
      where: { id: conversation.id },
      data: { draftContent: nextContent },
    });
    await replyToEvent(context, "已收到这段正文。继续发送内容，全部完成后发送“/结束”。");
    return { ok: true };
  }

  if (conversation.step === "await-submit-confirm") {
    if (isConfirmPublishMessage(text)) {
      try {
        const result = await submitConversationPost(conversation.id, context);
        await replyToEvent(context, result.message);
        return { ok: true, topicId: result.topicId };
      } catch (error: any) {
        const message = error?.message || "投稿失败";
        await replyToEvent(context, `投稿失败：${message}`);
        return { ok: false, error: message };
      }
    }
    if (/^(改标题|重新标题|换标题)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-title" },
      });
      await replyToEvent(context, renderConversationPrompt(next, "好的，请发送新的标题。"));
      return { ok: true };
    }
    if (/^(补充|继续写|继续补充|改正文|继续修改)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToEvent(context, renderConversationPrompt(next, "好的，继续把正文补充给我。"));
      return { ok: true };
    }
    if (!isCommandMessage(text)) {
      const nextContent = mergeConversationContent(conversation.draftContent || "", context.messageText);
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: {
          draftContent: nextContent,
          step: "collect-content",
        },
      });
      await replyToEvent(context, renderConversationPrompt(next, "我把这段也补进正文里了。"));
      return { ok: true };
    }
    await replyToEvent(context, "如果可以发布，请回复“确认发布”或“是”；想改标题回复“改标题”；想继续补正文就直接发内容。");
    return { ok: true };
  }

  return null;
}

async function submitConversationPost(
  conversationId: number,
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
) {
  const conversation = await prisma.qqBotConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.status !== "active") throw Errors.badRequest("当前没有进行中的投稿会话");
  if (!conversation.draftTitle?.trim()) throw Errors.badRequest("标题为空，请先发送标题");
  const content = (conversation.draftContent || "").trim() || conversation.draftTitle.trim();
  const result = await submitQqPost({
    ...context,
    messageText: buildPostCommandFromDraft(conversation.draftBoardSlug || context.config.defaultBoardSlug, conversation.draftTitle, content, context.groupId, context.config.defaultBoardSlug),
  });
  await finishConversation(conversationId, "done");
  return result;
}

async function getActiveConversation(qqId: string, groupId?: string) {
  return prisma.qqBotConversation.findFirst({
    where: {
      qqId,
      groupId: groupId || null,
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function upsertConversation(
  qqId: string,
  groupId: string | undefined,
  input: {
    scene: QqConversationScene;
    step: QqConversationStep;
    draftTitle?: string;
    draftContent?: string;
    draftBoardSlug?: string;
    sourceMessageId?: string;
    sourceSummary?: string;
    metadata?: string;
  },
) {
  const current = await getActiveConversation(qqId, groupId);
  if (current) {
    return prisma.qqBotConversation.update({
      where: { id: current.id },
      data: {
        scene: input.scene,
        step: input.step,
        draftTitle: input.draftTitle || null,
        draftContent: input.draftContent || "",
        draftBoardSlug: input.draftBoardSlug || null,
        sourceMessageId: input.sourceMessageId || null,
        sourceSummary: input.sourceSummary || null,
        metadata: input.metadata || "{}",
        status: "active",
      },
    });
  }
  return prisma.qqBotConversation.create({
    data: {
      qqId,
      groupId: groupId || null,
      scene: input.scene,
      step: input.step,
      draftTitle: input.draftTitle || null,
      draftContent: input.draftContent || "",
      draftBoardSlug: input.draftBoardSlug || null,
      sourceMessageId: input.sourceMessageId || null,
      sourceSummary: input.sourceSummary || null,
      metadata: input.metadata || "{}",
    },
  });
}

async function finishConversation(id: number, status: "done" | "cancelled") {
  await prisma.qqBotConversation.update({
    where: { id },
    data: { status },
  }).catch(() => null);
}

function renderConversationPrompt(conversation: any, assistantHint?: string) {
  if (conversation.step === "await-title") {
    const isRetitling = /重新发一个标题|重新标题|改标题|新标题/.test(String(assistantHint || ""));
    return [
      isRetitling ? "请发送新的标题。" : "请先发送标题。",
      "不想继续的话，发送“/取消”。",
      assistantHint || "",
    ].join("\n");
  }
  if (conversation.step === "await-forward-confirm") {
    return [
      "我收到了疑似合并转发内容。",
      conversation.sourceSummary ? `内容摘要：${conversation.sourceSummary}` : "",
      "如果要投稿，请回复“是”；不想投稿请回复“否”或“/取消”。",
      assistantHint || "",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-ai-post-confirm") {
    return [
      "我先帮你整理了一版草稿：",
      conversation.draftBoardSlug ? `板块：${conversation.draftBoardSlug}` : "",
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
      conversation.draftContent ? `正文预览：${conversation.draftContent.slice(0, 120)}${conversation.draftContent.length > 120 ? "..." : ""}` : "",
      assistantHint || "",
      "如果可以直接发，请回复“是”。",
      "想改标题就回复“改标题”；想继续补正文就直接发内容。",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-submit-confirm") {
    return [
      "投稿确认：",
      conversation.draftBoardSlug ? `板块：${conversation.draftBoardSlug}` : "",
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
      conversation.draftContent ? `正文预览：${conversation.draftContent.slice(0, 160)}${conversation.draftContent.length > 160 ? "..." : ""}` : "",
      assistantHint || "",
      "确认发布请回复“确认发布”或“是”。",
      "想改标题请回复“改标题”；想继续补正文就直接发内容；不想发了就回复“/取消”。",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-forward-title") {
    return [
      "好的，请发送这篇投稿的标题。",
      "正文我会使用刚才的转发内容。",
      "不想继续的话，发送“/取消”。",
      assistantHint || "",
    ].join("\n");
  }
  if (conversation.step === "collect-content") {
    return [
      `标题已记录：${conversation.draftTitle || "未命名"}`,
      "接下来请逐条发送正文内容。",
      "每发一条我会自动换行拼接。",
      "全部完成后发送“/结束”。不想继续的话，发送“/取消”。",
      assistantHint || "",
    ].join("\n");
  }
  return "请继续发送内容。";
}

async function ensureQqPostingAllowed(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
}) {
  if (context.event.message_type === "group" && !context.config.allowGroupPost) {
    throw Errors.badRequest("群内投稿暂未开启，请私聊投稿。");
  }
  if (context.event.message_type !== "group" && !context.config.allowPrivatePost) {
    throw Errors.badRequest("私聊投稿暂未开启。");
  }
}

async function ensureQqBinding(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId },
    include: { user: { select: { id: true } } },
  });
  if (!binding?.enabled) throw Errors.badRequest("还没有绑定站内账号。请先在站内生成绑定码，然后发送：/绑定 绑定码");
  return binding;
}

function mergeConversationContent(existing: string, next: string) {
  return [existing.trim(), next.trim()].filter(Boolean).join("\n");
}

async function parseConversationTitle(text: string, defaultBoardSlug: string, groupId?: string) {
  return parsePostCommand(`/投稿 ${text}`, defaultBoardSlug, groupId);
}

function buildPostCommandFromDraft(boardSlug: string, title: string, content: string, groupId?: string, defaultBoardSlug?: string) {
  const useBoardPrefix = !defaultBoardSlug || boardSlug !== (groupId ? boardSlug : defaultBoardSlug);
  const firstLine = useBoardPrefix ? `${boardSlug} ${title}` : title;
  return `投稿 ${firstLine}\n${content}`;
}

async function parsePostCommand(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim().replace(/^\/?#?投稿\s*/, "");
  const lines = normalized.split(/\r?\n/);
  const firstLine = (lines.shift() || "").trim();
  if (!firstLine) throw Errors.badRequest("投稿格式：投稿 [板块slug] 标题\\n正文");
  const defaultSlug = await resolveDefaultBoardSlug(defaultBoardSlug, groupId);
  const tokens = firstLine.split(/\s+/);
  let boardSlug = defaultSlug;
  let title = firstLine;
  if (tokens.length >= 2) {
    const maybeBoard = await prisma.board.findUnique({ where: { slug: tokens[0] }, select: { slug: true } });
    if (maybeBoard) {
      boardSlug = maybeBoard.slug;
      title = tokens.slice(1).join(" ").trim();
    }
  }
  const content = lines.join("\n").trim() || title;
  if (title.length < 2) throw Errors.badRequest("标题至少 2 个字");
  return { boardSlug, title: title.slice(0, 120), content: content.slice(0, 20000) };
}

async function resolveDefaultBoardSlug(defaultBoardSlug: string, groupId?: string) {
  const group = groupId ? await prisma.qqBotGroup.findUnique({ where: { groupId } }) : null;
  return group?.defaultBoardSlug || defaultBoardSlug || "general";
}

async function createTopicFromQq(input: {
  user: { userId: number; studentId: string; role: string; campus: string };
  boardSlug: string;
  title: string;
  content: string;
  qqId: string;
  groupId?: string;
  messageId?: string;
  rawPayload: unknown;
}) {
  const userId = input.user.userId;
  await ensureForumAccessEnabled(userId, input.user.role);
  await ensureUserCanSpeak(userId);
  await ensureUserCanSubmitTopic(userId);
  const board = await prisma.board.findUnique({ where: { slug: input.boardSlug } });
  if (!board) throw Errors.notFound("板块不存在");
  if (board.readOnly && input.user.role !== "bot" && input.user.role !== "admin") throw Errors.forbidden("该板块为只读公告板，禁止发帖");
  if (board.type !== "announce" && input.user.role !== "admin") {
    const featureKey = featureForBoardType(board.type) ?? "forum";
    if (!isFeatureOn(featureKey)) throw Errors.forbidden("该板块当前不可发帖，已被站方临时关闭");
  }
  const metadata = {
    source: "qqbot",
    qq: {
      qqId: input.qqId,
      groupId: input.groupId || null,
      messageId: input.messageId || null,
    },
  };
  const now = new Date();
  const bypassAiReview = await shouldBypassAiReviewForUser(userId, input.user.role);
  const shouldReview = shouldRunAiReview() && !bypassAiReview && board.type !== "announce";
  const aiResult = shouldReview
    ? await reviewTopicContent({
        title: input.title,
        content: input.content,
        boardName: board.name,
        boardType: board.type,
        metadata,
      })
    : null;
  const hiddenByAi = aiResult?.status === "blocked_ai";
  const topic = await prisma.$transaction(async (tx) => {
    const created = await tx.topic.create({
      data: {
        boardId: board.id,
        authorId: userId,
        title: input.title,
        content: input.content,
        metadata: JSON.stringify(metadata),
        aiReviewStatus: aiResult?.status ?? "auto_passed",
        aiRiskLevel: aiResult?.riskLevel ?? "low",
        aiRiskScore: aiResult?.riskScore ?? 0,
        aiReviewReason: aiResult?.reason ?? "",
        aiReviewDetail: aiResult?.detail ?? "",
        aiModel: aiResult?.model ?? null,
        aiReviewedAt: aiResult ? now : null,
        hidden: hiddenByAi,
        lastReplyAt: now,
        lastReplyById: userId,
      },
    });
    if (!hiddenByAi) {
      await tx.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
      await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
    }
    return created;
  });
  const aiTags = await generateTopicAiTags({
    title: input.title,
    content: input.content,
    boardName: board.name,
    boardType: board.type,
    metadata,
  }).catch(() => [] as string[]);
  await syncTopicAiTags(topic.id, aiTags);
  if (hiddenByAi && aiResult) {
    await notifyTopicAiBlocked({
      topicId: topic.id,
      userId,
      title: input.title,
      reason: aiResult.reason,
      riskScore: aiResult.riskScore,
    });
  }
  if (hiddenByAi) await refreshUserPostCount(userId).catch(() => {});
  await refreshBoardTopicCounts([board.id]).catch(() => {});
  return { ...topic, board };
}

export async function sendQqMessage(target: { qqId?: string; groupId?: string }, message: string) {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !config.napcatBaseUrl) throw Errors.badRequest("QQBot 未启用或 NapCat 地址未配置");
  const endpoint = target.groupId ? "send_group_msg" : "send_private_msg";
  const body = target.groupId
    ? { group_id: Number(target.groupId), message }
    : { user_id: Number(target.qqId), message };
  if (isWebSocketUrl(config.napcatBaseUrl)) {
    try {
      await sendQqMessageByWebSocket(endpoint, body, target, message);
    } catch (error: any) {
      await logQqBotMessage({
        direction: "outbound",
        eventType: target.groupId ? "group-message" : "private-message",
        status: "error",
        qqId: target.qqId,
        groupId: target.groupId,
        content: message.slice(0, 1000),
        result: String(error?.message || error || "NapCat WebSocket 发送失败").slice(0, 500),
      });
      throw error;
    }
    return;
  }
  const response = await fetch(`${config.napcatBaseUrl.replace(/\/+$/, "")}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  await logQqBotMessage({
    direction: "outbound",
    eventType: target.groupId ? "group-message" : "private-message",
    status: response.ok ? "ok" : "error",
    qqId: target.qqId,
    groupId: target.groupId,
    content: message.slice(0, 1000),
    result: text.slice(0, 500),
  });
  if (!response.ok) throw Errors.server(`NapCat 发送失败：${response.status} ${text.slice(0, 120)}`);
}

async function replyToEvent(context: { event: OneBotEvent; qqId: string; groupId?: string }, message: string) {
  if (context.event.message_type === "group" && context.groupId) {
    await sendQqMessage({ groupId: context.groupId }, message);
  } else {
    await sendQqMessage({ qqId: context.qqId }, message);
  }
}

export function startQqNotificationPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => dispatchRecentQqNotifications().catch((error) => {
    console.warn("[qqbot] notification dispatch failed", error);
  });
  connectQqBotWebSocket().catch((error) => {
    console.warn("[qqbot] websocket connect failed", error);
  });
  setTimeout(tick, 5000);
  setInterval(tick, 30_000);
  setInterval(() => connectQqBotWebSocket().catch(() => undefined), 30_000);
}

export async function dispatchRecentQqNotifications() {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !config.notificationEnabled || !config.napcatBaseUrl) return { sent: 0 };
  const categories = parseStringArray(config.notifyCategories, DEFAULT_NOTIFY_CATEGORIES);
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const notifications = await prisma.notification.findMany({
    where: {
      createdAt: { gte: since },
      category: { in: categories },
      OR: [
        { userId: { not: null }, readAt: null },
        { userId: null },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let sent = 0;
  for (const item of notifications) {
    if (item.userId) {
      const existed = await prisma.qqBotMessageLog.findFirst({
        where: { eventType: "notification", notificationId: item.id, userId: item.userId, status: "ok" },
        select: { id: true },
      });
      if (existed) continue;
      const binding = await prisma.qqBotBinding.findFirst({ where: { userId: item.userId, enabled: true } });
      if (!binding) continue;
      await sendNotificationMessage({ qqId: binding.qqId }, item, item.userId);
      sent += 1;
    } else {
      const groups = await prisma.qqBotGroup.findMany({ where: { enabled: true, notificationEnabled: true } });
      for (const group of groups) {
        const existed = await prisma.qqBotMessageLog.findFirst({
          where: { eventType: "notification", notificationId: item.id, groupId: group.groupId, status: "ok" },
          select: { id: true },
        });
        if (existed) continue;
        await sendNotificationMessage({ groupId: group.groupId }, item, null);
        sent += 1;
      }
    }
  }
  return { sent };
}

async function sendNotificationMessage(target: { qqId?: string; groupId?: string }, notification: any, userId: number | null) {
  const message = [
    `【${notification.source || "药大拾间"}】${notification.title}`,
    notification.content,
    notification.link ? `链接：${notification.link}` : "",
  ].filter(Boolean).join("\n");
  try {
    await sendQqMessage(target, message);
    await logQqBotMessage({
      direction: "outbound",
      eventType: "notification",
      status: "ok",
      qqId: target.qqId,
      groupId: target.groupId,
      userId,
      notificationId: notification.id,
      content: message.slice(0, 1000),
      result: "sent",
    });
  } catch (error: any) {
    await logQqBotMessage({
      direction: "outbound",
      eventType: "notification",
      status: "error",
      qqId: target.qqId,
      groupId: target.groupId,
      userId,
      notificationId: notification.id,
      content: message.slice(0, 1000),
      result: error?.message || "发送失败",
    });
  }
}

export async function logQqBotMessage(input: {
  direction: string;
  eventType: string;
  status?: string;
  qqId?: string;
  groupId?: string;
  messageId?: string;
  userId?: number | null;
  topicId?: number | null;
  notificationId?: number | null;
  command?: string;
  content?: string;
  result?: string;
  rawPayload?: unknown;
}) {
  return prisma.qqBotMessageLog.create({
    data: {
      direction: input.direction,
      eventType: input.eventType,
      status: input.status ?? "ok",
      qqId: input.qqId || null,
      groupId: input.groupId || null,
      messageId: input.messageId || null,
      userId: input.userId ?? null,
      topicId: input.topicId ?? null,
      notificationId: input.notificationId ?? null,
      command: input.command || null,
      content: input.content || "",
      result: input.result || "",
      rawPayload: input.rawPayload === undefined ? "{}" : JSON.stringify(input.rawPayload).slice(0, 8000),
    },
  }).catch(() => null);
}

function extractMessageText(message: unknown): string {
  if (typeof message === "string") return cleanCqMessage(message);
  if (!Array.isArray(message)) return "";
  return message.map((seg: any) => {
    if (seg?.type === "text") return String(seg.data?.text || "");
    if (seg?.type === "image") {
      const url = seg.data?.url || seg.data?.file || "";
      return url ? `\n![QQ图片](${url})\n` : "\n[图片]\n";
    }
    if (seg?.type === "forward") return "\n[合并转发]\n";
    if (seg?.type === "video") return "\n[视频]\n";
    if (seg?.type === "record") return "\n[语音]\n";
    return "";
  }).join("").trim();
}

async function extractForwardPayload(message: unknown): Promise<(ParsedForwardPayload & { source: ForwardSource }) | null> {
  if (!Array.isArray(message)) return null;
  const forwardSeg = message.find((seg: any) => seg?.type === "forward" && seg?.data?.id);
  const forwardId = String(forwardSeg?.data?.id || "").trim();
  if (forwardId) {
    const payload = await callQqBotAction("get_forward_msg", { id: forwardId }).catch(() => null);
    const parsed = parseForwardMessages(payload?.data?.messages, forwardId);
    if (parsed) return { ...parsed, source: "direct" };
  }
  const replyId = extractReplyMessageId(message);
  if (!replyId) return null;
  const replied = await callQqBotAction("get_msg", { message_id: Number(replyId) || replyId }).catch(() => null);
  const replyMessage = replied?.data?.message;
  const replyForwardSeg = Array.isArray(replyMessage)
    ? replyMessage.find((seg: any) => seg?.type === "forward" && seg?.data?.id)
    : null;
  const replyForwardId = String(replyForwardSeg?.data?.id || "").trim();
  if (!replyForwardId) return null;
  const payload = await callQqBotAction("get_forward_msg", { id: replyForwardId }).catch(() => null);
  const parsed = parseForwardMessages(payload?.data?.messages, replyForwardId);
  if (!parsed) return null;
  return { ...parsed, source: "reply" };
}

function parseForwardMessages(messages: unknown, forwardId: string): ParsedForwardPayload | null {
  const list = Array.isArray(messages) ? messages : [];
  const lines = list.map((item: any) => {
    const nickname = String(item?.sender?.nickname || item?.sender?.user_id || "QQ用户");
    const text = extractMessageText(item?.content || item?.message || "").trim();
    return text ? `${nickname}：${text}` : "";
  }).filter(Boolean);
  if (!lines.length) return null;
  return {
    summary: lines.slice(0, 3).join(" / ").slice(0, 120),
    content: lines.join("\n"),
    sourceMessageId: forwardId,
  };
}

function extractReplyMessageId(message: unknown) {
  if (!Array.isArray(message)) return "";
  const replySeg = message.find((seg: any) => seg?.type === "reply" && seg?.data?.id);
  return String(replySeg?.data?.id || "").trim();
}

function cleanCqMessage(value: string) {
  return value
    .replace(/\[CQ:image,[^\]]*url=([^,\]]+)[^\]]*\]/g, "\n![QQ图片]($1)\n")
    .replace(/\[CQ:image[^\]]*\]/g, "\n[图片]\n")
    .replace(/\[CQ:at,[^\]]+\]/g, "")
    .replace(/\[CQ:[^\]]+\]/g, "")
    .trim();
}

function appendSourceFooter(content: string, context: { groupId?: string; event: OneBotEvent }) {
  const source = context.groupId ? `QQ群 ${context.groupId}` : "QQ 私聊";
  return `${content}\n\n> 由 QQBot 从${source}搬运投稿。`;
}

function isHelpCommand(text: string) {
  return /^[/／](帮助|help|菜单)$/i.test(text.trim());
}

function isBoardListCommand(text: string) {
  return /^[/／](板块|板块列表|boards?)$/i.test(text.trim());
}

function isMyPostsCommand(text: string) {
  return /^[/／](我的投稿|我的帖子|recent|mine)$/i.test(text.trim());
}

function isUnbindCommand(text: string) {
  return /^[/／](解绑|解除绑定|unbind)$/i.test(text.trim());
}

function isCommandMessage(text: string) {
  const normalized = text.trim();
  return normalized.startsWith("/") || normalized.startsWith("／");
}

function isPrivatePlainCommand(text: string, keyword: string) {
  const normalized = text.trim();
  return !isCommandMessage(normalized) && normalized === keyword;
}

function normalizePrivatePlainCommand(text: string, keyword: string) {
  const normalized = text.trim();
  if (normalized === keyword) return `/${keyword}`;
  return normalized;
}

function isConfirmPublishMessage(text: string) {
  return /^(是|确认|确认发布|发布|发吧|就这样|没问题)$/i.test(text.trim()) || /^[/／](发布|确认发布)(?:\s|$)/i.test(text.trim());
}

function isCancelMessage(text: string) {
  const normalized = text.trim();
  return /^[/／]取消(?:\s|$)/.test(normalized)
    || /^(取消|算了|不发了|我不发了|先不发了|不要发了|不投了|我不投了|先不投了|不了|不用了)$/i.test(normalized);
}

function isGreetingMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(你好|您好|哈喽|hello|hi|嗨|在吗|有人吗|bot|qqbot)[!！。?？ ]*$/.test(normalized);
}

function renderHelp(defaultBoardSlug: string) {
  return [
    "药大拾间 QQBot：",
    "绑定 绑定码 - 绑定站内账号",
    "状态 - 查看绑定状态和投稿开关",
    "板块 - 查看可投稿板块",
    "我的投稿 - 查看最近投稿记录",
    "解绑 - 解除当前 QQ 绑定",
    "投稿 - 开始分步投稿",
    "结束 - 提交当前投稿",
    "取消 - 取消当前投稿",
    "",
    "也可以直接说“我想投稿”或发送一段想发的内容，我会尽量按对话帮你整理。",
    "",
    `默认投稿区：${defaultBoardSlug}`,
  ].join("\n");
}

function renderGreetingReply(defaultBoardSlug: string) {
  return [
    "我在。",
    "如果你想投稿，可以直接说“我想投稿”，或者发送“/投稿”开始分步投稿。",
    `默认投稿区是 ${defaultBoardSlug}。`,
    "常用命令：帮助 / 状态 / 板块 / 我的投稿",
  ].join("\n");
}

function renderPrivateFallbackReply() {
  return [
    "我收到啦。",
    "你可以直接告诉我你想做什么，比如：投稿、查状态、看板块、看最近投稿。",
    "常用命令：帮助 / 状态 / 板块 / 我的投稿 / 投稿",
  ].join("\n");
}

function shouldAssistantAutoReply(context: {
  event: OneBotEvent;
  messageText: string;
}) {
  if (context.event.message_type !== "group") return true;
  const text = context.messageText.trim();
  if (!text) return false;
  if (/^[/／].+/.test(text)) return true;
  return isExplicitBotMention(context.event, context.messageText);
}

function cooldownKey(qqId: string, groupId?: string) {
  return `${qqId}::${groupId || "private"}`;
}

function markConversationCancelled(qqId: string, groupId?: string) {
  qqBotCooldowns.set(cooldownKey(qqId, groupId), { cancelledAt: Date.now() });
}

function isRecentlyCancelled(qqId: string, groupId?: string) {
  const state = qqBotCooldowns.get(cooldownKey(qqId, groupId));
  if (!state?.cancelledAt) return false;
  return Date.now() - state.cancelledAt < 2 * 60 * 1000;
}

function isExplicitBotMention(event: OneBotEvent, text: string) {
  const raw = text.trim();
  if (!raw) return false;
  if (/(qqbot|药大拾间bot|助手|bot)\b/i.test(raw)) return true;
  if (/(帮我投稿|我要投稿|我想投稿|投稿到|发树洞|发帖|帮我发|板块|状态|帮助)/i.test(raw)) return true;
  return isMessageAtBot(event.message, event.self_id);
}

function isExplicitPostTrigger(event: OneBotEvent, text: string) {
  const raw = text.trim();
  if (!raw) return false;
  if (/^[/／]投稿\b/.test(raw)) return true;
  if (/(帮我投稿|我要投稿|我想投稿|投稿到|发树洞|发帖|帮我发)/i.test(raw)) return true;
  return event.message_type === "group" ? isExplicitBotMention(event, text) : false;
}

function isMessageAtBot(message: unknown, selfId?: number | string) {
  if (!Array.isArray(message) || !selfId) return false;
  const target = String(selfId);
  return message.some((seg: any) => seg?.type === "at" && String(seg?.data?.qq || "") === target);
}

function shouldHandleForwardPostInContext(context: {
  event: OneBotEvent;
  messageText: string;
  forwardPayload?: (ParsedForwardPayload & { source: ForwardSource }) | null;
}) {
  if (!context.forwardPayload) return false;
  if (context.event.message_type !== "group") return true;
  return context.forwardPayload.source === "reply" && isExplicitBotMention(context.event, context.messageText);
}

async function renderBindingStatus(
  qqId: string,
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
  groupId?: string,
) {
  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId },
    include: { user: { select: { nickname: true, username: true } } },
  });
  const group = groupId ? await prisma.qqBotGroup.findUnique({ where: { groupId } }) : null;
  const defaultBoardSlug = group?.defaultBoardSlug || config.defaultBoardSlug || "general";
  if (!binding?.enabled) {
    return [
      "当前 QQ 尚未绑定站内账号。",
      "请先在站内生成绑定码，然后私聊我发送：绑定 绑定码",
      `默认投稿区：${defaultBoardSlug}`,
      `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
      `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
    ].join("\n");
  }
  return [
    `已绑定：${binding.user.nickname}（${binding.user.username}）`,
    `默认投稿区：${defaultBoardSlug}`,
    `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
    `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
    "命令：板块 / 我的投稿 / 解绑",
  ].join("\n");
}

async function renderBoardList(defaultBoardSlug: string, groupId?: string) {
  const group = groupId ? await prisma.qqBotGroup.findUnique({ where: { groupId } }) : null;
  const currentDefaultSlug = group?.defaultBoardSlug || defaultBoardSlug || "general";
  const boards = await prisma.board.findMany({
    where: {
      readOnly: false,
      type: { in: ["normal", "question", "market", "coursereview"] },
    },
    orderBy: { order: "asc" },
    select: {
      slug: true,
      name: true,
      description: true,
      type: true,
    },
  });
  const availableBoards = boards.filter((board) => isBoardTypeEnabled(board.type));
  if (!availableBoards.length) {
    return "当前没有可投稿板块，请稍后再试。";
  }
  const lines = [
    "可投稿板块：",
    ...availableBoards.slice(0, 12).map((board) => {
      const suffix = board.slug === currentDefaultSlug ? "（默认投稿区）" : "";
      const desc = board.description ? ` - ${board.description}` : "";
      return `${board.name}${suffix}${desc}`;
    }),
  ];
  const closedHints = boards
    .filter((board) => !isBoardTypeEnabled(board.type))
    .map((board) => `${board.name}：${featureClosedMessage(board.type)}`);
  if (closedHints.length) {
    lines.push("", "当前暂不可投：");
    lines.push(...closedHints.slice(0, 4));
  }
  lines.push("", "示例：");
  lines.push("直接说“我想投稿”，或者发送“投稿 标题”");
  lines.push("正文");
  lines.push("如果想指定投稿区，可以先发“板块”看看名称，再告诉我你想发到哪里。");
  return lines.join("\n");
}

function buildTopicLink(topicId: number) {
  const origin = getSiteOrigin();
  if (!origin) return "";
  return `${origin}/forum/topic/${topicId}`;
}

async function renderRecentQqTopics(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId },
    include: {
      user: { select: { id: true } },
    },
  });
  if (!binding?.enabled) {
    return "当前 QQ 尚未绑定站内账号，暂时无法查看投稿记录。";
  }
  const topics = await prisma.topic.findMany({
    where: {
      authorId: binding.user.id,
      metadata: { contains: `"qqId":"${qqId}"` },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      board: { select: { name: true } },
    },
  });
  if (!topics.length) return "最近还没有通过 QQ 投稿的帖子。";
  return [
    "最近投稿：",
    ...topics.map((topic) => {
      const topicLink = buildTopicLink(topic.id) || `/forum/topic/${topic.id}`;
      const status = topic.hidden ? "待审核" : "已发布";
      return `- ${topic.title}｜${topic.board.name}｜${status}\n  ${topicLink}`;
    }),
  ].join("\n");
}

async function logHandledInboundMessage(
  context: {
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
  eventType: string,
  result: string,
) {
  await logQqBotMessage({
    direction: "inbound",
    eventType,
    status: "ok",
    qqId: context.qqId,
    groupId: context.groupId,
    messageId: context.event.message_id ? String(context.event.message_id) : undefined,
    content: context.messageText.slice(0, 500),
    result,
    rawPayload: context.event,
  });
}

async function inferQqBotIntent(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
  messageText: string;
}) {
  const content = await requestAiJson([
    {
      role: "system",
      content: [
        "你是校园论坛 QQBot 的意图识别助手。",
        "你只能输出 JSON。",
        "请判断用户这句话更像是在：求帮助、查状态、查板块、查最近投稿、开始投稿、普通闲聊，或者需要你直接回复一句简短提示。",
        "如果用户明显表达了想发帖/投稿/搬运内容，也可以抽取标题、正文、板块 slug。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        '输出格式：{"intent":"chat|help|status|boards|recent-posts|start-post|reply","title":"","content":"","boardSlug":"","message":""}',
        `默认投稿板块：${context.config.defaultBoardSlug}`,
        `用户消息：${context.messageText}`,
      ].join("\n"),
    },
  ]);
  const parsed = parseAiIntentJson(content);
  const intent = String(parsed.intent || "chat").trim();
  if (intent === "help" || intent === "status" || intent === "boards" || intent === "recent-posts" || intent === "chat") {
    return { intent } as QqBotAiIntent;
  }
  if (intent === "reply") {
    return { intent: "reply", message: String(parsed.message || "如果你想投稿，可以直接说“我想投稿”，我会一步步带你发。").slice(0, 300) } as QqBotAiIntent;
  }
  if (intent === "start-post") {
    return {
      intent: "start-post",
      title: String(parsed.title || "").trim().slice(0, 120),
      content: String(parsed.content || "").trim().slice(0, 20000),
      boardSlug: String(parsed.boardSlug || "").trim().slice(0, 80) || undefined,
    } as QqBotAiIntent;
  }
  return { intent: "chat" } as QqBotAiIntent;
}

function parseAiIntentJson(content: string) {
  if (!content || typeof content !== "string") return { intent: "chat" };
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return { intent: "chat" };
      }
    }
    return { intent: "chat" };
  }
}

async function generateAssistantReply(
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
  fallbackMessage: string,
): Promise<QqBotAssistantReply> {
  const boardList = await prisma.board.findMany({
    where: {
      readOnly: false,
      type: { in: ["normal", "question", "market", "coursereview"] },
    },
    orderBy: { order: "asc" },
    select: { slug: true, name: true, description: true, type: true },
    take: 12,
  });
  const content = await requestAiJson([
    {
      role: "system",
      content: [
        "你是校园论坛 QQBot 助手。",
        "请根据用户消息给出一段简短自然的回复。",
        "如果用户像是在投稿、求助发帖、发树洞、发二手或课程评价，请尽量同时整理出建议板块 slug、建议标题、建议正文。",
        "只返回 JSON。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        '输出格式：{"reply":"","suggestedBoardSlug":"","suggestedTitle":"","suggestedContent":"","confidence":"low|medium|high"}',
        `默认板块：${context.config.defaultBoardSlug}`,
        `可选板块：${boardList.map((board) => `${board.slug}:${board.name}`).join("；")}`,
        `用户消息：${context.messageText}`,
        `兜底提示：${fallbackMessage}`,
      ].join("\n"),
    },
  ]);
  return parseAssistantReplyJson(content, fallbackMessage);
}

async function polishConversationDraft(
  conversation: any,
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
) {
  const content = await requestAiJson([
    {
      role: "system",
      content: [
        "你是校园论坛 QQBot 的投稿润色助手。",
        "请在不改变原意的前提下，帮用户把标题和正文整理得更清晰自然。",
        "只返回 JSON。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        '输出格式：{"reply":"","suggestedTitle":"","suggestedContent":""}',
        `当前标题：${conversation.draftTitle || ""}`,
        `当前正文：${conversation.draftContent || ""}`,
        `用户要求：${context.messageText}`,
      ].join("\n"),
    },
  ]);
  const parsed = parseAssistantReplyJson(content, "我已经帮你稍微整理了一下草稿。");
  const next = await prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: {
      draftTitle: parsed.suggestedTitle || conversation.draftTitle,
      draftContent: parsed.suggestedContent || conversation.draftContent,
      step: "await-submit-confirm",
    },
  });
  return renderConversationPrompt(next, parsed.reply);
}

function parseAssistantReplyJson(content: string, fallbackMessage: string): QqBotAssistantReply {
  if (!content || typeof content !== "string") return { reply: fallbackMessage };
  try {
    const parsed = JSON.parse(content);
    return {
      reply: String(parsed.reply || fallbackMessage).slice(0, 500),
      suggestedBoardSlug: String(parsed.suggestedBoardSlug || "").trim() || undefined,
      suggestedTitle: String(parsed.suggestedTitle || "").trim().slice(0, 120) || undefined,
      suggestedContent: String(parsed.suggestedContent || "").trim().slice(0, 20000) || undefined,
      confidence: normalizeAssistantConfidence(parsed.confidence),
    };
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          reply: String(parsed.reply || fallbackMessage).slice(0, 500),
          suggestedBoardSlug: String(parsed.suggestedBoardSlug || "").trim() || undefined,
          suggestedTitle: String(parsed.suggestedTitle || "").trim().slice(0, 120) || undefined,
          suggestedContent: String(parsed.suggestedContent || "").trim().slice(0, 20000) || undefined,
          confidence: normalizeAssistantConfidence(parsed.confidence),
        };
      } catch {
        return { reply: fallbackMessage };
      }
    }
    return { reply: fallbackMessage };
  }
}

function normalizeAssistantConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

function parseStringArray(value: string, fallback: string[]) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [...fallback];
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^(https?|wss?):\/\//i.test(trimmed)) throw Errors.badRequest("NapCat 地址必须以 ws://、wss://、http:// 或 https:// 开头");
  return trimmed.replace(/\/+$/, "");
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function isWebSocketUrl(value: string) {
  return /^wss?:\/\//i.test(value.trim());
}

function buildWebSocketUrl(config: Awaited<ReturnType<typeof getQqBotConfigRaw>>) {
  let url = config.napcatBaseUrl.trim();
  if (!config.accessToken || /[?&]access_token=/.test(url)) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}access_token=${encodeURIComponent(config.accessToken)}`;
}

function getQqBotConnectionStatus(config: Awaited<ReturnType<typeof getQqBotConfigRaw>>): QqBotConfigView["connectionStatus"] {
  if (!config.enabled) return "disabled";
  if (!isWebSocketUrl(config.napcatBaseUrl)) return "http";
  if (wsClient?.readyState === 1) return "connected";
  if (wsConnecting || wsClient?.readyState === 0) return "connecting";
  if (wsLastError) return "error";
  return "idle";
}

function getQqBotConnectionError(config: Awaited<ReturnType<typeof getQqBotConfigRaw>>) {
  if (!config.enabled || !isWebSocketUrl(config.napcatBaseUrl)) return "";
  return wsLastError;
}

function describeWebSocketError(error: unknown) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  const maybeError = error as { message?: string; error?: unknown; cause?: unknown };
  if (typeof maybeError.message === "string" && maybeError.message.trim()) return maybeError.message.trim();
  if (maybeError.error) return describeWebSocketError(maybeError.error);
  if (maybeError.cause) return describeWebSocketError(maybeError.cause);
  return String(error);
}

function setWebSocketError(message: string) {
  wsLastError = message;
}

function rejectPendingWebSocketActions(reason: string) {
  for (const [echo, pending] of wsPendingActions.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    wsPendingActions.delete(echo);
  }
}

export async function connectQqBotWebSocket() {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !isWebSocketUrl(config.napcatBaseUrl)) return;
  if (wsClient && (wsClient.readyState === 0 || wsClient.readyState === 1)) return;
  if (wsConnecting) return;
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (!WebSocketCtor) {
    setWebSocketError("当前 Node.js 运行环境不支持全局 WebSocket");
    console.warn("[qqbot] current Node.js runtime has no global WebSocket");
    return;
  }
  wsConnecting = true;
  try {
    const socket = new WebSocketCtor(buildWebSocketUrl(config), {
      headers: config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : undefined,
    });
    wsClient = socket;
    socket.addEventListener("open", () => {
      wsConnecting = false;
      wsLastError = "";
      logQqBotMessage({ direction: "outbound", eventType: "websocket", status: "ok", result: "connected" });
    });
    socket.addEventListener("message", (event: any) => {
      const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      handleWebSocketPayload(text).catch((error) => {
        console.warn("[qqbot] websocket message failed", error);
      });
    });
    socket.addEventListener("close", (event: any) => {
      wsConnecting = false;
      if (wsClient === socket) wsClient = null;
      const message = event?.code === 1000
        ? "连接已关闭"
        : `连接已关闭（code ${event?.code ?? "unknown"}${event?.reason ? `, ${String(event.reason)}` : ""}）`;
      if (event?.code === 1000) wsLastError = "";
      else if (!wsLastError) setWebSocketError(message);
      rejectPendingWebSocketActions(message);
      scheduleWebSocketReconnect();
    });
    socket.addEventListener("error", (event: any) => {
      wsConnecting = false;
      if (wsClient === socket) wsClient = null;
      const message = `WebSocket 握手失败：${describeWebSocketError(event)}`;
      setWebSocketError(message);
      rejectPendingWebSocketActions(message);
      scheduleWebSocketReconnect();
    });
  } catch (error) {
    wsConnecting = false;
    setWebSocketError(`创建 WebSocket 失败：${describeWebSocketError(error)}`);
    rejectPendingWebSocketActions(wsLastError);
    scheduleWebSocketReconnect();
    throw error;
  }
}

function resetQqBotWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsClient) {
    try { wsClient.close(); } catch { /* ignore */ }
    wsClient = null;
  }
  wsConnecting = false;
  wsLastError = "";
  rejectPendingWebSocketActions("QQBot WebSocket 已重置");
}

function scheduleWebSocketReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectQqBotWebSocket().catch(() => undefined);
  }, 5000);
}

async function handleWebSocketPayload(text: string) {
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    await logQqBotMessage({ direction: "inbound", eventType: "websocket", status: "error", result: "JSON 解析失败", content: text.slice(0, 1000) });
    return;
  }
  if (payload?.echo) {
    const pending = wsPendingActions.get(String(payload.echo));
    if (pending) {
      clearTimeout(pending.timer);
      wsPendingActions.delete(String(payload.echo));
      if (payload.status === "ok") pending.resolve(payload);
      else pending.reject(new Error(String(payload?.wording || payload?.msg || payload?.message || "NapCat 动作失败")));
    }
    await logQqBotMessage({
      direction: "inbound",
      eventType: "websocket-response",
      status: payload.status === "ok" ? "ok" : "error",
      result: JSON.stringify(payload).slice(0, 1000),
      rawPayload: payload,
    });
    return;
  }
  await handleQqBotWebhook(payload, (await getQqBotConfigRaw()).webhookSecret);
}

async function callQqBotAction(action: string, params: Record<string, unknown>) {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !config.napcatBaseUrl) throw Errors.badRequest("QQBot 未启用或 NapCat 地址未配置");
  if (!isWebSocketUrl(config.napcatBaseUrl)) {
    const response = await fetch(`${config.napcatBaseUrl.replace(/\/+$/, "")}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
      },
      body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Errors.server(`NapCat 动作失败：${response.status}`);
    return data;
  }
  await connectQqBotWebSocket();
  await waitWebSocketOpen();
  const echo = `cpu-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      wsPendingActions.delete(echo);
      reject(Errors.badRequest(`NapCat 动作超时：${action}`));
    }, 8000);
    wsPendingActions.set(echo, { resolve, reject, timer });
    wsClient.send(JSON.stringify({ action, params, echo }));
  });
  return result;
}

async function sendQqMessageByWebSocket(
  action: "send_private_msg" | "send_group_msg",
  params: Record<string, unknown>,
  target: { qqId?: string; groupId?: string },
  message: string,
) {
  await connectQqBotWebSocket();
  await waitWebSocketOpen();
  const echo = `cpu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  wsClient.send(JSON.stringify({ action, params, echo }));
  await logQqBotMessage({
    direction: "outbound",
    eventType: target.groupId ? "group-message" : "private-message",
    status: "ok",
    qqId: target.qqId,
    groupId: target.groupId,
    content: message.slice(0, 1000),
    result: `queued:${echo}`,
  });
}

function waitWebSocketOpen() {
  if (wsClient?.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (wsClient?.readyState === 1) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 3000) {
        clearInterval(timer);
        const reason = wsLastError ? `：${wsLastError}` : "";
        reject(Errors.badRequest(`NapCat WebSocket 尚未连接${reason}`));
      }
    }, 100);
  });
}
