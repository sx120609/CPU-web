import { Prisma, type Board, type Topic, type Reply } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { hashPassword } from "../utils/password";
import { runWithDistributedLock } from "./cache";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import { refreshBoardTopicCount, refreshUserPostCount, refreshUserReplyCount } from "./forumStats";

const WEIWALL_BOARD_SLUG = "campus-wall";
const WEIWALL_BOARD_NAME = "校园墙";
const WEIWALL_BOARD_DESCRIPTION = "从外部校园墙同步的只读镜像，自动刷新帖子与评论。";
const WEIWALL_BOARD_ICON = "📮";
const WEIWALL_BOARD_COLOR = "#0ea5e9";
const WEIWALL_DEFAULT_BASE_URL = "https://s.weiwall.com";
const WEIWALL_TICK_MS = 30_000;
const WEIWALL_MIN_INTERVAL_SECONDS = 30;
const WEIWALL_LOCK_MS = 4 * 60_000;
const WEIWALL_MAX_COMMENT_PAGE_SIZE = 20;

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

function buildSyntheticUsername(externalKey: string) {
  return `ww_${createHash("sha1").update(externalKey).digest("hex").slice(0, 16)}`;
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
  if (!res.ok || json?.status === "unauthorized" || json?.errcode === 4010001 || json?.errcode === 4010002) {
    throw new Error(json?.errmsg || `WeiWall 请求失败 (${res.status})`);
  }
  return json;
}

