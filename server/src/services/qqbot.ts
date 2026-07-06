import crypto from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { runWithDistributedLock } from "./cache";
import { ensureForumAccessEnabled } from "./forumAccess";
import { ensureForumImageAssetsForContent } from "./imageModeration";
import { getSiteOrigin, isBoardTypeEnabled, isFeatureOn, featureForBoardType, featureClosedMessage } from "./siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import { ensureUserCanSpeak } from "./userModeration";
import { ensureForumVideoAssetsForContent } from "./videoModeration";
import {
  callQqBotAction,
  configureQqBotConnection,
  connectQqBotWebSocket,
  getQqBotConnectionError,
  getQqBotConnectionStatus,
  isWebSocketUrl,
  resetQqBotWebSocket,
  sendQqMessageByWebSocket,
} from "./qqbot/connection";
import {
  extractConversationBoardSwitchTarget,
  extractConversationTitleCommandValue,
  extractFinishCommandPayload,
  isBoardListCommand,
  isCancelMessage,
  isCommandMessage,
  isConfirmPublishMessage,
  isConversationPreviewCommand,
  isConversationRetitleCommand,
  isConversationStatusCommand,
  isGreetingMessage,
  isHelpCommand,
  isLikelyConversationCommandMessage,
  isMyPostsCommand,
  parseQqGroupAdminCommand,
  isPrivatePlainCommand,
  isStatusCommand,
  isUnbindCommand,
  normalizeInboundCommandText,
  normalizeShortReplyText,
} from "./qqbot/commands";
import {
  buildGroupNotificationDeliveryKey,
  isNotificationVisibleToQq,
  parseNotificationPayload,
  shouldDeliverQqNotificationToGroup,
  shouldDeliverQqNotificationToUser,
  toPositiveInt,
} from "./qqbot/notifications";
import {
  createConversationRenderer,
  getConversationDraftBlocks,
  mergeConversationContent,
  normalizeConversationDraftBlocks,
  parseConversationMetadata,
  type QqConversationScene,
  type QqConversationStep,
} from "./qqbot/conversationRendering";
import { buildQqBotDebugExport } from "./qqbot/forwardDebug";
import {
  appendSourceFooter,
  extractForwardNodeId,
  extractForwardPayload,
  extractMessageText,
  extractReplyMessageId,
  normalizeRenderedMessage,
  QQBOT_POST_SUBMIT_PENDING_MESSAGE,
  shouldUseLightForwardExtraction,
  splitQqMessageForDelivery,
  type ForwardSource,
  type ParsedForwardPayload,
  type QqMessageExtractOptions,
} from "./qqbot/messageRendering";
import {
  ensureUserCanSubmitTopic,
  generateTopicAiTags,
  notifyTopicAiBlocked,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
  syncTopicAiTags,
} from "./topicAiReview";
import { reviewQqGroupMessageForAd } from "./qqbotGroupAdReview";

export { buildQqBotDebugExport };
export { connectQqBotWebSocket };

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
  superAdminQqIds: string[];
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
  memberWelcomeEnabled: boolean;
  memberWelcomeMessage: string;
  adFilterEnabled: boolean;
  joinReviewEnabled: boolean;
  allowMute: boolean;
  allowKick: boolean;
  allowKickAndBlock: boolean;
  commandUserQqIds: string[];
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
  sender?: { nickname?: string; card?: string; user_id?: number | string; role?: string };
};

type QqBotDoubtFriendRequest = {
  user_id?: number | string;
  nickname?: string;
  age?: number;
  sex?: string;
  reason?: string;
  flag?: string | number;
};

type QqMessageTarget = {
  qqId?: string;
  groupId?: string;
  tempGroupId?: string;
};

const qqBotCooldowns = new Map<string, { cancelledAt?: number }>();

const CONFIG_ID = 1;
const DEFAULT_NOTIFY_CATEGORIES = ["reply", "mention", "like", "system", "service-tool", "school-feed"];
const LEGACY_PERSONAL_NOTIFY_CORE = ["reply", "mention", "like", "system"];
const REQUIRED_PERSONAL_NOTIFY_CATEGORIES = ["service-tool", "school-feed"];
const GROUP_NOTIFY_CATEGORY_OPTIONS = ["system", "school-feed"] as const;
const GROUP_NOTIFY_AUDIENCE_OPTIONS = ["public", "staff"] as const;
const DEFAULT_GROUP_NOTIFY_CATEGORIES = ["system", "school-feed"];
const DEFAULT_GROUP_NOTIFY_AUDIENCES = ["public"];
const DEFAULT_MEMBER_WELCOME_MESSAGE = "欢迎加入本群，请先查看群公告了解群内规则和使用说明。\n\n如果想把课表添加到手机桌面，可以先打开站内课表页，再按页面提示完成添加。\n\n也欢迎前往个人中心绑定本 QQBot，绑定后可在 QQ 同步接收站内通知。建议顺手把本 QQBot 添加为好友，消息接收和后续操作体验会更顺畅。后续还会陆续接入更多实用功能，敬请期待。";
let pollerStarted = false;

const {
  renderConversationCommandHelp,
  renderConversationDraftPreview,
  renderConversationPrompt,
  renderConversationStageNudge,
  renderConversationStatus,
} = createConversationRenderer({ resolveBoardDisplayName });

configureQqBotConnection({
  getConfig: getQqBotConfigRaw,
  handleWebhook: handleQqBotWebhook,
  logMessage: logQqBotMessage,
});

