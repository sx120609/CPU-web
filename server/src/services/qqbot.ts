import crypto from "node:crypto";
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { ensureForumAccessEnabled } from "./forumAccess";
import { ensureForumImageAssetsForContent } from "./imageModeration";
import { saveMediaAsset } from "./mediaStorage";
import { getSiteOrigin, isBoardTypeEnabled, isFeatureOn, featureForBoardType, featureClosedMessage } from "./siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import { ensureUserCanSpeak } from "./userModeration";
import { ensureForumVideoAssetsForContent } from "./videoModeration";
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

export type QqBotGroupNotifyCategory = "system" | "school-feed";
export type QqBotGroupNotifyAudience = "public" | "staff";

export type QqBotGroupView = {
  id: number;
  groupId: string;
  name: string | null;
  enabled: boolean;
  allowPosting: boolean;
  defaultBoardSlug: string | null;
  notificationEnabled: boolean;
  notifyCategories: QqBotGroupNotifyCategory[];
  notifyAudiences: QqBotGroupNotifyAudience[];
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
  request_type?: "friend" | "group";
  notice_type?: string;
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  message_id?: number | string;
  flag?: string;
  comment?: string;
  request_id?: number | string;
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
  messageCount: number;
  blockCount: number;
  participantCount: number;
  imageCount: number;
};
type ParsedForwardEntry = {
  nickname: string;
  text: string;
  messageCount: number;
  imageCount: number;
};
type ParsedShareCard = {
  source?: string;
  title?: string;
  summary?: string;
  url?: string;
};

type ForwardSource = "direct-forward" | "reply-forward" | "reply-message";
type QqMessageExtractOptions = {
  forwardDepth?: number;
  imageMode?: "upload" | "placeholder";
  videoMode?: "upload" | "placeholder";
  forwardMode?: "expand" | "placeholder";
};

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
const GROUP_NOTIFY_CATEGORY_OPTIONS = ["system", "school-feed"] as const;
const GROUP_NOTIFY_AUDIENCE_OPTIONS = ["public", "staff"] as const;
const DEFAULT_GROUP_NOTIFY_CATEGORIES = ["system", "school-feed"];
const DEFAULT_GROUP_NOTIFY_AUDIENCES = ["public"];
const STAFF_GROUP_ACTIONABLE_NOTIFICATION_TYPES = new Set([
  "topic-manual-review-admin",
  "reply-manual-review-admin",
]);
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

function readConfigBotQqId(config: any) {
  return String(config?.botQqId || "").trim();
}

