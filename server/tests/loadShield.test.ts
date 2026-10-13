import assert from "node:assert/strict";
import test from "node:test";
import { ConcurrencyGate, ConcurrencyGateFullError, TtlLru, createWindowBudget } from "../src/utils/loadShield";

test("concurrent misses for one key run the loader once", async () => {
  const cache = new TtlLru<number>({ maxEntries: 10 });
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loader = async () => {
    loads += 1;
    await gate;
    return 42;
  };
  const waiting = Array.from({ length: 50 }, () => cache.load("topic", 1_000, loader));
  release();
  assert.deepEqual(new Set(await Promise.all(waiting)), new Set([42]));
  assert.equal(loads, 1);
  assert.equal(await cache.load("topic", 1_000, loader), 42);
  assert.equal(loads, 1);
});

test("null is cached as a value and expired entries are reloaded", async () => {
  const cache = new TtlLru<string | null>({ maxEntries: 10 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return null;
  };
  assert.equal(await cache.load("missing", 1_000, loader), null);
  assert.equal(await cache.load("missing", 1_000, loader), null);
  assert.equal(loads, 1);

  cache.set("old", "value", 10, Date.now() - 20);
  assert.equal(cache.get("old"), undefined);
  assert.equal(cache.size, 1);
});

test("a failed load is not cached", async () => {
  const cache = new TtlLru<number>({ maxEntries: 10 });
  let calls = 0;
  await assert.rejects(cache.load("key", 1_000, async () => {
    calls += 1;
    throw new Error("database down");
  }));
  assert.equal(await cache.load("key", 1_000, async () => ++calls), 2);
});

test("entry and byte limits evict the least recently used entries", () => {
  const cache = new TtlLru<Buffer>({ maxEntries: 3, maxBytes: 10, sizeOf: (value) => value.length });
  cache.set("a", Buffer.alloc(3), 1_000);
  cache.set("b", Buffer.alloc(3), 1_000);
  cache.set("c", Buffer.alloc(3), 1_000);
  assert.ok(cache.get("a"));
  cache.set("d", Buffer.alloc(3), 1_000);
  assert.equal(cache.get("b"), undefined);
  assert.ok(cache.get("a"));
  cache.set("big", Buffer.alloc(11), 1_000);
  assert.equal(cache.get("big"), undefined);
  cache.set("e", Buffer.alloc(8), 1_000);
  assert.deepEqual(["a", "c", "d", "e"].filter((key) => cache.get(key)), ["e"]);
});

test("the gate caps concurrency and rejects work beyond its queue", async () => {
  const gate = new ConcurrencyGate(2, 1);
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const task = () => gate.run(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    return "done";
  });
  const accepted = [task(), task(), task()];
  await assert.rejects(task(), ConcurrencyGateFullError);
  assert.equal(gate.active, 2);
  assert.equal(gate.queued, 1);
  while (releases.length) {
    releases.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(await Promise.all(accepted), ["done", "done", "done"]);
  assert.equal(peak, 2);
  assert.equal(gate.active, 0);
  assert.equal(await gate.run(async () => "again"), "again");
});

test("a window budget allows a fixed number of events per window", () => {
  const take = createWindowBudget(2, 1_000);
  assert.deepEqual([take(0), take(10), take(20)], [true, true, false]);
  assert.equal(take(999), false);
  assert.deepEqual([take(1_000), take(1_001), take(1_002)], [true, true, false]);
});
