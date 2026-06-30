import { Prisma, type Board, type Topic, type Reply } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { getCachedJson, setCachedJson } from "./cache";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import { refreshBoardTopicCount, refreshUserPostCount, refreshUserReplyCount } from "./forumStats";
import { config } from "../config";
import { Errors } from "../utils/response";
import { getSiteOrigin } from "./siteSettings";

export const WEIWALL_BOARD_SLUG = "campus-wall";
const WEIWALL_BOARD_NAME = "逛逛";
const WEIWALL_BOARD_DESCRIPTION = "从外部逛逛同步的只读镜像，自动刷新帖子与评论。";
const WEIWALL_BOARD_ICON = "📮";
const WEIWALL_BOARD_COLOR = "#0ea5e9";
const WEIWALL_DEFAULT_BASE_URL = "https://s.weiwall.com";
const WEIWALL_TICK_MS = 30_000;
const WEIWALL_MIN_INTERVAL_SECONDS = 30;
const WEIWALL_LOCK_MS = 4 * 60_000;
const WEIWALL_MAX_COMMENT_PAGE_SIZE = 20;
const WEIWALL_COMMENT_BACKFILL_TOPICS_PER_RUN = 12;
const WEIWALL_COMMENT_BACKFILL_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const WEIWALL_TRACE_LIMIT = 40;
const WEIWALL_BOT_USERNAME = "weiwall_sync_bot";
const WEIWALL_BOT_NICKNAME = "逛逛同步";
const WEIWALL_AUTH_FLOW_TTL_MS = 15 * 60_000;
const PRISMA_ID_IN_BATCH_SIZE = 10_000;

type WeiwallUserInfo = {
  uuid?: number | string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type WeiwallContactSourceFields = {
  linkPeople?: string | null;
  linkType?: number | string | null;
  linkInfo?: string | null;
};

type WeiwallTopicRow = WeiwallContactSourceFields & {
  id: number | string;
  title?: string | null;
  content?: string | null;
  createTime?: string | null;
  likeCount?: number | null;
  commentCount?: number | null;
  viewCount?: number | null;
  isAnon?: number | boolean | null;
  isTop?: number | boolean | null;
  isOver?: number | boolean | null;
  isDelete?: number | boolean | null;
  status?: string | number | null;
  node?: string | null;
  userInfo?: WeiwallUserInfo | null;
  imgs?: string[] | null;
  data?: { imgs?: string[] | null } | null;
};

type WeiwallReplyRow = {
  id: number | string;
  content?: string | null;
  createTime?: string | null;
  likeCount?: number | null;
  status?: string | number | null;
  isDelete?: number | boolean | null;
  userInfo?: WeiwallUserInfo | null;
  imgs?: string[] | null;
  topicId?: number | string | null;
  commentId?: number | string | null;
  replyId?: number | string | null;
};

type WeiwallCommentPage = {
  rows: WeiwallReplyRow[];
  page?: number;
  pageSize?: number;
};

function* chunks<T>(items: readonly T[], size: number) {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

function uniquePositiveIds(ids: Array<number | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)));
}

type WeiwallReadOnlyTopicDetail = WeiwallContactSourceFields & {
  id?: number | string;
  status?: string | number | null;
  commentCount?: number | null;
  likeCount?: number | null;
  viewCount?: number | null;
  createTime?: string | null;
  isOver?: number | boolean | null;
};

type FlattenedExternalReply = {
  row: WeiwallReplyRow;
  externalReplyId: string;
  parentExternalReplyId: string | null;
  externalCommentId: string | null;
};

type SyncClient = typeof prisma | Prisma.TransactionClient;

export type WeiwallSyncAdminConfig = {
  id: number;
  enabled: boolean;
  baseUrl: string;
  schoolEn: string;
  tenantId: number;
  tokenPresent: boolean;
  tokenPreview: string;
  tokenExpiresAt: string | null;
  tokenExpiresKnown: boolean;
  tokenExpired: boolean;
  intervalSeconds: number;
  topicPages: number;
  commentPageSize: number;
  maxCommentPages: number;
  maxReplyPages: number;
  board: null | {
    id: number;
    slug: string;
    name: string;
    readOnly: boolean;
    topicCount: number;
  };
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  lastSyncedAt: string | null;
};

export type WeiwallSyncPatch = Partial<{
  enabled: boolean;
  baseUrl: string;
  schoolEn: string;
  tenantId: number;
  token: string;
  clearToken: boolean;
  intervalSeconds: number;
  topicPages: number;
  commentPageSize: number;
  maxCommentPages: number;
  maxReplyPages: number;
}>;

export type WeiwallSyncResult = {
  ok: boolean;
  boardSlug: string;
  sourceName: string;
  pagesScanned: number;
  topicsScanned: number;
  topicsCreated: number;
  topicsUpdated: number;
  repliesCreated: number;
  repliesUpdated: number;
  authorsCreated: number;
  authorsUpdated: number;
  commentsFetched: number;
  latestExternalTopicId: string | null;
  topicTraces: WeiwallSyncTopicTrace[];
  error?: string | null;
};

export type WeiwallSyncTopicTrace = {
  phase: "latest" | "backfill";
  action: "fetched" | "probed" | "skipped";
  externalTopicId: string;
  localTopicId: number | null;
  title: string;
  remoteCommentCount: number | null;
  localReplyCountBefore: number | null;
  visibleReplyCountAfter: number | null;
  commentsFetched: number;
  repliesCreated: number;
  repliesUpdated: number;
  note: string | null;
};

export type WeiwallTokenAuthSession = {
  flowId: string;
  authorizeUrl: string;
  qrDataUrl: string;
  callbackUrl: string;
  expiresAt: string;
};

export type WeiwallTokenAuthStatus = {
  flowId: string;
  status: "pending" | "success" | "error" | "expired";
  expiresAt: string | null;
  completedAt: string | null;
  error: string | null;
};

type AuthorSyncCounters = {
  created: number;
  updated: number;
};

type WeiwallAuthFlowRecord = {
  flowId: string;
  schoolEn: string;
  expiresAtMs: number;
  status: "pending" | "success" | "error";
  completedAtMs: number | null;
  error: string | null;
  used: boolean;
};

type WeiwallAuthFlowPayload = {
  purpose: "weiwall-token-auth";
  flowId: string;
  schoolEn: string;
};

type WeiwallTokenMeta = {
  expiresAt: string | null;
  expiresAtMs: number | null;
  expiresKnown: boolean;
  expired: boolean;
};

class WeiwallRateLimitError extends Error {
  constructor(message = "请求过于频繁，请稍后再试") {
    super(message);
    this.name = "WeiwallRateLimitError";
  }
}

