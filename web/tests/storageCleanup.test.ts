import assert from "node:assert/strict";
import test from "node:test";
import { isJwxtDataCacheKey } from "../src/utils/jwxtCache";
import {
  clearNativeStorage,
  formatBytes,
  hasNativeStorageBridge,
  isPageCacheKey,
  measureNativeStorage,
  parseNativeStorageUsage,
  removeStorageKeys,
  storageBytes,
} from "../src/utils/storageCleanup";

function memoryStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => { data.delete(key); },
    keys: () => [...data.keys()],
  };
}

// 清理缓存时必须留下的本地数据：登录、教务账号、草稿、外观和课表自定义内容。
const KEPT_KEYS = [
  "cpu-web-token",
  "cpu-authenticated",
  "cpu-jwxt-creds-v1",
  "cpu-jwxt-key-v1",
  "cpu-jwxt-cache-presence-v1",
  "cpu-appearance-mode-v1",
  "cpu-schedule-theme-v2",
  "cpu-schedule-edits-v1",
  "cpu-schedule-background-v1",
  "cpu-post-new-draft-general",
  "cpu-iservice-favorite-overrides",
  "cpu-data-auth-agreement-v1",
  "cpu-account-deletion-receipt",
  "cpu-forum-pending-reply:42",
];

test("page and academic categories never match login, settings or drafts", () => {
  for (const key of KEPT_KEYS) {
    assert.equal(isPageCacheKey(key), false, key);
    assert.equal(isJwxtDataCacheKey(key), false, key);
  }
});

test("page cache keys cover the per-page snapshots only", () => {
  for (const key of [
    "cpu-home-summary-v1:u1",
    "cpu-home-second-hand-v1:u1",
    "cpu-profile-view-v1:u1",
    "cpu-services-tools-v1:guest",
    "cpu-forum-view-v1:u1:topic:9",
    "cpu-iservice-apps-cache-v1",
  ]) assert.equal(isPageCacheKey(key), true, key);
  assert.equal(isPageCacheKey("cpu-schedule-cache-v3:browser-session:u1:2026-2027-1:6"), false);
  assert.equal(isJwxtDataCacheKey("cpu-schedule-cache-v3:browser-session:u1:2026-2027-1:6"), true);
  assert.equal(isJwxtDataCacheKey("cpu-jwxt-tab-cache-v10:browser-session:u1:grades"), true);
});

test("storage size counts two bytes per character of matching keys and values", () => {
  const storage = memoryStorage({
    "cpu-home-summary-v1:u1": "12345678",
    "cpu-web-token": "secret",
  });
  assert.equal(storageBytes(storage, isPageCacheKey), ("cpu-home-summary-v1:u1".length + 8) * 2);
});

test("removing a category leaves every other key in place", () => {
  const storage = memoryStorage({
    "cpu-home-summary-v1:u1": "a",
    "cpu-forum-view-v1:u1:topic:9": "b",
    "cpu-schedule-cache-v3:browser-session:u1:current:6": "c",
    ...Object.fromEntries(KEPT_KEYS.map((key) => [key, "keep"])),
  });

  assert.equal(removeStorageKeys(storage, isPageCacheKey), 2);
  assert.equal(removeStorageKeys(storage, isJwxtDataCacheKey), 1);
  assert.deepEqual(storage.keys().sort(), [...KEPT_KEYS].sort());
});

test("the Android string bridge and the Harmony promise bridge are both awaited", async () => {
  const usage = { categories: [{ id: "network", bytes: 1 }, { id: "temp", bytes: 2 }], totalBytes: 3 };
  const cleared = { categories: [{ id: "network", bytes: 0 }, { id: "temp", bytes: 2 }], totalBytes: 2 };
  const host = globalThis as unknown as { window?: Record<string, unknown> };
  const previous = host.window;
  try {
    const calls: string[] = [];
    host.window = { CPUAndroid: {
      getStorageUsage: () => JSON.stringify(usage),
      clearStorage: (categories: string) => { calls.push(categories); return JSON.stringify(cleared); },
    } };
    assert.equal(hasNativeStorageBridge(), true);
    assert.deepEqual(await measureNativeStorage(), usage);
    assert.deepEqual(await clearNativeStorage(["network"]), cleared);
    assert.deepEqual(calls, ['["network"]']);

    host.window = { CPUHarmony: {
      getStorageUsage: async () => JSON.stringify(usage),
      clearStorage: async () => JSON.stringify(cleared),
    } };
    assert.deepEqual(await measureNativeStorage(), usage);
    assert.deepEqual(await clearNativeStorage(["network", "temp"]), cleared);

    host.window = { CPUHarmony: { getStorageUsage: async () => { throw new Error("gone"); }, clearStorage: async () => "" } };
    assert.equal(await measureNativeStorage(), null);
    assert.equal(await clearNativeStorage(["temp"]), null);

    host.window = { CPUHarmony: { getVersionName: () => "3.0.2" } };
    assert.equal(hasNativeStorageBridge(), false);
  } finally {
    host.window = previous;
  }
});

test("native usage accepts the Android JSON string and the iOS reply object", () => {
  const expected = { categories: [{ id: "network", bytes: 2048 }, { id: "temp", bytes: 0 }], totalBytes: 4096 };
  assert.deepEqual(parseNativeStorageUsage(JSON.stringify(expected)), expected);
  assert.deepEqual(parseNativeStorageUsage(expected), expected);
});

test("native usage drops unknown categories and rejects malformed replies", () => {
  assert.deepEqual(
    parseNativeStorageUsage({ categories: [{ id: "cookies", bytes: 9 }, { id: "temp", bytes: -5 }, null] }),
    { categories: [{ id: "temp", bytes: 0 }], totalBytes: null },
  );
  assert.equal(parseNativeStorageUsage(""), null);
  assert.equal(parseNativeStorageUsage("{"), null);
  assert.equal(parseNativeStorageUsage({ totalBytes: 1 }), null);
  assert.equal(parseNativeStorageUsage(undefined), null);
});

test("sizes are shown in the unit a person would read", () => {
  assert.equal(formatBytes(0), "0 KB");
  assert.equal(formatBytes(-1), "0 KB");
  assert.equal(formatBytes(512), "不到 1 KB");
  assert.equal(formatBytes(1536), "2 KB");
  assert.equal(formatBytes(4.4 * 1024 * 1024), "4.4 MB");
  assert.equal(formatBytes(104.6 * 1024 * 1024), "104.6 MB");
  assert.equal(formatBytes(12 * 1024 * 1024), "12 MB");
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), "1.5 GB");
});