export function formatQqBotConfig(config: Awaited<ReturnType<typeof getQqBotConfigRaw>>): QqBotConfigView {
  return {
    id: config.id,
    enabled: config.enabled,
    botQqId: readConfigBotQqId(config),
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

export function normalizeQqBotGroupNotifyCategories(input?: string[] | null): QqBotGroupNotifyCategory[] {
  const normalized = normalizeAllowedStringArray(
    input,
    DEFAULT_GROUP_NOTIFY_CATEGORIES,
    GROUP_NOTIFY_CATEGORY_OPTIONS,
  );
  return normalized as QqBotGroupNotifyCategory[];
}

export function normalizeQqBotGroupNotifyAudiences(input?: string[] | null): QqBotGroupNotifyAudience[] {
  const normalized = normalizeAllowedStringArray(
    input,
    DEFAULT_GROUP_NOTIFY_AUDIENCES,
    GROUP_NOTIFY_AUDIENCE_OPTIONS,
  );
  return normalized as QqBotGroupNotifyAudience[];
}

export function formatQqBotGroup(group: {
  id: number;
  groupId: string;
  name: string | null;
  enabled: boolean;
  allowPosting: boolean;
  defaultBoardSlug: string | null;
  notificationEnabled: boolean;
  notifyCategories?: string | null;
  notifyAudiences?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): QqBotGroupView {
  return {
    id: group.id,
    groupId: group.groupId,
    name: group.name,
    enabled: group.enabled,
    allowPosting: group.allowPosting,
    defaultBoardSlug: group.defaultBoardSlug,
    notificationEnabled: group.notificationEnabled,
    notifyCategories: normalizeQqBotGroupNotifyCategories(parseStringArray(group.notifyCategories || "", DEFAULT_GROUP_NOTIFY_CATEGORIES)),
    notifyAudiences: normalizeQqBotGroupNotifyAudiences(parseStringArray(group.notifyAudiences || "", DEFAULT_GROUP_NOTIFY_AUDIENCES)),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
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
    botQqId: readConfigBotQqId(config),
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
  if (event.post_type === "request") {
    return handleQqBotRequestEvent(event, config);
  }
  if (event.post_type === "notice") {
    return handleQqBotNoticeEvent(event, config);
  }
  if (event.post_type !== "message") {
    await logQqBotMessage({ direction: "inbound", eventType: event.post_type || "event", status: "ignored", rawPayload: event });
    return { ignored: true };
  }

  const qqId = event.user_id ? String(event.user_id) : "";
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const messageExtractOptions = shouldUseLightForwardExtraction(event.message)
    ? ({ forwardMode: "placeholder", imageMode: "placeholder", videoMode: "placeholder" } satisfies QqMessageExtractOptions)
    : {};
  const messageText = await extractMessageText(event.message ?? event.raw_message ?? "", messageExtractOptions);
  const context = { config, event, qqId, groupId, messageText, forwardPayload: null as (ParsedForwardPayload & { source: ForwardSource }) | null };
  if (!qqId) {
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
    await replyToEvent(context, await renderHelp(config.defaultBoardSlug));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "板块")) && isBoardListCommand(normalizePrivatePlainCommand(messageText, "板块"))) {
    await logHandledInboundMessage(context, "message", "assistant:boards");
    await replyToEvent(context, await renderBoardList(config.defaultBoardSlug, groupId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "我的投稿")) && isMyPostsCommand(normalizePrivatePlainCommand(messageText, "我的投稿"))) {
    if (event.message_type === "group") {
      await replyToEvent(context, "这个功能只支持私聊使用。请私聊我后发送“我的投稿”。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:recent-posts");
    await replyToEvent(context, await renderRecentQqTopics(qqId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) && /^[/／]状态(?:\s|$)/.test(messageText.trim())) || isPrivatePlainCommand(messageText, "状态")) {
    if (event.message_type === "group") {
      await replyToEvent(context, "这个功能只支持私聊使用。请私聊我后发送“状态”。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:status");
    await replyToEvent(context, await renderBindingStatus(qqId, config, groupId));
    return { ok: true };
  }
  if ((isCommandMessage(messageText) || isPrivatePlainCommand(messageText, "解绑")) && isUnbindCommand(normalizePrivatePlainCommand(messageText, "解绑"))) {
    if (event.message_type === "group") {
      await replyToEvent(context, "这个功能只支持私聊使用。请私聊我后发送“解绑”。");
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
  if (messageText.trim().match(/^(?:[/／])?绑定(?:\s|$)/i)) {
    await logHandledInboundMessage(context, "message", "assistant:bind-hint");
    await replyToEvent(context, [
      "绑定需要使用站内生成的绑定码。",
      "请先到个人中心生成绑定码，再私聊发送：",
      "绑定 绑定码",
    ].join("\n"));
    return { ok: true };
  }
  const isSlashPostCommand = isCommandMessage(messageText) && /^[/／]投稿(?:\s|$)/.test(messageText.trim());
  const isPlainPrivatePostCommand = event.message_type !== "group" && isPrivatePlainCommand(messageText, "投稿");
  const isQuickPostTrigger = isSlashPostCommand || isPlainPrivatePostCommand;
  const forwardPayload = await maybeExtractForwardPayloadForPosting(event.message, messageText, event);
  if (!messageText.trim() && !forwardPayload) {
    await logQqBotMessage({ direction: "inbound", eventType: "message", status: "ignored", qqId, groupId, rawPayload: event });
    return { ignored: true };
  }
  context.forwardPayload = forwardPayload;
  if (isQuickPostTrigger && forwardPayload) {
    const conversation = await startForwardPostConversation(context, forwardPayload);
    await logHandledInboundMessage(context, "message", "assistant:forward-detected");
    await replyToPostingConversation(conversation, context, await renderConversationPrompt(conversation));
    return { ok: true };
  }
  if (isSlashPostCommand) {
    if (event.message_type === "group") {
      await replyToPrivateForPosting(
        context,
        [
          "群聊投稿请这样发：",
          "回复你想投稿的那条消息（可以是文字、图片、分享卡片或合并转发），并在同一条消息里 @我 说明要投稿。",
          "如果不方便这样操作，也可以改用私聊投稿。",
        ].join("\n"),
        "已收到，请查看私信了解投稿方式。",
      );
      return { ok: true };
    }
    const conversation = await startPostConversation(context);
    await logHandledInboundMessage(context, "message", "assistant:start-post");
    await replyToEvent(context, await renderConversationPrompt(conversation, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"));
    return { ok: true };
  }
  if (isPlainPrivatePostCommand) {
    const conversation = await startPostConversation(context);
    await logHandledInboundMessage(context, "message", "assistant:start-post");
    await replyToEvent(context, await renderConversationPrompt(conversation, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"));
    return { ok: true };
  }
  if (!isCommandMessage(messageText) && forwardPayload && shouldHandleForwardPostInContext(context)) {
    const conversation = await startForwardPostConversation(context, forwardPayload);
    await logHandledInboundMessage(context, "message", "assistant:forward-detected");
    await replyToPostingConversation(conversation, context, await renderConversationPrompt(conversation));
    return { ok: true };
  }

  if (!isCommandMessage(messageText) && isGreetingMessage(messageText) && shouldAssistantAutoReply(context)) {
    await logHandledInboundMessage(context, "message", "assistant:greeting");
    await replyToEvent(context, await renderGreetingReply(context.config.defaultBoardSlug));
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

async function handleQqBotRequestEvent(
  event: OneBotEvent,
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
) {
  const qqId = event.user_id ? String(event.user_id) : "";
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const requestType = String(event.request_type || "").trim();
  const subType = String(event.sub_type || "").trim();
  const flag = String(event.flag || "").trim();
  if (!flag || !requestType) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "request",
      status: "ignored",
      qqId,
      groupId,
      result: "request 缺少 flag 或 request_type",
      rawPayload: event,
    });
    return { ignored: true };
  }
  if (requestType === "friend") {
    await callQqBotAction("set_friend_add_request", {
      flag,
      approve: true,
      remark: "CPU Web 用户",
    });
    await logQqBotMessage({
      direction: "inbound",
      eventType: "friend-request",
      status: "ok",
      qqId,
      result: "已自动通过好友申请",
      rawPayload: event,
    });
    return { ok: true, autoAccepted: "friend" };
  }
  if (requestType === "group" && subType === "invite") {
    await callQqBotAction("set_group_add_request", {
      flag,
      sub_type: "invite",
      approve: true,
    });
    await ensureQqBotPostingGroup({
      groupId,
      config,
      preferredName: extractQqBotGroupName(event),
      source: "invite-request",
    });
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-invite",
      status: "ok",
      qqId,
      groupId,
      result: "已自动通过群聊邀请，并设为投稿群",
      rawPayload: event,
    });
    return { ok: true, autoAccepted: "group-invite" };
  }
  await logQqBotMessage({
    direction: "inbound",
    eventType: "request",
    status: "ignored",
    qqId,
    groupId,
    result: `未处理的 request：${requestType}${subType ? `/${subType}` : ""}`,
    rawPayload: event,
  });
  return { ignored: true };
}

async function handleQqBotNoticeEvent(
  event: OneBotEvent,
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
) {
  const qqId = event.user_id ? String(event.user_id) : "";
  const groupId = event.group_id ? String(event.group_id) : undefined;
  if (
    event.notice_type === "group_increase"
    && groupId
    && event.self_id
    && String(event.user_id || "") === String(event.self_id)
  ) {
    await ensureQqBotPostingGroup({
      groupId,
      config,
      preferredName: extractQqBotGroupName(event),
      source: "group-increase",
    });
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-increase",
      status: "ok",
      qqId,
      groupId,
      result: "机器人已入群，已同步为投稿群",
      rawPayload: event,
    });
    return { ok: true, synced: "group" };
  }
  await logQqBotMessage({
    direction: "inbound",
    eventType: event.notice_type || "notice",
    status: "ignored",
    qqId,
    groupId,
    rawPayload: event,
  });
  return { ignored: true };
}

async function ensureQqBotPostingGroup(input: {
  groupId?: string;
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  preferredName?: string | null;
  source: "invite-request" | "group-increase";
}) {
  const groupId = String(input.groupId || "").trim();
  if (!groupId) return null;
  const boardSlug = String(input.config.defaultBoardSlug || "").trim() || "general";
  const groupName = await resolveQqBotGroupName(groupId, input.preferredName);
  return prisma.qqBotGroup.upsert({
    where: { groupId },
    create: {
      groupId,
      name: groupName,
      enabled: true,
      allowPosting: true,
      defaultBoardSlug: boardSlug,
      notificationEnabled: false,
      notifyCategories: JSON.stringify(DEFAULT_GROUP_NOTIFY_CATEGORIES),
      notifyAudiences: JSON.stringify(DEFAULT_GROUP_NOTIFY_AUDIENCES),
    },
    update: {
      name: groupName ?? undefined,
      enabled: true,
      allowPosting: true,
      defaultBoardSlug: boardSlug,
    },
  });
}

function extractQqBotGroupName(event: OneBotEvent) {
  const payload = event as Record<string, any>;
  return String(
    payload?.group_name
    || payload?.group?.group_name
    || payload?.group?.name
    || payload?.name
    || "",
  ).trim() || null;
}

async function resolveQqBotGroupName(groupId: string, fallback?: string | null) {
  const preferred = String(fallback || "").trim();
  if (preferred) return preferred.slice(0, 80);
  const payload = await callQqBotAction("get_group_info", { group_id: Number(groupId) || groupId, no_cache: true }).catch(() => null);
  const name = String(
    payload?.data?.group_name
    || payload?.data?.groupName
    || payload?.group_name
    || "",
  ).trim();
  return name ? name.slice(0, 80) : null;
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
    await replyToEvent(context, await renderHelp(context.config.defaultBoardSlug));
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
    const reply = await renderConversationPrompt(
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

function parseConversationMetadata(metadata?: string | null) {
  if (!metadata) return {} as Record<string, any>;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}

function buildConversationMetadata(
  context: { event: OneBotEvent; groupId?: string },
  extra: Record<string, unknown> = {},
) {
  const metadata: Record<string, unknown> = { ...extra };
  if (context.event.message_type === "group" && context.groupId) {
    metadata.delivery = "private";
    metadata.originGroupId = context.groupId;
  }
  return JSON.stringify(metadata);
}

function conversationStorageGroupId(context: { event: OneBotEvent; groupId?: string }) {
  return context.event.message_type === "group" ? undefined : context.groupId;
}

async function moveConversationToPrivate(conversation: any, originGroupId?: string | null) {
  const normalizedGroupId = String(originGroupId || conversation.groupId || "").trim();
  if (!normalizedGroupId || !conversation.groupId) return conversation;
  const metadata = {
    ...parseConversationMetadata(conversation.metadata),
    delivery: "private",
    originGroupId: normalizedGroupId,
  };
  return prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: {
      groupId: null,
      metadata: JSON.stringify(metadata),
    },
  });
}

async function replyToPostingConversation(
  conversation: any,
  context: { event: OneBotEvent; qqId: string; groupId?: string },
  message: string,
  groupHint = "已收到，请查看私信完成投稿。",
) {
  const metadata = parseConversationMetadata(conversation?.metadata);
  const shouldReplyPrivately = Boolean(
    context.event.message_type === "group"
    || metadata.delivery === "private"
    || metadata.originGroupId,
  );
  if (!shouldReplyPrivately) {
    await replyToEvent(context, message);
    return;
  }
  await replyToPrivateForPosting(context, message, groupHint);
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
  return upsertConversation(context.qqId, conversationStorageGroupId(context), {
    scene: "post",
    step: "await-title",
    draftTitle: "",
    draftContent: "",
    draftBoardSlug: defaultBoardSlug,
    sourceMessageId: context.event.message_id ? String(context.event.message_id) : undefined,
    sourceSummary: "",
    metadata: buildConversationMetadata(context),
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
  forwardPayload: ParsedForwardPayload & { source: ForwardSource },
) {
  await ensureQqPostingAllowed(context);
  await ensureQqBinding(context.qqId);
  const defaultBoardSlug = await resolveDefaultBoardSlug(context.config.defaultBoardSlug, context.groupId);
  return upsertConversation(context.qqId, conversationStorageGroupId(context), {
    scene: "forward-post",
    step: "await-forward-confirm",
    draftTitle: "",
    draftContent: forwardPayload.content,
    draftBoardSlug: defaultBoardSlug,
    sourceMessageId: forwardPayload.sourceMessageId || (context.event.message_id ? String(context.event.message_id) : undefined),
    sourceSummary: forwardPayload.summary,
    metadata: buildConversationMetadata(context, {
      source: forwardPayload.source === "reply-message" ? "reply-message" : "forward",
      quotedPayloadSource: forwardPayload.source,
      forwardDraftTemplate: forwardPayload.content,
      forwardDraftMode: forwardPayload.source === "reply-message" ? "reply" : "placeholder",
    }),
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
        "打开链接后可申请人工复核。",
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
  if (conversation.groupId) {
    conversation = await moveConversationToPrivate(conversation, context.groupId || conversation.groupId);
  }
  const text = context.messageText.trim();
  if (isCancelMessage(text)) {
    markConversationCancelled(context.qqId, context.groupId);
    await finishConversation(conversation.id, "cancelled");
    await replyToPostingConversation(conversation, context, "已取消这次投稿。");
    return { ok: true, cancelled: true };
  }

  if (conversation.step === "await-forward-confirm") {
    if (/^(是|要|好的|确认|投稿)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-forward-title" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next));
      return { ok: true };
    }
    if (/^(否|不要|取消|算了)$/i.test(text)) {
      markConversationCancelled(context.qqId, context.groupId);
      await finishConversation(conversation.id, "cancelled");
      await replyToPostingConversation(conversation, context, "好的，这条内容我先不投稿。");
      return { ok: true, cancelled: true };
    }
    await replyToPostingConversation(
      conversation,
      context,
      "如果要投稿，请回复“是”；不想投稿就回复“否”或“/取消”。我会把你刚才回复的那条消息内容当作投稿素材。",
    );
    return { ok: true };
  }

  if (conversation.step === "await-ai-post-confirm") {
    if (/^(是|好|好的|继续|发送|确认|就这样|可以)$/i.test(text)) {
      if ((conversation.draftContent || "").trim()) {
        try {
          await replyToPostingConversation(conversation, context, "已收到投稿确认，正在处理中，请耐心稍候。").catch(() => null);
          const result = await submitConversationPost(conversation.id, context);
          await replyToPostingConversation(conversation, context, result.message);
          return { ok: true, topicId: result.topicId };
        } catch (error: any) {
          return cancelConversationAfterSubmitFailure(conversation, context, error);
        }
      }
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，你继续把正文发给我。"));
      return { ok: true };
    }
    if (/^(改标题|重新标题|换标题)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-title" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，请发送新的标题。"));
      return { ok: true };
    }
    if (/^(补充|继续写|加正文)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，继续把正文补充给我。"));
      return { ok: true };
    }
    await replyToPostingConversation(conversation, context, "如果这份草稿可以直接发，请回复“是”；想改标题就回复“改标题”；想继续补正文就直接发内容或回复“补充”。");
    return { ok: true };
  }

  if (conversation.step === "await-title" || conversation.step === "await-forward-title") {
    const normalizedText = context.messageText.trim();
    if (normalizedText.length < 2) {
      await replyToPostingConversation(conversation, context, "标题至少 2 个字，请重新发送标题。");
      return { ok: true };
    }
    const colonParsed = await detectBoardAndTitleInSingleLine(
      normalizedText,
      conversation.draftBoardSlug || context.config.defaultBoardSlug,
      context.groupId,
    );
    if (colonParsed) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: {
          draftBoardSlug: colonParsed.board.slug,
          draftTitle: colonParsed.title,
          step: conversation.step === "await-forward-title" || (conversation.draftContent || "").trim()
            ? "await-submit-confirm"
            : "collect-content",
        },
      });
      await replyToPostingConversation(
        conversation,
        context,
        await renderConversationPrompt(next, `我会把这篇稿子发到「${colonParsed.board.name}」，标题记成「${colonParsed.title}」。`),
      );
      return { ok: true };
    }
    const boardSelection = await detectBoardSelectionInTitleStep(
      normalizedText,
      conversation.draftBoardSlug || context.config.defaultBoardSlug,
      context.groupId,
    );
    if (boardSelection) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { draftBoardSlug: boardSelection.slug },
      });
      await replyToPostingConversation(
        conversation,
        context,
        await renderConversationPrompt(next, `好的，这篇稿子会发到「${boardSelection.name}」。现在请发送标题。`),
      );
      return { ok: true };
    }
    const [firstLine, ...restLines] = normalizedText.split(/\r?\n/);
    const titleCandidate = firstLine.trim();
    if (titleCandidate.length < 2) {
      await replyToPostingConversation(conversation, context, "标题至少 2 个字，请重新发送标题。");
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
    await replyToPostingConversation(conversation, context, await renderConversationPrompt(
      next,
      conversation.step === "await-forward-title"
        ? `标题我记成「${parsed.title}」了，正文我会直接使用你刚才回复的那条消息内容。`
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
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "我先帮你整理好，确认后再正式发布。"));
      return { ok: true };
    }

    if (shouldAssistantAutoReply(context) && /^(帮我润色|润色一下|优化一下|帮我整理一下|重写一下)/i.test(text)) {
      const polished = await polishConversationDraft(conversation, context).catch(() => null);
      if (polished) {
        await replyToPostingConversation(conversation, context, polished);
        return { ok: true };
      }
    }

    const nextContent = mergeConversationContent(conversation.draftContent || "", context.messageText);
    await prisma.qqBotConversation.update({
      where: { id: conversation.id },
      data: { draftContent: nextContent },
    });
    await replyToPostingConversation(conversation, context, "已收到这段正文。继续发送内容，全部完成后发送“/结束”。");
    return { ok: true };
  }

  if (conversation.step === "await-submit-confirm") {
    if (isConfirmPublishMessage(text)) {
      try {
        await replyToPostingConversation(conversation, context, "已收到投稿确认，正在处理中，请耐心稍候。").catch(() => null);
        const result = await submitConversationPost(conversation.id, context);
        await replyToPostingConversation(conversation, context, result.message);
        return { ok: true, topicId: result.topicId };
      } catch (error: any) {
        return cancelConversationAfterSubmitFailure(conversation, context, error);
      }
    }
    if (/^(改标题|重新标题|换标题)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-title" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，请发送新的标题。"));
      return { ok: true };
    }
    if (/^(补充|继续写|继续补充|改正文|继续修改)$/i.test(text)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，继续把正文补充给我。"));
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
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "我把这段也补进正文里了。"));
      return { ok: true };
    }
    await replyToPostingConversation(conversation, context, "如果可以发布，请回复“确认发布”或“是”；想改标题回复“改标题”；想继续补正文就直接发内容。");
    return { ok: true };
  }

  return null;
}

