import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("a flood of views on one topic becomes one database write per flush", async () => {
  const { prisma } = await import("../src/prisma");
  const { flushTopicViews, recordTopicView, unflushedTopicViews } = await import("../src/services/topicViewCounter");
  const calls: Array<{ ids: number[]; count: number }> = [];
  let fail = true;
  const original = prisma.topic.updateMany;
  prisma.topic.updateMany = (async (args: any) => {
    if (fail) throw new Error("database down");
    calls.push({ ids: [...args.where.id.in].sort(), count: args.data.viewCount.increment });
    return { count: args.where.id.in.length };
  }) as unknown as typeof original;
  try {
    for (let index = 0; index < 10_000; index += 1) recordTopicView(28036);
    recordTopicView(1);
    recordTopicView(2);
    assert.equal(unflushedTopicViews(28036), 10_000, "readers still see live counts");

    await flushTopicViews();
    assert.equal(calls.length, 0);
    assert.equal(unflushedTopicViews(28036), 10_000, "a failed write is retried, not lost");

    fail = false;
    await flushTopicViews();
    assert.deepEqual(calls.sort((a, b) => a.count - b.count), [{ ids: [1, 2], count: 1 }, { ids: [28036], count: 10_000 }]);
    assert.equal(unflushedTopicViews(28036), 0);
  } finally {
    prisma.topic.updateMany = original;
  }
});

test("shutdown drains arrivals queued behind an in-flight batch", async () => {
  const { prisma } = await import("../src/prisma");
  const { flushTopicViews, drainTopicViews, recordTopicView, unflushedTopicViews } = await import("../src/services/topicViewCounter");
  const original = prisma.topic.updateMany;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: number[] = [];
  prisma.topic.updateMany = (async (args: any) => {
    writes.push(args.data.viewCount.increment);
    if (writes.length === 1) await gate;
    return { count: 1 };
  }) as typeof original;
  try {
    recordTopicView(42, 2);
    const first = flushTopicViews();
    recordTopicView(42, 3);
    const drain = drainTopicViews();
    release();
    await Promise.all([first, drain]);
    assert.deepEqual(writes, [2, 3]);
    assert.equal(unflushedTopicViews(42), 0);
  } finally { prisma.topic.updateMany = original; }
});

test("shutdown retries only failed groups and reports bounded failure with pending counts retained", async () => {
  const { prisma } = await import("../src/prisma");
  const { drainTopicViews, recordTopicView, unflushedTopicViews } = await import("../src/services/topicViewCounter");
  const original = prisma.topic.updateMany;
  const writes: number[] = [];
  let failing = true;
  prisma.topic.updateMany = (async (args: any) => {
    const count = args.data.viewCount.increment;
    writes.push(count);
    if (count === 3 && failing) throw new Error("database down");
    return { count: 1 };
  }) as typeof original;
  try {
    recordTopicView(43, 2);
    recordTopicView(44, 3);
    await assert.rejects(drainTopicViews(), /1 pending topics/);
    assert.deepEqual(writes, [2, 3, 3, 3]);
    assert.equal(unflushedTopicViews(43), 0);
    assert.equal(unflushedTopicViews(44), 3);
    failing = false;
    await drainTopicViews();
    assert.equal(unflushedTopicViews(44), 0);
  } finally { prisma.topic.updateMany = original; }
});
