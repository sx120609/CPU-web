import crypto from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { ensureForumAccessEnabled } from "./forumAccess";
import { isFeatureOn, featureForBoardType } from "./siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import { ensureUserCanSpeak } from "./userModeration";
import {
  ensureUserCanSubmitTopic,
  generateTopicAiTags,
  notifyTopicAiBlocked,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
  syncTopicAiTags,
} from "./topicAiReview";

export type QqBotConfigView = {
  id: number;
  enabled: boolean;
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

type OneBotEvent = {
  post_type?: string;
  message_type?: "private" | "group";
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  message_id?: number | string;
  message?: unknown;
  raw_message?: string;
  sender?: { nickname?: string; card?: string; user_id?: number | string };
};

const CONFIG_ID = 1;
const DEFAULT_NOTIFY_CATEGORIES = ["reply", "mention", "like", "system"];
let pollerStarted = false;
let wsClient: any = null;
let wsConnecting = false;
let wsReconnectTimer: NodeJS.Timeout | null = null;
let wsLastError = "";

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
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.qqBotBindToken.create({ data: { userId, token, expiresAt } });
  return { token, expiresAt };
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
  const context = { config, event, qqId, groupId, messageText };
  if (!qqId || !messageText.trim()) {
    await logQqBotMessage({ direction: "inbound", eventType: "message", status: "ignored", qqId, groupId, rawPayload: event });
    return { ignored: true };
  }

  if (isHelpCommand(messageText)) {
    await replyToEvent(context, renderHelp(config.defaultBoardSlug));
    return { ok: true };
  }
  if (/^\/?状态\b/.test(messageText.trim())) {
    await replyToEvent(context, await renderBindingStatus(qqId));
    return { ok: true };
  }
  const bindMatch = messageText.trim().match(/^\/?绑定\s+([A-Z0-9]{6,16})$/i);
  if (bindMatch) {
    const result = await bindQqAccount({
      qqId,
      nickname: event.sender?.card || event.sender?.nickname || "",
      token: bindMatch[1].toUpperCase(),
    });
    await replyToEvent(context, result);
    return { ok: true };
  }
  if (/^\/?#?投稿\b/.test(messageText.trim())) {
    try {
      const result = await submitQqPost(context);
      await replyToEvent(context, result.message);
      return { ok: true, topicId: result.topicId };
    } catch (error: any) {
      const message = error?.message || "投稿失败";
      await logQqBotMessage({
        direction: "inbound",
        eventType: "post",
        status: "error",
        qqId,
        groupId,
        messageId: event.message_id ? String(event.message_id) : undefined,
        command: "投稿",
        content: messageText.slice(0, 1000),
        result: message,
        rawPayload: event,
      });
      await replyToEvent(context, `投稿失败：${message}`);
      return { ok: false, error: message };
    }
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

async function bindQqAccount(input: { qqId: string; nickname?: string; token: string }) {
  const row = await prisma.qqBotBindToken.findUnique({
    where: { token: input.token },
    include: { user: { select: { id: true, nickname: true, status: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return "绑定码不存在或已过期，请在站内重新生成。";
  if (row.user.status === "banned") return "这个站内账号已被封禁，不能绑定 QQ。";
  await prisma.$transaction([
    prisma.qqBotBinding.upsert({
      where: { qqId: input.qqId },
      create: { qqId: input.qqId, userId: row.userId, nickname: input.nickname || null },
      update: { userId: row.userId, nickname: input.nickname || null, enabled: true },
    }),
    prisma.qqBotBindToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  return `绑定成功：${row.user.nickname}。之后可以用“投稿 标题\\n正文”把 QQ 内容搬运到论坛。`;
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
    return { message: `已搬运到平台，但暂未通过 AI 初审：${topic.aiReviewReason || "需要人工复核"}`, topicId: topic.id };
  }
  return { message: `已投稿到「${topic.board.name}」：${topic.title}\\n/forum/topic/${topic.id}`, topicId: topic.id };
}

async function parsePostCommand(text: string, defaultBoardSlug: string, groupId?: string) {
  const normalized = text.trim().replace(/^\/?#?投稿\s*/, "");
  const lines = normalized.split(/\r?\n/);
  const firstLine = (lines.shift() || "").trim();
  if (!firstLine) throw Errors.badRequest("投稿格式：投稿 [板块slug] 标题\\n正文");
  const group = groupId ? await prisma.qqBotGroup.findUnique({ where: { groupId } }) : null;
  const defaultSlug = group?.defaultBoardSlug || defaultBoardSlug || "general";
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
    if (seg?.type === "video") return "\n[视频]\n";
    if (seg?.type === "record") return "\n[语音]\n";
    return "";
  }).join("").trim();
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
  return /^\/?(帮助|help|菜单)$/i.test(text.trim());
}

function renderHelp(defaultBoardSlug: string) {
  return [
    "药大拾间 QQBot：",
    "绑定 绑定码 - 绑定站内账号",
    "状态 - 查看绑定状态",
    `投稿 标题\\n正文 - 投稿到默认板块 ${defaultBoardSlug}`,
    "投稿 板块slug 标题\\n正文 - 投稿到指定板块",
  ].join("\n");
}

async function renderBindingStatus(qqId: string) {
  const binding = await prisma.qqBotBinding.findUnique({
    where: { qqId },
    include: { user: { select: { nickname: true, username: true } } },
  });
  if (!binding?.enabled) return "当前 QQ 尚未绑定站内账号。";
  return `已绑定：${binding.user.nickname}（${binding.user.username}）`;
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
      scheduleWebSocketReconnect();
    });
    socket.addEventListener("error", (event: any) => {
      wsConnecting = false;
      if (wsClient === socket) wsClient = null;
      const message = `WebSocket 握手失败：${describeWebSocketError(event)}`;
      setWebSocketError(message);
      scheduleWebSocketReconnect();
    });
  } catch (error) {
    wsConnecting = false;
    setWebSocketError(`创建 WebSocket 失败：${describeWebSocketError(error)}`);
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