export async function getQqBotConfigRaw() {
  const config = await prisma.qqBotConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID },
    update: {},
  });
  const backfilledCategories = backfillLegacyPersonalNotifyCategories(config.notifyCategories);
  if (!backfilledCategories) return config;
  return prisma.qqBotConfig.update({
    where: { id: config.id },
    data: { notifyCategories: JSON.stringify(backfilledCategories) },
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
    notifyCategories: parseQqBotNotifyCategories(config.notifyCategories),
    superAdminQqIds: normalizeQqBotQqIdList(parseStringArray(config.superAdminQqIds || "", [])),
    webhookPath: "/api/qqbot/webhook",
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function parseQqBotNotifyCategories(value: string | null | undefined) {
  return normalizePersonalNotifyCategories(parseStringArray(value || "", DEFAULT_NOTIFY_CATEGORIES));
}

function normalizePersonalNotifyCategories(input?: readonly string[] | null) {
  return normalizeAllowedStringArray(input, DEFAULT_NOTIFY_CATEGORIES, DEFAULT_NOTIFY_CATEGORIES);
}

function backfillLegacyPersonalNotifyCategories(value: string | null | undefined) {
  const parsed = normalizeAllowedStringArray(parseStringArray(value || "", []), [], DEFAULT_NOTIFY_CATEGORIES);
  const missing = REQUIRED_PERSONAL_NOTIFY_CATEGORIES.filter((category) => !parsed.includes(category));
  if (!missing.length) return null;
  const looksLikeLegacyDefault = LEGACY_PERSONAL_NOTIFY_CORE.every((category) => parsed.includes(category))
    && parsed.every((category) => DEFAULT_NOTIFY_CATEGORIES.includes(category));
  if (!looksLikeLegacyDefault) return null;
  return Array.from(new Set([...parsed, ...missing]));
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
  memberWelcomeEnabled: boolean;
  memberWelcomeMessage: string | null;
  adFilterEnabled: boolean;
  joinReviewEnabled: boolean;
  allowMute: boolean;
  allowKick: boolean;
  allowKickAndBlock: boolean;
  commandUserQqIds?: string | null;
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
    memberWelcomeEnabled: group.memberWelcomeEnabled,
    memberWelcomeMessage: group.memberWelcomeMessage || DEFAULT_MEMBER_WELCOME_MESSAGE,
    adFilterEnabled: group.adFilterEnabled,
    joinReviewEnabled: group.joinReviewEnabled,
    allowMute: group.allowMute,
    allowKick: group.allowKick,
    allowKickAndBlock: group.allowKickAndBlock,
    commandUserQqIds: normalizeQqBotQqIdList(parseStringArray(group.commandUserQqIds || "", [])),
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
  superAdminQqIds?: string[];
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
    data.notifyCategories = JSON.stringify(normalizePersonalNotifyCategories(input.notifyCategories));
  }
  if (input.superAdminQqIds !== undefined) {
    data.superAdminQqIds = JSON.stringify(normalizeQqBotQqIdList(input.superAdminQqIds));
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
  const commandText = normalizeInboundCommandText(messageText);
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
  const canHandlePlainCommand = event.message_type !== "group" || isExplicitBotMention(event, messageText);
  const groupAdminCommand = event.message_type === "group" && groupId && canHandlePlainCommand
    ? parseQqGroupAdminCommand(commandText)
    : null;

  if (groupAdminCommand && groupId) {
    const handled = await handleQqBotGroupAdminCommand({
      config,
      event,
      qqId,
      groupId,
      messageText,
      commandText,
      command: groupAdminCommand,
    });
    if (handled) return { ok: true };
  }

  if (canHandlePlainCommand && isHelpCommand(commandText)) {
    if (event.message_type === "group" && groupId) {
      await logHandledInboundMessage(context, "message", "assistant:group-help");
      await replyToEvent(context, await renderGroupHelp(config, groupId, event));
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:help");
    await replyToEvent(context, await renderHelp(config.defaultBoardSlug));
    return { ok: true };
  }
  if (canHandlePlainCommand && isBoardListCommand(commandText)) {
    await logHandledInboundMessage(context, "message", "assistant:boards");
    await replyToEvent(context, await renderBoardList(config.defaultBoardSlug, groupId));
    return { ok: true };
  }
  if (canHandlePlainCommand && isMyPostsCommand(commandText)) {
    if (event.message_type === "group") {
      await replyToEvent(context, "这个功能只支持私聊使用。请私聊我后发送“我的投稿”。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:recent-posts");
    await replyToEvent(context, await renderRecentQqTopics(qqId));
    return { ok: true };
  }
  if (canHandlePlainCommand && isStatusCommand(commandText)) {
    if (event.message_type === "group") {
      await logHandledInboundMessage(context, "message", "assistant:group-status");
      await replyToEvent(context, await renderGroupStatus(config, groupId, event));
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:status");
    await replyToEvent(context, await renderBindingStatus(qqId, config, groupId));
    return { ok: true };
  }
  if (canHandlePlainCommand && isUnbindCommand(commandText)) {
    if (event.message_type === "group") {
      await replyToEvent(context, "这个功能只支持私聊使用。请私聊我后发送“解绑”。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:unbind");
    await replyToEvent(context, await unbindQqAccount(qqId));
    return { ok: true };
  }
  const bindMatch = canHandlePlainCommand
    ? commandText.trim().match(/^(?:[/／])?绑定\s+([A-Z0-9]{6,16})$/i)
    : null;
  if (bindMatch) {
    if (event.message_type === "group") {
      await replyToEvent(context, "绑定码只支持私聊发送。请私聊我后再发送“绑定 绑定码”。");
      return { ok: true };
    }
    const result = await bindQqAccount({
      qqId,
      nickname: event.sender?.card || event.sender?.nickname || "",
      token: bindMatch[1].toUpperCase(),
    });
    await logHandledInboundMessage(context, "message", "assistant:bind");
    await replyToEvent(context, result);
    return { ok: true };
  }
  if (canHandlePlainCommand && commandText.trim().match(/^(?:[/／])?绑定(?:\s|$)/i)) {
    if (event.message_type === "group") {
      await replyToEvent(context, "绑定码只支持私聊发送。请先私聊我，再发送“绑定 绑定码”。");
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:bind-hint");
    await replyToEvent(context, [
      "绑定需要使用站内生成的绑定码。",
      "请先到个人中心生成绑定码，再私聊发送：",
      "绑定 绑定码",
    ].join("\n"));
    return { ok: true };
  }
  const isSlashPostCommand = canHandlePlainCommand && isCommandMessage(commandText) && /^[/／]投稿(?:\s|$)/.test(commandText.trim());
  const isPlainPrivatePostCommand = event.message_type !== "group" && isPrivatePlainCommand(commandText, "投稿");
  const isQuickPostTrigger = isSlashPostCommand || isPlainPrivatePostCommand;
  const forwardPayload = await maybeExtractForwardPayloadForPosting(event.message, messageText, event);
  if (!messageText.trim() && !forwardPayload) {
    await logQqBotMessage({ direction: "inbound", eventType: "message", status: "ignored", qqId, groupId, rawPayload: event });
    return { ignored: true };
  }
  context.forwardPayload = forwardPayload;
  if (isQuickPostTrigger && forwardPayload) {
    let conversation: Awaited<ReturnType<typeof startForwardPostConversation>>;
    try {
      conversation = await startForwardPostConversation(context, forwardPayload);
    } catch (error: any) {
      await logHandledInboundMessage(context, "message", "assistant:forward-start-blocked");
      await replyToEvent(context, getQqBotUserFacingErrorMessage(error, "暂时无法开始投稿，请稍后再试。"));
      return { ok: true };
    }
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
    let conversation: Awaited<ReturnType<typeof startPostConversation>>;
    try {
      conversation = await startPostConversation(context);
    } catch (error: any) {
      await logHandledInboundMessage(context, "message", "assistant:start-post-blocked");
      await replyToEvent(context, getQqBotUserFacingErrorMessage(error, "暂时无法开始投稿，请稍后再试。"));
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:start-post");
    await replyToEvent(context, await renderConversationPrompt(conversation, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"));
    return { ok: true };
  }
  if (isPlainPrivatePostCommand) {
    let conversation: Awaited<ReturnType<typeof startPostConversation>>;
    try {
      conversation = await startPostConversation(context);
    } catch (error: any) {
      await logHandledInboundMessage(context, "message", "assistant:start-post-blocked");
      await replyToEvent(context, getQqBotUserFacingErrorMessage(error, "暂时无法开始投稿，请稍后再试。"));
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:start-post");
    await replyToEvent(context, await renderConversationPrompt(conversation, "如果方便，建议前往客户端完成投稿，编辑体验会更好。"));
    return { ok: true };
  }
  if (!isCommandMessage(messageText) && forwardPayload && shouldHandleForwardPostInContext(context)) {
    let conversation: Awaited<ReturnType<typeof startForwardPostConversation>>;
    try {
      conversation = await startForwardPostConversation(context, forwardPayload);
    } catch (error: any) {
      await logHandledInboundMessage(context, "message", "assistant:forward-start-blocked");
      await replyToEvent(context, getQqBotUserFacingErrorMessage(error, "暂时无法开始投稿，请稍后再试。"));
      return { ok: true };
    }
    await logHandledInboundMessage(context, "message", "assistant:forward-detected");
    await replyToPostingConversation(conversation, context, await renderConversationPrompt(conversation));
    return { ok: true };
  }

  if (!isCommandMessage(messageText) && isGreetingMessage(messageText) && shouldAssistantAutoReply(context)) {
    await logHandledInboundMessage(context, "message", "assistant:greeting");
    await replyToEvent(context, await renderGreetingReply(context.config.defaultBoardSlug));
    return { ok: true };
  }

  if (event.message_type !== "group") {
    await logHandledInboundMessage(context, "message", "assistant:fallback");
    await replyToEvent(context, renderPrivateFallbackReply());
    return { ok: true };
  }
  if (!groupId) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "message",
      status: "ignored",
      qqId,
      result: "group message 缺少 group_id",
      rawPayload: event,
    });
    return { ignored: true };
  }

  const adFiltered = await maybeHandleQqGroupAdFilter({
    config,
    event,
    qqId,
    groupId,
    messageText,
  });
  if (adFiltered) return { ok: true };

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
    const approvedVia = await approveQqFriendRequest({ flag, qqId, rawPayload: event });
    await logQqBotMessage({
      direction: "inbound",
      eventType: "friend-request",
      status: "ok",
      qqId,
      result: approvedVia === "doubt" ? "已自动通过可疑好友申请" : "已自动通过好友申请",
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
  if (requestType === "group" && subType === "add" && groupId && qqId) {
    return handleQqBotGroupJoinRequestEvent(event, {
      flag,
      qqId,
      groupId,
      nickname: extractQqRequesterNickname(event),
      comment: String(event.comment || "").trim(),
    });
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
  const botQqId = readConfigBotQqId(config);
  const isBotUser = Boolean(
    (event.self_id && String(event.user_id || "") === String(event.self_id))
    || (botQqId && qqId === botQqId),
  );
  if (
    event.notice_type === "group_increase"
    && groupId
    && isBotUser
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
  if (event.notice_type === "group_increase" && groupId && qqId) {
    return handleQqBotGroupMemberIncrease(event, { qqId, groupId });
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

async function handleQqBotGroupMemberIncrease(
  event: OneBotEvent,
  target: { qqId: string; groupId: string },
) {
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: target.groupId } });
  if (!group?.enabled) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-member-increase",
      status: "ignored",
      qqId: target.qqId,
      groupId: target.groupId,
      result: group ? "QQ群配置已停用" : "QQ群未配置",
      rawPayload: event,
    });
    return { ignored: true };
  }
  if (!group.memberWelcomeEnabled) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-member-increase",
      status: "ignored",
      qqId: target.qqId,
      groupId: target.groupId,
      result: "该群新成员私聊欢迎未开启",
      rawPayload: event,
    });
    return { ignored: true };
  }
  const message = renderMemberWelcomeMessage(group.memberWelcomeMessage, event, group);
  if (!message) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-member-welcome",
      status: "ignored",
      qqId: target.qqId,
      groupId: target.groupId,
      result: "欢迎消息为空",
      rawPayload: event,
    });
    return { ignored: true };
  }
  try {
    await sendQqMessage({ qqId: target.qqId, tempGroupId: target.groupId }, message);
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-member-welcome",
      status: "ok",
      qqId: target.qqId,
      groupId: target.groupId,
      content: message.slice(0, 1000),
      result: "已向新成员发送私聊欢迎",
      rawPayload: event,
    });
    return { ok: true, welcomeSent: true };
  } catch (error: any) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-member-welcome",
      status: "error",
      qqId: target.qqId,
      groupId: target.groupId,
      content: message.slice(0, 1000),
      result: String(error?.message || error || "私聊欢迎发送失败").slice(0, 500),
      rawPayload: event,
    });
    return { ok: true, welcomeSent: false };
  }
}