async function cancelConversationAfterSubmitFailure(
  conversation: any,
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
  error: any,
) {
  const message = error?.message || "投稿失败";
  markConversationCancelled(context.qqId, context.groupId);
  await finishConversation(conversation.id, "cancelled");
  await replyToPostingConversation(
    conversation,
    context,
    `投稿失败：${message}\n这次投稿已自动取消。如需继续，请重新发送“投稿”或重新提供投稿内容。`,
  );
  return { ok: false, error: message, cancelled: true };
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
  const content = (await refreshForwardDraftContent(conversation)) || conversation.draftTitle.trim();
  const metadata = parseConversationMetadata(conversation.metadata);
  const originGroupId = String(metadata.originGroupId || "").trim() || undefined;
  const result = await submitQqPost({
    ...context,
    event: {
      ...context.event,
      message_type: originGroupId ? "group" : context.event.message_type,
      group_id: originGroupId || context.event.group_id,
      message_id: conversation.sourceMessageId || context.event.message_id,
    },
    groupId: originGroupId,
    messageText: buildPostCommandFromDraft(
      conversation.draftBoardSlug || context.config.defaultBoardSlug,
      conversation.draftTitle,
      content,
      originGroupId,
      context.config.defaultBoardSlug,
    ),
  });
  if (!result.topicId || !Number.isFinite(result.topicId) || result.topicId <= 0) {
    throw Errors.badRequest(result.message || "投稿失败");
  }
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

async function renderConversationPrompt(conversation: any, assistantHint?: string) {
  const boardDisplayName = conversation.draftBoardSlug ? await resolveBoardDisplayName(conversation.draftBoardSlug) : "";
  const draftPreview = conversation.draftContent
    ? `${conversation.draftContent.slice(0, 160)}${conversation.draftContent.length > 160 ? "..." : ""}`
    : "";
  if (conversation.step === "await-title") {
    const isRetitling = /重新发一个标题|重新标题|改标题|新标题/.test(String(assistantHint || ""));
    return [
      isRetitling ? "请发送新的标题。" : "请先发送标题。",
      "不想继续的话，发送“/取消”。",
      !isRetitling ? "如果你想指定投稿区，也可以直接说“投稿到树洞”，或者发“树洞：标题”。" : "",
      assistantHint || "",
    ].join("\n");
  }
  if (conversation.step === "await-forward-confirm") {
    return [
      "我收到了你回复的那条消息内容。",
      "如果要投稿，请回复“是”。不想投稿请回复“否”或“取消”。",
      assistantHint || "",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-ai-post-confirm") {
    return [
      "我先帮你整理了一版草稿：",
      boardDisplayName ? `投稿区：${boardDisplayName}` : "",
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
      draftPreview ? `正文预览：${draftPreview}` : "",
      assistantHint || "",
      "如果可以直接发，请回复“是”。",
      "想改标题就回复“改标题”。想继续补正文就直接发内容。",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-submit-confirm") {
    return [
      "投稿确认：",
      boardDisplayName ? `投稿区：${boardDisplayName}` : "",
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
      draftPreview ? `正文预览：${draftPreview}` : "",
      assistantHint || "",
      "确认发布请回复“确认发布”或“是”。",
      "想改标题请回复“改标题”。想继续补正文就直接发内容。不想发了就回复“取消”。",
    ].filter(Boolean).join("\n");
  }
  if (conversation.step === "await-forward-title") {
    return [
      "好的，请发送这篇投稿的标题。",
      "正文我会使用刚才那条消息里的内容。",
      "不想继续的话，发送“取消”。",
      assistantHint || "",
    ].join("\n");
  }
  if (conversation.step === "collect-content") {
    return [
      `标题已记录：${conversation.draftTitle || "未命名"}`,
      "接下来请逐条发送正文内容。",
      "每发一条我会自动换行拼接。",
      "全部完成后发送“结束”。不想继续的话，发送“取消”。",
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

function replaceForwardDraftTemplate(currentDraft: string, template: string, nextForwardContent: string) {
  const current = String(currentDraft || "").trim();
  const previous = String(template || "").trim();
  const next = String(nextForwardContent || "").trim();
  if (!next) return current;
  if (!current) return next;
  if (!previous) return current;
  if (current === previous) return next;
  const index = current.indexOf(previous);
  if (index < 0) return current;
  return normalizeRenderedMessage(`${current.slice(0, index)}${next}${current.slice(index + previous.length)}`);
}

function hasForwardMediaPlaceholders(content: string) {
  const normalized = String(content || "");
  return normalized.includes("[图片]")
    || normalized.includes("[视频]")
    || normalized.includes("qq-forward-placeholder");
}

async function refreshForwardDraftContent(conversation: any) {
  const currentDraft = String(conversation?.draftContent || "").trim();
  const metadata = parseConversationMetadata(conversation?.metadata);
  const forwardId = String(conversation?.sourceMessageId || "").trim();
  if (conversation?.scene !== "forward-post" || !forwardId) return currentDraft;
  const forwardDraftTemplate = String(metadata.forwardDraftTemplate || "");
  if (!hasForwardMediaPlaceholders(forwardDraftTemplate) && !hasForwardMediaPlaceholders(currentDraft)) return currentDraft;
  const payloadSource = String(metadata.quotedPayloadSource || "").trim();
  let refreshed = "";
  if (payloadSource === "reply-message") {
    const replied = await callQqBotAction("get_msg", { message_id: Number(forwardId) || forwardId }).catch(() => null);
    refreshed = await extractMessageText(replied?.data?.message ?? replied?.data?.content, {
      imageMode: "upload",
      videoMode: "upload",
    }).catch(() => "");
  } else {
    const payload = await extractForwardPayload([{ type: "forward", data: { id: forwardId } }], {
      imageMode: "upload",
      videoMode: "upload",
    }).catch(() => null);
    refreshed = String(payload?.content || "").trim();
  }
  if (!refreshed) return currentDraft;
  return replaceForwardDraftTemplate(currentDraft, String(metadata.forwardDraftTemplate || ""), refreshed);
}

async function parseConversationTitle(text: string, defaultBoardSlug: string, groupId?: string) {
  return parsePostCommand(`/投稿 ${text}`, defaultBoardSlug, groupId);
}

async function detectBoardSelectionInTitleStep(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim();
  const match = normalized.match(/^(?:发到|投稿到|发去|投到|发在|放到)(.+)$/);
  if (!match) return null;
  const target = match[1].trim();
  if (!target) return null;
  const currentDefaultSlug = await resolveDefaultBoardSlug(defaultBoardSlug, groupId);
  if (/^(默认板块|默认投稿区|默认区|默认)$/i.test(target)) {
    const board = await prisma.board.findUnique({ where: { slug: currentDefaultSlug }, select: { slug: true, name: true } });
    return board ? { slug: board.slug, name: board.name } : null;
  }
  const boards = await prisma.board.findMany({
    where: {
      readOnly: false,
      type: { in: ["normal", "question", "market", "coursereview"] },
    },
    select: { slug: true, name: true },
    take: 50,
  });
  const aliasMap = buildBoardAliasMap(boards);
  const aliasHit = aliasMap.get(normalizeBoardAliasKey(target));
  if (aliasHit) return aliasHit;
  const exact = boards.find((board) => board.name === target || board.slug === target);
  if (exact) return exact;
  const fuzzy = boards.find((board) => target.includes(board.name) || board.name.includes(target));
  return fuzzy ?? null;
}

async function detectBoardAndTitleInSingleLine(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim();
  const match = normalized.match(/^(.+?)[：:]\s*(.+)$/);
  if (!match) return null;
  const boardHint = match[1].trim();
  const title = match[2].trim();
  if (title.length < 2) return null;
  const board = await detectBoardSelectionInTitleStep(`投稿到${boardHint}`, defaultBoardSlug, groupId);
  if (!board) return null;
  return { board, title: title.slice(0, 120) };
}

function buildBoardAliasMap(boards: Array<{ slug: string; name: string }>) {
  const map = new Map<string, { slug: string; name: string }>();
  for (const board of boards) {
    const keys = new Set<string>([
      normalizeBoardAliasKey(board.slug),
      normalizeBoardAliasKey(board.name),
    ]);
    for (const alias of boardAliasCandidates(board.slug, board.name)) {
      keys.add(normalizeBoardAliasKey(alias));
    }
    for (const key of keys) {
      if (key) map.set(key, board);
    }
  }
  return map;
}

function normalizeBoardAliasKey(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function boardAliasCandidates(slug: string, name: string) {
  const out = new Set<string>([slug, name]);
  if (slug === "general") {
    out.add("默认板块");
    out.add("默认投稿区");
    out.add("默认区");
    out.add("总板块");
    out.add("灌水");
    out.add("灌水广场");
  }
  if (slug === "treehole") {
    out.add("树洞");
  }
  if (slug === "life") {
    out.add("校园生活");
    out.add("生活");
  }
  if (slug === "freshman") {
    out.add("新生");
    out.add("新生入学");
  }
  if (slug === "question") {
    out.add("提问");
    out.add("提问广场");
    out.add("求助");
  }
  if (slug === "market") {
    out.add("二手");
    out.add("二手市场");
  }
  if (slug === "coursereview") {
    out.add("课评");
    out.add("课程点评");
  }
  return [...out];
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
  const shouldReview = shouldRunAiReview() && !bypassAiReview;
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
  void generateTopicAiTags({
    title: input.title,
    content: input.content,
    boardName: board.name,
    boardType: board.type,
    metadata,
  })
    .then((aiTags) => syncTopicAiTags(topic.id, aiTags))
    .catch(() => undefined);
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
  await Promise.all([
    ensureForumImageAssetsForContent(input.content, userId).catch(() => null),
    ensureForumVideoAssetsForContent(input.content, userId).catch(() => null),
  ]);
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

async function replyToPrivateForPosting(
  context: { event: OneBotEvent; qqId: string; groupId?: string },
  message: string,
  groupHint = "已收到，请查看私信完成投稿。",
) {
  try {
    await sendQqMessage({ qqId: context.qqId }, message);
  } catch {
    if (context.event.message_type === "group" && context.groupId) {
      await sendQqMessage(
        { groupId: context.groupId },
        "已收到，但私信发送失败。请先私聊我，确认能收到消息后再继续投稿。",
      ).catch(() => undefined);
    }
    return false;
  }
  if (context.event.message_type === "group" && context.groupId) {
    await sendQqMessage({ groupId: context.groupId }, groupHint).catch(() => undefined);
  }
  return true;
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
  const personalCategories = parseStringArray(config.notifyCategories, DEFAULT_NOTIFY_CATEGORIES);
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const rawGroups = await prisma.qqBotGroup.findMany({ where: { enabled: true, notificationEnabled: true } });
  const groups = rawGroups.map((group) => formatQqBotGroup(group));
  const groupCategorySet = new Set<string>();
  groups.forEach((group) => {
    group.notifyCategories.forEach((category) => groupCategorySet.add(category));
  });
  const categories = Array.from(new Set([
    ...personalCategories,
    ...groupCategorySet,
  ]));
  if (!categories.length) return { sent: 0 };
  const [notifications, bindings] = await Promise.all([
    prisma.notification.findMany({
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
    }),
    prisma.qqBotBinding.findMany({
      where: { enabled: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        userId: true,
        qqId: true,
        user: {
          select: {
            messageSetting: {
              select: {
                subscribeReply: true,
                subscribeLike: true,
                subscribeSchool: true,
                subscribeSystem: true,
              },
            },
            role: true,
          },
        },
      },
    }),
  ]);
  const bindingByUserId = new Map<number, (typeof bindings)[number]>();
  for (const binding of bindings) {
    if (!bindingByUserId.has(binding.userId)) bindingByUserId.set(binding.userId, binding);
  }
  const uniqueBindings = Array.from(bindingByUserId.values());
  const notificationUserIds = Array.from(new Set(
    notifications
      .map((item) => item.userId)
      .filter((item): item is number => Number.isFinite(item)),
  ));
  const notificationUsers = notificationUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: notificationUserIds } },
        select: { id: true, role: true },
      })
    : [];
  const notificationUserRoleById = new Map(notificationUsers.map((user) => [user.id, user.role]));
  let sent = 0;
  for (const item of notifications) {
    if (item.userId) {
      const recipientRole = notificationUserRoleById.get(item.userId) || null;
      const binding = bindingByUserId.get(item.userId);
      if (binding && shouldDeliverQqNotificationToUser(item, binding.user.messageSetting)) {
        const existed = await prisma.qqBotMessageLog.findFirst({
          where: { eventType: "notification", notificationId: item.id, userId: item.userId, status: "ok" },
          select: { id: true },
        });
        if (!existed && await sendNotificationMessage({ qqId: binding.qqId }, item, item.userId)) {
          sent += 1;
        }
      }
      for (const group of groups) {
        if (!shouldDeliverQqNotificationToGroup(group, item, recipientRole)) continue;
        const groupDeliveryKey = buildGroupNotificationDeliveryKey(item);
        const existedInGroup = await prisma.qqBotMessageLog.findFirst({
          where: { eventType: "notification", groupId: group.groupId, command: groupDeliveryKey, status: "ok" },
          select: { id: true },
        });
        if (existedInGroup) continue;
        if (await sendNotificationMessage({ groupId: group.groupId }, item, null, { command: groupDeliveryKey })) {
          sent += 1;
        }
      }
    } else {
      if (!isNotificationVisibleToQq(item)) continue;
      for (const binding of uniqueBindings) {
        if (!shouldDeliverQqNotificationToUser(item, binding.user.messageSetting)) continue;
        const existed = await prisma.qqBotMessageLog.findFirst({
          where: { eventType: "notification", notificationId: item.id, userId: binding.userId, status: "ok" },
          select: { id: true },
        });
        if (existed) continue;
        if (await sendNotificationMessage({ qqId: binding.qqId }, item, binding.userId)) {
          sent += 1;
        }
      }
      for (const group of groups) {
        if (!shouldDeliverQqNotificationToGroup(group, item, null)) continue;
        const groupDeliveryKey = buildGroupNotificationDeliveryKey(item);
        const existed = await prisma.qqBotMessageLog.findFirst({
          where: { eventType: "notification", groupId: group.groupId, command: groupDeliveryKey, status: "ok" },
          select: { id: true },
        });
        if (existed) continue;
        if (await sendNotificationMessage({ groupId: group.groupId }, item, null, { command: groupDeliveryKey })) {
          sent += 1;
        }
      }
    }
  }
  return { sent };
}

async function sendNotificationMessage(
  target: { qqId?: string; groupId?: string },
  notification: any,
  userId: number | null,
  options?: { command?: string },
) {
  const link = resolveNotificationLink(notification);
  const message = [
    `【${notification.source || "药大拾间"}】${notification.title}`,
    notification.content,
    link ? `链接：${link}` : "",
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
      command: options?.command,
      content: message.slice(0, 1000),
      result: "sent",
    });
    return true;
  } catch (error: any) {
    await logQqBotMessage({
      direction: "outbound",
      eventType: "notification",
      status: "error",
      qqId: target.qqId,
      groupId: target.groupId,
      userId,
      notificationId: notification.id,
      command: options?.command,
      content: message.slice(0, 1000),
      result: error?.message || "发送失败",
    });
    return false;
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

export async function buildQqBotDebugExport(input: {
  status?: string;
  eventType?: string;
  take?: number;
}) {
  const take = Math.min(200, Math.max(20, Number(input.take ?? 80) || 80));
  const where: any = {};
  if (input.status) where.status = input.status;
  if (input.eventType) where.eventType = input.eventType;
  const [messageLogs, forwardDebugEntries] = await Promise.all([
    prisma.qqBotMessageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: { user: { select: { id: true, username: true, nickname: true } } },
    }),
    readQqBotForwardDebugEntries(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    filters: {
      status: input.status || "",
      eventType: input.eventType || "",
      take,
    },
    messageLogs: messageLogs.map((row) => ({
      ...row,
      rawPayload: parseJsonTextMaybe(row.rawPayload),
    })),
    forwardDebugEntries,
  };
}

function parseJsonTextMaybe(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readQqBotForwardDebugEntries(limit = QQBOT_FORWARD_DEBUG_EXPORT_LIMIT) {
  const raw = await readFile(QQBOT_FORWARD_DEBUG_FILE, "utf8").catch(() => "");
  if (!raw.trim()) return [] as any[];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => parseJsonTextMaybe(line));
}

function trimDebugValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= 5) return "[depth-limit]";
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated ${value.length - 4000} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const trimmed = value.slice(0, 20).map((item) => trimDebugValue(item, depth + 1));
    if (value.length > 20) trimmed.push(`[truncated ${value.length - 20} items]`);
    return trimmed;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, 30)) out[key] = trimDebugValue(item, depth + 1);
    if (entries.length > 30) out.__truncatedKeys = `[truncated ${entries.length - 30} keys]`;
    return out;
  }
  return String(value);
}

