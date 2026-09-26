import type { Board } from "@/api/board";
import type { Reply, Topic } from "@/api/topic";
import { pruneViewCache, readViewCache, writeViewCache } from "@/utils/viewCache";

const PREFIX = "cpu-forum-view-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// 每个帖子、每个板块分页各占一个键；限量保留最近的条目，避免挤占课表离线缓存的存储配额。
export const FORUM_CACHE_MAX_TOPIC_ENTRIES = 40;
export const FORUM_CACHE_MAX_LIST_ENTRIES = 40;

export type ForumBoardPageCache = {
  board: Board;
  pins: Topic[];
  list: Topic[];
  total: number;
};

export type ForumLatestFeedCache = {
  pins: Topic[];
  list: Topic[];
  total: number;
  page: number;
};

export type ForumTopicCache = {
  topic: Topic;
  replies: Reply[];
};

function part(value: string | number) {
  return encodeURIComponent(String(value));
}

function cacheKey(scope: string, kind: string, ...parts: Array<string | number>) {
  return [PREFIX, part(scope), kind, ...parts.map(part)].join(":");
}

/** 删除过期的论坛缓存，并按保存时间只保留最近的帖子详情与列表页条目。 */
export function pruneForumViewCache() {
  pruneViewCache(`${PREFIX}:`, {
    maxAgeMs: MAX_AGE_MS,
    // 键格式为 前缀:作用域:类型:…，作用域已编码，不含冒号。
    groupOf: (key) => (key.split(":")[2] === "topic" ? "topic" : "list"),
    limits: { topic: FORUM_CACHE_MAX_TOPIC_ENTRIES, list: FORUM_CACHE_MAX_LIST_ENTRIES },
  });
}

let pruneScheduled = false;

function schedulePrune() {
  if (pruneScheduled || typeof window === "undefined") return;
  pruneScheduled = true;
  const run = () => {
    pruneScheduled = false;
    pruneForumViewCache();
  };
  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 5000 });
  } else {
    window.setTimeout(run, 1000);
  }
}

function writeForumCache<T>(key: string, data: T) {
  writeViewCache(key, data);
  schedulePrune();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isBoardList(value: unknown): value is Board[] {
  return Array.isArray(value) && value.every((item) => isObject(item) && typeof item.slug === "string");
}

function isBoardPage(value: unknown): value is ForumBoardPageCache {
  if (!isObject(value)) return false;
  return isObject(value.board)
    && typeof value.board.slug === "string"
    && Array.isArray(value.pins)
    && Array.isArray(value.list)
    && typeof value.total === "number";
}

function isLatestFeed(value: unknown): value is ForumLatestFeedCache {
  if (!isObject(value)) return false;
  return Array.isArray(value.pins)
    && Array.isArray(value.list)
    && typeof value.total === "number"
    && typeof value.page === "number";
}

function isTopicCache(value: unknown): value is ForumTopicCache {
  if (!isObject(value)) return false;
  return isObject(value.topic)
    && typeof value.topic.id === "number"
    && Array.isArray(value.replies);
}

export function forumCacheScope(user?: { id?: number; role?: string } | null) {
  return user?.id ? `user-${user.id}:role-${user.role || "user"}` : "guest";
}

export function readForumBoards(scope: string) {
  return readViewCache(cacheKey(scope, "boards"), isBoardList, MAX_AGE_MS);
}

export function writeForumBoards(scope: string, boards: Board[]) {
  writeForumCache(cacheKey(scope, "boards"), boards);
}

export function readForumBoardPage(scope: string, slug: string, page: number, sort: string) {
  return readViewCache(cacheKey(scope, "board", slug, page, sort), isBoardPage, MAX_AGE_MS);
}

export function writeForumBoardPage(scope: string, slug: string, page: number, sort: string, data: ForumBoardPageCache) {
  writeForumCache(cacheKey(scope, "board", slug, page, sort), data);
}

export function readForumHotFeed(scope: string) {
  return readViewCache(cacheKey(scope, "hot"), (value): value is Topic[] => Array.isArray(value), MAX_AGE_MS);
}

export function writeForumHotFeed(scope: string, list: Topic[]) {
  writeForumCache(cacheKey(scope, "hot"), list);
}

export function readForumLatestFeed(scope: string, stream = "all") {
  return readViewCache(cacheKey(scope, "latest", stream), isLatestFeed, MAX_AGE_MS);
}

export function writeForumLatestFeed(scope: string, data: ForumLatestFeedCache, stream = "all") {
  writeForumCache(cacheKey(scope, "latest", stream), data);
}

export function readForumTopic(scope: string, id: number) {
  return readViewCache(cacheKey(scope, "topic", id), isTopicCache, MAX_AGE_MS);
}

export function writeForumTopic(scope: string, id: number, data: ForumTopicCache) {
  writeForumCache(cacheKey(scope, "topic", id), data);
}
