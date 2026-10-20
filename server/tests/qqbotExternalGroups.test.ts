import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const EXTERNAL_GROUP_ID = 20002;

function replace(t: TestContext, target: any, key: string, implementation: (...args: any[]) => any) {
  const original = target[key];
  const mocked = t.mock.fn(implementation);
  target[key] = mocked;
  t.after(() => { target[key] = original; });
  return mocked;
}

async function setup(t: TestContext) {
  const previous = process.env.QQBOT_EXTERNAL_GROUP_IDS;
  process.env.QQBOT_EXTERNAL_GROUP_IDS = `999, ${EXTERNAL_GROUP_ID}`;
  t.after(() => {
    if (previous === undefined) delete process.env.QQBOT_EXTERNAL_GROUP_IDS;
    else process.env.QQBOT_EXTERNAL_GROUP_IDS = previous;
  });
  const { prisma } = await import("../src/prisma");
  const { handleQqBotWebhook } = await import("../src/services/qqbot");
  const requests: string[] = [];
  const logs: any[] = [];
  replace(t, prisma.qqBotConfig, "findUnique", async () => ({
    id: 1,
    enabled: true,
    botQqId: "10001",
    webhookSecret: "",
    connectionMode: "outbound",
    napcatBaseUrl: "https://napcat.test",
    accessToken: "",
    notifyCategories: '["reply","mention","like","system","service-tool","lost-found","school-feed"]',
    superAdminQqIds: "[]",
  }));
  const groupLookup = replace(t, prisma.qqBotGroup, "findUnique", async () => ({ enabled: true, allowMute: true }));
  const groupUpsert = replace(t, prisma.qqBotGroup, "upsert", async () => assert.fail("外部群不能被登记为投稿群"));
  replace(t, prisma.qqBotMessageLog, "create", async ({ data }: any) => {
    logs.push(data);
    return data;
  });
  t.mock.method(globalThis, "fetch", async (url: any) => {
    requests.push(new URL(String(url)).pathname.slice(1));
    return Response.json({ status: "ok", retcode: 0, data: { message_id: 456 } });
  });
  return { handleQqBotWebhook, requests, logs, groupLookup, groupUpsert };
}

test("外部群的 @ 帮助和自助禁言都不响应，也不写日志", async (t) => {
  const { handleQqBotWebhook, requests, logs, groupLookup } = await setup(t);
  for (const text of ["/banme", "帮助"]) {
    const result = await handleQqBotWebhook({
      post_type: "message",
      message_type: "group",
      group_id: EXTERNAL_GROUP_ID,
      user_id: 30003,
      self_id: 10001,
      message_id: 123,
      sender: { role: "member" },
      message: [{ type: "at", data: { qq: "10001" } }, { type: "text", data: { text } }],
    } as any);
    assert.deepEqual(result, { ignored: true });
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(logs, []);
  assert.equal(groupLookup.mock.callCount(), 0);
});

test("外部群的入群邀请和机器人入群通知不会自动通过或登记", async (t) => {
  const { handleQqBotWebhook, requests, groupUpsert } = await setup(t);
  assert.deepEqual(await handleQqBotWebhook({
    post_type: "request",
    request_type: "group",
    sub_type: "invite",
    flag: "invite-flag",
    group_id: EXTERNAL_GROUP_ID,
    user_id: 30003,
    self_id: 10001,
  } as any), { ignored: true });
  assert.deepEqual(await handleQqBotWebhook({
    post_type: "notice",
    notice_type: "group_increase",
    group_id: EXTERNAL_GROUP_ID,
    user_id: 10001,
    self_id: 10001,
  } as any), { ignored: true });
  assert.deepEqual(requests, []);
  assert.equal(groupUpsert.mock.callCount(), 0);
});

test("不在外部群名单里的群照常处理", async (t) => {
  const { handleQqBotWebhook, requests } = await setup(t);
  const result = await handleQqBotWebhook({
    post_type: "message",
    message_type: "group",
    group_id: 30003,
    user_id: 40004,
    self_id: 10001,
    message_id: 124,
    sender: { role: "member" },
    message: [{ type: "text", data: { text: "/banme" } }],
  } as any);
  assert.deepEqual(result, { ok: true });
  assert.equal(requests[0], "set_group_ban");
});