async function appendQqBotForwardDebug(stage: string, payload: Record<string, unknown>) {
  const trimmedPayload = trimDebugValue(payload);
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    stage,
    ...(
      trimmedPayload && typeof trimmedPayload === "object" && !Array.isArray(trimmedPayload)
        ? trimmedPayload as Record<string, unknown>
        : { payload: trimmedPayload }
    ),
  });
  await mkdir(path.dirname(QQBOT_FORWARD_DEBUG_FILE), { recursive: true });
  await appendFile(QQBOT_FORWARD_DEBUG_FILE, `${entry}\n`, "utf8").catch(() => undefined);
}

function queueQqBotForwardDebug(stage: string, payload: Record<string, unknown>) {
  void appendQqBotForwardDebug(stage, payload);
}

function debugMessagePreview(value: string, limit = 240) {
  const normalized = normalizeRenderedMessage(value).replace(/\n+/g, " ");
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

const MAX_FORWARD_DEPTH = 4;
const QQBOT_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const QQBOT_VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const QQBOT_FORWARD_DEBUG_FILE = path.resolve(process.cwd(), "runtime", "qqbot-forward-debug.ndjson");
const QQBOT_FORWARD_DEBUG_EXPORT_LIMIT = 200;
const qqImageUploadCache = new Map<string, Promise<string>>();
const qqVideoUploadCache = new Map<string, Promise<string>>();

async function extractMessageText(
  message: unknown,
  options: QqMessageExtractOptions = {},
): Promise<string> {
  if (typeof message === "string") return cleanCqMessage(message, options);
  if (message && typeof message === "object") {
    const maybeMessage = message as any;
    if (maybeMessage.type === "node") {
      if (options.forwardMode === "placeholder") return "[合并转发]";
      const embedded = await renderEmbeddedNodeSegmentContent(
        maybeMessage.data?.content ?? maybeMessage.data?.message,
        options,
      );
      if (embedded) return normalizeRenderedMessage(embedded);
      if (maybeMessage.data?.id) return normalizeRenderedMessage(await resolveReferencedNodeContent(maybeMessage.data.id, options));
      if (Array.isArray(maybeMessage.data?.content)) return extractMessageText(maybeMessage.data.content, options);
      if (typeof maybeMessage.data?.content === "string") return cleanCqMessage(maybeMessage.data.content, options);
    }
    if (maybeMessage.type === "forward") {
      if (options.forwardMode === "placeholder") return "[合并转发]";
      const embedded = await renderEmbeddedForwardSegmentContent(
        maybeMessage.data?.content ?? maybeMessage.data?.message,
        options,
      );
      if (embedded) return normalizeRenderedMessage(embedded);
      const forwardId = readForwardSegmentId(maybeMessage.data);
      if (forwardId) {
        return normalizeRenderedMessage(await renderNestedForwardContent(forwardId, {
          ...options,
          forwardDepth: (options.forwardDepth ?? 0) + 1,
        }));
      }
    }
    if (["image", "video", "record", "json", "xml", "share", "music"].includes(String(maybeMessage.type || "").trim())) {
      const rendered = await renderMessageSegment(maybeMessage, options);
      if (rendered) return normalizeRenderedMessage(rendered);
    }
    if (Array.isArray(maybeMessage.message)) return extractMessageText(maybeMessage.message, options);
    if (Array.isArray(maybeMessage.content)) return extractMessageText(maybeMessage.content, options);
    if (typeof maybeMessage.message === "string") return cleanCqMessage(maybeMessage.message, options);
    if (typeof maybeMessage.content === "string") return cleanCqMessage(maybeMessage.content, options);
  }
  if (!Array.isArray(message)) return "";
  const parts: string[] = [];
  for (const seg of message) {
    const rendered = await renderMessageSegment(seg, options);
    if (rendered) parts.push(rendered);
  }
  return normalizeRenderedMessage(parts.join(""));
}

function readForwardSegmentId(data: any) {
  return String(data?.id || data?.resid || data?.forward_id || data?.message_id || "").trim();
}

function looksLikeForwardMessageList(value: unknown): value is any[] {
  if (!Array.isArray(value) || !value.length) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const type = String((item as any).type || "").trim();
    if (type && type !== "node") return false;
    const node = (item as any).data ?? item;
    return Boolean(
      type === "node"
      || node?.sender
      || node?.nickname
      || node?.user_id
      || node?.message_type
      || node?.content !== undefined
      || node?.message !== undefined,
    );
  });
}

function pickEmbeddedForwardMessages(value: unknown): unknown[] | null {
  if (looksLikeForwardMessageList(value)) return value;
  if (!value || typeof value !== "object") return null;
  const maybeValue = value as any;
  if (looksLikeForwardMessageList(maybeValue.messages)) return maybeValue.messages;
  if (looksLikeForwardMessageList(maybeValue.data?.messages)) return maybeValue.data.messages;
  if (looksLikeForwardMessageList(maybeValue.content)) return maybeValue.content;
  if (looksLikeForwardMessageList(maybeValue.data?.content)) return maybeValue.data.content;
  return null;
}

async function renderEmbeddedForwardLikeContent(
  content: unknown,
  options: QqMessageExtractOptions & { withForwardTitle: boolean },
) {
  if (content == null) return "";
  const nestedOptions = {
    ...options,
    forwardDepth: (options.forwardDepth ?? 0) + 1,
  };
  const embeddedMessages = pickEmbeddedForwardMessages(content);
  if (embeddedMessages) {
    const parsed = await parseForwardMessages(embeddedMessages, "", nestedOptions);
    if (parsed?.content) return `\n${parsed.content}\n`;
  }
  const nested = await extractMessageText(content, nestedOptions).catch(() => "");
  if (!nested.trim()) return "";
  return `\n${nested}\n`;
}

async function renderEmbeddedNodeSegmentContent(content: unknown, options: QqMessageExtractOptions) {
  return renderEmbeddedForwardLikeContent(content, { ...options, withForwardTitle: false });
}

async function renderEmbeddedForwardSegmentContent(content: unknown, options: QqMessageExtractOptions) {
  return renderEmbeddedForwardLikeContent(content, { ...options, withForwardTitle: true });
}

async function renderMessageSegment(seg: any, options: QqMessageExtractOptions): Promise<string> {
  if (seg?.type === "text") return String(seg.data?.text || "");
  if (seg?.type === "image") {
    if (options.imageMode === "placeholder") return "\n[图片]\n";
    const url = await resolveQqImageUrl(seg.data?.url, seg.data?.file);
    return url ? `\n![QQ图片](${url})\n` : "\n[图片]\n";
  }
  if (seg?.type === "video") {
    if (options.videoMode === "placeholder") return "\n[视频]\n";
    const url = await resolveQqVideoUrl(
      seg.data?.url ?? seg.data?.src,
      seg.data?.file ?? seg.data?.file_id ?? seg.data?.path,
    );
    return url ? `\n${renderQqVideoBlock(url)}\n` : "\n[视频]\n";
  }
  if (seg?.type === "share") {
    return renderShareCardBlock(parseShareSegmentCard(seg.data));
  }
  if (seg?.type === "music") {
    return renderShareCardBlock(parseMusicSegmentCard(seg.data));
  }
  if (seg?.type === "json") {
    return renderShareCardBlock(parseJsonShareCard(seg.data?.data ?? seg.data));
  }
  if (seg?.type === "xml") {
    return renderShareCardBlock(parseXmlShareCard(seg.data?.data ?? seg.data));
  }
  if (seg?.type === "node") {
    if (options.forwardMode === "placeholder") return "\n[合并转发]\n";
    const embedded = await renderEmbeddedNodeSegmentContent(seg.data?.content ?? seg.data?.message, options);
    if (embedded) return embedded;
    if (seg?.data?.id) return resolveReferencedNodeContent(seg.data.id, options);
  }
  if (seg?.type === "forward") {
    if (options.forwardMode === "placeholder") return "\n[合并转发]\n";
    const embedded = await renderEmbeddedForwardSegmentContent(seg.data?.content ?? seg.data?.message, options);
    if (embedded) return embedded;
    return renderNestedForwardContent(readForwardSegmentId(seg.data), {
      ...options,
      forwardDepth: (options.forwardDepth ?? 0) + 1,
    });
  }
  if (seg?.type === "record") return "\n[语音]\n";
  return "";
}

