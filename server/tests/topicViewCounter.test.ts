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
