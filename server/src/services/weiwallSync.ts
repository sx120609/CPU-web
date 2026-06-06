import { Prisma, type Board, type Topic, type Reply } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import { refreshBoardTopicCount, refreshUserPostCount, refreshUserReplyCount } from "./forumStats";

export const WEIWALL_BOARD_SLUG = "campus-wall";
const WEIWALL_BOARD_NAME = "校园墙";
const WEIWALL_BOARD_DESCRIPTION = "从外部校园墙同步的只读镜像，自动刷新帖子与评论。";
const WEIWALL_BOARD_ICON = "📮";
const WEIWALL_BOARD_COLOR = "#0ea5e9";
const WEIWALL_DEFAULT_BASE_URL = "https://s.weiwall.com";
const WEIWALL_TICK_MS = 30_000;
const WEIWALL_MIN_INTERVAL_SECONDS = 30;
const WEIWALL_LOCK_MS = 4 * 60_000;
const WEIWALL_MAX_COMMENT_PAGE_SIZE = 20;
const WEIWALL_BOT_USERNAME = "weiwall_sync_bot";
const WEIWALL_BOT_NICKNAME = "校园墙同步";

type WeiwallUserInfo = {
  uuid?: number | string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type WeiwallTopicRow = {
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
  error?: string | null;
};

type AuthorSyncCounters = {
  created: number;
  updated: number;
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

function renderExternalContent(content: unknown, images: Array<string | null | undefined>) {
  const body = String(content ?? "").trim();
  const uniqImages = uniqStrings(images);
  const imageMarkdown = uniqImages.map((url) => `![](${url})`).join("\n\n");
  if (body && imageMarkdown) return `${body}\n\n${imageMarkdown}`;
  if (body) return body;
  if (imageMarkdown) return imageMarkdown;
  return "_（外部内容为空）_";
}

function deriveLocalTitle(topic: WeiwallTopicRow) {
  const explicit = trimTo(topic.title, 120);
  if (explicit && explicit !== "none") return explicit;
  const firstLine = String(topic.content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.slice(0, 120);
  return `校园墙帖子 ${externalId(topic.id)}`;
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
  if (topicMaps.length) {
    await prisma.topic.updateMany({
      where: { id: { in: topicMaps.map((item) => item.localTopicId) }, authorId: { not: botUserId } },
      data: { authorId: botUserId },
    });
  }
  if (replyMaps.length) {
    await prisma.reply.updateMany({
      where: { id: { in: replyMaps.map((item) => item.localReplyId) }, authorId: { not: botUserId } },
      data: { authorId: botUserId },
    });
  }
}

function topicHidden(topic: WeiwallTopicRow) {
  const status = String(topic.status ?? "").trim().toLowerCase();
  return Boolean(coerceBool(topic.isDelete) || (status && status !== "1" && status !== "normal"));
}

function replyHidden(reply: WeiwallReplyRow) {
  const status = String(reply.status ?? "").trim().toLowerCase();
  return Boolean(coerceBool(reply.isDelete) || (status && status !== "1" && status !== "normal"));
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
  if (existing) return existing;
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
  return {
    id: row.id,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    schoolEn: row.schoolEn,
    tenantId: row.tenantId,
    tokenPresent: Boolean(row.token),
    tokenPreview: maskToken(row.token),
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
  return toAdminConfig(await ensureWeiwallSyncConfigRow());
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
  return trimTo(json?.data?.tenantName, 80, "校园墙");
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
        select: { id: true, authorId: true, createdAt: true },
      },
    },
  });

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

  const shouldSyncComments =
    Number(topic.commentCount ?? 0) > 0
    && !control.commentFetchStopped
    && (!existingMap || Number(topic.commentCount ?? 0) !== existingMap.lastCommentCount);

  const commentFetchCounters = { commentsFetched: 0 };
  const comments = shouldSyncComments
    ? await fetchTopicComments(configRow, externalTopicId, commentFetchCounters, control)
    : [];
  counters.commentsFetched += commentFetchCounters.commentsFetched;

  const result = await prisma.$transaction(async (tx) => {
    const externalAuthor = externalAuthorForStorage(topic.userInfo);
    const createdAt = parseExternalTime(topic.createTime);
    const localContent = renderExternalContent(topic.content, [...(topic.imgs ?? []), ...(topic.data?.imgs ?? [])]);
    const localTitle = deriveLocalTitle(topic);
    const hidden = topicHidden(topic);
    const pinned = false;
    const metadata = JSON.stringify({
      sourceUrl: buildTopicSourceUrl(configRow.baseUrl, configRow.schoolEn, externalTopicId),
      sourceName,
      publishedAt: createdAt.toISOString(),
      external: true,
      externalType: "weiwall",
      externalPlatform: "weiwall",
      externalId: externalTopicId,
      externalNode: trimTo(topic.node, 40),
      externalCommentCount: Number(topic.commentCount ?? 0) || 0,
      externalLikeCount: Number(topic.likeCount ?? 0) || 0,
      externalViewCount: Number(topic.viewCount ?? 0) || 0,
      originalTitle: trimTo(topic.title, 120),
      externalAuthorName: externalAuthor.name,
      externalAuthorAvatar: externalAuthor.avatar,
      externalAuthorUuid: externalAuthor.uuid,
    });

    let localTopic: Pick<Topic, "id" | "authorId" | "createdAt">;
    if (!existingMap) {
      const created = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: botUserId,
          title: localTitle,
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
        },
        select: { id: true, authorId: true, createdAt: true },
      });
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
      await tx.topic.update({
        where: { id: existingMap.localTopicId },
        data: {
          authorId: botUserId,
          title: localTitle,
          content: localContent,
          metadata,
          hidden,
          pinned,
          locked: true,
          likeCount: Number(topic.likeCount ?? 0) || 0,
          viewCount: Number(topic.viewCount ?? 0) || 0,
        },
      });
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

    let replySync = { repliesCreated: 0, repliesUpdated: 0, touchedReplyAuthorIds: [] as number[] };
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
    };
  });

  counters.repliesCreated += result.repliesCreated;
  counters.repliesUpdated += result.repliesUpdated;
  return {
    topicAuthorIds: [result.currentTopicAuthorId, result.previousTopicAuthorId].filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0),
    replyAuthorIds: result.touchedReplyAuthorIds,
  };
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
      sourceName: "校园墙",
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
      error: null,
    };

    if (!configRow.enabled) {
      result.error = "disabled";
      return result;
    }
    if (!configRow.token) {
      result.error = "token missing";
      await prisma.weiwallSyncConfig.update({
        where: { id: configRow.id },
        data: { lastRunAt: new Date(), lastRunOk: false, lastError: "未配置 token" },
      });
      return result;
    }

    try {
      result.sourceName = await fetchTenantName(configRow.baseUrl || WEIWALL_DEFAULT_BASE_URL);
      const authorCounters: AuthorSyncCounters = { created: 0, updated: 0 };
      const botUser = await ensureWeiwallBotUser(prisma);
      await normalizeLegacyMirroredAuthorAssignments(botUser.id);
      const control = { commentFetchStopped: false, rateLimitMessage: null as string | null };
      const topicScan = await fetchLatestTopics(configRow);
      result.pagesScanned = topicScan.pagesScanned;
      result.topicsScanned = topicScan.rows.length;
      result.latestExternalTopicId = externalId(topicScan.rows[0]?.id) || null;
      if (topicScan.rateLimited) control.rateLimitMessage = topicScan.rateLimitMessage;
      const touchedTopicAuthorIds = new Set<number>();
      const touchedReplyAuthorIds = new Set<number>();
      for (const topic of topicScan.rows) {
        const syncResult = await syncSingleTopic(configRow, board, result.sourceName, topic, botUser.id, result, control);
        syncResult.topicAuthorIds.forEach((id) => touchedTopicAuthorIds.add(id));
        syncResult.replyAuthorIds.forEach((id) => touchedReplyAuthorIds.add(id));
      }
      result.authorsCreated = authorCounters.created;
      result.authorsUpdated = authorCounters.updated;
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
      if (result.topicsCreated || result.topicsUpdated || result.repliesCreated || result.repliesUpdated) {
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
    sourceName: "校园墙",
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
      console.log(`📮 校园墙同步完成: +${result.topicsCreated} 帖子, +${result.repliesCreated} 回复`);
    }
  };

  setTimeout(() => {
    tick().catch((error) => console.warn("[weiwall-sync] tick error:", error));
    setInterval(() => {
      tick().catch((error) => console.warn("[weiwall-sync] tick error:", error));
    }, WEIWALL_TICK_MS);
  }, 8_000);

  console.log("📮 校园墙同步器已挂载（默认 30 秒检查，按配置 intervalSeconds 执行）");
}