async function extractForwardPayload(
  message: unknown,
  options: QqMessageExtractOptions = {},
): Promise<(ParsedForwardPayload & { source: ForwardSource }) | null> {
  const forwardId = extractForwardNodeId(message);
  if (forwardId) {
    const payload = await callQqBotAction("get_forward_msg", { id: forwardId }).catch(() => null);
    const parsed = await parseForwardMessages(payload?.data?.messages, forwardId, options);
    if (parsed) {
      queueQqBotForwardDebug("forward.extract", {
        source: "direct-forward",
        forwardId,
        summary: parsed.summary,
        preview: debugMessagePreview(parsed.content),
      });
      return { ...parsed, source: "direct-forward" };
    }
  }
  const replyId = extractReplyMessageId(message);
  if (!replyId) return null;
  const replied = await callQqBotAction("get_msg", { message_id: Number(replyId) || replyId }).catch(() => null);
  const replyMessage = replied?.data?.message ?? replied?.data?.content;
  const replyForwardId = extractForwardNodeId(replyMessage);
  if (replyForwardId) {
    const payload = await callQqBotAction("get_forward_msg", { id: replyForwardId }).catch(() => null);
    const parsed = await parseForwardMessages(payload?.data?.messages, replyForwardId, options);
    if (parsed) {
      queueQqBotForwardDebug("forward.extract", {
        source: "reply-forward",
        replyId,
        forwardId: replyForwardId,
        summary: parsed.summary,
        preview: debugMessagePreview(parsed.content),
      });
      return { ...parsed, source: "reply-forward" };
    }
  }
  const replyContent = (await extractMessageText(replyMessage, options).catch(() => "")).trim();
  if (!replyContent) return null;
  const imageCount = countForwardImageTokens(replyContent);
  const summary = buildReplyMessageSummary(replyContent, imageCount);
  queueQqBotForwardDebug("forward.extract", {
    source: "reply-message",
    replyId,
    summary,
    preview: debugMessagePreview(replyContent),
    message: replyMessage,
  });
  return {
    source: "reply-message",
    summary,
    content: replyContent,
    sourceMessageId: replyId,
    messageCount: 1,
    blockCount: 1,
    participantCount: 1,
    imageCount,
  };
}

async function parseForwardMessages(
  messages: unknown,
  forwardId: string,
  options: QqMessageExtractOptions = {},
): Promise<ParsedForwardPayload | null> {
  const list = Array.isArray(messages) ? messages : [];
  const entries: ParsedForwardEntry[] = [];
  const forwardDepth = options.forwardDepth ?? 0;
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const node = item?.data ?? item;
    const nickname = String(
      node?.sender?.nickname
      || node?.sender?.card
      || node?.nickname
      || node?.user_id
      || item?.sender?.nickname
      || item?.sender?.user_id
      || "QQ用户",
    );
    const text = (await extractMessageText(
      node?.content
      ?? node?.message
      ?? item?.content
      ?? item?.message
      ?? "",
      options,
    )).trim();
    if (!text) continue;
    entries.push({
      nickname,
      text,
      messageCount: 1,
      imageCount: countForwardImageTokens(text),
    });
  }
  const mergedEntries = mergeForwardEntries(entries);
  if (!mergedEntries.length) {
    queueQqBotForwardDebug("forward.parse.empty", {
      forwardId,
      forwardDepth,
      itemCount: list.length,
      messages: list,
    });
    return null;
  }
  const messageCount = entries.reduce((total, entry) => total + entry.messageCount, 0);
  const imageCount = entries.reduce((total, entry) => total + entry.imageCount, 0);
  const participantNames = Array.from(new Set(mergedEntries.map((entry) => entry.nickname).filter(Boolean)));
  const parsed = {
    summary: buildForwardPayloadSummary(mergedEntries, {
      messageCount,
      blockCount: mergedEntries.length,
      participantCount: participantNames.length,
      imageCount,
    }),
    content: renderForwardPayloadContent(
      mergedEntries,
      {
        messageCount,
        blockCount: mergedEntries.length,
        participantCount: participantNames.length,
        imageCount,
        participantNames,
      },
      forwardDepth,
    ),
    sourceMessageId: forwardId,
    messageCount,
    blockCount: mergedEntries.length,
    participantCount: participantNames.length,
    imageCount,
  };
  queueQqBotForwardDebug("forward.parse.ok", {
    forwardId,
    forwardDepth,
    itemCount: list.length,
    summary: parsed.summary,
    preview: debugMessagePreview(parsed.content),
    messages: list,
  });
  return parsed;
}

function extractReplyMessageId(message: unknown) {
  if (!Array.isArray(message)) return "";
  const replySeg = message.find((seg: any) => seg?.type === "reply" && seg?.data?.id);
  return String(replySeg?.data?.id || "").trim();
}

function shouldUseLightForwardExtraction(message: unknown) {
  if (!Array.isArray(message)) return false;
  return message.some((seg: any) => {
    const type = String(seg?.type || "").trim();
    return type === "forward" || type === "node" || type === "reply";
  });
}

async function maybeExtractForwardPayloadForPosting(
  message: unknown,
  messageText: string,
  event: OneBotEvent,
): Promise<(ParsedForwardPayload & { source: ForwardSource }) | null> {
  if (!shouldAttemptForwardPayloadExtraction(message, messageText, event)) return null;
  return extractForwardPayload(message, {
    imageMode: "placeholder",
    videoMode: "placeholder",
  }).catch(() => null);
}

function shouldAttemptForwardPayloadExtraction(message: unknown, messageText: string, event: OneBotEvent) {
  const hasForwardLikeSource = Boolean(extractForwardNodeId(message) || extractReplyMessageId(message));
  if (!hasForwardLikeSource) return false;
  if (event.message_type !== "group") return true;
  return isExplicitBotMention(event, messageText)
    || /^[/／]投稿(?:\s|$)/.test(messageText.trim())
    || /^投稿(?:\s|$)/.test(messageText.trim());
}

function extractForwardNodeId(message: unknown): string {
  if (!message) return "";
  if (Array.isArray(message)) {
    for (const seg of message) {
      const nested = extractForwardNodeId(seg);
      if (nested) return nested;
    }
    return "";
  }
  if (typeof message === "string") {
    const match = message.match(/\[CQ:(?:forward|node),[^\]]*(?:id|resid|forward_id|message_id)=([^,\]]+)/i);
    return String(match?.[1] || "").trim();
  }
  if (typeof message === "object") {
    const item = message as any;
    if ((item?.type === "forward" || item?.type === "node") && item?.data) {
      const id = item.data.id || item.data.resid || item.data.forward_id || item.data.message_id;
      if (id) return String(id).trim();
      if (item.data.content) return extractForwardNodeId(item.data.content);
      if (item.data.message) return extractForwardNodeId(item.data.message);
    }
    if (item?.content) return extractForwardNodeId(item.content);
    if (item?.message) return extractForwardNodeId(item.message);
    if (item?.data?.content) return extractForwardNodeId(item.data.content);
    if (item?.data?.message) return extractForwardNodeId(item.data.message);
  }
  return "";
}

async function cleanCqMessage(value: string, options: QqMessageExtractOptions = {}) {
  let normalized = String(value || "");
  const mediaMatches = Array.from(normalized.matchAll(/\[CQ:(image|video|forward|node|json|xml|share|music),([^\]]*)\]/g));
  for (const match of mediaMatches) {
    const raw = match[0];
    const type = String(match[1] || "").trim();
    const rawParams = String(match[2] || "");
    if (type === "json") {
      const rendered = renderShareCardBlock(parseJsonShareCard(rawParams.replace(/^data=/, "").trim()));
      normalized = normalized.replace(raw, rendered || "\n[分享卡片]\n");
      continue;
    }
    if (type === "xml") {
      const rendered = renderShareCardBlock(parseXmlShareCard(rawParams.replace(/^data=/, "").trim()));
      normalized = normalized.replace(raw, rendered || "\n[分享卡片]\n");
      continue;
    }
    const attrs = parseCqParams(rawParams);
    if (type === "image") {
      if (options.imageMode === "placeholder") {
        normalized = normalized.replace(raw, "\n[图片]\n");
        continue;
      }
      const url = await resolveQqImageUrl(attrs.url, attrs.file);
      normalized = normalized.replace(raw, url ? `\n![QQ图片](${url})\n` : "\n[图片]\n");
      continue;
    }
    if (type === "video") {
      if (options.videoMode === "placeholder") {
        normalized = normalized.replace(raw, "\n[视频]\n");
        continue;
      }
      const url = await resolveQqVideoUrl(
        attrs.url || attrs.src,
        attrs.file || attrs.file_id || attrs.path,
      );
      normalized = normalized.replace(raw, url ? `\n${renderQqVideoBlock(url)}\n` : "\n[视频]\n");
      continue;
    }
    if (type === "share") {
      normalized = normalized.replace(raw, renderShareCardBlock(parseShareSegmentCard(attrs)) || "\n[分享卡片]\n");
      continue;
    }
    if (type === "music") {
      normalized = normalized.replace(raw, renderShareCardBlock(parseMusicSegmentCard(attrs)) || "\n[分享卡片]\n");
      continue;
    }
    if (options.forwardMode === "placeholder") {
      normalized = normalized.replace(raw, "\n[合并转发]\n");
      continue;
    }
    const forwardId = attrs.id || attrs.resid || attrs.file || attrs.message_id || attrs.forward_id;
    const expanded = await renderNestedForwardContent(forwardId, {
      ...options,
      forwardDepth: (options.forwardDepth ?? 0) + 1,
    });
    normalized = normalized.replace(raw, expanded || "\n[合并转发]\n");
  }
  normalized = normalized
    .replace(/\[CQ:at,[^\]]+\]/g, "")
    .replace(/\[CQ:video[^\]]*\]/g, "\n[视频]\n")
    .replace(/\[CQ:record[^\]]*\]/g, "\n[语音]\n")
    .replace(/\[CQ:[^\]]+\]/g, "");
  return normalizeRenderedMessage(normalized);
}

function parseCqParams(raw: string) {
  const out: Record<string, string> = {};
  const parts = String(raw || "").split(",");
  for (const item of parts) {
    const [key, ...rest] = item.split("=");
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = rest.join("=").trim();
  }
  return out;
}

function parseShareSegmentCard(data: any): ParsedShareCard | null {
  return finalizeShareCard({
    source: undefined,
    title: data?.title,
    summary: data?.content,
    url: data?.url,
  });
}

function parseMusicSegmentCard(data: any): ParsedShareCard | null {
  const sourceMap: Record<string, string> = {
    qq: "QQ音乐",
    "163": "网易云音乐",
    kugou: "酷狗音乐",
    kuwo: "酷我音乐",
    migu: "咪咕音乐",
    xm: "虾米音乐",
    custom: "音乐分享",
  };
  return finalizeShareCard({
    source: sourceMap[String(data?.type || "").trim().toLowerCase()] || "音乐分享",
    title: data?.title,
    summary: data?.content || data?.singer,
    url: data?.url,
  });
}

