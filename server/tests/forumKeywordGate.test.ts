import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("keyword hits remain private on forum create/edit, even for AI-whitelisted staff", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { topicRouter } = await import("../src/routes/topic");
  const { replyRouter } = await import("../src/routes/reply");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const replace = (target: any, key: string, value: any) => {
    const previous = target[key]; target[key] = value;
    t.after(() => { target[key] = previous; });
  };
  const board = { id: 1, slug: "market", name: "二手交流", type: "market", readOnly: false };
  let topic: any;
  let reply: any;
  const writes: any[] = [];
  replace(prisma.user, "findUnique", async () => ({ id: 1, status: "active", aiReviewWhitelisted: true }));
  replace(prisma.user, "updateMany", async () => ({ count: 0 }));
  replace(prisma.user, "update", async () => ({}));
  replace(prisma.user, "findMany", async () => []);
  replace(prisma.board, "findUnique", async () => board);
  replace(prisma.board, "update", async () => ({}));
  replace(prisma.topic, "findUnique", async () => ({ ...topic }));
  replace(prisma.reply, "findUnique", async () => ({ ...reply }));
  replace(prisma.topic, "count", async () => 0);
  replace(prisma.reply, "count", async () => 0);
  replace(prisma.reply, "findFirst", async () => null);
  replace(prisma.topic, "findFirst", async () => null);
  replace(prisma.notification, "create", async () => ({}));
  replace(prisma.siteSetting, "upsert", async () => ({}));
  replace(prisma, "$transaction", async (work: any) => work(prisma));
  for (const method of ["create", "update"]) {
    replace(prisma.topic, method, async ({ data }: any) => { writes.push(data); Object.assign(topic, data); return { ...topic }; });
    replace(prisma.reply, method, async ({ data }: any) => { writes.push(data); Object.assign(reply, data); return { ...reply }; });
  }
  for (const [router, method, path, body] of [
    [topicRouter, "post", "/", { boardSlug: "market", title: "课程教材", content: "麻豆传媒" }],
    [topicRouter, "patch", "/:id", { content: "销售摇@头@丸" }],
    [replyRouter, "post", "/", { topicId: 1, content: "三片高清" }],
    [replyRouter, "patch", "/:id", { content: "习扁担" }],
  ] as const) {
    topic = { id: 1, boardId: 1, title: "课程教材", content: "原始正文", metadata: "{}", authorId: 2, hidden: false, locked: false, board };
    reply = { id: 3, topicId: 1, authorId: 2, content: "原始回复", hidden: false, topic, parentReplyId: null };
    const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method])?.route;
    assert.ok(route, `${method} ${path}`);
    let failure: any, payload: any, status = 200;
    await route.stack.at(-1).handle(
      { body, params: { id: "1" }, user: { userId: 1, role: "admin" } },
      { setHeader() {}, status(value: number) { status = value; return this; }, json(value: any) { payload = value; } },
      (error: any) => { failure = error; },
    );
    assert.equal(failure, undefined, `${method} ${path}: ${failure?.message}`);
    assert.equal(status, 202);
    assert.equal(payload.data.hidden, true);
    assert.ok(["pending", "manual_review"].includes(payload.data.submissionResult.status));
  }
  assert.ok(writes.filter(write => write.content).every(write => write.hidden === true));
  t.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
});
