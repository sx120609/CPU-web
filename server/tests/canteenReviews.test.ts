import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma";
import { submitCanteenReview } from "../src/services/canteenReviews";
import { toolsRouter } from "../src/routes/tools";

test("canteen publication respects active, expired and permanent account restrictions inside the deletion lock", async () => {
  const originalTransaction = prisma.$transaction;
  const originalAggregate = prisma.canteenReview.aggregate;
  let player: { status: string; mutedUntil: Date | null } | null = { status: "active", mutedUntil: null };
  let locked = false;
  let writes = 0;
  let statusAfterLock: string | undefined;
  const tx = {
    $executeRaw: async () => {
      locked = true;
      if (statusAfterLock && player) player.status = statusAfterLock;
      return 1;
    },
    user: { findUnique: async () => { assert.ok(locked); return player; } },
    canteenReview: { upsert: async ({ create }: any) => {
      assert.ok(locked);
      writes += 1;
      return { ...create, updatedAt: new Date() };
    } },
  };
  prisma.$transaction = (async (fn: any) => {
    locked = false;
    try { return await fn(tx); } finally { locked = false; }
  }) as typeof originalTransaction;
  prisma.canteenReview.aggregate = (async () => ({ _avg: { rating: 4 }, _count: { _all: 1 } })) as any;
  const submit = () => submitCanteenReview("1.1::张良麻辣烫", 4, "  好吃  ", { userId: 7 });
  try {
    assert.equal((await submit()).me.comment, "好吃");
    for (const status of ["banned", "deleting", "deleted"]) {
      player = { status, mutedUntil: null };
      await assert.rejects(submit(), /账户已停止访问/);
    }
    player = { status: "muted", mutedUntil: null };
    await assert.rejects(submit(), /禁言/);
    player = { status: "muted", mutedUntil: new Date(Date.now() + 60_000) };
    await assert.rejects(submit(), /禁言/);
    assert.equal(writes, 1);
    player = { status: "muted", mutedUntil: new Date(Date.now() - 1_000) };
    assert.equal((await submit()).recorded, true);
    player = { status: "active", mutedUntil: null };
    statusAfterLock = "deleting";
    await assert.rejects(submit(), /账户已停止访问/);
    assert.equal(writes, 2, "a submission waiting behind deletion must not recreate reviews");
  } finally {
    prisma.$transaction = originalTransaction;
    prisma.canteenReview.aggregate = originalAggregate;
  }
});

test("the reviews route allows public reads by default and enforces the tool login setting", async () => {
  const originalSetting = prisma.toolSetting.upsert;
  const originalAggregate = prisma.canteenReview.aggregate;
  const originalRows = prisma.canteenReview.findMany;
  let requireLogin = false;
  let reads = 0;
  prisma.toolSetting.upsert = (async () => ({ toolCode: "canteen_picker", requireLogin })) as any;
  prisma.canteenReview.aggregate = (async () => {
    reads += 1;
    return { _avg: { rating: null }, _count: { _all: 0 } };
  }) as any;
  prisma.canteenReview.findMany = (async () => []) as any;
  const route = toolsRouter.stack.find((layer: any) => layer.route?.path === "/canteen/reviews" && layer.route.methods.get)?.route as any;
  assert.ok(route);
  const handler = route.stack.at(-1).handle;
  const invoke = async () => {
    let body: any;
    let error: any;
    await handler({ query: { shopId: "1.1::张良麻辣烫" } }, { json: (value: any) => { body = value; } }, (value: any) => { error = value; });
    return { body, error };
  };
  try {
    const publicRead = await invoke();
    assert.equal(publicRead.error, undefined);
    assert.equal(publicRead.body.code, 0);
    requireLogin = true;
    const restrictedRead = await invoke();
    assert.equal(restrictedRead.error.status, 401);
    assert.equal(restrictedRead.body, undefined);
    assert.equal(reads, 1, "restricted guests must not query review data");
  } finally {
    prisma.toolSetting.upsert = originalSetting;
    prisma.canteenReview.aggregate = originalAggregate;
    prisma.canteenReview.findMany = originalRows;
  }
});
