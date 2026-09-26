import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma";
import { messageRouter } from "../src/routes/message";

function replace(target: any, key: string, value: unknown, t: { after: (fn: () => void) => void }) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

async function listMessages(userId: number, headers: Record<string, string> = {}) {
  const route = messageRouter.stack.find((layer: any) => layer.route?.path === "/" && layer.route.methods.get)?.route as any;
  let payload: any;
  let failure: any;
  await route.stack.at(-1).handle(
    { user: { userId }, query: {}, get: (name: string) => headers[name.toLowerCase()] },
    { json(value: any) { payload = value; return this; } },
    (error: any) => { failure = error; },
  );
  assert.equal(failure, undefined, failure?.message);
  return payload.data;
}

test("消息列表只为本次返回的全局通知读取已读记录，结果保持不变", async (t) => {
  const createdAt = new Date("2026-09-01T00:00:00Z");
  const notifications = [
    { id: 11, userId: 3, category: "reply", targetClient: null, readAt: null, payload: '{"a":1}', createdAt },
    { id: 12, userId: null, category: "system", targetClient: "all", readAt: null, payload: "{}", createdAt },
    { id: 13, userId: null, category: "system", targetClient: "ios", readAt: null, payload: "{}", createdAt },
    { id: 14, userId: 3, category: "like", targetClient: "web", readAt: new Date("2026-09-02T00:00:00Z"), payload: "bad-json", createdAt },
    { id: 15, userId: null, category: "system", targetClient: null, readAt: null, payload: "{}", createdAt },
  ];
  const reads = [
    { userId: 3, notificationId: 12, readAt: new Date("2026-09-03T00:00:00Z") },
    { userId: 3, notificationId: 13, readAt: new Date("2026-09-04T00:00:00Z") },
    { userId: 3, notificationId: 999, readAt: new Date("2026-09-05T00:00:00Z") },
  ];
  const readQueries: any[] = [];
  replace(prisma.notification, "findMany", async () => notifications.map((item) => ({ ...item })), t);
  replace(prisma.notificationRead, "findMany", async (args: any) => {
    readQueries.push(args.where);
    return reads
      .filter((item) => item.userId === args.where.userId && args.where.notificationId.in.includes(item.notificationId))
      .map(({ notificationId, readAt }) => ({ notificationId, readAt }));
  }, t);

  const list = await listMessages(3);
  assert.deepEqual(list.map((item: any) => item.id), [11, 12, 14, 15]);
  assert.deepEqual(list.map((item: any) => item.readAt), [null, reads[0].readAt, notifications[3].readAt, null]);
  assert.deepEqual(list[0].payload, { a: 1 });
  assert.deepEqual(list[2].payload, {});
  assert.deepEqual(readQueries, [{ userId: 3, notificationId: { in: [12, 15] } }]);

  // iOS 客户端能看到 13 号通知，也只查询它实际拿到的全局通知。
  const iosList = await listMessages(3, { "x-cpu-client": "ios" });
  assert.deepEqual(iosList.map((item: any) => item.id), [11, 12, 13, 15]);
  assert.equal(iosList[2].readAt, reads[1].readAt);
  assert.deepEqual(readQueries.at(-1), { userId: 3, notificationId: { in: [12, 13, 15] } });
});

test("没有全局通知时不再查询已读记录", async (t) => {
  replace(prisma.notification, "findMany", async () => [
    { id: 21, userId: 3, category: "reply", targetClient: null, readAt: null, payload: "{}", createdAt: new Date() },
  ], t);
  let readQueries = 0;
  replace(prisma.notificationRead, "findMany", async () => {
    readQueries += 1;
    return [];
  }, t);
  const list = await listMessages(3);
  assert.equal(list.length, 1);
  assert.equal(readQueries, 0);
});