function parseJsonShareCard(raw: unknown): ParsedShareCard | null {
  const root = normalizeJsonCardValue(raw);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const metaCandidates = Object.values((root as any).meta || {}).filter((item) => item && typeof item === "object");
  const candidates = [
    ...metaCandidates.map((item) => extractShareCardFromObject(item, root)),
    extractShareCardFromObject(root, root),
  ].filter(Boolean) as ParsedShareCard[];
  return finalizeShareCard(pickBestShareCard(candidates));
}

function parseXmlShareCard(raw: unknown): ParsedShareCard | null {
  const xml = decodeCqEntities(String(raw || "").trim());
  if (!xml) return null;
  return finalizeShareCard({
    source: extractXmlAttr(xml, "source", "name") || extractXmlAttr(xml, "msg", "brief"),
    title: extractXmlTagText(xml, "title"),
    summary: extractXmlTagText(xml, "summary"),
    url: extractXmlAttr(xml, "msg", "url") || extractXmlAttr(xml, "item", "url"),
  });
}

function pickBestShareCard(cards: ParsedShareCard[]) {
  let best: ParsedShareCard | null = null;
  let bestScore = -1;
  for (const card of cards) {
    const score = Number(Boolean(card.url)) * 3
      + Number(Boolean(card.title)) * 2
      + Number(Boolean(card.summary))
      + Number(Boolean(card.source)) * 0.5;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

function extractShareCardFromObject(candidate: any, fallbackRoot?: any): ParsedShareCard | null {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    source: firstNonEmpty([
      candidate.tag,
      candidate.source,
      candidate.sourceName,
      fallbackRoot?.prompt,
      fallbackRoot?.desc,
      fallbackRoot?.app,
    ]),
    title: firstNonEmpty([
      candidate.title,
      candidate.name,
      candidate.headline,
      fallbackRoot?.title,
    ]),
    summary: firstNonEmpty([
      candidate.desc,
      candidate.description,
      candidate.summary,
      candidate.content,
      candidate.text,
      candidate.brief,
      candidate.subtitle,
      fallbackRoot?.summary,
    ]),
    url: firstNonEmpty([
      candidate.jumpUrl,
      candidate.targetUrl,
      candidate.url,
      candidate.sourceUrl,
      candidate.qqdocurl,
      fallbackRoot?.url,
    ]),
  };
}

function normalizeJsonCardValue(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  const text = decodeCqEntities(String(raw || "").trim());
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function renderShareCardBlock(card: ParsedShareCard | null) {
  const normalized = finalizeShareCard(card);
  if (!normalized) return "\n[分享卡片]\n";
  const title = escapeShareCardHtml(normalized.title || normalized.source || extractUrlHostLabel(normalized.url) || "分享卡片");
  const summary = normalized.summary ? escapeShareCardHtml(normalized.summary) : "";
  const source = normalized.source ? escapeShareCardHtml(normalized.source) : "";
  const host = extractUrlHostLabel(normalized.url);
  const hostLabel = host && host !== normalized.source ? escapeShareCardHtml(host) : "";
  const hasLink = Boolean(normalized.url);
  const linkAttrs = hasLink
    ? ` href="${escapeShareCardHtml(normalized.url!)}" target="_blank" rel="noopener noreferrer nofollow"`
    : "";
  const metaBits = [
    source ? `<span class="qq-share-card__source">${source}</span>` : "",
    hostLabel ? `<span class="qq-share-card__host">${hostLabel}</span>` : "",
  ].filter(Boolean).join("");
  return [
    "",
    `<div class="qq-share-card${hasLink ? " qq-share-card--linked" : ""}">`,
    `<div class="qq-share-card__eyebrow">分享卡片</div>`,
    hasLink
      ? `<div class="qq-share-card__title"><a class="qq-share-card__title-link"${linkAttrs}>${title}</a></div>`
      : `<div class="qq-share-card__title">${title}</div>`,
    summary ? `<div class="qq-share-card__summary">${summary}</div>` : "",
    metaBits ? `<div class="qq-share-card__meta">${metaBits}</div>` : "",
    hasLink ? `<div class="qq-share-card__action"><a class="qq-share-card__action-link"${linkAttrs}>打开链接</a></div>` : "",
    `</div>`,
    "",
  ].filter(Boolean).join("\n");
}

function finalizeShareCard(card: ParsedShareCard | null | undefined): ParsedShareCard | null {
  if (!card) return null;
  const source = normalizeShareCardText(card.source, { allowGenericShareText: false, allowPackageName: false });
  const title = normalizeShareCardText(card.title, { allowGenericShareText: false });
  const summary = normalizeShareCardText(card.summary, { allowGenericShareText: false });
  const url = normalizeShareCardUrl(card.url);
  const resolvedSource = source && source !== title ? source : "";
  const resolvedSummary = summary && summary !== title ? summary : "";
  if (!resolvedSource && !title && !resolvedSummary && !url) return null;
  return {
    source: resolvedSource || undefined,
    title: title || undefined,
    summary: resolvedSummary || undefined,
    url: url || undefined,
  };
}

function normalizeShareCardText(
  value: unknown,
  options: { allowGenericShareText?: boolean; allowPackageName?: boolean } = {},
) {
  let text = decodeCqEntities(String(value || "").trim());
  if (!text) return "";
  text = text
    .replace(/\r/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\[(?:分享|链接分享)\]\s*/u, "")
    .trim();
  if (!text) return "";
  if (!options.allowPackageName && looksLikePackageName(text)) return "";
  if (!options.allowGenericShareText && /^(分享|链接分享|QQ分享)$/iu.test(text)) return "";
  return text.slice(0, 300);
}

function normalizeShareCardUrl(value: unknown) {
  const raw = decodeCqEntities(String(value || "").trim());
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 1000);
  return "";
}

function firstNonEmpty(values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function looksLikePackageName(value: string) {
  return /^[a-z0-9_.-]+\.[a-z0-9_.-]+$/i.test(value.trim());
}

function decodeCqEntities(value: string) {
  let out = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    out = out
      .replace(/&amp;/g, "&")
      .replace(/&#91;/g, "[")
      .replace(/&#93;/g, "]")
      .replace(/&#44;/g, ",")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return out;
}

function escapeShareCardHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractUrlHostLabel(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function renderQqVideoBlock(url: string) {
  const safeUrl = escapeShareCardHtml(String(url || "").trim());
  if (!safeUrl) return "[视频]";
  return [
    `<div class="qq-video-card">`,
    `<video class="qq-inline-video" controls preload="metadata" playsinline src="${safeUrl}">`,
    "你的浏览器暂不支持站内视频预览。",
    `</video>`,
    `<p><a class="qq-inline-video__link" href="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">打开视频</a></p>`,
    `</div>`,
  ].join("\n");
}

function extractXmlTagText(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? decodeCqEntities(match[1]).replace(/<!\\[CDATA\\[|\\]\\]>/g, "").trim() : "";
}

function extractXmlAttr(xml: string, tagName: string, attrName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=(["'])([\\s\\S]*?)\\1`, "i");
  const match = xml.match(pattern);
  return match ? decodeCqEntities(match[2]).trim() : "";
}

async function resolveQqImageUrl(urlLike: unknown, fileLike: unknown): Promise<string> {
  const key = `${String(urlLike || "").trim()}|${String(fileLike || "").trim()}`;
  if (qqImageUploadCache.has(key)) return qqImageUploadCache.get(key)!;
  const task = downloadQqImageToUpload(urlLike, fileLike).catch(() => "");
  qqImageUploadCache.set(key, task);
  const result = await task;
  if (!result) qqImageUploadCache.delete(key);
  return result;
}

async function resolveQqVideoUrl(urlLike: unknown, fileLike: unknown): Promise<string> {
  const key = `${String(urlLike || "").trim()}|${String(fileLike || "").trim()}`;
  if (qqVideoUploadCache.has(key)) return qqVideoUploadCache.get(key)!;
  const task = downloadQqVideoToUpload(urlLike, fileLike).catch(() => "");
  qqVideoUploadCache.set(key, task);
  const result = await task;
  if (!result) qqVideoUploadCache.delete(key);
  return result;
}

function normalizeRemoteMediaUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function normalizeLocalMediaPath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) {
    try {
      return decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, ""));
    } catch {
      return "";
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) return raw;
  return "";
}

async function downloadQqImageToUpload(urlLike: unknown, fileLike: unknown): Promise<string> {
  const file = String(fileLike || "").trim();
  const candidates: Array<{ kind: "remote" | "local"; value: string }> = [];
  const seen = new Set<string>();
  const pushCandidate = (kind: "remote" | "local", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, value: normalized });
  };
  const pushFromUnknown = (value: unknown) => {
    const remote = normalizeRemoteMediaUrl(value);
    if (remote) {
      pushCandidate("remote", remote);
      return;
    }
    const local = normalizeLocalMediaPath(value);
    if (local) pushCandidate("local", local);
  };

  pushFromUnknown(urlLike);
  pushFromUnknown(fileLike);
  if (file) {
    const payload = await callQqBotAction("get_image", { file }).catch(() => null);
    pushFromUnknown(payload?.data?.url);
    pushFromUnknown(payload?.data?.src);
    pushFromUnknown(payload?.data?.file);
    pushFromUnknown(payload?.data?.path);
  }

  for (const candidate of candidates) {
    const loaded = candidate.kind === "remote"
      ? await fetchRemoteImage(candidate.value)
      : await readLocalImage(candidate.value);
    if (!loaded) continue;
    return saveQqImageUpload(loaded.buffer, loaded.mime, loaded.nameHint);
  }
  return "";
}

async function downloadQqVideoToUpload(urlLike: unknown, fileLike: unknown): Promise<string> {
  const file = String(fileLike || "").trim();
  const candidates: Array<{ kind: "remote" | "local"; value: string }> = [];
  const seen = new Set<string>();
  const pushCandidate = (kind: "remote" | "local", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, value: normalized });
  };
  const pushFromUnknown = (value: unknown) => {
    const remote = normalizeRemoteMediaUrl(value);
    if (remote) {
      pushCandidate("remote", remote);
      return;
    }
    const local = normalizeLocalMediaPath(value);
    if (local) pushCandidate("local", local);
  };

  pushFromUnknown(urlLike);
  pushFromUnknown(fileLike);
  if (file) {
    const payload = await callQqBotAction("get_file", { file, file_id: file }).catch(() => null);
    pushFromUnknown(payload?.data?.url);
    pushFromUnknown(payload?.data?.src);
    pushFromUnknown(payload?.data?.file);
    pushFromUnknown(payload?.data?.path);
    pushFromUnknown(payload?.data?.local);
    const base64Loaded = decodeBase64MediaPayload(payload?.data?.base64, payload?.data?.mime_type, file);
    if (base64Loaded) {
      return saveQqVideoUpload(base64Loaded.buffer, base64Loaded.mime, base64Loaded.nameHint);
    }
  }

  for (const candidate of candidates) {
    const loaded = candidate.kind === "remote"
      ? await fetchRemoteVideo(candidate.value)
      : await readLocalVideo(candidate.value);
    if (!loaded) continue;
    return saveQqVideoUpload(loaded.buffer, loaded.mime, loaded.nameHint);
  }
  return "";
}

async function fetchRemoteImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > QQBOT_IMAGE_MAX_BYTES) return null;
  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  if (!arrayBuffer) return null;
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > QQBOT_IMAGE_MAX_BYTES) return null;
  const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { buffer, mime, nameHint: url };
}

async function fetchRemoteVideo(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!response?.ok) return null;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > QQBOT_VIDEO_MAX_BYTES) return null;
  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  if (!arrayBuffer) return null;
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > QQBOT_VIDEO_MAX_BYTES) return null;
  const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { buffer, mime, nameHint: url };
}