async function handleQqBotGroupJoinRequestEvent(
  event: OneBotEvent,
  target: { flag: string; qqId: string; groupId: string; nickname?: string | null; comment?: string | null },
) {
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: target.groupId } });
  if (!group?.enabled) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-join-request",
      status: "ignored",
      qqId: target.qqId,
      groupId: target.groupId,
      result: group ? "QQ群配置已停用" : "QQ群未配置",
      rawPayload: event,
    });
    return { ignored: true };
  }
  const blockedUser = await prisma.qqBotGroupBlockedUser.findUnique({
    where: {
      groupId_qqId: {
        groupId: target.groupId,
        qqId: target.qqId,
      },
    },
  });
  if (blockedUser) {
    await callQqBotAction("set_group_add_request", {
      flag: target.flag,
      sub_type: "add",
      approve: false,
    }).catch(() => undefined);
    await prisma.qqBotGroupJoinRequest.upsert({
      where: { flag: target.flag },
      create: {
        groupId: target.groupId,
        qqId: target.qqId,
        nickname: target.nickname || blockedUser.nickname || null,
        comment: target.comment || null,
        flag: target.flag,
        status: "rejected",
        handledAction: "blacklist",
        handledByQqId: blockedUser.blockedByQqId || null,
        handledAt: new Date(),
        rawPayload: JSON.stringify(event).slice(0, 8000),
      },
      update: {
        qqId: target.qqId,
        nickname: target.nickname || blockedUser.nickname || null,
        comment: target.comment || null,
        status: "rejected",
        handledAction: "blacklist",
        handledByQqId: blockedUser.blockedByQqId || null,
        handledAt: new Date(),
        rawPayload: JSON.stringify(event).slice(0, 8000),
      },
    });
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-join-request",
      status: "ok",
      qqId: target.qqId,
      groupId: target.groupId,
      content: `${target.nickname || blockedUser.nickname || ""} ${target.comment || ""}`.trim().slice(0, 500),
      result: "命中本群黑名单，已自动拒绝加群申请",
      rawPayload: event,
    });
    return { ok: true, autoRejected: "blacklist" };
  }
  if (!group.joinReviewEnabled) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-join-request",
      status: "ignored",
      qqId: target.qqId,
      groupId: target.groupId,
      result: "该群未开启快速审核加群",
      rawPayload: event,
    });
    return { ignored: true };
  }

  await prisma.qqBotGroupJoinRequest.upsert({
    where: { flag: target.flag },
    create: {
      groupId: target.groupId,
      qqId: target.qqId,
      nickname: target.nickname || null,
      comment: target.comment || null,
      flag: target.flag,
      status: "pending",
      rawPayload: JSON.stringify(event).slice(0, 8000),
    },
    update: {
      qqId: target.qqId,
      nickname: target.nickname || null,
      comment: target.comment || null,
      status: "pending",
      handledAction: null,
      handledByQqId: null,
      handledAt: null,
      rawPayload: JSON.stringify(event).slice(0, 8000),
    },
  });

  const groupView = formatQqBotGroup(group);
  const noticeMessage = [
    "收到新的加群申请",
    `申请 QQ：${target.qqId}`,
    `申请昵称：${target.nickname || "未提供"}`,
    `验证信息：${target.comment || "无"}`,
    "可用命令：待审加群 / 通过加群 QQ号 / 拒绝加群 QQ号",
  ].join("\n");

  await sendQqMessage({ groupId: target.groupId }, noticeMessage).catch(async (error) => {
    await logQqBotMessage({
      direction: "outbound",
      eventType: "group-join-request-notice",
      status: "error",
      qqId: target.qqId,
      groupId: target.groupId,
      content: noticeMessage.slice(0, 1000),
      result: String((error as any)?.message || error || "发送加群审核通知失败").slice(0, 500),
      rawPayload: event,
    });
    return null;
  });

  await logQqBotMessage({
    direction: "inbound",
    eventType: "group-join-request",
    status: "ok",
    qqId: target.qqId,
    groupId: target.groupId,
    content: `${target.nickname || ""} ${target.comment || ""}`.trim().slice(0, 500),
    result: `已记录待审申请并通知群内管理员（${groupView.name || target.groupId}）`,
    rawPayload: event,
  });
  return { ok: true, pendingJoinRequest: true };
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
      notificationEnabled: true,
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

function extractQqRequesterNickname(event: OneBotEvent) {
  const payload = event as Record<string, any>;
  return String(
    event.sender?.card
    || event.sender?.nickname
    || payload?.nickname
    || payload?.user?.nickname
    || payload?.requester_nickname
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

function renderMemberWelcomeMessage(
  template: string | null | undefined,
  event: OneBotEvent,
  group: { groupId: string; name: string | null },
) {
  const qqId = event.user_id ? String(event.user_id) : "";
  const nickname = extractQqBotMemberNickname(event) || "同学";
  const groupName = group.name || extractQqBotGroupName(event) || group.groupId;
  const values: Record<string, string> = {
    qq: qqId,
    nickname,
    groupId: group.groupId,
    groupName,
  };
  return String(template || DEFAULT_MEMBER_WELCOME_MESSAGE)
    .trim()
    .replace(/\{\{\s*(qq|nickname|groupId|groupName)\s*\}\}|\{(qq|nickname|groupId|groupName)\}/g, (_match, doubleKey, singleKey) => {
      const key = String(doubleKey || singleKey);
      return values[key] ?? "";
    });
}

function extractQqBotMemberNickname(event: OneBotEvent) {
  const payload = event as Record<string, any>;
  return String(
    event.sender?.card
    || event.sender?.nickname
    || payload?.card
    || payload?.nickname
    || payload?.user_nickname
    || payload?.member?.card
    || payload?.member?.nickname
    || "",
  ).trim();
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
    "现在可以直接在 QQ 里这样用我：",
    "帮助：查看全部命令",
    "状态：查看绑定状态和投稿开关",
    "板块：查看可投稿板块",
    "我的投稿：查看最近投稿",
    "投稿：开始分步投稿",
  ].join("\n");
}

async function unbindQqAccount(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({ where: { qqId } });
  if (!binding) return "当前 QQ 还没有绑定站内账号。";
  await prisma.qqBotBinding.delete({ where: { id: binding.id } });
  return "已解绑当前 QQ。之后如需继续投稿，请回站内重新生成绑定码。";
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

function updateConversationMetadata(metadataText: string | null | undefined, patch: Record<string, unknown>) {
  return JSON.stringify({
    ...parseConversationMetadata(metadataText),
    ...patch,
  });
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
    metadata: buildConversationMetadata(context, { draftBlocks: [] }),
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
      draftBlocks: forwardPayload.content.trim() ? [forwardPayload.content.trim()] : [],
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
  if (context.event.message_type === "group") {
    try {
      await ensureQqGroupPostingEnabled(context.groupId);
    } catch (error) {
      return {
        message: getQqBotUserFacingErrorMessage(error, "当前群暂不支持投稿。"),
        topicId: null,
      };
    }
  }
  if (context.event.message_type !== "group" && !context.config.allowPrivatePost) {
    return { message: "私聊投稿暂未开启。", topicId: null };
  }

  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId: context.qqId },
    include: { user: { select: { id: true, username: true, nickname: true, role: true, status: true } } },
  });
  if (!binding?.enabled) {
    return { message: "还没有绑定站内账号。请先在站内生成绑定码，再私聊发送：绑定 绑定码", topicId: null };
  }
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

