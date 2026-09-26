import assert from "node:assert/strict";
import test from "node:test";
import {
  FORUM_CACHE_MAX_LIST_ENTRIES,
  FORUM_CACHE_MAX_TOPIC_ENTRIES,
  forumCacheScope,
  pruneForumViewCache,
  readForumTopic,
  writeForumTopic,
} from "../src/utils/forumCache";
import { sweepPageViewCaches } from "../src/utils/viewCache";

const DAY_MS = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    keys: () => [...values.keys()],
  };
}

function installStorage() {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return storage;
}

function envelope(savedAt: number, data: unknown = {}) {
  return JSON.stringify({ version: 1, savedAt, data });
}

test("论坛缓存清理只删除过期或损坏的论坛条目，不触碰课表等其他缓存", () => {
  const storage = installStorage();
  const now = Date.now();
  const scheduleKey = "cpu-schedule-cache-v3:undergraduate:2026-2027-1:1";
  storage.setItem(scheduleKey, JSON.stringify({ savedAt: now - 30 * DAY_MS, data: {} }));
  storage.setItem("cpu-authenticated", "1");
  storage.setItem("cpu-forum-pending-reply:12", "draft");
  storage.setItem("cpu-forum-view-v1:guest:topic:1", envelope(now - DAY_MS - 1000));
  storage.setItem("cpu-forum-view-v1:guest:topic:2", envelope(now - 1000));
  storage.setItem("cpu-forum-view-v1:guest:board:news:1:latest", "{not json");
  storage.setItem("cpu-forum-view-v1:guest:hot", JSON.stringify({ version: 0, savedAt: now, data: [] }));
  // 头部顺序不同的旧条目仍按完整 JSON 解析保存时间。
  storage.setItem("cpu-forum-view-v1:guest:latest:all", JSON.stringify({ savedAt: now - 2000, version: 1, data: {} }));

  pruneForumViewCache();

  assert.deepEqual(storage.keys().sort(), [
    "cpu-authenticated",
    "cpu-forum-pending-reply:12",
    "cpu-forum-view-v1:guest:latest:all",
    "cpu-forum-view-v1:guest:topic:2",
    scheduleKey,
  ].sort());
});

test("论坛缓存按保存时间分别保留最近的帖子详情和列表条目", () => {
  const storage = installStorage();
  const now = Date.now();
  const extraTopics = 5;
  const extraLists = 3;
  for (let index = 0; index < FORUM_CACHE_MAX_TOPIC_ENTRIES + extraTopics; index += 1) {
    const scope = index % 2 ? "guest" : encodeURIComponent("user-1:role-user");
    storage.setItem(`cpu-forum-view-v1:${scope}:topic:${index}`, envelope(now - (1000 + index) * 1000));
  }
  for (let index = 0; index < FORUM_CACHE_MAX_LIST_ENTRIES + extraLists; index += 1) {
    storage.setItem(`cpu-forum-view-v1:guest:board:b${index}:1:latest`, envelope(now - (1000 + index) * 1000));
  }

  pruneForumViewCache();

  const keys = storage.keys();
  const topicIds = keys.filter((key) => key.includes(":topic:")).map((key) => Number(key.split(":").pop()));
  const boards = keys.filter((key) => key.includes(":board:"));
  assert.equal(topicIds.length, FORUM_CACHE_MAX_TOPIC_ENTRIES);
  assert.equal(boards.length, FORUM_CACHE_MAX_LIST_ENTRIES);
  // 编号越小保存得越晚，应保留编号最小的那一批。
  assert.equal(Math.max(...topicIds), FORUM_CACHE_MAX_TOPIC_ENTRIES - 1);
  assert.ok(!boards.includes(`cpu-forum-view-v1:guest:board:b${FORUM_CACHE_MAX_LIST_ENTRIES}:1:latest`));
});

test("写入后的论坛帖子缓存仍可读取", () => {
  installStorage();
  const scope = forumCacheScope({ id: 7, role: "user" });
  const topic = { id: 9, title: "hello" } as never;
  writeForumTopic(scope, 9, { topic, replies: [] });
  assert.deepEqual(readForumTopic(scope, 9), { topic, replies: [] });
  pruneForumViewCache();
  assert.deepEqual(readForumTopic(scope, 9), { topic, replies: [] });
});

test("页面视图缓存清理只删除过期条目", () => {
  const storage = installStorage();
  const now = Date.now();
  storage.setItem("cpu-profile-view-v1:user-1", envelope(now - DAY_MS - 1000));
  storage.setItem("cpu-profile-view-v1:user-2", envelope(now - 1000));
  storage.setItem("cpu-services-tools-v1:guest", envelope(now - 2 * DAY_MS));
  storage.setItem("cpu-services-tools-v1:user-2", envelope(now));
  storage.setItem("cpu-home-summary-v1:guest", envelope(now - 5 * DAY_MS));

  sweepPageViewCaches();

  assert.deepEqual(storage.keys().sort(), [
    "cpu-home-summary-v1:guest",
    "cpu-profile-view-v1:user-2",
    "cpu-services-tools-v1:user-2",
  ]);
});
