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