async function readLocalImage(filePath: string) {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer?.length || buffer.length > QQBOT_IMAGE_MAX_BYTES) return null;
  return { buffer, mime: "", nameHint: filePath };
}

async function readLocalVideo(filePath: string) {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer?.length || buffer.length > QQBOT_VIDEO_MAX_BYTES) return null;
  return { buffer, mime: "", nameHint: filePath };
}

async function saveQqImageUpload(buffer: Buffer, mime: string, nameHint?: string) {
  const ext = detectImageExtension(buffer, mime, nameHint);
  if (!ext) return "";
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const relativeDir = path.join("forum", month);
  const filename = `qqbot-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const saved = await saveMediaAsset({
    relativePath: path.posix.join(relativeDir.replace(/\\/g, "/"), filename),
    buffer,
    contentType: mime || undefined,
  });
  return saved.url;
}

async function saveQqVideoUpload(buffer: Buffer, mime: string, nameHint?: string) {
  const ext = detectVideoExtension(buffer, mime, nameHint);
  if (!ext) return "";
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const relativeDir = path.join("forum", month);
  const filename = `qqbot-video-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const saved = await saveMediaAsset({
    relativePath: path.posix.join(relativeDir.replace(/\\/g, "/"), filename),
    buffer,
    contentType: mime || resolveVideoMimeTypeByExt(ext),
  });
  return saved.url;
}

function detectImageExtension(buffer: Buffer, mime: string, nameHint?: string) {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")) return "jpg";
  if (normalizedMime.includes("png")) return "png";
  if (normalizedMime.includes("webp")) return "webp";
  if (normalizedMime.includes("gif")) return "gif";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  const ext = path.extname(String(nameHint || "")).replace(/^\./, "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "";
}

function detectVideoExtension(buffer: Buffer, mime: string, nameHint?: string) {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.includes("mp4")) return "mp4";
  if (normalizedMime.includes("webm")) return "webm";
  if (normalizedMime.includes("ogg")) return "ogv";
  if (normalizedMime.includes("quicktime")) return "mov";
  if (normalizedMime.includes("x-m4v")) return "m4v";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return normalizeVideoHintExtension(nameHint) || "mp4";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const hinted = normalizeVideoHintExtension(nameHint);
    return hinted === "mkv" ? "mkv" : "webm";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return "ogv";
  return normalizeVideoHintExtension(nameHint);
}

function normalizeVideoHintExtension(nameHint?: string) {
  const ext = path.extname(String(nameHint || "")).replace(/^\./, "").toLowerCase();
  if (["mp4", "webm", "ogv", "ogg", "mov", "m4v", "mkv"].includes(ext)) {
    return ext === "ogg" ? "ogv" : ext;
  }
  return "";
}

function resolveVideoMimeTypeByExt(ext: string) {
  const mimeByExt: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
  };
  return mimeByExt[String(ext || "").toLowerCase()] || "application/octet-stream";
}

function decodeBase64MediaPayload(base64Like: unknown, mimeLike: unknown, nameHint?: string) {
  const raw = String(base64Like || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/^base64:\/\//i, "").replace(/\s+/g, "");
  if (!normalized) return null;
  try {
    const buffer = Buffer.from(normalized, "base64");
    if (!buffer.length) return null;
    return {
      buffer,
      mime: String(mimeLike || "").trim().toLowerCase(),
      nameHint: nameHint || "",
    };
  } catch {
    return null;
  }
}

async function renderNestedForwardContent(forwardId: unknown, options: QqMessageExtractOptions = {}) {
  const normalizedId = String(forwardId || "").trim();
  const forwardDepth = options.forwardDepth ?? 0;
  if (!normalizedId) return "\n[合并转发]\n";
  if (forwardDepth > MAX_FORWARD_DEPTH) return "\n[合并转发层级过深]\n";
  const payload = await callQqBotAction("get_forward_msg", { id: normalizedId }).catch(() => null);
  const parsed = await parseForwardMessages(payload?.data?.messages, normalizedId, options);
  queueQqBotForwardDebug("forward.api.get_forward_msg", {
    forwardId: normalizedId,
    forwardDepth,
    payload: payload?.data?.messages ?? null,
    parsed: parsed
      ? { summary: parsed.summary, preview: debugMessagePreview(parsed.content) }
      : null,
  });
  if (!parsed?.content) return "\n[合并转发]\n";
  return `\n${parsed.content}\n`;
}

async function resolveReferencedNodeContent(messageId: unknown, options: QqMessageExtractOptions = {}) {
  const normalizedId = String(messageId || "").trim();
  const forwardDepth = options.forwardDepth ?? 0;
  if (!normalizedId) return "\n[合并转发]\n";
  const referenced = await callQqBotAction("get_msg", { message_id: Number(normalizedId) || normalizedId }).catch(() => null);
  const message = referenced?.data?.message ?? referenced?.data?.content;
  const forwardId = extractForwardNodeId(message);
  if (forwardId) {
    queueQqBotForwardDebug("forward.node.refers-forward", {
      messageId: normalizedId,
      forwardDepth,
      forwardId,
      message,
    });
    return renderNestedForwardContent(forwardId, {
      ...options,
      forwardDepth: forwardDepth + 1,
    });
  }
  const text = await extractMessageText(message, options).catch(() => "");
  queueQqBotForwardDebug("forward.node.resolve", {
    messageId: normalizedId,
    forwardDepth,
    preview: debugMessagePreview(text),
    message,
  });
  return text.trim() ? `\n${quoteMarkdownBlock(text)}\n` : "\n[合并转发]\n";
}

function mergeForwardEntries(entries: ParsedForwardEntry[]) {
  const merged: ParsedForwardEntry[] = [];
  for (const entry of entries) {
    const normalizedText = normalizeRenderedMessage(entry.text);
    if (!normalizedText) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.nickname === entry.nickname) {
      previous.text = normalizeRenderedMessage(`${previous.text}\n\n${normalizedText}`);
      previous.messageCount += entry.messageCount;
      previous.imageCount += entry.imageCount;
      continue;
    }
    merged.push({
      nickname: entry.nickname,
      text: normalizedText,
      messageCount: entry.messageCount,
      imageCount: entry.imageCount,
    });
  }
  return merged;
}

function countForwardImageTokens(text: string) {
  return (String(text || "").match(/!\[[^\]]*\]\([^)]+\)|\[图片\]/g) || []).length;
}

function buildForwardPayloadSummary(
  entries: ParsedForwardEntry[],
  stats: { messageCount: number; blockCount: number; participantCount: number; imageCount: number },
) {
  const statBits = [
    `${stats.messageCount} 条消息`,
    `${stats.blockCount} 段整理稿`,
    `${stats.participantCount} 人参与`,
  ];
  if (stats.imageCount > 0) statBits.push(`${stats.imageCount} 张图`);
  const previewBits = entries
    .slice(0, 3)
    .map((entry) => `${entry.nickname}：${forwardSummaryPreview(entry.text)}`);
  return [statBits.join("，"), previewBits.join(" / ")].filter(Boolean).join(" · ").slice(0, 160);
}

function buildReplyMessageSummary(content: string, imageCount: number) {
  const statBits = ["1 条消息"];
  if (imageCount > 0) statBits.push(`${imageCount} 张图`);
  return [statBits.join("，"), forwardSummaryPreview(content)].filter(Boolean).join(" · ").slice(0, 160);
}

function renderForwardPayloadContent(
  entries: ParsedForwardEntry[],
  stats: {
    messageCount: number;
    blockCount: number;
    participantCount: number;
    imageCount: number;
    participantNames: string[];
  },
  forwardDepth: number,
) {
  const flattenedNestedCard = unwrapSingleNestedForwardCard(entries, forwardDepth);
  if (flattenedNestedCard) {
    return normalizeRenderedMessage(["", flattenedNestedCard, ""].join("\n"));
  }
  const entryHtml = entries.map((entry) => renderForwardEntryBlock(entry)).filter(Boolean).join("");
  const badgeText = forwardDepth > 0 ? "转发内容" : "合并转发";
  return normalizeRenderedMessage([
    "",
    `<div class="qq-forward-card" data-forward-depth="${Math.min(forwardDepth, 4)}">`,
    `  <div class="qq-forward-card__head">`,
    `    <span class="qq-forward-card__badge">${badgeText}</span>`,
    `  </div>`,
    `  <div class="qq-forward-card__body">`,
    entryHtml,
    `  </div>`,
    `</div>`,
    "",
  ].filter(Boolean).join("\n"));
}

function unwrapSingleNestedForwardCard(entries: ParsedForwardEntry[], forwardDepth: number) {
  if (entries.length !== 1) return "";
  const onlyContent = normalizeRenderedMessage(entries[0]?.text || "");
  if (!onlyContent) return "";

  const directCardMatch = onlyContent.match(/^(<div class="qq-forward-card"[\s\S]*<\/div>)$/);
  const nestedCardMatch = onlyContent.match(
    /^<div class="qq-forward-nest">\s*(?:<div class="qq-forward-nest__label">转发内容<\/div>\s*)?(<div class="qq-forward-card"[\s\S]*<\/div>)\s*<\/div>$/,
  );
  const card = nestedCardMatch?.[1] || directCardMatch?.[1] || "";
  if (!card) return "";
  if (forwardDepth > 0) return card;
  return promoteNestedForwardCardToRoot(card);
}

function promoteNestedForwardCardToRoot(content: string) {
  let promoted = String(content || "");
  promoted = promoted.replace(/data-forward-depth="([1-4])"/, 'data-forward-depth="0"');
  promoted = promoted.replace(/<span class="qq-forward-card__badge">转发内容<\/span>/, '<span class="qq-forward-card__badge">合并转发</span>');
  return promoted;
}

function renderForwardEntryBlock(entry: ParsedForwardEntry) {
  const content = normalizeRenderedMessage(entry.text);
  if (!content) return "";
  const nickname = String(entry.nickname || "").trim();
  return [
    `<article class="qq-forward-entry">`,
    nickname ? `  <div class="qq-forward-entry__head"><span class="qq-forward-entry__name">${escapeShareCardHtml(nickname)}</span></div>` : "",
    `  <div class="qq-forward-entry__content">`,
    renderForwardEntryContent(content),
    `  </div>`,
    `</article>`,
  ].join("\n");
}

function renderForwardEntryContent(content: string) {
  const blocks = normalizeRenderedMessage(content).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const html: string[] = [];
  let pendingImages: Array<{ url: string; alt: string }> = [];

  const flushImages = () => {
    if (!pendingImages.length) return;
    if (pendingImages.length === 1) {
      const image = pendingImages[0];
      html.push(renderForwardImageBlock(image));
    } else {
      html.push(renderForwardAlbumBlock(pendingImages));
    }
    pendingImages = [];
  };

  for (const block of blocks) {
    const image = parseStandaloneMarkdownImage(block);
    if (image) {
      pendingImages.push(image);
      continue;
    }
    flushImages();
    if (isTrustedForwardHtmlBlock(block)) {
      if (String(block).trim().startsWith("<div class=\"qq-forward-card")) {
        html.push([
          `<div class="qq-forward-nest">`,
          block,
          `</div>`,
        ].join("\n"));
      } else {
        html.push(block);
      }
      continue;
    }
    if (block === "[图片]") {
      html.push(`<p class="qq-forward-placeholder">图片</p>`);
      continue;
    }
    html.push(`<p>${escapeShareCardHtml(block).replace(/\n/g, "<br>")}</p>`);
  }
  flushImages();
  return html.join("\n");
}

function parseStandaloneMarkdownImage(block: string) {
  const match = String(block || "").trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  if (!match) return null;
  return {
    alt: String(match[1] || "QQ图片").trim() || "QQ图片",
    url: String(match[2] || "").trim(),
  };
}

function renderForwardImageBlock(image: { url: string; alt: string }) {
  return `<p><img src="${escapeShareCardHtml(image.url)}" alt="${escapeShareCardHtml(image.alt)}" data-size="small" /></p>`;
}

