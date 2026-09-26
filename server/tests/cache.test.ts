import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("shared cache serves stale data immediately and refreshes it in the background", async () => {
  const { withCache } = await import("../src/services/cache");
  let loads = 0;
  const loader = async () => ({ value: ++loads });

  const first = await withCache("test-stale-cache", ["one"], 20, loader);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(await withCache("test-stale-cache", ["one"], 20, loader), { value: 1 });

  await wait(30);
  const stale = await withCache("test-stale-cache", ["one"], 20, loader);
  assert.deepEqual(stale, { value: 1 });

  for (let attempt = 0; attempt < 20 && loads < 2; attempt += 1) await wait(5);
  assert.equal(loads, 2);
  assert.deepEqual(await withCache("test-stale-cache", ["one"], 20, loader), { value: 2 });
});

test("cache version invalidation never serves the stale value from an older version", async () => {
  const { bumpCacheVersion, withCache } = await import("../src/services/cache");
  let value = 1;
  const domain = "test-versioned-cache";
  assert.equal(await withCache(domain, ["one"], 60_000, async () => value), 1);
  value = 2;
  await bumpCacheVersion(domain);
  assert.equal(await withCache(domain, ["one"], 60_000, async () => value), 2);
});

test("explicit refresh replaces the value used by subsequent readers", async () => {
  const { withCache } = await import("../src/services/cache");
  let value = 1;
  const read = (refresh = false) => withCache("test-forced-refresh", ["one"], 60_000, async () => value, { refresh });
  assert.equal(await read(), 1);
  value = 2;
  assert.equal(await read(true), 2);
  assert.equal(await read(), 2);
});

test("L1 cache evicts the least recently used entries beyond the entry cap", async () => {
  const { setLocalCacheLimitsForTests, withCache } = await import("../src/services/cache");
  const previous = setLocalCacheLimitsForTests({ maxEntries: 3 });
  try {
    const loads = new Map<string, number>();
    const read = (name: string) => withCache("test-lru-count", [name], 60_000, async () => {
      loads.set(name, (loads.get(name) ?? 0) + 1);
      return name;
    });
    await read("a");
    await read("b");
    await read("c");
    await read("a");
    await read("d");
    await read("c");
    await read("d");
    await read("a");
    assert.deepEqual(["a", "c", "d"].map((name) => loads.get(name)), [1, 1, 1]);
    assert.equal(await read("b"), "b");
    assert.equal(loads.get("b"), 2);
  } finally {
    setLocalCacheLimitsForTests(previous);
  }
});

test("L1 cache evicts by approximate size", async () => {
  const { setLocalCacheLimitsForTests, withCache } = await import("../src/services/cache");
  const previous = setLocalCacheLimitsForTests({ maxBytes: 64 * 1024 });
  try {
    let loads = 0;
    const large = "x".repeat(20 * 1024);
    const read = (name: string) => withCache("test-lru-bytes", [name], 60_000, async () => {
      loads += 1;
      return large;
    });
    await read("one");
    await read("two");
    await read("two");
    assert.equal(loads, 2);
    await read("one");
    assert.equal(loads, 3);
  } finally {
    setLocalCacheLimitsForTests(previous);
  }
});

test("L1 eviction never drops live non-cache values", async () => {
  const { getEphemeralValue, setEphemeralValue, setLocalCacheLimitsForTests, withCache } = await import("../src/services/cache");
  const previous = setLocalCacheLimitsForTests({ maxEntries: 1, maxBytes: 1 });
  try {
    await setEphemeralValue("test-lru:session", "keep", 60_000);
    for (const name of ["a", "b", "c"]) {
      assert.equal(await withCache("test-lru-ephemeral", [name], 60_000, async () => name), name);
    }
    assert.equal(await getEphemeralValue("test-lru:session"), "keep");
  } finally {
    setLocalCacheLimitsForTests(previous);
  }
});

test("periodic sweep removes expired local values of every kind and keeps live ones", async () => {
  const { getEphemeralValue, setEphemeralValue, sweepExpiredLocalCacheValues, withCache } = await import("../src/services/cache");
  const later = Date.now() + 10 * 60_000;
  // 先清掉前面用例留下的条目，便于精确计数。
  sweepExpiredLocalCacheValues(later);
  await setEphemeralValue("test-sweep:expired", "old", 1);
  await setEphemeralValue("test-sweep:live", "live", 60 * 60_000);
  let loads = 0;
  // L1 会在 ttl 之外再保留至少 60 秒的旧值窗口。
  assert.equal(await withCache("test-sweep", ["entry"], 1, async () => ++loads), 1);
  assert.equal(sweepExpiredLocalCacheValues(later), 2);
  assert.equal(sweepExpiredLocalCacheValues(later), 0);
  assert.equal(await getEphemeralValue("test-sweep:live"), "live");
  assert.equal(await withCache("test-sweep", ["entry"], 60_000, async () => ++loads), 2);
});