function isWeiwallRateLimitMessage(message: unknown) {
  const text = String(message ?? "");
  return /请求过于频繁|请稍后再试|rate limit/i.test(text);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weiwallAuthFlowCacheKey(flowId: string) {
  return `weiwall-auth-flow:${String(flowId).trim()}`;
}

function parseJsonSafe<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function trimTo(input: unknown, max: number, fallback = "") {
  const text = String(input ?? "").trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function maskToken(token: string) {
  if (!token) return "";
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function inspectWeiwallToken(token: string): WeiwallTokenMeta {
  const text = String(token || "").trim();
  if (!text) {
    return {
      expiresAt: null,
      expiresAtMs: null,
      expiresKnown: false,
      expired: false,
    };
  }
  const decoded = jwt.decode(text);
  if (!decoded || typeof decoded !== "object") {
    return {
      expiresAt: null,
      expiresAtMs: null,
      expiresKnown: false,
      expired: false,
    };
  }
  const expSeconds = Number((decoded as Record<string, unknown>).exp ?? 0);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
    return {
      expiresAt: null,
      expiresAtMs: null,
      expiresKnown: false,
      expired: false,
    };
  }
  const expiresAtMs = Math.round(expSeconds * 1000);
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    expiresKnown: true,
    expired: expiresAtMs <= Date.now(),
  };
}

function shortDateTime(input: string | null) {
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function weiwallTokenHash(token: string) {
  return createHash("sha1").update(String(token || "").trim()).digest("hex").slice(0, 16);
}

async function notifyAdminsIfWeiwallTokenExpired(token: string, expiresAt: string) {
  const admins = await prisma.user.findMany({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  if (!admins.length) return;
  const tokenHash = weiwallTokenHash(token);
  const existing = await prisma.notification.findMany({
    where: {
      userId: { in: admins.map((item) => item.id) },
      category: "system",
      source: "逛逛同步",
      title: "逛逛 Token 已过期",
      AND: [
        { payload: { contains: "\"type\":\"weiwall-token-expired\"" } },
        { payload: { contains: `"tokenHash":"${tokenHash}"` } },
      ],
    },
    select: { userId: true },
  });
  const existingUserIds = new Set(existing.map((item) => item.userId).filter((value): value is number => typeof value === "number"));
  const missingUserIds = admins.map((item) => item.id).filter((id) => !existingUserIds.has(id));
  if (!missingUserIds.length) return;
  const payload = JSON.stringify({
    type: "weiwall-token-expired",
    tokenHash,
    expiresAt,
  });
  await prisma.notification.createMany({
    data: missingUserIds.map((userId) => ({
      userId,
      category: "system",
      level: "warning",
      title: "逛逛 Token 已过期",
      content: `当前逛逛 Token 已于 ${shortDateTime(expiresAt)} 过期，请尽快重新授权。`,
      source: "逛逛同步",
      link: "/admin?tab=weiwall",
      payload,
    })),
  }).catch(() => {});
}

async function maybeNotifyWeiwallTokenExpired(token: string) {
  const meta = inspectWeiwallToken(token);
  if (!meta.expiresKnown || !meta.expired || !meta.expiresAt) return meta;
  await notifyAdminsIfWeiwallTokenExpired(token, meta.expiresAt);
  return meta;
}

function coerceBool(input: unknown) {
  return input === true || input === 1 || input === "1";
}

function externalId(input: unknown) {
  return String(input ?? "").trim();
}

function parseExternalTime(input: string | null | undefined) {
  if (!input) return new Date();
  const normalized = input.trim().replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function uniqStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function pushWeiwallTrace(result: WeiwallSyncResult, trace: WeiwallSyncTopicTrace) {
  if (result.topicTraces.length >= WEIWALL_TRACE_LIMIT) return;
  result.topicTraces.push(trace);
}

function describeCommentSyncReason(input: {
  remoteCommentCount: number;
  lastCommentCount?: number | null;
  localReplyCount?: number | null;
  needsReplyAuthorBackfill?: number;
}) {
  const notes: string[] = [];
  if (input.remoteCommentCount !== Math.max(0, Number(input.lastCommentCount ?? 0) || 0)) {
    notes.push("远端 commentCount 有变化");
  }
  if (input.remoteCommentCount !== Math.max(0, Number(input.localReplyCount ?? 0) || 0)) {
    notes.push("远端评论数与本地 replyCount 不一致");
  }
  if ((input.needsReplyAuthorBackfill ?? 0) > 0) {
    notes.push("历史回复作者信息需要补齐");
  }
  return notes.join("；") || "本轮未命中评论补抓条件";
}

function looksLikeWeiwallBlockedBody(content: unknown) {
  const body = String(content ?? "").trim();
  if (!body) return false;
  const compact = body.replace(/\s+/g, "");
  if (/^[-_=~*#.^。·—]{5,}$/.test(compact)) return true;
  const normalized = compact.toLowerCase();
  return [
    "该内容已被屏蔽",
    "内容已被屏蔽",
    "该评论已被屏蔽",
    "该回复已被屏蔽",
    "该内容无法查看",
  ].includes(normalized);
}

function renderWeiwallBlockedNotice() {
  return [
    "> **该内容被逛逛屏蔽，当前无法查看原文。**",
  ].join("\n");
}

async function countLegacyBlockedPlaceholderReplies(externalTopicId: string) {
  const rows = await prisma.weiwallReplyMap.findMany({
    where: { externalTopicId },
    select: {
      localReply: {
        select: {
          content: true,
        },
      },
    },
  });
  let count = 0;
  for (const row of rows) {
    if (looksLikeWeiwallBlockedBody(row.localReply?.content)) count += 1;
  }
  return count;
}

function renderExternalContent(content: unknown, images: Array<string | null | undefined>) {
  const body = String(content ?? "").trim();
  if (looksLikeWeiwallBlockedBody(body)) return renderWeiwallBlockedNotice();
  const uniqImages = uniqStrings(images);
  const imageMarkdown = uniqImages.map((url) => `![](${url})`).join("\n\n");
  if (body && imageMarkdown) return `${body}\n\n${imageMarkdown}`;
  if (body) return body;
  if (imageMarkdown) return imageMarkdown;
  return "_（外部内容为空）_";
}

function summarizeExternalText(input: unknown, max = 60) {
  const text = String(input ?? "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.slice(0, max);
}

function sanitizeWeiwallStorageText(input: unknown, max = 0) {
  const raw = String(input ?? "");
  let normalized = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t") continue;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    normalized += char;
  }
  normalized = normalized.replace(/\\x[0-9a-fA-F]?/g, " ").replace(/\\u(?![0-9a-fA-F]{4})/g, " ");
  normalized = normalized.replace(/\r\n/g, "\n").trim();
  if (max > 0) return normalized.slice(0, max);
  return normalized;
}

function normalizeWeiwallBinaryFlag(input: unknown) {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "boolean") return input ? 1 : 0;
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  return value > 0 ? 1 : 0;
}

function normalizeWeiwallContactType(input: unknown): 0 | 1 | 2 | null {
  const value = Number(input);
  if (value === 0 || value === 1 || value === 2) return value;
  return null;
}

function extractWeiwallTopicStateMetadata(input: { status?: unknown; isOver?: unknown }) {
  const metadata: Record<string, any> = {};
  const externalStatus = sanitizeWeiwallStorageText(String(input.status ?? "").trim(), 32);
  const externalIsOver = normalizeWeiwallBinaryFlag(input.isOver);
  if (externalStatus) metadata.externalStatus = externalStatus;
  if (externalIsOver !== null) metadata.externalIsOver = externalIsOver;
  return metadata;
}

function extractWeiwallContactMetadata(input: WeiwallContactSourceFields) {
  const metadata: Record<string, any> = {};
  const linkType = normalizeWeiwallContactType(input.linkType);
  const linkPeople = sanitizeWeiwallStorageText(String(input.linkPeople ?? "").trim(), 40);
  const linkInfo = sanitizeWeiwallStorageText(String(input.linkInfo ?? "").trim(), 80);
  if (linkType !== null) metadata.linkType = linkType;
  if (linkPeople) metadata.linkPeople = linkPeople;
  if (linkInfo) metadata.linkInfo = linkInfo;
  return metadata;
}

function hasWeiwallContactMetadata(input: Record<string, any>) {
  return "linkType" in input || "linkPeople" in input || "linkInfo" in input;
}

function pickStoredWeiwallContactMetadata(raw: unknown) {
  if (!raw || typeof raw !== "object") return {};
  return extractWeiwallContactMetadata(raw as WeiwallContactSourceFields);
}

function stripWeiwallDetailMetadata(raw: unknown) {
  const metadata = raw && typeof raw === "object" ? { ...(raw as Record<string, any>) } : {};
  delete metadata.externalStatus;
  delete metadata.externalIsOver;
  delete metadata.linkPeople;
  delete metadata.linkType;
  delete metadata.linkInfo;
  delete metadata.weiwallDetailLoaded;
  return metadata;
}

function hasWeiwallDetailLoaded(raw: unknown) {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, any>).weiwallDetailLoaded === true);
}

function deriveLocalTitle(topic: WeiwallTopicRow) {
  const explicit = trimTo(topic.title, 120);
  if (explicit && explicit !== "none") return explicit;
  const fromContent = summarizeExternalText(topic.content, 80);
  if (fromContent) return fromContent;
  return `逛逛帖子 ${externalId(topic.id) || "unknown"}`;
}

function buildMirroredTopicFallbackContent(sourceUrl: string) {
  return [
    "> 这条逛逛帖子在同步时遇到格式问题。",
    "",
    `> 请前往原帖查看：${sourceUrl}`,
  ].join("\n");
}

function formatTraceTitle(input: {
  title?: string | null;
  content?: string | null;
  externalTopicId?: string | null;
  localTopicId?: number | null;
}) {
  const title = trimTo(input.title, 120);
  if (title && title.toLowerCase() !== "none") return title;
  const fromContent = summarizeExternalText(input.content, 80);
  if (fromContent) return fromContent;
  const localId = Number(input.localTopicId ?? 0) || 0;
  const externalTopicId = String(input.externalTopicId || "").trim();
  if (localId > 0 && externalTopicId) return `本地#${localId} / 外部#${externalTopicId}`;
  if (externalTopicId) return `外部#${externalTopicId}`;
  if (localId > 0) return `本地#${localId}`;
  return "未命名帖子";
}

function normalizeExternalAuthor(userInfo?: WeiwallUserInfo | null) {
  const uuid = String(userInfo?.uuid ?? "").trim();
  const nickname = trimTo(userInfo?.nickname, 40, "神秘同学");
  const avatar = trimTo(userInfo?.avatar, 500);
  if (uuid && uuid !== "0") {
    return {
      externalKey: `uuid:${uuid}`,
      externalUuid: uuid,
      nickname,
      avatar: avatar || null,
    };
  }
  const hash = createHash("sha1").update(`${nickname}|${avatar}`).digest("hex").slice(0, 16);
  return {
    externalKey: `anon:${hash}`,
    externalUuid: null,
    nickname,
    avatar: avatar || null,
  };
}

function looksLikeWeiwallAdvertisement(topic: WeiwallTopicRow) {
  const text = `${trimTo(topic.title, 300)}\n${trimTo(topic.content, 5000)}`;
  let score = 0;
  if (/流量卡|校园卡|办卡|换卡|套餐到期|充值|充100得200|视频会员|兑换任意两杯/.test(text)) score += 2;
  if (/扫码下方二维码|二维码|负责人微信办理|超值优惠活动|重磅来袭|免费用|月底前/.test(text)) score += 2;
  if (/福利君|校园代理|推广|合作|限时活动/.test(`${trimTo(topic.userInfo?.nickname, 80)} ${text}`)) score += 1;
  if ((topic.imgs?.length || topic.data?.imgs?.length || 0) >= 2 && /优惠|活动|福利|礼包/.test(text)) score += 1;
  return score >= 3;
}

async function ensureWeiwallBotUser(client: SyncClient) {
  const existing = await client.user.findUnique({
    where: { username: WEIWALL_BOT_USERNAME },
    select: { id: true, nickname: true, role: true, avatar: true },
  });
  if (existing) {
    if (existing.role !== "bot" || existing.nickname !== WEIWALL_BOT_NICKNAME || existing.avatar) {
      await client.user.update({
        where: { id: existing.id },
        data: { role: "bot", nickname: WEIWALL_BOT_NICKNAME, avatar: null },
      });
    }
    return { id: existing.id };
  }
  const created = await client.user.create({
    data: {
      username: WEIWALL_BOT_USERNAME,
      passwordHash: "__disabled__",
      nickname: WEIWALL_BOT_NICKNAME,
      role: "bot",
      avatar: null,
    },
    select: { id: true },
  });
  return created;
}

async function cleanupLegacyWeiwallUsers() {
  const users = await prisma.user.findMany({
    where: {
      username: { startsWith: "ww_" },
      studentSso: false,
      forumEnabled: false,
      lastLoginAt: null,
    },
    select: { id: true },
    take: 2000,
  });
  for (const user of users) {
    const [topicCount, replyCount] = await Promise.all([
      prisma.topic.count({ where: { authorId: user.id } }),
      prisma.reply.count({ where: { authorId: user.id } }),
    ]);
    if (topicCount === 0 && replyCount === 0) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  }
}

async function normalizeLegacyMirroredAuthorAssignments(botUserId: number) {
  const [topicMaps, replyMaps] = await Promise.all([
    prisma.weiwallTopicMap.findMany({ select: { localTopicId: true } }),
    prisma.weiwallReplyMap.findMany({ select: { localReplyId: true } }),
  ]);
  const topicIds = uniquePositiveIds(topicMaps.map((item) => item.localTopicId));
  if (topicIds.length) {
    for (const batch of chunks(topicIds, PRISMA_ID_IN_BATCH_SIZE)) {
      await prisma.topic.updateMany({
        where: { id: { in: batch }, authorId: { not: botUserId } },
        data: { authorId: botUserId },
      });
    }
  }
  const replyIds = uniquePositiveIds(replyMaps.map((item) => item.localReplyId));
  if (replyIds.length) {
    for (const batch of chunks(replyIds, PRISMA_ID_IN_BATCH_SIZE)) {
      await prisma.reply.updateMany({
        where: { id: { in: batch }, authorId: { not: botUserId } },
        data: { authorId: botUserId },
      });
    }
  }
}

function topicHidden(topic: WeiwallTopicRow) {
  return Boolean(coerceBool(topic.isDelete) || isWeiwallContentHiddenStatus(topic.status));
}

function replyHidden(reply: WeiwallReplyRow) {
  return Boolean(coerceBool(reply.isDelete) || isWeiwallContentHiddenStatus(reply.status));
}

function isWeiwallContentHiddenStatus(status: unknown) {
  const text = String(status ?? "").trim().toLowerCase();
  if (!text) return false;
  if (["0", "1", "normal", "active", "open", "ok", "success"].includes(text)) return false;
  return [
    "delete",
    "deleted",
    "removed",
    "hide",
    "hidden",
    "ban",
    "banned",
    "forbid",
    "forbidden",
    "block",
    "blocked",
    "close",
    "closed",
    "disable",
    "disabled",
    "over",
  ].includes(text);
}

function buildTopicSourceUrl(baseUrl: string, schoolEn: string, topicId: string) {
  const url = new URL("/pages/index/detail", baseUrl || WEIWALL_DEFAULT_BASE_URL);
  url.searchParams.set("id", topicId);
  url.searchParams.set("s", schoolEn || "cpu");
  url.searchParams.set("source", "home");
  return url.toString();
}

async function nextBoardOrder(client: SyncClient) {
  return ((await client.board.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  }))?.order ?? -1) + 1;
}

async function ensureWeiwallBoard(client: SyncClient = prisma) {
  const existing = await client.board.findUnique({ where: { slug: WEIWALL_BOARD_SLUG } });
  if (existing) {
    const needsUpdate =
      existing.name !== WEIWALL_BOARD_NAME
      || (existing.description || "") !== WEIWALL_BOARD_DESCRIPTION
      || (existing.icon || "") !== WEIWALL_BOARD_ICON
      || (existing.color || "") !== WEIWALL_BOARD_COLOR
      || existing.readOnly !== true
      || existing.anonymousEnabled !== false;
    if (!needsUpdate) return existing;
    return client.board.update({
      where: { id: existing.id },
      data: {
        name: WEIWALL_BOARD_NAME,
        description: WEIWALL_BOARD_DESCRIPTION,
        icon: WEIWALL_BOARD_ICON,
        color: WEIWALL_BOARD_COLOR,
        readOnly: true,
        anonymousEnabled: false,
      },
    });
  }
  return client.board.create({
    data: {
      slug: WEIWALL_BOARD_SLUG,
      name: WEIWALL_BOARD_NAME,
      description: WEIWALL_BOARD_DESCRIPTION,
      icon: WEIWALL_BOARD_ICON,
      color: WEIWALL_BOARD_COLOR,
      order: await nextBoardOrder(client),
      type: "normal",
      readOnly: true,
      anonymousEnabled: false,
    },
  });
}

async function ensureWeiwallSyncConfigRow(client: SyncClient = prisma) {
  const existing = await client.weiwallSyncConfig.findFirst({
    include: {
      board: {
        select: { id: true, slug: true, name: true, readOnly: true, topicCount: true },
      },
    },
    orderBy: { id: "asc" },
  });
  if (existing) return existing;
  const board = await ensureWeiwallBoard(client);
  return client.weiwallSyncConfig.create({
    data: {
      boardId: board.id,
    },
    include: {
      board: {
        select: { id: true, slug: true, name: true, readOnly: true, topicCount: true },
      },
    },
  });
}

function toAdminConfig(row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>): WeiwallSyncAdminConfig {
  const tokenMeta = inspectWeiwallToken(row.token);
  return {
    id: row.id,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    schoolEn: row.schoolEn,
    tenantId: row.tenantId,
    tokenPresent: Boolean(row.token),
    tokenPreview: maskToken(row.token),
    tokenExpiresAt: tokenMeta.expiresAt,
    tokenExpiresKnown: tokenMeta.expiresKnown,
    tokenExpired: tokenMeta.expired,
    intervalSeconds: row.intervalSeconds,
    topicPages: row.topicPages,
    commentPageSize: row.commentPageSize,
    maxCommentPages: row.maxCommentPages,
    maxReplyPages: row.maxReplyPages,
    board: row.board ? {
      id: row.board.id,
      slug: row.board.slug,
      name: row.board.name,
      readOnly: row.board.readOnly,
      topicCount: row.board.topicCount,
    } : null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunOk: row.lastRunOk ?? null,
    lastError: row.lastError ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function getWeiwallSyncAdminConfig() {
  const row = await ensureWeiwallSyncConfigRow();
  if (row.token) await maybeNotifyWeiwallTokenExpired(row.token);
  return toAdminConfig(row);
}

export async function updateWeiwallSyncConfig(patch: WeiwallSyncPatch) {
  const current = await ensureWeiwallSyncConfigRow();
  const data: Prisma.WeiwallSyncConfigUncheckedUpdateInput = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.baseUrl !== undefined) data.baseUrl = trimTo(patch.baseUrl, 240, WEIWALL_DEFAULT_BASE_URL);
  if (patch.schoolEn !== undefined) data.schoolEn = trimTo(patch.schoolEn, 40, "cpu");
  if (patch.tenantId !== undefined) data.tenantId = patch.tenantId;
  if (patch.token !== undefined) data.token = String(patch.token ?? "").trim();
  if (patch.clearToken) data.token = "";
  if (patch.intervalSeconds !== undefined) {
    data.intervalSeconds = Math.max(WEIWALL_MIN_INTERVAL_SECONDS, Math.min(3600, Math.round(patch.intervalSeconds)));
  }
  if (patch.topicPages !== undefined) data.topicPages = Math.max(1, Math.min(20, Math.round(patch.topicPages)));
  if (patch.commentPageSize !== undefined) {
    data.commentPageSize = Math.max(5, Math.min(WEIWALL_MAX_COMMENT_PAGE_SIZE, Math.round(patch.commentPageSize)));
  }
  if (patch.maxCommentPages !== undefined) data.maxCommentPages = Math.max(1, Math.min(50, Math.round(patch.maxCommentPages)));
  if (patch.maxReplyPages !== undefined) data.maxReplyPages = Math.max(1, Math.min(50, Math.round(patch.maxReplyPages)));

  const board = await ensureWeiwallBoard();
  await prisma.weiwallSyncConfig.update({
    where: { id: current.id },
    data: {
      ...data,
      boardId: current.boardId ?? board.id,
    },
  });
  return toAdminConfig(await ensureWeiwallSyncConfigRow());
}

async function fetchTenantName(baseUrl: string) {
  const res = await fetch(new URL("/api/client/tenant", baseUrl).toString(), {
    headers: { Accept: "application/json" },
  });
  const json = parseJsonSafe<any>(await res.text(), {});
  return trimTo(json?.data?.tenantName, 80, "逛逛");
}

async function weiwallFetchJson(row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>, path: string, query?: Record<string, string | number | null | undefined>) {
  const url = new URL(path, row.baseUrl || WEIWALL_DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${row.token}`,
        Tenant: String(row.tenantId),
        "User-Agent": "Mozilla/5.0",
      },
    });
    const text = await res.text();
    const json = parseJsonSafe<any>(text, {});
    const message = json?.errmsg || json?.message || `WeiWall 请求失败 (${res.status})`;
    if (json?.status === "unauthorized" || json?.errcode === 4010001 || json?.errcode === 4010002) {
      throw new Error(message);
    }
    if (isWeiwallRateLimitMessage(message)) {
      if (attempt < 2) {
        await delay(1200 * (attempt + 1));
        continue;
      }
      throw new WeiwallRateLimitError(message);
    }
    if (!res.ok) throw new Error(message);
    return json;
  }
  throw new Error("WeiWall 请求失败");
}

async function weiwallPostJson(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  path: string,
  body: Record<string, unknown>,
  contentType: "application/json" | "application/x-www-form-urlencoded" = "application/json",
) {
  const url = new URL(path, row.baseUrl || WEIWALL_DEFAULT_BASE_URL);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Tenant: String(row.tenantId),
    "User-Agent": "Mozilla/5.0",
  };
  let payload = "";
  if (contentType === "application/x-www-form-urlencoded") {
    headers["Content-Type"] = contentType;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    payload = params.toString();
  } else {
    headers["Content-Type"] = contentType;
    payload = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: payload,
  });
  const text = await res.text();
  const json = parseJsonSafe<any>(text, {});
  const message = json?.errmsg || json?.message || `WeiWall 请求失败 (${res.status})`;
  if (!res.ok) throw new Error(message);
  return json;
}

async function weiwallFetchPublicJson(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  path: string,
  query?: Record<string, string | number | null | undefined>,
) {
  const url = new URL(path, row.baseUrl || WEIWALL_DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Tenant: String(row.tenantId),
        "User-Agent": "Mozilla/5.0",
      },
    });
    const text = await res.text();
    const json = parseJsonSafe<any>(text, {});
    const message = json?.errmsg || json?.message || `WeiWall 请求失败 (${res.status})`;
    if (isWeiwallRateLimitMessage(message)) {
      if (attempt < 2) {
        await delay(1200 * (attempt + 1));
        continue;
      }
      throw new WeiwallRateLimitError(message);
    }
    if (!res.ok) throw new Error(message);
    return json;
  }
  throw new Error("WeiWall 请求失败");
}

async function fetchLatestTopics(row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>) {
  const collected: WeiwallTopicRow[] = [];
  const seen = new Set<string>();
  let lastId = "";
  let pagesScanned = 0;
  let rateLimited = false;
  let rateLimitMessage: string | null = null;
  for (let page = 1; page <= row.topicPages; page++) {
    let json: any;
    try {
      json = await weiwallFetchJson(row, "/api/client/topics", {
        page,
        last_id: lastId || undefined,
        pageSize: 20,
        page_size: 20,
      });
    } catch (error: any) {
      if (!(error instanceof WeiwallRateLimitError)) throw error;
      rateLimited = true;
      rateLimitMessage = error.message;
      break;
    }
    const rows = Array.isArray(json?.data?.rows) ? (json.data.rows as WeiwallTopicRow[]) : [];
    pagesScanned++;
    if (!rows.length) break;
    for (const topic of rows) {
      const topicId = externalId(topic.id);
      if (!topicId || seen.has(topicId)) continue;
      seen.add(topicId);
      collected.push(topic);
    }
    lastId = externalId(rows[rows.length - 1]?.id);
    if (!lastId) break;
  }
  return { pagesScanned, rows: collected, rateLimited, rateLimitMessage };
}

async function fetchCommentPage(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  args: {
    topicId: string;
    page: number;
    pageSize: number;
    commentId?: string | null;
    replyId?: string | null;
    sort?: string;
  },
) {
  const pageSize = Math.max(5, Math.min(WEIWALL_MAX_COMMENT_PAGE_SIZE, Math.round(args.pageSize)));
  const json = await weiwallFetchJson(row, "/api/client/comments", {
    topic_id: args.topicId,
    comment_id: args.commentId ?? undefined,
    reply_id: args.replyId ?? undefined,
    sort: args.sort ?? "time",
    page: args.page,
    pageSize,
    page_size: pageSize,
  });
  return {
    rows: Array.isArray(json?.data?.rows) ? (json.data.rows as WeiwallReplyRow[]) : [],
    page: Number(json?.data?.page ?? args.page),
    pageSize: Number(json?.data?.pageSize ?? pageSize),
  } satisfies WeiwallCommentPage;
}

async function fetchReadOnlyTopicDetail(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  topicId: string,
) {
  const json = await weiwallFetchPublicJson(row, `/api/client/topics/read_only/${encodeURIComponent(topicId)}`);
  return (json?.data ?? null) as WeiwallReadOnlyTopicDetail | null;
}

async function removeWeiwallHotEntries(boardId: number) {
  const removed = await prisma.topic.deleteMany({
    where: {
      boardId,
      metadata: { contains: "\"weiwallHotEntry\":true" },
    },
  });
  return removed.count > 0;
}

async function finalizeWeiwallEntryChanges(boardId: number, botUserId: number) {
  await refreshBoardTopicCount(boardId);
  await refreshUserPostCount(botUserId);
  await invalidateBoardCaches();
  await invalidateForumCaches();
}

function signWeiwallAuthFlowToken(payload: WeiwallAuthFlowPayload) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: Math.floor(WEIWALL_AUTH_FLOW_TTL_MS / 1000),
  });
}

function verifyWeiwallAuthFlowToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as WeiwallAuthFlowPayload;
}

function normalizeOrigin(origin: string) {
  const text = String(origin ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(text)) throw Errors.badRequest("当前站点地址不合法，无法生成微信授权链接");
  return text;
}

async function readWeiwallAuthFlow(flowId: string) {
  return await getCachedJson<WeiwallAuthFlowRecord>(weiwallAuthFlowCacheKey(flowId));
}

async function writeWeiwallAuthFlow(record: WeiwallAuthFlowRecord, ttlMs = WEIWALL_AUTH_FLOW_TTL_MS) {
  await setCachedJson(weiwallAuthFlowCacheKey(record.flowId), record, ttlMs);
}

async function buildWeiwallOfficialAuthorizeUrl(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  redirectUri: string,
) {
  const payload = { redirect_uri: encodeURIComponent(redirectUri) };
  let json = await weiwallPostJson(row, "/api/client/wxjssdk/official_authorizer_url", payload).catch(async (error) => {
    const message = String((error as Error)?.message ?? error ?? "");
    if (!/不能为空/.test(message)) throw error;
    return await weiwallPostJson(row, "/api/client/wxjssdk/official_authorizer_url", payload, "application/x-www-form-urlencoded");
  });
  if (!json?.data?.url) throw new Error(String(json?.errmsg || json?.message || "未获取到微信授权地址"));
  return String(json.data.url);
}

async function exchangeWeiwallCodeForToken(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  school: string,
  code: string,
) {
  const payload = { school, code };
  let json = await weiwallPostJson(row, "/api/client/users", payload).catch(async (error) => {
    const message = String((error as Error)?.message ?? error ?? "");
    if (!/不能为空/.test(message)) throw error;
    return await weiwallPostJson(row, "/api/client/users", payload, "application/x-www-form-urlencoded");
  });
  const token = String(json?.data?.token || "").trim();
  if (!token) throw new Error(String(json?.errmsg || json?.message || "未获取到 token"));
  return token;
}

export async function createWeiwallTokenAuthSession(origin: string) {
  const configRow = await ensureWeiwallSyncConfigRow();
  const normalizedOrigin = normalizeOrigin(getSiteOrigin() || origin);
  const flowId = randomUUID();
  const expiresAtMs = Date.now() + WEIWALL_AUTH_FLOW_TTL_MS;
  const flowToken = signWeiwallAuthFlowToken({
    purpose: "weiwall-token-auth",
    flowId,
    schoolEn: configRow.schoolEn || "cpu",
  });
  const callbackUrl = `${normalizedOrigin}/api/weiwall-auth/callback?flow=${encodeURIComponent(flowToken)}`;
  const authorizeUrl = await buildWeiwallOfficialAuthorizeUrl(configRow, callbackUrl);
  const qrDataUrl = await QRCode.toDataURL(authorizeUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
  await writeWeiwallAuthFlow({
    flowId,
    schoolEn: configRow.schoolEn || "cpu",
    expiresAtMs,
    status: "pending",
    completedAtMs: null,
    error: null,
    used: false,
  });
  return {
    flowId,
    authorizeUrl,
    qrDataUrl,
    callbackUrl,
    expiresAt: new Date(expiresAtMs).toISOString(),
  } satisfies WeiwallTokenAuthSession;
}

export async function getWeiwallTokenAuthStatus(flowId: string) {
  const record = await readWeiwallAuthFlow(String(flowId).trim());
  if (!record) {
    return {
      flowId: String(flowId).trim(),
      status: "expired",
      expiresAt: null,
      completedAt: null,
      error: "授权会话不存在或已过期",
    } satisfies WeiwallTokenAuthStatus;
  }
  const expired = record.expiresAtMs <= Date.now();
  return {
    flowId: record.flowId,
    status: expired && record.status === "pending" ? "expired" : record.status,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    completedAt: record.completedAtMs ? new Date(record.completedAtMs).toISOString() : null,
    error: expired && record.status === "pending" ? "授权会话已过期" : record.error,
  } satisfies WeiwallTokenAuthStatus;
}

export async function completeWeiwallTokenAuthCallback(input: {
  flowToken: string;
  school?: string | null;
  code?: string | null;
}) {
  const payload = verifyWeiwallAuthFlowToken(String(input.flowToken || ""));
  if (payload.purpose !== "weiwall-token-auth") throw Errors.badRequest("授权凭证无效");
  const record = await readWeiwallAuthFlow(payload.flowId);
  if (!record || record.expiresAtMs <= Date.now()) {
    throw Errors.badRequest("授权会话已过期，请重新生成二维码");
  }
  if (record.used) {
    throw Errors.badRequest("授权会话已使用，请重新生成二维码");
  }
  const school = String(input.school || record.schoolEn || payload.schoolEn || "").trim();
  const code = String(input.code || "").trim();
  if (!school || !code) throw Errors.badRequest("缺少 school 或 code，无法完成授权");
  try {
    const configRow = await ensureWeiwallSyncConfigRow();
    const token = await exchangeWeiwallCodeForToken(configRow, school, code);
    await prisma.weiwallSyncConfig.update({
      where: { id: configRow.id },
      data: {
        schoolEn: school,
        token,
        lastError: null,
      },
    });
    record.used = true;
    record.status = "success";
    record.error = null;
    record.completedAtMs = Date.now();
    await writeWeiwallAuthFlow(record, 10 * 60_000);
    return {
      ok: true,
      title: "逛逛 Token 已更新",
      message: "新的逛逛 Token 已自动保存，现在可以返回后台继续使用。",
    };
  } catch (error: any) {
    record.used = true;
    record.status = "error";
    record.error = error?.message ?? String(error);
    record.completedAtMs = Date.now();
    await writeWeiwallAuthFlow(record, 10 * 60_000);
    throw error;
  }
}

async function fetchTopicComments(
  row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  topicId: string,
  counters: { commentsFetched: number },
  control: { commentFetchStopped: boolean; rateLimitMessage: string | null },
) {
  if (control.commentFetchStopped) return [];
  const topLevelRows: Array<WeiwallReplyRow & { children: WeiwallReplyRow[] }> = [];
  for (let page = 1; page <= row.maxCommentPages; page++) {
    let pageData: WeiwallCommentPage;
    try {
      pageData = await fetchCommentPage(row, {
        topicId,
        page,
        pageSize: row.commentPageSize,
        sort: "time",
      });
    } catch (error: any) {
      if (!(error instanceof WeiwallRateLimitError)) throw error;
      control.commentFetchStopped = true;
      control.rateLimitMessage = error.message;
      break;
    }
    if (!pageData.rows.length) break;
    counters.commentsFetched += pageData.rows.length;
    for (const current of pageData.rows) {
      const previewChildren = Array.isArray((current as any).replys?.rows)
        ? ((current as any).replys.rows as WeiwallReplyRow[])
        : [];
      const childCount = Number((current as any).replys?.count ?? previewChildren.length ?? 0);
      const childMap = new Map<string, WeiwallReplyRow>();
      for (const child of previewChildren) {
        childMap.set(externalId(child.id), child);
      }
      if (childCount > childMap.size) {
        for (let childPage = 1; childPage <= row.maxReplyPages; childPage++) {
          let nested: WeiwallCommentPage;
          try {
            nested = await fetchCommentPage(row, {
              topicId,
              commentId: externalId(current.id),
              replyId: externalId((current as any).replyId ?? 0),
              page: childPage,
              pageSize: row.commentPageSize,
              sort: "time",
            });
          } catch (error: any) {
            if (!(error instanceof WeiwallRateLimitError)) throw error;
            control.commentFetchStopped = true;
            control.rateLimitMessage = error.message;
            break;
          }
          if (!nested.rows.length) break;
          counters.commentsFetched += nested.rows.length;
          for (const child of nested.rows) {
            childMap.set(externalId(child.id), child);
          }
          if (nested.rows.length < row.commentPageSize) break;
        }
      }
      topLevelRows.push({
        ...current,
        children: [...childMap.values()].sort((a, b) => {
          const timeDiff = parseExternalTime(a.createTime).getTime() - parseExternalTime(b.createTime).getTime();
          if (timeDiff !== 0) return timeDiff;
          return externalId(a.id).localeCompare(externalId(b.id));
        }),
      });
    }
    if (pageData.rows.length < row.commentPageSize) break;
    if (control.commentFetchStopped) break;
  }
  return topLevelRows;
}

function externalAuthorForStorage(userInfo: WeiwallUserInfo | null | undefined) {
  const normalized = normalizeExternalAuthor(userInfo);
  return {
    key: normalized.externalKey,
    uuid: normalized.externalUuid,
    name: normalized.nickname,
    avatar: normalized.avatar,
  };
}

async function attachTopicNodeTag(client: SyncClient, topicId: number, nodeName: string | null | undefined) {
  const name = trimTo(nodeName, 20);
  if (!name) return;
  const tag = await client.tag.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  await client.topicTag.upsert({
    where: { topicId_tagId: { topicId, tagId: tag.id } },
    update: {},
    create: { topicId, tagId: tag.id },
  });
}

async function syncTopicReplies(
  client: SyncClient,
  localTopic: Pick<Topic, "id" | "authorId" | "createdAt">,
  externalTopicId: string,
  comments: Array<WeiwallReplyRow & { children: WeiwallReplyRow[] }>,
  botUserId: number,
) {
  const replyMaps = await client.weiwallReplyMap.findMany({
    where: { externalTopicId },
    select: { id: true, externalReplyId: true, localReplyId: true, externalCreatedAt: true, externalAuthorName: true, externalAuthorAvatar: true, externalAuthorUuid: true },
  });
  const replyMapByExternal = new Map(replyMaps.map((item) => [item.externalReplyId, item]));
  const touchedReplyAuthorIds = new Set<number>();
  let repliesCreated = 0;
  let repliesUpdated = 0;

  const upsertOne = async (entry: FlattenedExternalReply) => {
    const externalAuthor = externalAuthorForStorage(entry.row.userInfo);
    const replyId = entry.externalReplyId;
    const parentLocalReplyId = entry.parentExternalReplyId
      ? replyMapByExternal.get(entry.parentExternalReplyId)?.localReplyId ?? null
      : null;
    const createdAt = parseExternalTime(entry.row.createTime);
    const hidden = replyHidden(entry.row);
    const data: Prisma.ReplyUncheckedCreateInput = {
      topicId: localTopic.id,
      authorId: botUserId,
      content: renderExternalContent(entry.row.content, entry.row.imgs ?? []),
      parentReplyId: parentLocalReplyId,
      hidden,
      likeCount: Number(entry.row.likeCount ?? 0) || 0,
      floor: 0,
      createdAt,
    };
    const existing = replyMapByExternal.get(replyId);
    if (existing) {
      await client.reply.update({
        where: { id: existing.localReplyId },
        data: {
          authorId: botUserId,
          content: data.content,
          parentReplyId: data.parentReplyId,
          hidden: data.hidden,
          likeCount: data.likeCount,
        },
      });
      await client.weiwallReplyMap.update({
        where: { id: existing.id },
        data: {
          externalCommentId: entry.externalCommentId,
          parentExternalReplyId: entry.parentExternalReplyId,
          externalAuthorUuid: externalAuthor.uuid,
          externalAuthorName: externalAuthor.name,
          externalAuthorAvatar: externalAuthor.avatar,
          externalCreatedAt: data.createdAt,
          lastSyncedAt: new Date(),
        },
      });
      repliesUpdated++;
      touchedReplyAuthorIds.add(botUserId);
      return;
    }
    const created = await client.reply.create({ data });
    await client.weiwallReplyMap.create({
      data: {
        externalReplyId: replyId,
        localReplyId: created.id,
        externalTopicId,
        externalCommentId: entry.externalCommentId,
        parentExternalReplyId: entry.parentExternalReplyId,
        externalAuthorUuid: externalAuthor.uuid,
        externalAuthorName: externalAuthor.name,
        externalAuthorAvatar: externalAuthor.avatar,
        externalCreatedAt: createdAt,
        lastSyncedAt: new Date(),
      },
    });
    replyMapByExternal.set(replyId, {
      id: 0,
      externalReplyId: replyId,
      localReplyId: created.id,
      externalCreatedAt: createdAt,
      externalAuthorName: externalAuthor.name,
      externalAuthorAvatar: externalAuthor.avatar,
      externalAuthorUuid: externalAuthor.uuid,
    });
    repliesCreated++;
    touchedReplyAuthorIds.add(botUserId);
  };

  for (const topLevel of comments) {
    const topId = externalId(topLevel.id);
    if (!topId) continue;
    await upsertOne({
      row: topLevel,
      externalReplyId: topId,
      externalCommentId: topId,
      parentExternalReplyId: null,
    });
    for (const child of topLevel.children) {
      const childId = externalId(child.id);
      if (!childId) continue;
      await upsertOne({
        row: child,
        externalReplyId: childId,
        externalCommentId: topId,
        parentExternalReplyId: topId,
      });
    }
  }

  const orderedMaps = await client.weiwallReplyMap.findMany({
    where: { externalTopicId },
    orderBy: [
      { externalCreatedAt: "asc" },
      { externalReplyId: "asc" },
    ],
    include: {
      localReply: {
        select: { id: true, authorId: true, hidden: true, createdAt: true },
      },
    },
  });
  const visibleReplies = orderedMaps.filter((item) => !item.localReply.hidden);
  let nextFloor = 1;
  for (const row of orderedMaps) {
    await client.reply.update({
      where: { id: row.localReplyId },
      data: { floor: nextFloor++ },
    });
  }
  const lastVisibleReply = visibleReplies[visibleReplies.length - 1]?.localReply ?? null;
  await client.topic.update({
    where: { id: localTopic.id },
    data: {
      replyCount: visibleReplies.length,
      lastReplyAt: lastVisibleReply?.createdAt ?? localTopic.createdAt,
      lastReplyById: lastVisibleReply?.authorId ?? localTopic.authorId,
    },
  });

  return {
    repliesCreated,
    repliesUpdated,
    touchedReplyAuthorIds: [...touchedReplyAuthorIds],
    visibleReplyCount: visibleReplies.length,
  };
}

async function syncSingleTopic(
  configRow: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  board: Board,
  sourceName: string,
  topic: WeiwallTopicRow,
  botUserId: number,
  counters: WeiwallSyncResult,
  control: { commentFetchStopped: boolean; rateLimitMessage: string | null },
) {
  const externalTopicId = externalId(topic.id);
  if (!externalTopicId) return { topicAuthorIds: [] as number[], replyAuthorIds: [] as number[] };

  const existingMap = await prisma.weiwallTopicMap.findUnique({
    where: { externalTopicId },
    include: {
      localTopic: {
        select: { id: true, authorId: true, createdAt: true, replyCount: true, title: true, metadata: true },
      },
    },
  });
  const existingMetadata = parseJsonSafe<Record<string, any>>(existingMap?.localTopic?.metadata, {});

  const needsReplyAuthorBackfill = existingMap
    ? await prisma.weiwallReplyMap.count({
        where: {
          externalTopicId,
          OR: [
            { externalAuthorName: null },
            { externalAuthorName: "" },
          ],
        },
      })
    : 0;
  const remoteCommentCount = Math.max(0, Number(topic.commentCount ?? 0) || 0);
  const localReplyCountBefore = existingMap?.localTopic?.replyCount ?? 0;
  const shouldProbeLegacyBlockedReplies =
    Boolean(existingMap)
    && remoteCommentCount > 0
    && remoteCommentCount === Math.max(0, Number(existingMap?.lastCommentCount ?? 0) || 0)
    && remoteCommentCount === Math.max(0, Number(localReplyCountBefore ?? 0) || 0)
    && needsReplyAuthorBackfill === 0;
  const legacyBlockedReplyCount = shouldProbeLegacyBlockedReplies
    ? await countLegacyBlockedPlaceholderReplies(externalTopicId)
    : 0;

  if (looksLikeWeiwallAdvertisement(topic)) {
    if (existingMap) {
      await prisma.$transaction(async (tx) => {
        await tx.topic.update({
          where: { id: existingMap.localTopicId },
          data: { authorId: botUserId, hidden: true, pinned: false, locked: true, lastReplyById: botUserId },
        });
        await tx.reply.updateMany({ where: { topicId: existingMap.localTopicId }, data: { authorId: botUserId } });
        await tx.weiwallTopicMap.update({
          where: { id: existingMap.id },
          data: { lastStatus: "filtered-ad", lastSyncedAt: new Date() },
        });
      });
      counters.topicsUpdated++;
    }
    return {
      topicAuthorIds: [botUserId, existingMap?.localTopic.authorId ?? null].filter((id): id is number => typeof id === "number" && id > 0),
      replyAuthorIds: [botUserId],
    };
  }

  const rowContactMetadata = extractWeiwallContactMetadata(topic);
  const needsWeiwallDetailSync = !hasWeiwallContactMetadata(rowContactMetadata) && !hasWeiwallDetailLoaded(existingMetadata);
  let topicDetail: WeiwallReadOnlyTopicDetail | null = null;
  if (needsWeiwallDetailSync) {
    try {
      topicDetail = await fetchReadOnlyTopicDetail(configRow, externalTopicId);
    } catch (error) {
      console.warn(`[weiwall-sync] read_only detail skipped for ${externalTopicId}:`, error);
    }
  }

  const shouldSyncComments =
    remoteCommentCount > 0
    && !control.commentFetchStopped
    && (
      !existingMap
      || remoteCommentCount !== existingMap.lastCommentCount
      || remoteCommentCount !== Number(existingMap.localTopic?.replyCount ?? 0)
      || needsReplyAuthorBackfill > 0
      || legacyBlockedReplyCount > 0
    );

  const commentFetchCounters = { commentsFetched: 0 };
  const comments = shouldSyncComments
    ? await fetchTopicComments(configRow, externalTopicId, commentFetchCounters, control)
    : [];
  counters.commentsFetched += commentFetchCounters.commentsFetched;
  const localTitle = deriveLocalTitle(topic);

  const result = await prisma.$transaction(async (tx) => {
    const externalAuthor = externalAuthorForStorage(topic.userInfo);
    const createdAt = parseExternalTime(topic.createTime);
    const sourceUrl = buildTopicSourceUrl(configRow.baseUrl, configRow.schoolEn, externalTopicId);
    const localContent = sanitizeWeiwallStorageText(
      renderExternalContent(topic.content, [...(topic.imgs ?? []), ...(topic.data?.imgs ?? [])]),
    );
    const fallbackContent = buildMirroredTopicFallbackContent(sourceUrl);
    const hidden = topicHidden(topic);
    const pinned = false;
    const stateMetadata = {
      ...extractWeiwallTopicStateMetadata(topic),
      ...extractWeiwallTopicStateMetadata(topicDetail ?? {}),
    };
    const contactMetadata = topicDetail
      ? extractWeiwallContactMetadata(topicDetail)
      : hasWeiwallContactMetadata(rowContactMetadata)
        ? rowContactMetadata
        : pickStoredWeiwallContactMetadata(existingMetadata);
    const weiwallDetailLoaded = Boolean(topicDetail) || hasWeiwallContactMetadata(rowContactMetadata) || hasWeiwallDetailLoaded(existingMetadata);
    const metadata = JSON.stringify({
      sourceUrl,
      sourceName: sanitizeWeiwallStorageText(sourceName, 80),
      publishedAt: createdAt.toISOString(),
      external: true,
      externalType: "weiwall",
      externalPlatform: "weiwall",
      externalId: externalTopicId,
      externalNode: sanitizeWeiwallStorageText(trimTo(topic.node, 40), 40),
      externalCommentCount: Number(topic.commentCount ?? 0) || 0,
      externalLikeCount: Number(topic.likeCount ?? 0) || 0,
      externalViewCount: Number(topic.viewCount ?? 0) || 0,
      originalTitle: sanitizeWeiwallStorageText(trimTo(topic.title, 120), 120),
      externalAuthorName: sanitizeWeiwallStorageText(externalAuthor.name, 80),
      externalAuthorAvatar: sanitizeWeiwallStorageText(externalAuthor.avatar, 500),
      externalAuthorUuid: sanitizeWeiwallStorageText(externalAuthor.uuid, 80),
      ...stateMetadata,
      ...contactMetadata,
      ...(weiwallDetailLoaded ? { weiwallDetailLoaded: true } : {}),
    });
    const fallbackMetadata = JSON.stringify({
      sourceUrl,
      sourceName: "逛逛",
      publishedAt: createdAt.toISOString(),
      external: true,
      externalType: "weiwall",
      externalPlatform: "weiwall",
      externalId: externalTopicId,
      ...stateMetadata,
      ...contactMetadata,
      ...(weiwallDetailLoaded ? { weiwallDetailLoaded: true } : {}),
    });
    const safeLocalTitle = sanitizeWeiwallStorageText(localTitle, 120) || `逛逛帖子 ${externalTopicId}`;
    const fallbackTitle = `逛逛帖子 ${externalTopicId}`;

    let localTopic: Pick<Topic, "id" | "authorId" | "createdAt" | "replyCount" | "title">;
    if (!existingMap) {
      const createData = {
        boardId: board.id,
        authorId: botUserId,
        title: safeLocalTitle,
        content: localContent,
        metadata,
        hidden,
        pinned,
        locked: true,
        likeCount: Number(topic.likeCount ?? 0) || 0,
        viewCount: Number(topic.viewCount ?? 0) || 0,
        lastReplyAt: createdAt,
        lastReplyById: botUserId,
        createdAt,
      } satisfies Prisma.TopicUncheckedCreateInput;
      let created: Pick<Topic, "id" | "authorId" | "createdAt" | "replyCount" | "title">;
      try {
        created = await tx.topic.create({
          data: createData,
          select: { id: true, authorId: true, createdAt: true, replyCount: true, title: true },
        });
      } catch (error) {
        console.warn(`[weiwall-sync] mirrored topic create fallback for ${externalTopicId}:`, error);
        created = await tx.topic.create({
          data: {
            ...createData,
            title: fallbackTitle,
            content: fallbackContent,
            metadata: fallbackMetadata,
          },
          select: { id: true, authorId: true, createdAt: true, replyCount: true, title: true },
        });
      }
      await tx.weiwallTopicMap.create({
        data: {
          externalTopicId,
          localTopicId: created.id,
          externalAuthorKey: externalAuthor.key,
          externalAuthorUuid: externalAuthor.uuid,
          externalAuthorName: externalAuthor.name,
          externalAuthorAvatar: externalAuthor.avatar,
          externalCreatedAt: createdAt,
          lastCommentCount: Number(topic.commentCount ?? 0) || 0,
          lastLikeCount: Number(topic.likeCount ?? 0) || 0,
          lastStatus: String(topic.status ?? ""),
          lastSyncedAt: new Date(),
        },
      });
      await attachTopicNodeTag(tx, created.id, topic.node);
      localTopic = created;
      counters.topicsCreated++;
    } else {
      const updateData = {
        authorId: botUserId,
        title: safeLocalTitle,
        content: localContent,
        metadata,
        hidden,
        pinned,
        locked: true,
        likeCount: Number(topic.likeCount ?? 0) || 0,
        viewCount: Number(topic.viewCount ?? 0) || 0,
      } satisfies Prisma.TopicUncheckedUpdateInput;
      try {
        await tx.topic.update({
          where: { id: existingMap.localTopicId },
          data: updateData,
        });
      } catch (error) {
        console.warn(`[weiwall-sync] mirrored topic update fallback for ${externalTopicId}:`, error);
        await tx.topic.update({
          where: { id: existingMap.localTopicId },
          data: {
            ...updateData,
            title: fallbackTitle,
            content: fallbackContent,
            metadata: fallbackMetadata,
          },
        });
      }
      await tx.weiwallTopicMap.update({
        where: { id: existingMap.id },
        data: {
          externalAuthorKey: externalAuthor.key,
          externalAuthorUuid: externalAuthor.uuid,
          externalAuthorName: externalAuthor.name,
          externalAuthorAvatar: externalAuthor.avatar,
          externalCreatedAt: createdAt,
          lastCommentCount: Number(topic.commentCount ?? 0) || 0,
          lastLikeCount: Number(topic.likeCount ?? 0) || 0,
          lastStatus: String(topic.status ?? ""),
          lastSyncedAt: new Date(),
        },
      });
      await attachTopicNodeTag(tx, existingMap.localTopicId, topic.node);
      localTopic = existingMap.localTopic;
      counters.topicsUpdated++;
    }

    let replySync = { repliesCreated: 0, repliesUpdated: 0, touchedReplyAuthorIds: [] as number[], visibleReplyCount: localTopic.replyCount ?? 0 };
    if (shouldSyncComments) {
      replySync = await syncTopicReplies(tx, localTopic, externalTopicId, comments, botUserId);
    } else if ((Number(topic.commentCount ?? 0) || 0) === 0) {
      await tx.topic.update({
        where: { id: localTopic.id },
        data: {
          replyCount: 0,
          lastReplyAt: localTopic.createdAt,
          lastReplyById: localTopic.authorId,
        },
      });
    }

    return {
      currentTopicAuthorId: botUserId,
      previousTopicAuthorId: existingMap?.localTopic.authorId ?? null,
      touchedReplyAuthorIds: replySync.touchedReplyAuthorIds,
      repliesCreated: replySync.repliesCreated,
      repliesUpdated: replySync.repliesUpdated,
      visibleReplyCount: replySync.visibleReplyCount,
    };
  });

  counters.repliesCreated += result.repliesCreated;
  counters.repliesUpdated += result.repliesUpdated;
  if (shouldSyncComments) {
    pushWeiwallTrace(counters, {
      phase: "latest",
      action: "fetched",
      externalTopicId,
      localTopicId: existingMap?.localTopicId ?? null,
      title: formatTraceTitle({
        title: localTitle,
        content: topic.content,
        externalTopicId,
        localTopicId: existingMap?.localTopicId ?? null,
      }),
      remoteCommentCount,
      localReplyCountBefore,
      visibleReplyCountAfter: result.visibleReplyCount,
      commentsFetched: commentFetchCounters.commentsFetched,
      repliesCreated: result.repliesCreated,
      repliesUpdated: result.repliesUpdated,
      note: result.visibleReplyCount === 0 && commentFetchCounters.commentsFetched > 0
        ? "已抓到评论，但本地可见回复仍为 0"
        : describeCommentSyncReason({
            remoteCommentCount,
            lastCommentCount: existingMap?.lastCommentCount,
            localReplyCount: localReplyCountBefore,
            needsReplyAuthorBackfill,
          }) + (legacyBlockedReplyCount > 0 ? `；发现 ${legacyBlockedReplyCount} 条旧占位评论待修复` : ""),
    });
  }
  return {
    topicAuthorIds: [result.currentTopicAuthorId, result.previousTopicAuthorId].filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0),
    replyAuthorIds: result.touchedReplyAuthorIds,
  };
}

async function syncBackfillTopicComments(
  configRow: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>,
  topicMap: {
    id: number;
    externalTopicId: string;
    localTopicId: number;
    lastCommentCount: number;
    lastStatus: string | null;
    localTopic: Pick<Topic, "id" | "authorId" | "createdAt" | "replyCount" | "title" | "metadata"> | null;
  },
  botUserId: number,
  counters: WeiwallSyncResult,
  control: { commentFetchStopped: boolean; rateLimitMessage: string | null },
) {
  if (control.commentFetchStopped || !topicMap.localTopic) return { replyAuthorIds: [] as number[] };

  let detail: WeiwallReadOnlyTopicDetail | null = null;
  try {
    detail = await fetchReadOnlyTopicDetail(configRow, topicMap.externalTopicId);
  } catch (error: any) {
    if (!(error instanceof WeiwallRateLimitError)) throw error;
    control.commentFetchStopped = true;
    control.rateLimitMessage = error.message;
    return { replyAuthorIds: [] as number[] };
  }

  const remoteCommentCount = Math.max(0, Number(detail?.commentCount ?? topicMap.lastCommentCount) || 0);
  const remoteStatus = String(detail?.status ?? topicMap.lastStatus ?? "");
  const existingTopicMetadata = parseJsonSafe<Record<string, any>>(topicMap.localTopic.metadata, {});
  const backfilledMetadata = detail
    ? JSON.stringify({
        ...stripWeiwallDetailMetadata(existingTopicMetadata),
        ...extractWeiwallTopicStateMetadata(detail),
        ...extractWeiwallContactMetadata(detail),
        weiwallDetailLoaded: true,
      })
    : topicMap.localTopic.metadata;
  const shouldProbeLegacyBlockedReplies =
    remoteCommentCount > 0
    && remoteCommentCount === Math.max(0, Number(topicMap.lastCommentCount ?? 0) || 0)
    && remoteCommentCount === Math.max(0, Number(topicMap.localTopic?.replyCount ?? 0) || 0);
  const legacyBlockedReplyCount = shouldProbeLegacyBlockedReplies
    ? await countLegacyBlockedPlaceholderReplies(topicMap.externalTopicId)
    : 0;
  const shouldFetchComments =
    remoteCommentCount !== Math.max(0, Number(topicMap.lastCommentCount ?? 0) || 0)
    || remoteCommentCount !== Math.max(0, Number(topicMap.localTopic?.replyCount ?? 0) || 0)
    || legacyBlockedReplyCount > 0;

  if (!shouldFetchComments) {
    await prisma.topic.update({
      where: { id: topicMap.localTopic.id },
      data: { metadata: backfilledMetadata },
    });
    await prisma.weiwallTopicMap.update({
      where: { id: topicMap.id },
      data: {
        lastCommentCount: remoteCommentCount,
        lastStatus: remoteStatus,
        lastSyncedAt: new Date(),
      },
    });
    pushWeiwallTrace(counters, {
      phase: "backfill",
      action: "probed",
      externalTopicId: topicMap.externalTopicId,
      localTopicId: topicMap.localTopicId,
      title: formatTraceTitle({
        title: topicMap.localTopic.title,
        externalTopicId: topicMap.externalTopicId,
        localTopicId: topicMap.localTopicId,
      }),
      remoteCommentCount,
      localReplyCountBefore: topicMap.localTopic.replyCount,
      visibleReplyCountAfter: topicMap.localTopic.replyCount,
      commentsFetched: 0,
      repliesCreated: 0,
      repliesUpdated: 0,
      note: "只做只读探测，commentCount 未变化",
    });
    return { replyAuthorIds: [] as number[] };
  }

  const commentFetchCounters = { commentsFetched: 0 };
  const comments = await fetchTopicComments(configRow, topicMap.externalTopicId, commentFetchCounters, control);
  counters.commentsFetched += commentFetchCounters.commentsFetched;

  const replySync = await prisma.$transaction(async (tx) => {
    const replies = comments.length
      ? await syncTopicReplies(tx, topicMap.localTopic!, topicMap.externalTopicId, comments, botUserId)
      : { repliesCreated: 0, repliesUpdated: 0, touchedReplyAuthorIds: [] as number[], visibleReplyCount: 0 };

    if (!comments.length) {
      await tx.topic.update({
        where: { id: topicMap.localTopic!.id },
        data: {
          metadata: backfilledMetadata,
          replyCount: 0,
          lastReplyAt: topicMap.localTopic!.createdAt,
          lastReplyById: topicMap.localTopic!.authorId,
        },
      });
    } else {
      await tx.topic.update({
        where: { id: topicMap.localTopic!.id },
        data: { metadata: backfilledMetadata },
      });
    }

    await tx.weiwallTopicMap.update({
      where: { id: topicMap.id },
      data: {
        lastCommentCount: remoteCommentCount,
        lastStatus: remoteStatus,
        lastSyncedAt: new Date(),
      },
    });

    return replies;
  });

  counters.repliesCreated += replySync.repliesCreated;
  counters.repliesUpdated += replySync.repliesUpdated;
  pushWeiwallTrace(counters, {
    phase: "backfill",
    action: "fetched",
    externalTopicId: topicMap.externalTopicId,
    localTopicId: topicMap.localTopicId,
    title: formatTraceTitle({
      title: topicMap.localTopic.title,
      externalTopicId: topicMap.externalTopicId,
      localTopicId: topicMap.localTopicId,
    }),
    remoteCommentCount,
    localReplyCountBefore: topicMap.localTopic.replyCount,
    visibleReplyCountAfter: replySync.visibleReplyCount,
    commentsFetched: commentFetchCounters.commentsFetched,
    repliesCreated: replySync.repliesCreated,
    repliesUpdated: replySync.repliesUpdated,
    note: describeCommentSyncReason({
      remoteCommentCount,
      lastCommentCount: topicMap.lastCommentCount,
      localReplyCount: topicMap.localTopic.replyCount,
    }) + (legacyBlockedReplyCount > 0 ? `；发现 ${legacyBlockedReplyCount} 条旧占位评论待修复` : ""),
  });
  return { replyAuthorIds: replySync.touchedReplyAuthorIds };
}

export async function runWeiwallSyncNow() {
  const locked = await runWithDistributedLock("weiwall-sync:run", WEIWALL_LOCK_MS, async () => {
    const configRow = await ensureWeiwallSyncConfigRow();
    const board = await ensureWeiwallBoard();
    if (!configRow.boardId || configRow.boardId !== board.id) {
      await prisma.weiwallSyncConfig.update({ where: { id: configRow.id }, data: { boardId: board.id } });
    }

    const result: WeiwallSyncResult = {
      ok: false,
      boardSlug: board.slug,
      sourceName: "逛逛",
      pagesScanned: 0,
      topicsScanned: 0,
      topicsCreated: 0,
      topicsUpdated: 0,
      repliesCreated: 0,
      repliesUpdated: 0,
      authorsCreated: 0,
      authorsUpdated: 0,
      commentsFetched: 0,
      latestExternalTopicId: null,
      topicTraces: [],
      error: null,
    };

    if (!configRow.enabled) {
      result.error = "disabled";
      return result;
    }
    const botUser = await ensureWeiwallBotUser(prisma);
    const hotEntryChanged = await removeWeiwallHotEntries(board.id);
    if (!configRow.token) {
      result.error = "token missing";
      await prisma.weiwallSyncConfig.update({
        where: { id: configRow.id },
        data: { lastRunAt: new Date(), lastRunOk: false, lastError: "未配置 token" },
      });
      if (hotEntryChanged) {
        await refreshBoardTopicCount(board.id);
        await invalidateBoardCaches();
        await invalidateForumCaches();
      }
      return result;
    }
    await maybeNotifyWeiwallTokenExpired(configRow.token);

    try {
      result.sourceName = await fetchTenantName(configRow.baseUrl || WEIWALL_DEFAULT_BASE_URL);
      const authorCounters: AuthorSyncCounters = { created: 0, updated: 0 };
      await normalizeLegacyMirroredAuthorAssignments(botUser.id);
      const control = { commentFetchStopped: false, rateLimitMessage: null as string | null };
      const topicScan = await fetchLatestTopics(configRow);
      result.pagesScanned = topicScan.pagesScanned;
      result.topicsScanned = topicScan.rows.length;
      result.latestExternalTopicId = externalId(topicScan.rows[0]?.id) || null;
      if (topicScan.rateLimited) control.rateLimitMessage = topicScan.rateLimitMessage;
      const touchedTopicAuthorIds = new Set<number>();
      const touchedReplyAuthorIds = new Set<number>();
      const latestExternalTopicIds = new Set<string>();
      for (const topic of topicScan.rows) {
        latestExternalTopicIds.add(externalId(topic.id));
        const syncResult = await syncSingleTopic(configRow, board, result.sourceName, topic, botUser.id, result, control);
        syncResult.topicAuthorIds.forEach((id) => touchedTopicAuthorIds.add(id));
        syncResult.replyAuthorIds.forEach((id) => touchedReplyAuthorIds.add(id));
      }
      if (!control.commentFetchStopped) {
        const backfillCutoff = new Date(Date.now() - WEIWALL_COMMENT_BACKFILL_MAX_AGE_MS);
        const backfillCandidates = await prisma.weiwallTopicMap.findMany({
          where: {
            AND: [
              latestExternalTopicIds.size
                ? { externalTopicId: { notIn: [...latestExternalTopicIds] } }
                : {},
              {
                OR: [
                  { externalCreatedAt: { gte: backfillCutoff } },
                  { externalCreatedAt: null, createdAt: { gte: backfillCutoff } },
                ],
              },
            ],
          },
          orderBy: [
            { lastSyncedAt: "asc" },
            { id: "asc" },
          ],
          take: WEIWALL_COMMENT_BACKFILL_TOPICS_PER_RUN,
          include: {
            localTopic: {
              select: { id: true, authorId: true, createdAt: true, replyCount: true, title: true, metadata: true },
            },
          },
        });
        for (const topicMap of backfillCandidates) {
          if (control.commentFetchStopped) break;
          const syncResult = await syncBackfillTopicComments(configRow, topicMap, botUser.id, result, control);
          syncResult.replyAuthorIds.forEach((id) => touchedReplyAuthorIds.add(id));
        }
      }
      result.authorsCreated = authorCounters.created;
      result.authorsUpdated = authorCounters.updated;
      if (hotEntryChanged) touchedTopicAuthorIds.add(botUser.id);
      if (control.rateLimitMessage && (result.topicsCreated || result.topicsUpdated || result.repliesCreated || result.repliesUpdated)) {
        result.error = `${control.rateLimitMessage}；本轮已部分同步，稍后会继续补齐`;
      } else if (control.rateLimitMessage) {
        result.error = control.rateLimitMessage;
      }

      await refreshBoardTopicCount(board.id);
      await Promise.all([
        ...[...touchedTopicAuthorIds].map((id) => refreshUserPostCount(id)),
        ...[...touchedReplyAuthorIds].map((id) => refreshUserReplyCount(id)),
      ]);
      await cleanupLegacyWeiwallUsers();
      await prisma.weiwallSyncConfig.update({
        where: { id: configRow.id },
        data: {
          lastRunAt: new Date(),
          lastRunOk: control.rateLimitMessage ? Boolean(result.topicsScanned) : true,
          lastError: result.error,
          lastSyncedAt: new Date(),
        },
      });
      if (result.topicsCreated || result.topicsUpdated || result.repliesCreated || result.repliesUpdated || hotEntryChanged) {
        await invalidateBoardCaches();
        await invalidateForumCaches();
      }
      result.ok = !control.rateLimitMessage || Boolean(result.topicsScanned);
      return result;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      await prisma.weiwallSyncConfig.update({
        where: { id: configRow.id },
        data: {
          lastRunAt: new Date(),
          lastRunOk: false,
          lastError: message,
        },
      });
      result.error = message;
      return result;
    }
  });
  if (locked.acquired && locked.result) return locked.result;
  const board = await ensureWeiwallBoard();
  return {
    ok: false,
    boardSlug: board.slug,
    sourceName: "逛逛",
    pagesScanned: 0,
    topicsScanned: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    repliesCreated: 0,
    repliesUpdated: 0,
    authorsCreated: 0,
    authorsUpdated: 0,
    commentsFetched: 0,
    latestExternalTopicId: null,
    topicTraces: [],
    error: "locked",
  } satisfies WeiwallSyncResult;
}

let schedulerStarted = false;

export function startWeiwallSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    const configRow = await ensureWeiwallSyncConfigRow();
    if (!configRow.enabled) return;
    const lastRunAt = configRow.lastRunAt?.getTime() ?? 0;
    if (Date.now() - lastRunAt < Math.max(WEIWALL_MIN_INTERVAL_SECONDS, configRow.intervalSeconds) * 1000) return;
    const result = await runWeiwallSyncNow();
    if (!result.ok && result.error && result.error !== "disabled") {
      console.warn("[weiwall-sync] run failed:", result.error);
      return;
    }
    if (result.ok && (result.topicsCreated || result.repliesCreated)) {
      console.log(`📮 逛逛同步完成: +${result.topicsCreated} 帖子, +${result.repliesCreated} 回复`);
    }
  };

  setTimeout(() => {
    tick().catch((error) => console.warn("[weiwall-sync] tick error:", error));
    setInterval(() => {
      tick().catch((error) => console.warn("[weiwall-sync] tick error:", error));
    }, WEIWALL_TICK_MS);
  }, 8_000);

  console.log("📮 逛逛同步器已挂载（默认 30 秒检查，按配置 intervalSeconds 执行）");
}