function renderForwardAlbumBlock(images: Array<{ url: string; alt: string }>) {
  const items = images
    .map((image) => `<img src="${escapeShareCardHtml(image.url)}" alt="${escapeShareCardHtml(image.alt)}" data-size="album" />`)
    .join("");
  return `<p class="qq-forward-album" data-image-album="1">${items}</p>`;
}

function isTrustedForwardHtmlBlock(block: string) {
  const normalized = String(block || "").trim();
  return normalized.startsWith("<div class=\"qq-share-card")
    || normalized.startsWith("<div class=\"qq-forward-card")
    || normalized.startsWith("<p class=\"qq-forward-album")
    || normalized.startsWith("<p><img ");
}

function forwardSummaryPreview(text: string) {
  return normalizeRenderedMessage(
    text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "[图片]")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*> ?/gm, "")
      .replace(/^\s*-{3,}\s*$/gm, "")
      .replace(/[*_]+/g, ""),
  ).replace(/\n+/g, " ").slice(0, 40) || "内容";
}

function quoteMarkdownBlock(content: string) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function normalizeRenderedMessage(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendSourceFooter(content: string, context: { groupId?: string; event: OneBotEvent }) {
  const source = context.groupId ? `QQ群 ${context.groupId}` : "QQ 私聊";
  return `${content}\n\n> 转自 QQBot（${source}）。`;
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

async function renderHelp(defaultBoardSlug: string) {
  const defaultBoardName = await resolveBoardDisplayName(defaultBoardSlug);
  return [
    "我能帮你做这些事：",
    "绑定 绑定码：绑定站内账号",
    "状态：查看绑定状态和投稿开关",
    "板块：查看可投稿板块",
    "我的投稿：查看最近投稿记录",
    "解绑：解除当前 QQ 绑定",
    "投稿：开始分步投稿",
    "结束：提交当前投稿",
    "取消：取消当前投稿",
    "",
    "你也可以直接说“我想投稿”，我会一步步带你完成。",
    "",
    `默认投稿区：${defaultBoardName}`,
  ].join("\n");
}

async function renderGreetingReply(defaultBoardSlug: string) {
  const defaultBoardName = await resolveBoardDisplayName(defaultBoardSlug);
  return [
    "我在。",
    "如果你想投稿，可以直接说“我想投稿”，或者发送“投稿”开始分步投稿。",
    `默认投稿区是 ${defaultBoardName}。`,
    "常用命令：帮助 / 状态 / 板块 / 我的投稿",
  ].join("\n");
}

function renderPrivateFallbackReply() {
  return [
    "我收到啦。",
    "你可以直接告诉我你想做什么，比如：投稿、查状态、看板块、看最近投稿。",
    "如果不确定怎么说，发“帮助”就行。",
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
  return isExplicitBotMention(context.event, context.messageText);
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
  const defaultBoardName = await resolveBoardDisplayName(defaultBoardSlug);
  if (!binding?.enabled) {
    return [
      "当前 QQ 尚未绑定站内账号。",
      "请先在站内生成绑定码，再私聊我发送：绑定 绑定码",
      `默认投稿区：${defaultBoardName}`,
      `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
      `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
    ].join("\n");
  }
  return [
    `已绑定：${binding.user.nickname}（${binding.user.username}）`,
    `默认投稿区：${defaultBoardName}`,
    `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
    `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
    "命令：板块 / 我的投稿 / 解绑",
  ].join("\n");
}

async function renderBoardList(defaultBoardSlug: string, groupId?: string) {
  const group = groupId ? await prisma.qqBotGroup.findUnique({ where: { groupId } }) : null;
  const currentDefaultSlug = group?.defaultBoardSlug || defaultBoardSlug || "general";
  const boards = await getAvailableBoardOptions();
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
  lines.push("直接说“我想投稿”，我会一步步带你填写。");
  lines.push("如果你已经想好内容，也可以直接发“投稿 标题”，下一行开始写正文。");
  return lines.join("\n");
}

async function getAvailableBoardOptions() {
  return prisma.board.findMany({
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
}

function buildTopicLink(topicId: number) {
  const origin = getSiteOrigin();
  if (!origin) return "";
  return `${origin}/forum/topic/${topicId}`;
}

function buildReplyLink(topicId: number, replyId?: number | null) {
  const topicLink = buildTopicLink(topicId);
  if (!topicLink) return "";
  return replyId && Number.isFinite(replyId) && replyId > 0
    ? `${topicLink}#reply-${replyId}`
    : topicLink;
}

function isNotificationVisibleToQq(notification: { targetClient?: string | null }) {
  return !notification.targetClient || notification.targetClient === "all";
}

function shouldDeliverQqNotificationToUser(
  notification: { category?: string | null; targetClient?: string | null },
  messageSetting?: {
    subscribeReply?: boolean;
    subscribeLike?: boolean;
    subscribeSchool?: boolean;
    subscribeSystem?: boolean;
  } | null,
) {
  if (!isNotificationVisibleToQq(notification)) return false;
  if (notification.category === "reply") return messageSetting?.subscribeReply !== false;
  if (notification.category === "like") return messageSetting?.subscribeLike !== false;
  if (notification.category === "school-feed") return messageSetting?.subscribeSchool !== false;
  if (notification.category === "system") return messageSetting?.subscribeSystem !== false;
  return true;
}

function shouldDeliverQqNotificationToGroup(
  group: QqBotGroupView,
  notification: { userId?: number | null; category?: string | null; targetClient?: string | null; payload?: unknown },
  recipientRole?: string | null,
) {
  if (!group.notificationEnabled) return false;
  if (!notification.category || !group.notifyCategories.includes(notification.category as QqBotGroupNotifyCategory)) return false;
  if (notification.userId == null) {
    return group.notifyAudiences.includes("public") && isNotificationVisibleToQq(notification);
  }
  if (!group.notifyAudiences.includes("staff")) return false;
  if (recipientRole !== "admin" && recipientRole !== "mod") return false;
  return isStaffGroupActionableNotification(notification);
}

function buildGroupNotificationDeliveryKey(notification: {
  id?: number | null;
  userId?: number | null;
  category?: string | null;
  title?: string | null;
  content?: string | null;
  payload?: unknown;
  link?: string | null;
  source?: string | null;
}) {
  if (notification.userId == null) return `global:${notification.id || 0}`;
  const payload = parseNotificationPayload(notification.payload);
  const topicId = toPositiveInt(payload.topicId);
  const replyId = toPositiveInt(payload.replyId);
  const type = String(payload.type || "").trim();
  return [
    "staff",
    type || notification.category || "",
    topicId || 0,
    replyId || 0,
  ].join(":");
}

function isStaffGroupActionableNotification(notification: { category?: string | null; payload?: unknown }) {
  if (notification.category !== "system") return false;
  const payload = parseNotificationPayload(notification.payload);
  const type = String(payload.type || "").trim();
  return STAFF_GROUP_ACTIONABLE_NOTIFICATION_TYPES.has(type);
}

function parseNotificationPayload(payload: unknown): Record<string, any> {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  if (typeof payload === "object") return payload as Record<string, any>;
  return {};
}

function toPositiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveNotificationLink(notification: { link?: string | null; payload?: unknown }) {
  const payload = parseNotificationPayload(notification.payload);
  const topicId = toPositiveInt(payload.topicId);
  const replyId = toPositiveInt(payload.replyId);
  const rawLink = String(notification.link || "").trim();
  if (rawLink) {
    if (/^https?:\/\//i.test(rawLink)) return rawLink;
    if (rawLink.startsWith("/")) {
      const suffix = !rawLink.includes("#") && replyId && /^\/forum\/topic\/\d+$/i.test(rawLink)
        ? `#reply-${replyId}`
        : "";
      const origin = getSiteOrigin();
      return origin ? `${origin}${rawLink}${suffix}` : `${rawLink}${suffix}`;
    }
    return rawLink;
  }
  if (topicId) {
    const replyLink = buildReplyLink(topicId, replyId);
    if (replyLink) return replyLink;
  }
  return "";
}

async function resolveBoardDisplayName(slug?: string | null) {
  const normalized = String(slug || "").trim();
  if (!normalized) return "默认投稿区";
  const board = await prisma.board.findUnique({ where: { slug: normalized }, select: { name: true } }).catch(() => null);
  return board?.name || normalized;
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
      hidden: false,
      board: { type: { in: ["announce", "normal", "question", "market", "coursereview"] } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      board: { select: { name: true } },
    },
  });
  if (!topics.length) return "最近还没有可见的投稿记录。";
  return [
    "最近投稿：",
    ...topics.map((topic) => {
      const topicLink = buildTopicLink(topic.id) || `/forum/topic/${topic.id}`;
      return `- ${topic.title}｜${topic.board.name}\n  ${topicLink}`;
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
  const boardList = await getAvailableBoardOptions();
  const defaultBoardName = await resolveBoardDisplayName(context.config.defaultBoardSlug);
  const content = await requestAiJson([
    {
      role: "system",
      content: [
        "你是校园论坛 QQBot 的意图识别助手。",
        "你只能输出 JSON。",
        "你只能在这些能力范围内判断意图：帮助、绑定码绑定、查看状态、查看板块、查看最近投稿、开始投稿、普通闲聊。",
        "如果用户提到绑定，但没有提供绑定码，不要猜测学号、工号、密码等内容，也不要要求用户输入这些信息。",
        "不要编造不存在的业务规则或命令。",
        "请判断用户这句话更像是在：求帮助、查状态、查板块、查最近投稿、开始投稿、普通闲聊，或者需要你直接回复一句简短提示。",
        "如果用户明显表达了想发帖/投稿/搬运内容，也可以抽取标题、正文、板块 slug。",
        "返回给程序时可以使用板块 slug，但不要把 slug 当成给用户看的文案。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        '输出格式：{"intent":"chat|help|status|boards|recent-posts|start-post|reply","title":"","content":"","boardSlug":"","message":""}',
        `默认投稿区：${defaultBoardName}`,
        `可用投稿区（中文名=>slug）：${boardList.map((board) => `${board.name}=>${board.slug}`).join("；")}`,
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
    return { intent: "reply", message: String(parsed.message || "如果你想投稿，可以直接说“我想投稿”，我会一步步带你完成。").slice(0, 300) } as QqBotAiIntent;
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
  const boardList = (await getAvailableBoardOptions()).slice(0, 12);
  const defaultBoardName = await resolveBoardDisplayName(context.config.defaultBoardSlug);
  const content = await requestAiJson([
    {
      role: "system",
      content: [
        "你是校园论坛 QQBot 助手。",
        "你只能围绕这些功能回复：帮助、绑定码绑定、查看状态、查看板块、查看最近投稿、投稿助手。",
        "不要要求用户输入学号、工号、密码，也不要编造任何不存在的绑定流程。",
        "请根据用户消息给出一段简短、明确、不会引起歧义的回复。",
        "如果用户像是在投稿、求助发帖、发树洞、发二手或课程评价，请尽量同时整理出建议板块 slug、建议标题、建议正文。",
        "给用户看的回复里优先使用中文板块名，不要直接展示 slug。",
        "只返回 JSON。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        '输出格式：{"reply":"","suggestedBoardSlug":"","suggestedTitle":"","suggestedContent":"","confidence":"low|medium|high"}',
        `默认投稿区：${defaultBoardName}`,
        `可用投稿区（中文名=>slug）：${boardList.map((board) => `${board.name}=>${board.slug}`).join("；")}`,
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
  return await renderConversationPrompt(next, parsed.reply);
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

function normalizeAllowedStringArray(
  input: readonly string[] | null | undefined,
  fallback: readonly string[],
  allowed: readonly string[],
) {
  const allowedSet = new Set(allowed);
  const values = Array.isArray(input) ? input : fallback;
  const normalized = Array.from(new Set(values.map((item) => String(item || "").trim()).filter((item) => allowedSet.has(item))));
  return normalized.length ? normalized : [...fallback];
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