async function normalizeConversationForSimpleFlow(conversation: any) {
  if (conversation.step !== "await-ai-post-confirm") return conversation;
  return prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: {
      step: String(conversation.draftContent || "").trim() ? "await-submit-confirm" : "collect-content",
    },
  });
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
  conversation = await normalizeConversationForSimpleFlow(conversation);
  const text = context.messageText.trim();
  const shortReply = normalizeShortReplyText(text);
  if (isCancelMessage(text)) {
    markConversationCancelled(context.qqId, context.groupId);
    await finishConversation(conversation.id, "cancelled");
    await replyToPostingConversation(conversation, context, "已取消这次投稿。");
    return { ok: true, cancelled: true };
  }
  const utilityHandled = await handleConversationUtilityCommand(conversation, context);
  if (utilityHandled) return utilityHandled;

  if (conversation.step === "await-forward-confirm") {
    if (/^(是|要|好的|确认|投稿)$/.test(shortReply)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-forward-title" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next));
      return { ok: true };
    }
    if (/^(否|不要|取消|算了)$/.test(shortReply)) {
      markConversationCancelled(context.qqId, context.groupId);
      await finishConversation(conversation.id, "cancelled");
      await replyToPostingConversation(conversation, context, "好的，这条内容我先不投稿。");
      return { ok: true, cancelled: true };
    }
    await replyToPostingConversation(
      conversation,
      context,
      "如果要投稿，请回复“是”；不想投稿就回复“否”或“取消”。我会把你刚才回复的那条消息内容当作投稿素材。",
    );
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
    const mergedDraftBlocks = draftContent
      ? [...getConversationDraftBlocks(conversation), draftContent]
      : getConversationDraftBlocks(conversation);
    const shouldReturnToConfirm = Boolean((conversation.draftContent || "").trim()) || conversation.step === "await-forward-title" || Boolean(draftContent);
    const next = await prisma.qqBotConversation.update({
      where: { id: conversation.id },
      data: {
        draftTitle: parsed.title,
        draftBoardSlug: parsed.boardSlug,
        draftContent: mergedDraftContent,
        step: shouldReturnToConfirm ? "await-submit-confirm" : "collect-content",
        metadata: updateConversationMetadata(conversation.metadata, { draftBlocks: mergedDraftBlocks }),
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
    const finishPayload = extractFinishCommandPayload(context.messageText);
    if (finishPayload !== null) {
      const normalizedText = finishPayload;
      const mergedContent = normalizedText
        ? mergeConversationContent(conversation.draftContent || "", normalizedText)
        : (conversation.draftContent || "");
      const next = await updateConversationDraftContent(conversation, mergedContent, {
        step: "await-submit-confirm",
        appendBlock: normalizedText || undefined,
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "我先帮你整理好，确认后再正式发布。"));
      return { ok: true };
    }

    if (isLikelyConversationCommandMessage(normalizeInboundCommandText(text))) {
      await replyToPostingConversation(
        conversation,
        context,
        renderConversationStageNudge(conversation, "没认出这个会话命令。"),
      );
      return { ok: true };
    }

    const nextContent = mergeConversationContent(conversation.draftContent || "", context.messageText);
    const next = await updateConversationDraftContent(conversation, nextContent, {
      appendBlock: context.messageText,
    });
    await replyToPostingConversation(
      conversation,
      context,
      await renderConversationPrompt(next, "已收到这段正文。你可以继续补充，写完后发送“结束”。"),
    );
    return { ok: true };
  }

  if (conversation.step === "await-submit-confirm" || conversation.step === "await-ai-post-confirm") {
    if (isConfirmPublishMessage(text)) {
      try {
        await replyToPostingConversation(conversation, context, QQBOT_POST_SUBMIT_PENDING_MESSAGE).catch(() => null);
        const result = await submitConversationPost(conversation.id, context);
        await replyToPostingConversation(conversation, context, result.message);
        return { ok: true, topicId: result.topicId };
      } catch (error: any) {
        return cancelConversationAfterSubmitFailure(conversation, context, error);
      }
    }
    if (/^(改标题|重新标题|换标题)$/.test(shortReply)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "await-title" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，请发送新的标题。"));
      return { ok: true };
    }
    if (/^(补充|继续写|继续补充|改正文|继续修改|补充一下)$/.test(shortReply)) {
      const next = await prisma.qqBotConversation.update({
        where: { id: conversation.id },
        data: { step: "collect-content" },
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，继续把正文补充给我。"));
      return { ok: true };
    }
    if (!isCommandMessage(text)) {
      const nextContent = mergeConversationContent(conversation.draftContent || "", context.messageText);
      const next = await updateConversationDraftContent(conversation, nextContent, {
        appendBlock: context.messageText,
        step: "collect-content",
      });
      await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "我把这段也补进正文里了。"));
      return { ok: true };
    }
    await replyToPostingConversation(conversation, context, renderConversationStageNudge(
      conversation,
      "没太看懂你这一步想做什么。",
    ));
    return { ok: true };
  }

  return null;
}

async function handleConversationUtilityCommand(
  conversation: any,
  context: {
    config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
    messageText: string;
  },
) {
  const text = context.messageText.trim();
  if (!text) return null;
  const commandText = normalizeInboundCommandText(text);
  if (!isCommandMessage(commandText)) return null;
  const boardSwitchTarget = extractConversationBoardSwitchTarget(commandText);
  if (boardSwitchTarget) {
    const boardSelection = await detectBoardSelectionInTitleStep(`投稿到${boardSwitchTarget}`, context.config.defaultBoardSlug, context.groupId);
    if (!boardSelection) {
      await replyToPostingConversation(
        conversation,
        context,
        "没认出你想切到哪个板块。你可以先发送“/板块”看列表，再用“/板块 树洞”这样的格式切换。",
      );
      return { ok: true, utility: "board-switch-invalid" };
    }
    const next = await prisma.qqBotConversation.update({
      where: { id: conversation.id },
      data: { draftBoardSlug: boardSelection.slug },
    });
    await replyToPostingConversation(
      conversation,
      context,
      await renderConversationPrompt(next, `好的，这篇稿子会发到「${boardSelection.name}」。`),
    );
    return { ok: true, utility: "board-switch" };
  }
  const titleCommandValue = extractConversationTitleCommandValue(commandText);
  if (titleCommandValue) {
    try {
      const next = await applyConversationTitleUpdate(conversation, titleCommandValue);
      await replyToPostingConversation(
        conversation,
        context,
        await renderConversationPrompt(next, `好的，标题我改成「${next.draftTitle}」了。`),
      );
      return { ok: true, utility: "title-set" };
    } catch (error: any) {
      await replyToPostingConversation(conversation, context, error?.message || "标题还不太对，请重新发送。");
      return { ok: true, utility: "title-set-invalid" };
    }
  }
  if (isConversationRetitleCommand(commandText)) {
    return performConversationRetitle(conversation, context);
  }
  if (isHelpCommand(commandText)) {
    await replyToPostingConversation(conversation, context, await renderConversationCommandHelp(conversation));
    return { ok: true, utility: "help" };
  }
  if (isConversationPreviewCommand(commandText)) {
    await replyToPostingConversation(conversation, context, await renderConversationDraftPreview(conversation));
    return { ok: true, utility: "draft-preview" };
  }
  if (isBoardListCommand(commandText)) {
    const boardList = await renderBoardList(context.config.defaultBoardSlug, context.groupId);
    await replyToPostingConversation(
      conversation,
      context,
      [boardList, "", "当前这篇草稿还在，可以继续发送内容或发送“取消”。"].join("\n"),
    );
    return { ok: true, utility: "boards" };
  }
  if (isConversationStatusCommand(commandText) || isStatusCommand(commandText)) {
    await replyToPostingConversation(conversation, context, await renderConversationStatus(conversation));
    return { ok: true, utility: "conversation-status" };
  }
  if (isMyPostsCommand(commandText)) {
    const recent = await renderRecentQqTopics(context.qqId);
    await replyToPostingConversation(
      conversation,
      context,
      [recent, "", "当前这篇草稿还在，可以继续发送内容或发送“取消”。"].join("\n"),
    );
    return { ok: true, utility: "recent-posts" };
  }
  if (isUnbindCommand(commandText)) {
    await replyToPostingConversation(
      conversation,
      context,
      "当前有进行中的投稿草稿。请先发送“取消”结束这次投稿，再执行解绑。",
    );
    return { ok: true, utility: "unbind-blocked" };
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
  const submitDefaultBoardSlug = await resolveDefaultBoardSlug(context.config.defaultBoardSlug, originGroupId);
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
      submitDefaultBoardSlug,
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

async function ensureQqPostingAllowed(context: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId?: string;
}) {
  if (context.event.message_type === "group" && !context.config.allowGroupPost) {
    throw Errors.badRequest("群内投稿暂未开启，请私聊投稿。");
  }
  if (context.event.message_type === "group") {
    await ensureQqGroupPostingEnabled(context.groupId);
  }
  if (context.event.message_type !== "group" && !context.config.allowPrivatePost) {
    throw Errors.badRequest("私聊投稿暂未开启。");
  }
}

async function ensureQqGroupPostingEnabled(groupId?: string) {
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId) throw Errors.badRequest("当前群上下文缺失，暂时无法群内投稿。");
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: normalizedGroupId } });
  if (!group?.enabled) throw Errors.badRequest("当前群未启用 QQBot 群配置，暂不支持群内投稿。");
  if (!group.allowPosting) throw Errors.badRequest("当前群未开启投稿功能，请私聊投稿。");
  return group;
}

async function ensureQqBinding(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId },
    include: { user: { select: { id: true } } },
  });
  if (!binding?.enabled) throw Errors.badRequest("还没有绑定站内账号。请先在站内生成绑定码，再私聊发送：绑定 绑定码");
  return binding;
}

async function updateConversationDraftContent(
  conversation: any,
  nextContent: string,
  options: {
    step?: QqConversationStep;
    manualContentEdit?: boolean;
    appendBlock?: string;
    replaceBlocks?: string[];
  } = {},
) {
  const metadata = parseConversationMetadata(conversation.metadata);
  const currentBlocks = getConversationDraftBlocks(conversation);
  const nextBlocks = options.replaceBlocks
    ? normalizeConversationDraftBlocks(options.replaceBlocks)
    : options.appendBlock
    ? [...currentBlocks, String(options.appendBlock || "").trim()].filter(Boolean)
    : currentBlocks;
  if (options.manualContentEdit && conversation.scene === "forward-post") {
    metadata.forwardDraftTemplate = "";
  }
  metadata.draftBlocks = nextBlocks;
  return prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: {
      draftContent: nextContent,
      step: options.step ?? conversation.step,
      metadata: JSON.stringify(metadata),
    },
  });
}

async function performConversationRetitle(
  conversation: any,
  context: {
    event: OneBotEvent;
    qqId: string;
    groupId?: string;
  },
) {
  const next = await prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: { step: "await-title" },
  });
  await replyToPostingConversation(conversation, context, await renderConversationPrompt(next, "好的，请发送新的标题。"));
  return { ok: true, utility: "title-edit" } as const;
}

async function applyConversationTitleUpdate(conversation: any, title: string) {
  const normalizedTitle = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 120);
  if (normalizedTitle.length < 2) throw Errors.badRequest("标题至少 2 个字，请重新发送。");
  const shouldAdvanceFromTitleStep = conversation.step === "await-title" || conversation.step === "await-forward-title";
  const nextStep = shouldAdvanceFromTitleStep
    ? (conversation.step === "await-forward-title" || String(conversation.draftContent || "").trim()
      ? "await-submit-confirm"
      : "collect-content")
    : conversation.step;
  return prisma.qqBotConversation.update({
    where: { id: conversation.id },
    data: {
      draftTitle: normalizedTitle,
      step: nextStep,
    },
  });
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
  const match = normalized.match(/^(?:发到|投稿到|发去|投到|发在|放到)\s*(.+)$/);
  if (!match) return null;
  const target = match[1].trim().replace(/^到/, "").trim();
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

