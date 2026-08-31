import type { Board } from "@/api/board";
import type { Reply, Topic } from "@/api/topic";
import { readViewCache, writeViewCache } from "@/utils/viewCache";

const PREFIX = "cpu-forum-view-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  writeViewCache(cacheKey(scope, "boards"), boards);
}

export function readForumBoardPage(scope: string, slug: string, page: number, sort: string) {
  return readViewCache(cacheKey(scope, "board", slug, page, sort), isBoardPage, MAX_AGE_MS);
}

export function writeForumBoardPage(scope: string, slug: string, page: number, sort: string, data: ForumBoardPageCache) {
  writeViewCache(cacheKey(scope, "board", slug, page, sort), data);
}

export function readForumHotFeed(scope: string) {
  return readViewCache(cacheKey(scope, "hot"), (value): value is Topic[] => Array.isArray(value), MAX_AGE_MS);
}

export function writeForumHotFeed(scope: string, list: Topic[]) {
  writeViewCache(cacheKey(scope, "hot"), list);
}

export function readForumLatestFeed(scope: string, stream = "all") {
  return readViewCache(cacheKey(scope, "latest", stream), isLatestFeed, MAX_AGE_MS);
}

export function writeForumLatestFeed(scope: string, data: ForumLatestFeedCache, stream = "all") {
  writeViewCache(cacheKey(scope, "latest", stream), data);
}

export function readForumTopic(scope: string, id: number) {
  return readViewCache(cacheKey(scope, "topic", id), isTopicCache, MAX_AGE_MS);
}

export function writeForumTopic(scope: string, id: number, data: ForumTopicCache) {
  writeViewCache(cacheKey(scope, "topic", id), data);
}