async function fetchLatestTopics(row: Awaited<ReturnType<typeof ensureWeiwallSyncConfigRow>>) {
  const collected: WeiwallTopicRow[] = [];
  const seen = new Set<string>();
  let lastId = "";
  let pagesScanned = 0;
  for (let page = 1; page <= row.topicPages; page++) {
    const json = await weiwallFetchJson(row, "/api/client/topics", {
      page,
      last_id: lastId || undefined,
      pageSize: 20,
      page_size: 20,
    });
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
  return { pagesScanned, rows: collected };
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
) {
  const topLevelRows: Array<WeiwallReplyRow & { children: WeiwallReplyRow[] }> = [];
  for (let page = 1; page <= row.maxCommentPages; page++) {
    const pageData = await fetchCommentPage(row, {
      topicId,
      page,
      pageSize: row.commentPageSize,
      sort: "time",
    });
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
          const nested = await fetchCommentPage(row, {
            topicId,
            commentId: externalId(current.id),
            replyId: externalId((current as any).replyId ?? 0),
            page: childPage,
            pageSize: row.commentPageSize,
            sort: "time",
          });
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
  }
  return topLevelRows;
}

async function ensureLocalAuthor(userInfo: WeiwallUserInfo | null | undefined, client: SyncClient, counters: AuthorSyncCounters) {
  const normalized = normalizeExternalAuthor(userInfo);
  const existing = await client.weiwallAuthor.findUnique({
    where: { externalKey: normalized.externalKey },
    include: {
      localUser: {
        select: { id: true, nickname: true, avatar: true },
      },
    },
  });
  if (existing) {
    const userPatch: Prisma.UserUpdateInput = {};
    if (trimTo(existing.localUser.nickname, 40) !== normalized.nickname) userPatch.nickname = normalized.nickname.slice(0, 20);
    if ((existing.localUser.avatar || "") !== (normalized.avatar || "")) userPatch.avatar = normalized.avatar;
    const authorPatch: Prisma.WeiwallAuthorUpdateInput = {};
    if (existing.nickname !== normalized.nickname) authorPatch.nickname = normalized.nickname;
    if ((existing.avatar || "") !== (normalized.avatar || "")) authorPatch.avatar = normalized.avatar;
    if ((existing.externalUuid || "") !== (normalized.externalUuid || "")) authorPatch.externalUuid = normalized.externalUuid;
    authorPatch.lastSeenAt = new Date();
    if (Object.keys(userPatch).length) {
      await client.user.update({ where: { id: existing.localUserId }, data: userPatch });
      counters.updated++;
    }
    if (Object.keys(authorPatch).length) {
      await client.weiwallAuthor.update({ where: { id: existing.id }, data: authorPatch });
    }
    return { id: existing.localUserId };
  }

  const localUser = await client.user.create({
    data: {
      username: buildSyntheticUsername(normalized.externalKey),
      passwordHash: await hashPassword(randomUUID()),
      nickname: normalized.nickname.slice(0, 20),
      avatar: normalized.avatar,
    },
    select: { id: true },
  });
  await client.weiwallAuthor.create({
    data: {
      externalKey: normalized.externalKey,
      externalUuid: normalized.externalUuid,
      nickname: normalized.nickname,
      avatar: normalized.avatar,
      localUserId: localUser.id,
      lastSeenAt: new Date(),
    },
  });
  counters.created++;
  return { id: localUser.id };
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
  authorCounters: AuthorSyncCounters,
) {
  const replyMaps = await client.weiwallReplyMap.findMany({
    where: { externalTopicId },
    select: { id: true, externalReplyId: true, localReplyId: true, externalCreatedAt: true },
  });
  const replyMapByExternal = new Map(replyMaps.map((item) => [item.externalReplyId, item]));
  const touchedReplyAuthorIds = new Set<number>();
  let repliesCreated = 0;
  let repliesUpdated = 0;

  const upsertOne = async (entry: FlattenedExternalReply) => {
    const author = await ensureLocalAuthor(entry.row.userInfo, client, authorCounters);
    const replyId = entry.externalReplyId;
    const parentLocalReplyId = entry.parentExternalReplyId
      ? replyMapByExternal.get(entry.parentExternalReplyId)?.localReplyId ?? null
      : null;
    const createdAt = parseExternalTime(entry.row.createTime);
    const hidden = replyHidden(entry.row);
    const data: Prisma.ReplyUncheckedCreateInput = {
      topicId: localTopic.id,
      authorId: author.id,
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
          authorId: data.authorId,
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
          externalCreatedAt: data.createdAt,
          lastSyncedAt: new Date(),
        },
      });
      repliesUpdated++;
      touchedReplyAuthorIds.add(author.id);
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
        externalCreatedAt: createdAt,
        lastSyncedAt: new Date(),
      },
    });
    replyMapByExternal.set(replyId, {
      id: 0,
      externalReplyId: replyId,
      localReplyId: created.id,
      externalCreatedAt: createdAt,
    });
    repliesCreated++;
    touchedReplyAuthorIds.add(author.id);
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
  authorCounters: AuthorSyncCounters,
  counters: WeiwallSyncResult,
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

  const shouldSyncComments =
    Number(topic.commentCount ?? 0) > 0
    && (!existingMap || Number(topic.commentCount ?? 0) !== existingMap.lastCommentCount);

  const commentFetchCounters = { commentsFetched: 0 };
  const comments = shouldSyncComments
    ? await fetchTopicComments(configRow, externalTopicId, commentFetchCounters)
    : [];
  counters.commentsFetched += commentFetchCounters.commentsFetched;

  const result = await prisma.$transaction(async (tx) => {
    const topicAuthor = await ensureLocalAuthor(topic.userInfo, tx, authorCounters);
    const createdAt = parseExternalTime(topic.createTime);
    const localContent = renderExternalContent(topic.content, [...(topic.imgs ?? []), ...(topic.data?.imgs ?? [])]);
    const localTitle = deriveLocalTitle(topic);
    const hidden = topicHidden(topic);
    const pinned = Boolean(coerceBool(topic.isTop));
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
    });

    let localTopic: Pick<Topic, "id" | "authorId" | "createdAt">;
    if (!existingMap) {
      const created = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: topicAuthor.id,
          title: localTitle,
          content: localContent,
          metadata,
          hidden,
          pinned,
          locked: true,
          likeCount: Number(topic.likeCount ?? 0) || 0,
          viewCount: Number(topic.viewCount ?? 0) || 0,
          lastReplyAt: createdAt,
          lastReplyById: topicAuthor.id,
          createdAt,
        },
        select: { id: true, authorId: true, createdAt: true },
      });
      await tx.weiwallTopicMap.create({
        data: {
          externalTopicId,
          localTopicId: created.id,
          externalAuthorKey: normalizeExternalAuthor(topic.userInfo).externalKey,
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
          authorId: topicAuthor.id,
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
          externalAuthorKey: normalizeExternalAuthor(topic.userInfo).externalKey,
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
      replySync = await syncTopicReplies(tx, localTopic, externalTopicId, comments, authorCounters);
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
      currentTopicAuthorId: topicAuthor.id,
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
      const topicScan = await fetchLatestTopics(configRow);
      result.pagesScanned = topicScan.pagesScanned;
      result.topicsScanned = topicScan.rows.length;
      result.latestExternalTopicId = externalId(topicScan.rows[0]?.id) || null;
      const touchedTopicAuthorIds = new Set<number>();
      const touchedReplyAuthorIds = new Set<number>();
      for (const topic of topicScan.rows) {
        const syncResult = await syncSingleTopic(configRow, board, result.sourceName, topic, authorCounters, result);
        syncResult.topicAuthorIds.forEach((id) => touchedTopicAuthorIds.add(id));
        syncResult.replyAuthorIds.forEach((id) => touchedReplyAuthorIds.add(id));
      }
      result.authorsCreated = authorCounters.created;
      result.authorsUpdated = authorCounters.updated;

      await refreshBoardTopicCount(board.id);
      await Promise.all([
        ...[...touchedTopicAuthorIds].map((id) => refreshUserPostCount(id)),
        ...[...touchedReplyAuthorIds].map((id) => refreshUserReplyCount(id)),
      ]);
      await prisma.weiwallSyncConfig.update({
        where: { id: configRow.id },
        data: {
          lastRunAt: new Date(),
          lastRunOk: true,
          lastError: null,
          lastSyncedAt: new Date(),
        },
      });
      if (result.topicsCreated || result.topicsUpdated || result.repliesCreated || result.repliesUpdated) {
        await invalidateBoardCaches();
        await invalidateForumCaches();
      }
      result.ok = true;
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