async function detectBoardAndTitleInCommandLine(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim();
  const match = normalized.match(/^(?:到|发到|投稿到|发去|投到|发在|放到)\s*(\S+)\s+(.+)$/);
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

function buildPostCommandFromDraft(boardSlug: string, title: string, content: string, defaultBoardSlug?: string) {
  const useBoardPrefix = !defaultBoardSlug || boardSlug !== defaultBoardSlug;
  const firstLine = useBoardPrefix ? `${boardSlug} ${title}` : title;
  return `投稿 ${firstLine}\n${content}`;
}

async function parsePostCommand(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim().replace(/^\/?#?投稿\s*/, "");
  const lines = normalized.split(/\r?\n/);
  const firstLine = (lines.shift() || "").trim();
  if (!firstLine) {
    throw Errors.badRequest([
      "投稿格式不太对。",
      "可以这样发：",
      "投稿 标题",
      "正文",
      "也可以发：投稿 树洞 标题",
    ].join("\n"));
  }
  const defaultSlug = await resolveDefaultBoardSlug(defaultBoardSlug, groupId);
  const colonParsed = await detectBoardAndTitleInSingleLine(firstLine, defaultBoardSlug, groupId);
  if (colonParsed) {
    const content = lines.join("\n").trim() || colonParsed.title;
    return {
      boardSlug: colonParsed.board.slug,
      title: colonParsed.title.slice(0, 120),
      content: content.slice(0, 20000),
    };
  }
  const prefixedParsed = await detectBoardAndTitleInCommandLine(firstLine, defaultBoardSlug, groupId);
  if (prefixedParsed) {
    const content = lines.join("\n").trim() || prefixedParsed.title;
    return {
      boardSlug: prefixedParsed.board.slug,
      title: prefixedParsed.title.slice(0, 120),
      content: content.slice(0, 20000),
    };
  }
  const tokens = firstLine.split(/\s+/);
  let boardSlug = defaultSlug;
  let title = firstLine;
  if (tokens.length >= 2) {
    const maybeBoard = await detectBoardSelectionInTitleStep(`投稿到${tokens[0]}`, defaultBoardSlug, groupId);
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

export async function sendQqMessage(target: QqMessageTarget, message: string) {
  const chunks = splitQqMessageForDelivery(message);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const decorated = chunks.length > 1 ? `（${index + 1}/${chunks.length}）\n${chunk}` : chunk;
    await sendSingleQqMessage(target, decorated);
  }
}

async function sendSingleQqMessage(target: QqMessageTarget, message: string) {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !config.napcatBaseUrl) throw Errors.badRequest("QQBot 未启用或 NapCat 地址未配置");
  const endpoint = target.groupId ? "send_group_msg" : "send_private_msg";
  const body = target.groupId
    ? { group_id: Number(target.groupId) || target.groupId, message }
    : {
      user_id: Number(target.qqId) || target.qqId,
      message,
      ...(target.tempGroupId ? { group_id: Number(target.tempGroupId) || target.tempGroupId } : {}),
    };
  if (isWebSocketUrl(config.napcatBaseUrl)) {
    try {
      await sendQqMessageByWebSocket(endpoint, body, target, message);
    } catch (error: any) {
      await logQqBotMessage({
        direction: "outbound",
        eventType: target.groupId ? "group-message" : "private-message",
        status: "error",
        qqId: target.qqId,
        groupId: target.groupId || target.tempGroupId,
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
    groupId: target.groupId || target.tempGroupId,
    content: message.slice(0, 1000),
    result: text.slice(0, 500),
  });
  if (!response.ok) throw Errors.server(`NapCat 发送失败：${response.status} ${text.slice(0, 120)}`);
}

async function replyToEvent(context: { event: OneBotEvent; qqId: string; groupId?: string }, message: string) {
  if (context.event.message_type === "group" && context.groupId) {
    await sendQqMessage({ groupId: context.groupId }, message);
  } else {
    await sendQqMessage({ qqId: context.qqId, tempGroupId: context.groupId }, message);
  }
}

async function replyToPrivateForPosting(
  context: { event: OneBotEvent; qqId: string; groupId?: string },
  message: string,
  groupHint = "已收到，请查看私信完成投稿。",
) {
  try {
    await sendQqMessage({ qqId: context.qqId, tempGroupId: context.groupId }, message);
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
  const tick = () => runWithDistributedLock("qqbot-notification-dispatch:tick", 25_000, async () => {
    await Promise.all([
      dispatchRecentQqNotifications(),
      syncPendingDoubtFriendRequests({ reason: "poller" }),
    ]);
  }).catch((error) => {
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
  const personalCategories = parseQqBotNotifyCategories(config.notifyCategories);
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
                qqBotNotifyEnabled: true,
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
  target: QqMessageTarget,
  notification: any,
  userId: number | null,
  options?: { command?: string },
) {
  const link = resolveNotificationLink(notification);
  const message = [
    `【${notification.source || "药大拾间"}】${notification.title}`,
    "",
    notification.content,
    link ? "" : null,
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
  }).catch((error) => {
    const summary = {
      direction: input.direction,
      eventType: input.eventType,
      status: input.status ?? "ok",
      qqId: input.qqId || null,
      groupId: input.groupId || null,
      topicId: input.topicId ?? null,
      notificationId: input.notificationId ?? null,
    };
    console.error("[qqbot] message log write failed", summary, error);
    return null;
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
async function renderHelp(defaultBoardSlug: string) {
  const defaultBoardName = await resolveBoardDisplayName(defaultBoardSlug);
  return [
    "QQBot 帮助",
    "",
    "账号与状态",
    "• 帮助 / 命令 / 功能：查看全部命令",
    "• 绑定 绑定码：绑定站内账号",
    "• 状态：查看绑定状态、默认投稿区和投稿开关",
    "• 解绑：解除当前 QQ 绑定",
    "",
    "查询",
    "• 板块 / 版块 / 分区：查看可投稿板块",
    "• 我的投稿 / 最近投稿：查看最近投稿记录",
    "",
    "投稿",
    "• 投稿：开始分步投稿",
    "• 先发标题，再逐条发正文",
    "• 写完发送“结束”，最后回复“确认发布”",
    "• 取消：取消当前投稿",
    "",
    `默认投稿区：${defaultBoardName}`,
  ].join("\n");
}

async function renderGroupHelp(
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
  groupId: string,
  event?: OneBotEvent,
) {
  const group = await resolveQqBotGroupViewForReply(groupId, event);
  const defaultBoardName = await resolveBoardDisplayName(group.defaultBoardSlug || config.defaultBoardSlug || "general");
  const postingStatus = describeQqGroupPostingStatus(config, group);
  const adminCommandLines = buildQqGroupAdminCommandLines(group);
  return [
    "QQBot 群聊帮助",
    "",
    "群聊里请先 @我，再发送下面这些命令。",
    "",
    `当前群：${group.name || group.groupId}`,
    `群内投稿：${postingStatus}`,
    `默认投稿区：${defaultBoardName}`,
    "",
    "群聊可用",
    "• 帮助：查看当前群可用命令",
    "• 状态：查看当前群开关状态",
    "• 板块 / 版块 / 分区：查看当前群可投稿板块",
    group.enabled && config.allowGroupPost && group.allowPosting
      ? "• 投稿：开始群内投稿"
      : "• 投稿：当前群未开启",
    "",
    "群管命令",
    "• 群管帮助 / 管理命令：查看群管命令",
    ...adminCommandLines,
    "",
    "私聊专用",
    "• 绑定 绑定码：绑定站内账号",
    "• 我的投稿：查看最近投稿记录",
    "• 解绑：解除当前 QQ 绑定",
    "• 个人绑定状态请私聊发送“状态”查看",
  ].join("\n");
}

async function renderGroupStatus(
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
  groupId?: string,
  event?: OneBotEvent,
) {
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId) {
    return "当前消息不在已识别的群上下文里，请稍后再试。";
  }
  const group = await resolveQqBotGroupViewForReply(normalizedGroupId, event);
  const defaultBoardName = await resolveBoardDisplayName(group.defaultBoardSlug || config.defaultBoardSlug || "general");
  return [
    "当前群状态",
    `群名：${group.name || group.groupId}`,
    `群内投稿：${describeQqGroupPostingStatus(config, group)}`,
    `默认投稿区：${defaultBoardName}`,
    `站内通知：${group.enabled && group.notificationEnabled ? "已开启" : "未开启"}`,
    `新成员欢迎：${group.enabled && group.memberWelcomeEnabled ? "已开启" : "未开启"}`,
    `广告过滤：${group.enabled && group.adFilterEnabled ? "已开启" : "未开启"}`,
    `快速审核加群：${group.enabled && group.joinReviewEnabled ? "已开启" : "未开启"}`,
    `禁言：${group.enabled && group.allowMute ? "已开启" : "未开启"}`,
    `踢出：${group.enabled && group.allowKick ? "已开启" : "未开启"}`,
    `踢黑：${group.enabled && group.allowKickAndBlock ? "已开启" : "未开启"}`,
    "",
    "个人绑定状态、最近投稿、解绑请私聊使用。",
  ].join("\n");
}

async function renderGreetingReply(defaultBoardSlug: string) {
  const defaultBoardName = await resolveBoardDisplayName(defaultBoardSlug);
  return [
    "我在。",
    `默认投稿区：${defaultBoardName}`,
    "想投稿就直接发送“投稿”。",
    "常用命令：帮助 / 状态 / 板块 / 我的投稿",
  ].join("\n");
}

function renderPrivateFallbackReply() {
  return [
    "我收到啦。",
    "你可以直接发：帮助 / 投稿 / 状态 / 板块 / 我的投稿。",
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

function isExplicitBotMention(event: OneBotEvent, text: string) {
  const raw = text.trim();
  if (!raw) return false;
  return isMessageAtBot(event.message, event.self_id);
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

async function handleQqBotGroupAdminCommand(input: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId: string;
  messageText: string;
  commandText: string;
  command: NonNullable<ReturnType<typeof parseQqGroupAdminCommand>>;
}) {
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: input.groupId } });
  const replyAndLog = async (message: string, result: string, status: "ok" | "ignored" | "error" = "ok") => {
    await sendQqMessage({ groupId: input.groupId }, message).catch(() => undefined);
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-command",
      status,
      qqId: input.qqId,
      groupId: input.groupId,
      messageId: input.event.message_id ? String(input.event.message_id) : undefined,
      command: input.command.type,
      content: input.messageText.slice(0, 500),
      result,
      rawPayload: input.event,
    });
    return true;
  };

  if (input.command.type === "help") {
    return replyAndLog(
      renderQqGroupAdminHelp(group ? formatQqBotGroup(group) : buildQqBotGroupFallbackView(input.groupId, input.event)),
      "assistant:group-admin-help",
    );
  }

  if (!group?.enabled) {
    return replyAndLog("当前群还没有启用 QQBot 群管配置，请先在后台开启对应群功能。", "group-disabled", "ignored");
  }

  const permission = await resolveQqGroupCommandPermission({
    config: input.config,
    group,
    qqId: input.qqId,
    event: input.event,
  });
  if (!permission.allowed) {
    return replyAndLog("只有群管理员、已授权用户或 QQBot 超级管理员可以执行群管命令。", "permission-denied", "ignored");
  }

  try {
    if (input.command.type === "list-join-requests") {
      if (!group.joinReviewEnabled) {
        return replyAndLog("当前群未开启快速审核加群。", "join-review-disabled", "ignored");
      }
      const rows = await prisma.qqBotGroupJoinRequest.findMany({
        where: { groupId: input.groupId, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      return replyAndLog(renderPendingJoinRequests(rows), "assistant:list-join-requests");
    }

    if (input.command.type === "approve-join" || input.command.type === "reject-join") {
      if (!group.joinReviewEnabled) {
        return replyAndLog("当前群未开启快速审核加群。", "join-review-disabled", "ignored");
      }
      const target = extractCommandTarget(input.command.argText, input.event);
      if (!target?.qqId) {
        return replyAndLog("请带上待审核的 QQ 号，例如：通过加群 123456789。", "join-target-missing", "ignored");
      }
      const request = await prisma.qqBotGroupJoinRequest.findFirst({
        where: { groupId: input.groupId, qqId: target.qqId, status: "pending" },
        orderBy: { createdAt: "desc" },
      });
      if (!request) {
        return replyAndLog(`没有找到 QQ ${target.qqId} 的待审加群申请。`, "join-request-not-found", "ignored");
      }
      const approve = input.command.type === "approve-join";
      await callQqBotAction("set_group_add_request", {
        flag: request.flag,
        sub_type: "add",
        approve,
      });
      await prisma.qqBotGroupJoinRequest.update({
        where: { id: request.id },
        data: {
          status: approve ? "approved" : "rejected",
          handledAction: approve ? "approve" : "reject",
          handledByQqId: input.qqId,
          handledAt: new Date(),
        },
      });
      return replyAndLog(
        approve ? `已通过 QQ ${target.qqId} 的加群申请。` : `已拒绝 QQ ${target.qqId} 的加群申请。`,
        `assistant:${input.command.type}`,
      );
    }

    if (input.command.type === "mute" || input.command.type === "unmute") {
      if (!group.allowMute) {
        return replyAndLog("当前群未开启禁言功能。", "mute-disabled", "ignored");
      }
      const target = extractCommandTarget(input.command.argText, input.event);
      if (!target?.qqId) {
        return replyAndLog(
          input.command.type === "mute"
            ? "请带上目标 QQ 号或直接 @对方，例如：禁言 123456789 10m 或 禁言@某某 10m。"
            : "请带上目标 QQ 号或直接 @对方，例如：解除禁言 123456789 或 解除禁言@某某。",
          `${input.command.type}-target-missing`,
          "ignored",
        );
      }
      let durationSeconds = 0;
      if (input.command.type === "mute") {
        durationSeconds = parseMuteDurationSeconds(target.restText);
        if (!durationSeconds) {
          return replyAndLog("请填写禁言时长，例如：禁言 123456789 10m / 禁言@某某 1h / 1天。", "mute-duration-missing", "ignored");
        }
      }
      ensureModerationTargetAllowed(target.qqId, input.config, input.event);
      await callQqBotAction("set_group_ban", {
        group_id: Number(input.groupId) || input.groupId,
        user_id: Number(target.qqId) || target.qqId,
        duration: durationSeconds,
      });
      return replyAndLog(
        input.command.type === "mute"
          ? `已禁言 QQ ${target.qqId}，时长 ${formatMuteDuration(durationSeconds)}。`
          : `已解除 QQ ${target.qqId} 的禁言。`,
        `assistant:${input.command.type}`,
      );
    }

    if (input.command.type === "list-blocked-users") {
      if (!group.allowKickAndBlock) {
        return replyAndLog("当前群未开启踢出并拉黑功能。", "kick-block-disabled", "ignored");
      }
      const rows = await prisma.qqBotGroupBlockedUser.findMany({
        where: { groupId: input.groupId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return replyAndLog(renderBlockedUserList(rows), "assistant:list-blocked-users");
    }

    if (input.command.type === "kick" || input.command.type === "kick-block") {
      const featureEnabled = input.command.type === "kick" ? group.allowKick : group.allowKickAndBlock;
      if (!featureEnabled) {
        return replyAndLog(
          input.command.type === "kick" ? "当前群未开启踢出功能。" : "当前群未开启踢出并拉黑功能。",
          `${input.command.type}-disabled`,
          "ignored",
        );
      }
      const target = extractCommandTarget(input.command.argText, input.event);
      if (!target?.qqId) {
        return replyAndLog(
          input.command.type === "kick"
            ? "请带上目标 QQ 号或直接 @对方，例如：踢出 123456789 或 踢出@某某。"
            : "请带上目标 QQ 号或直接 @对方，例如：踢黑 123456789 或 踢黑@某某。",
          `${input.command.type}-target-missing`,
          "ignored",
        );
      }
      ensureModerationTargetAllowed(target.qqId, input.config, input.event);
      await callQqBotAction("set_group_kick", {
        group_id: Number(input.groupId) || input.groupId,
        user_id: Number(target.qqId) || target.qqId,
        reject_add_request: false,
      });
      if (input.command.type === "kick-block") {
        await prisma.qqBotGroupBlockedUser.upsert({
          where: {
            groupId_qqId: {
              groupId: input.groupId,
              qqId: target.qqId,
            },
          },
          create: {
            groupId: input.groupId,
            qqId: target.qqId,
            blockedByQqId: input.qqId,
            source: "command",
          },
          update: {
            blockedByQqId: input.qqId,
            source: "command",
          },
        });
      }
      return replyAndLog(
        input.command.type === "kick"
          ? `已将 QQ ${target.qqId} 踢出群聊。`
          : `已将 QQ ${target.qqId} 踢出群聊，并加入本群黑名单。`,
        `assistant:${input.command.type}`,
      );
    }

    if (input.command.type === "remove-blocked-user") {
      if (!group.allowKickAndBlock) {
        return replyAndLog("当前群未开启踢出并拉黑功能。", "kick-block-disabled", "ignored");
      }
      const target = extractCommandTarget(input.command.argText, input.event);
      if (!target?.qqId) {
        return replyAndLog(
          "请带上要移出黑名单的 QQ 号或直接 @对方，例如：移出黑名单 123456789 或 移出黑名单@某某。",
          "remove-blocked-user-target-missing",
          "ignored",
        );
      }
      const removed = await prisma.qqBotGroupBlockedUser.deleteMany({
        where: { groupId: input.groupId, qqId: target.qqId },
      });
      if (!removed.count) {
        return replyAndLog(`QQ ${target.qqId} 当前不在本群黑名单里。`, "remove-blocked-user-not-found", "ignored");
      }
      return replyAndLog(`已将 QQ ${target.qqId} 从本群黑名单移出。`, "assistant:remove-blocked-user");
    }

    if (input.command.type === "add-command-user" || input.command.type === "remove-command-user") {
      if (!permission.canManageCommandUsers) {
        return replyAndLog("只有群管理员或 QQBot 超级管理员可以维护群管授权用户。", "command-user-manage-denied", "ignored");
      }
      const target = extractCommandTarget(input.command.argText, input.event);
      if (!target?.qqId) {
        return replyAndLog(
          input.command.type === "add-command-user"
            ? "请带上要授权的 QQ 号或直接 @对方，例如：添加群管 123456789 或 添加群管@某某。"
            : "请带上要移除的 QQ 号或直接 @对方，例如：移除群管 123456789 或 移除群管@某某。",
          "command-user-target-missing",
          "ignored",
        );
      }
      const next = new Set(normalizeQqBotQqIdList(parseStringArray(group.commandUserQqIds || "", [])));
      if (input.command.type === "add-command-user") next.add(target.qqId);
      else next.delete(target.qqId);
      await prisma.qqBotGroup.update({
        where: { id: group.id },
        data: { commandUserQqIds: JSON.stringify(Array.from(next)) },
      });
      return replyAndLog(
        input.command.type === "add-command-user"
          ? `已把 QQ ${target.qqId} 加入本群授权用户。`
          : `已把 QQ ${target.qqId} 从本群授权用户中移除。`,
        `assistant:${input.command.type}`,
      );
    }

    if (input.command.type === "list-command-users") {
      const commandUsers = normalizeQqBotQqIdList(parseStringArray(group.commandUserQqIds || "", []));
      return replyAndLog(renderCommandUserList(commandUsers), "assistant:list-command-users");
    }
  } catch (error) {
    return replyAndLog(
      getQqBotUserFacingErrorMessage(error, "群管命令执行失败，请稍后再试。"),
      String((error as any)?.message || error || "group-command-error").slice(0, 500),
      "error",
    );
  }

  return false;
}

async function maybeHandleQqGroupAdFilter(input: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  qqId: string;
  groupId: string;
  messageText: string;
}) {
  const messageText = String(input.messageText || "").trim();
  const botQqId = readConfigBotQqId(input.config);
  if (!messageText) return false;
  if (isCommandMessage(messageText) || isExplicitBotMention(input.event, messageText)) return false;
  if (input.qqId && (input.qqId === botQqId || String(input.event.self_id || "") === input.qqId)) return false;

  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: input.groupId } });
  if (!group?.enabled || !group.adFilterEnabled) return false;
  const senderNickname = input.event.sender?.card || input.event.sender?.nickname || null;

  try {
    const review = await reviewQqGroupMessageForAd({
      groupId: input.groupId,
      groupName: group.name,
      qqId: input.qqId,
      nickname: senderNickname,
      content: messageText,
      metadata: {
        messageId: input.event.message_id ? String(input.event.message_id) : "",
      },
    });
    if (review.action !== "block") return false;
    if (!input.event.message_id) {
      await logQqBotMessage({
        direction: "inbound",
        eventType: "group-ad-filter",
        status: "error",
        qqId: input.qqId,
        groupId: input.groupId,
        content: messageText.slice(0, 500),
        result: `命中广告过滤，但缺少 message_id，无法撤回。原因：${review.reason}`,
        rawPayload: input.event,
      });
      return false;
    }

    await callQqBotAction("delete_msg", {
      message_id: Number(input.event.message_id) || input.event.message_id,
    });
    const strike = await recordQqGroupAdStrikeHit({
      groupId: input.groupId,
      qqId: input.qqId,
      nickname: senderNickname,
      review,
    });
    const penalty = await applyQqGroupAdPenalty({
      config: input.config,
      event: input.event,
      group,
      qqId: input.qqId,
      hitCount: strike.hitCount,
    });
    await sendQqMessage(
      { qqId: input.qqId, tempGroupId: input.groupId },
      renderQqGroupAdFilterPrivateNotice({
        groupName: group.name || input.groupId,
        review,
        hitCount: strike.hitCount,
        penaltyUserNotice: penalty.userNotice,
      }),
    ).catch(() => undefined);
    await sendQqMessage(
      { groupId: input.groupId },
      renderQqGroupAdFilterGroupNotice({
        qqId: input.qqId,
        nickname: senderNickname,
        review,
      }),
    ).catch(() => undefined);
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-ad-filter",
      status: "ok",
      qqId: input.qqId,
      groupId: input.groupId,
      messageId: String(input.event.message_id),
      content: messageText.slice(0, 500),
      result: [
        `已撤回疑似广告消息（第${strike.hitCount}次，${review.riskScore}分，${review.reason}）`,
        penalty.logSummary,
      ].filter(Boolean).join("；"),
      rawPayload: input.event,
    });
    return true;
  } catch (error) {
    await logQqBotMessage({
      direction: "inbound",
      eventType: "group-ad-filter",
      status: "error",
      qqId: input.qqId,
      groupId: input.groupId,
      messageId: input.event.message_id ? String(input.event.message_id) : undefined,
      content: messageText.slice(0, 500),
      result: String((error as any)?.message || error || "group ad filter failed").slice(0, 500),
      rawPayload: input.event,
    });
    return false;
  }
}

function renderQqGroupAdFilterPrivateNotice(input: {
  groupName: string;
  review: Awaited<ReturnType<typeof reviewQqGroupMessageForAd>>;
  hitCount: number;
  penaltyUserNotice?: string;
}) {
  return [
    `你在群 ${input.groupName} 的一条消息刚刚被广告过滤撤回了。`,
    `系统说明：${input.review.reason}`,
    "如果你本意只是普通交流、玩梗或求助，换个更直接、没那么像招募导流的说法再发一次就行。",
    `累计命中：第 ${input.hitCount} 次。`,
    ...(input.penaltyUserNotice ? [input.penaltyUserNotice] : []),
  ].join("\n");
}

function renderQqGroupAdFilterGroupNotice(
  input: {
    qqId: string;
    nickname?: string | null;
    review: Awaited<ReturnType<typeof reviewQqGroupMessageForAd>>;
  },
) {
  const who = [`[CQ:at,qq=${input.qqId}]`, `（QQ：${input.qqId}${input.nickname ? `，${input.nickname}` : ""}）`].join("");
  return [
    `刚刚撤回了 ${who} 的一条消息。`,
    `说明：${input.review.reason}`,
    "如果本意只是普通交流、玩梗或求助，建议改成更日常、更直接的说法后再发一次。",
  ].join("\n");
}

async function recordQqGroupAdStrikeHit(input: {
  groupId: string;
  qqId: string;
  nickname?: string | null;
  review: Awaited<ReturnType<typeof reviewQqGroupMessageForAd>>;
}) {
  const now = new Date();
  return prisma.qqBotGroupAdStrike.upsert({
    where: {
      groupId_qqId: {
        groupId: input.groupId,
        qqId: input.qqId,
      },
    },
    create: {
      groupId: input.groupId,
      qqId: input.qqId,
      nickname: input.nickname || null,
      hitCount: 1,
      lastReason: input.review.reason,
      lastRiskScore: input.review.riskScore,
      lastModel: input.review.model,
      lastHitAt: now,
    },
    update: {
      nickname: input.nickname || undefined,
      hitCount: { increment: 1 },
      lastReason: input.review.reason,
      lastRiskScore: input.review.riskScore,
      lastModel: input.review.model,
      lastHitAt: now,
    },
  });
}

async function applyQqGroupAdPenalty(input: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  event: OneBotEvent;
  group: {
    groupId: string;
    name: string | null;
    allowMute: boolean;
    allowKick: boolean;
    allowKickAndBlock: boolean;
  };
  qqId: string;
  hitCount: number;
}) {
  void input;
  return {
    userNotice: "",
    logSummary: "",
  };
}

async function resolveQqGroupCommandPermission(input: {
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>;
  group: { groupId: string; commandUserQqIds: string | null };
  qqId: string;
  event: OneBotEvent;
}) {
  const superAdminQqIds = normalizeQqBotQqIdList(parseStringArray(input.config.superAdminQqIds || "", []));
  if (superAdminQqIds.includes(input.qqId)) {
    return { allowed: true, canManageCommandUsers: true, source: "super-admin" as const };
  }

  const senderRole = await resolveQqGroupMemberRole(input.group.groupId, input.qqId, input.event);
  if (senderRole === "owner" || senderRole === "admin") {
    return { allowed: true, canManageCommandUsers: true, source: senderRole };
  }

  const commandUsers = normalizeQqBotQqIdList(parseStringArray(input.group.commandUserQqIds || "", []));
  if (commandUsers.includes(input.qqId)) {
    return { allowed: true, canManageCommandUsers: false, source: "command-user" as const };
  }

  return { allowed: false, canManageCommandUsers: false, source: "member" as const };
}

async function resolveQqGroupMemberRole(groupId: string, qqId: string, event: OneBotEvent) {
  const senderRole = normalizeQqGroupMemberRole(event.sender?.role);
  if (senderRole) return senderRole;
  const payload = await callQqBotAction("get_group_member_info", {
    group_id: Number(groupId) || groupId,
    user_id: Number(qqId) || qqId,
    no_cache: true,
  }).catch(() => null);
  return normalizeQqGroupMemberRole(
    (payload as any)?.data?.role
      || (payload as any)?.role
      || (payload as any)?.data?.member?.role,
  );
}

function normalizeQqGroupMemberRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "member") return role;
  return "";
}

function buildQqBotGroupFallbackView(groupId: string, event?: OneBotEvent) {
  return formatQqBotGroup({
    id: 0,
    groupId,
    name: extractQqBotGroupName(event || {}),
    enabled: false,
    allowPosting: false,
    defaultBoardSlug: null,
    notificationEnabled: false,
    notifyCategories: JSON.stringify(DEFAULT_GROUP_NOTIFY_CATEGORIES),
    notifyAudiences: JSON.stringify(DEFAULT_GROUP_NOTIFY_AUDIENCES),
    memberWelcomeEnabled: false,
    memberWelcomeMessage: DEFAULT_MEMBER_WELCOME_MESSAGE,
    adFilterEnabled: false,
    joinReviewEnabled: false,
    allowMute: false,
    allowKick: false,
    allowKickAndBlock: false,
    commandUserQqIds: "[]",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function resolveQqBotGroupViewForReply(groupId: string, event?: OneBotEvent) {
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId } });
  return group ? formatQqBotGroup(group) : buildQqBotGroupFallbackView(groupId, event);
}

function describeQqGroupPostingStatus(
  config: Awaited<ReturnType<typeof getQqBotConfigRaw>>,
  group: QqBotGroupView,
) {
  if (!group.enabled) return "未开启（当前群未启用 QQBot 群配置）";
  if (!config.allowGroupPost) return "未开启（总站群内投稿开关关闭）";
  if (!group.allowPosting) return "未开启（当前群未开启投稿）";
  return "已开启";
}

function buildQqGroupAdminCommandLines(group: QqBotGroupView) {
  const lines = [`• 当前群管开关：${group.enabled ? "已启用" : "未启用"}`];
  if (group.joinReviewEnabled) {
    lines.push("• 待审加群：查看待审核列表");
    lines.push("• 通过加群 QQ号 / 拒绝加群 QQ号");
  } else {
    lines.push("• 快速审核加群：未开启");
  }
  if (group.allowMute) {
    lines.push("• 禁言 QQ号/@某人 10m：支持 10m / 1h / 1天");
    lines.push("• 解除禁言 QQ号/@某人");
  }
  else lines.push("• 禁言：未开启");
  if (group.allowKick) lines.push("• 踢出 QQ号/@某人");
  else lines.push("• 踢出：未开启");
  if (group.allowKickAndBlock) {
    lines.push("• 踢黑 QQ号/@某人");
    lines.push("• 黑名单列表：查看本群黑名单");
    lines.push("• 移出黑名单 QQ号/@某人");
  }
  else lines.push("• 踢黑：未开启");
  lines.push("• 群管列表：查看本群授权用户");
  lines.push("• 添加群管 QQ号/@某人 / 移除群管 QQ号/@某人：维护授权用户");
  return lines;
}

function extractCommandTarget(argText: string, event: OneBotEvent) {
  const mentionedQqIds = extractMentionedQqIds(event.message, event.self_id);
  if (mentionedQqIds.length) {
    return { qqId: mentionedQqIds[0], restText: String(argText || "").trim() };
  }
  const cqMention = String(argText || "").match(/\[CQ:at,qq=(\d{5,20})[^\]]*\]/i);
  if (cqMention) {
    return {
      qqId: cqMention[1],
      restText: String(argText || "").replace(cqMention[0], "").trim(),
    };
  }
  const match = String(argText || "").trim().match(/^(\d{5,20})(?:\s+([\s\S]+))?$/);
  if (match) {
    return { qqId: match[1], restText: String(match[2] || "").trim() };
  }
  const fallback = String(argText || "").trim().match(/(\d{5,20})/);
  if (!fallback) return null;
  return {
    qqId: fallback[1],
    restText: String(argText || "").replace(fallback[1], "").trim(),
  };
}

function extractMentionedQqIds(message: unknown, selfId?: number | string) {
  if (!Array.isArray(message)) return [];
  const botId = String(selfId || "").trim();
  return Array.from(new Set(
    message
      .filter((segment: any) => segment?.type === "at")
      .map((segment: any) => String(segment?.data?.qq || "").trim())
      .filter((qqId) => qqId && qqId !== "all" && qqId !== botId),
  ));
}

function parseMuteDurationSeconds(value: string) {
  const match = String(value || "").trim().match(/(\d+)\s*(秒钟?|分钟?|分|小时|时|天|d|h|m|s)(?:\s|$)/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = match[2].toLowerCase();
  let seconds = amount;
  if (["m", "分", "分钟"].includes(unit)) seconds = amount * 60;
  else if (["h", "时", "小时"].includes(unit)) seconds = amount * 3600;
  else if (["d", "天"].includes(unit)) seconds = amount * 86400;
  return Math.max(60, Math.min(30 * 86400, seconds));
}

function formatMuteDuration(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400}天`;
  if (seconds % 3600 === 0) return `${seconds / 3600}小时`;
  if (seconds % 60 === 0) return `${seconds / 60}分钟`;
  return `${seconds}秒`;
}

function ensureModerationTargetAllowed(targetQqId: string, config: Awaited<ReturnType<typeof getQqBotConfigRaw>>, event: OneBotEvent) {
  const botQqId = readConfigBotQqId(config);
  const selfQqId = String(event.self_id || "").trim();
  if (targetQqId === botQqId || (selfQqId && targetQqId === selfQqId)) {
    throw Errors.badRequest("不能对 QQBot 自己执行这个操作");
  }
}

function renderQqGroupAdminHelp(group: QqBotGroupView) {
  const parts = [
    "群管命令",
    ...buildQqGroupAdminCommandLines(group),
    "",
    `当前群：${group.name || group.groupId}`,
    `群管配置：${group.enabled ? "开" : "关"}`,
    `加群快审：${group.joinReviewEnabled ? "开" : "关"}`,
    `禁言：${group.allowMute ? "开" : "关"}`,
    `踢出：${group.allowKick ? "开" : "关"}`,
    `踢黑：${group.allowKickAndBlock ? "开" : "关"}`,
    `广告过滤：${group.adFilterEnabled ? "开" : "关"}`,
  ];
  return parts.join("\n");
}

function renderPendingJoinRequests(
  rows: Array<{ qqId: string; nickname: string | null; comment: string | null; createdAt: Date }>,
) {
  if (!rows.length) return "当前没有待审核的加群申请。";
  return [
    "待审核加群申请：",
    "",
    rows.map((row, index) => [
      `${index + 1}. QQ ${row.qqId}${row.nickname ? ` · ${row.nickname}` : ""}`,
      `验证：${row.comment || "无"}`,
      `时间：${row.createdAt.toLocaleString("zh-CN", { hour12: false })}`,
    ].join("\n")).join("\n\n"),
  ].join("\n");
}

function renderBlockedUserList(
  rows: Array<{ qqId: string; nickname: string | null; blockedByQqId: string | null; createdAt: Date }>,
) {
  if (!rows.length) return "当前群黑名单为空。";
  return [
    "本群黑名单：",
    "",
    rows.map((row, index) => [
      `${index + 1}. QQ ${row.qqId}${row.nickname ? ` · ${row.nickname}` : ""}`,
      `加入时间：${row.createdAt.toLocaleString("zh-CN", { hour12: false })}`,
      row.blockedByQqId ? `操作人：${row.blockedByQqId}` : "",
    ].filter(Boolean).join("\n")).join("\n\n"),
  ].join("\n");
}

function renderCommandUserList(commandUsers: string[]) {
  if (!commandUsers.length) return "当前群还没有授权用户。";
  return [
    "当前群授权用户：",
    "",
    commandUsers.map((qqId, index) => `${index + 1}. ${qqId}`).join("\n"),
  ].join("\n");
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
      "当前状态：未绑定",
      "先到站内个人中心生成绑定码，再私聊发送：绑定 绑定码",
      `默认投稿区：${defaultBoardName}`,
      `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
      `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
      "提示：绑定后才能投稿、查状态和查看最近投稿。",
    ].join("\n");
  }
  return [
    `当前状态：已绑定 ${binding.user.nickname}（${binding.user.username}）`,
    `默认投稿区：${defaultBoardName}`,
    `私聊投稿：${config.allowPrivatePost ? "已开启" : "未开启"}`,
    `群内投稿：${config.allowGroupPost ? "已开启" : "未开启"}`,
    "常用命令：板块 / 我的投稿 / 投稿 / 解绑",
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
    "可投稿板块",
    ...availableBoards.slice(0, 12).map((board) => {
      const suffix = board.slug === currentDefaultSlug ? "（默认投稿区）" : "";
      const desc = board.description ? `：${board.description}` : "";
      return `• ${board.name}${suffix}${desc}`;
    }),
  ];
  const closedHints = boards
    .filter((board) => !isBoardTypeEnabled(board.type))
    .map((board) => `• ${board.name}：${featureClosedMessage(board.type)}`);
  if (closedHints.length) {
    lines.push("", "当前暂不可投");
    lines.push(...closedHints.slice(0, 4));
  }
  lines.push("", "怎么发");
  lines.push("• 发送“投稿”开始分步投稿");
  lines.push("• 先发标题，再逐条发正文，写完发送“结束”");
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
    "",
    topics.map((topic, index) => {
      const topicLink = buildTopicLink(topic.id) || `/forum/topic/${topic.id}`;
      return `${index + 1}. ${topic.title}\n板块：${topic.board.name}\n链接：${topicLink}`;
    }).join("\n\n"),
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

function getQqBotUserFacingErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

function getQqBotActionErrorMessage(error: unknown) {
  return String(
    (error && typeof error === "object" && "message" in error && (error as { message?: unknown }).message)
      || error
      || "",
  ).trim();
}

function isQqBotDoubtFriendRequestError(error: unknown) {
  const text = getQqBotActionErrorMessage(error);
  return /频繁|可疑|异常|风控|suspicious|frequent/i.test(text);
}

async function approveQqFriendRequest(input: { flag: string; qqId: string; rawPayload?: unknown }) {
  try {
    await callQqBotAction("set_friend_add_request", {
      flag: input.flag,
      approve: true,
    });
    return "friend" as const;
  } catch (error) {
    if (!isQqBotDoubtFriendRequestError(error)) throw error;
    const synced = await syncPendingDoubtFriendRequests({
      targetQqId: input.qqId,
      reason: "friend-request-fallback",
      rawPayload: input.rawPayload,
    });
    if (synced.acceptedCount > 0) return "doubt" as const;
    throw error;
  }
}

async function syncPendingDoubtFriendRequests(input?: {
  targetQqId?: string;
  reason?: string;
  rawPayload?: unknown;
}) {
  const config = await getQqBotConfigRaw();
  if (!config.enabled || !config.napcatBaseUrl) return { acceptedCount: 0, scannedCount: 0 };
  const reason = input?.reason || "manual";
  let result: any;
  try {
    result = await callQqBotAction("get_doubt_friends_add_request", { count: 20 });
  } catch (error) {
    const message = getQqBotActionErrorMessage(error);
    if (/未实现|not implemented|unknown action/i.test(message)) return { acceptedCount: 0, scannedCount: 0 };
    throw error;
  }
  const rows = normalizeQqBotDoubtFriendRequests(result?.data ?? result);
  const matched = input?.targetQqId
    ? rows.filter((row) => String(row.user_id || "") === input.targetQqId)
    : rows;
  let acceptedCount = 0;
  for (const row of matched) {
    const flag = String(row.flag || "").trim();
    if (!flag) continue;
    await callQqBotAction("set_doubt_friends_add_request", {
      flag,
      approve: true,
    });
    acceptedCount += 1;
    await logQqBotMessage({
      direction: "inbound",
      eventType: "friend-request",
      status: "ok",
      qqId: row.user_id ? String(row.user_id) : input?.targetQqId,
      result: `已自动通过可疑好友申请（${reason}）`,
      rawPayload: input?.rawPayload || row,
    });
  }
  return { acceptedCount, scannedCount: rows.length };
}

function normalizeQqBotDoubtFriendRequests(value: unknown): QqBotDoubtFriendRequest[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => item as QqBotDoubtFriendRequest);
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

export function normalizeQqBotQqIdList(input: readonly string[] | null | undefined) {
  const values = Array.isArray(input) ? input : [];
  return Array.from(new Set(
    values
      .map((item) => String(item || "").trim())
      .filter((item) => /^\d{5,20}$/.test(item)),
  ));
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
