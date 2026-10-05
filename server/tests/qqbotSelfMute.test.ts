import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

function replace(t: TestContext, target: any, key: string, implementation: (...args: any[]) => any) {
  const original = target[key];
  const mocked = t.mock.fn(implementation);
  target[key] = mocked;
  t.after(() => { target[key] = original; });
  return mocked;
}

async function setup(t: TestContext, group: any = { enabled: true, allowMute: true }, banError?: string) {
  const { prisma } = await import("../src/prisma");
  const { handleQqBotWebhook } = await import("../src/services/qqbot");
  const requests: { action: string; body: any }[] = [];
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
  const groupLookup = replace(t, prisma.qqBotGroup, "findUnique", async () => group);
  replace(t, prisma.qqBotMessageLog, "create", async ({ data }: any) => {
    logs.push(data);
    return data;
  });
  // A posting conversation or verification must never consume /banme.
  replace(t, prisma.qqBotConversation, "findFirst", async () => {
    assert.fail("self-mute must run before conversation handling");
  });
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    const action = new URL(String(url)).pathname.slice(1);
    requests.push({ action, body: JSON.parse(options.body) });
    return Response.json(action === "set_group_ban" && banError
      ? { status: "failed", retcode: 1, wording: banError }
      : { status: "ok", retcode: 0, data: { message_id: 456 } });
  });
  const event = {
    post_type: "message",
    message_type: "group" as const,
    group_id: 20002,
    user_id: 30003,
    self_id: 10001,
    message_id: 123,
    sender: { role: "member" },
    message: [{ type: "text", data: { text: "/banme" } }],
  };
  return { handleQqBotWebhook, event, requests, logs, groupLookup };
}

test("普通群成员无需 @ 或绑定即可禁言自己 60 秒，命令优先于投稿会话", async (t) => {
  const { handleQqBotWebhook, event, requests, logs, groupLookup } = await setup(t);
  assert.deepEqual(await handleQqBotWebhook(event), { ok: true });
  assert.deepEqual(requests[0], {
    action: "set_group_ban",
    body: { group_id: 20002, user_id: 30003, duration: 60 },
  });
  assert.equal(requests[1].action, "send_group_msg");
  assert.match(requests[1].body.message, /已将你禁言 1 分钟/);
  assert.deepEqual(groupLookup.mock.calls[0].arguments[0], { where: { groupId: "20002" } });
  assert.equal(logs.find(log => log.command === "banme")?.status, "ok");
});

test("即使消息 @ 了其他成员，自助禁言仍只作用于发送者", async (t) => {
  const { handleQqBotWebhook, event, requests } = await setup(t);
  event.message.unshift({ type: "at", data: { qq: "40004" } } as any);
  await handleQqBotWebhook(event);
  assert.equal(requests[0].body.user_id, event.user_id);
  assert.equal(requests[0].body.duration, 60);
});

for (const [name, group] of [
  ["未配置", null],
  ["未启用", { enabled: false, allowMute: true }],
  ["禁言关闭", { enabled: true, allowMute: false }],
] as const) {
  test(`群${name}时不执行禁言`, async (t) => {
    const { handleQqBotWebhook, event, requests, logs } = await setup(t, group);
    await handleQqBotWebhook(event);
    assert.equal(requests.some(request => request.action === "set_group_ban"), false);
    assert.match(requests[0].body.message, /未开启禁言/);
    assert.equal(logs.find(log => log.command === "banme")?.status, "ignored");
  });
}

test("私聊返回群聊使用提示，不执行禁言或查询群配置", async (t) => {
  const { handleQqBotWebhook, event, requests, groupLookup } = await setup(t);
  await handleQqBotWebhook({ ...event, message_type: "private", group_id: undefined });
  assert.equal(groupLookup.mock.callCount(), 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "send_private_msg");
  assert.match(requests[0].body.message, /只能在群聊/);
});

test("NapCat 拒绝禁言时返回失败提示并记录错误", async (t) => {
  const { handleQqBotWebhook, event, requests, logs } = await setup(t, undefined, "权限不足");
  await handleQqBotWebhook(event);
  assert.match(requests[1].body.message, /自助禁言失败：权限不足/);
  assert.doesNotMatch(requests[1].body.message, /已将你禁言/);
  assert.equal(logs.find(log => log.command === "banme")?.status, "error");
});

test("机器人自己的消息不能触发自我禁言", async (t) => {
  const { handleQqBotWebhook, event, requests, logs } = await setup(t);
  await handleQqBotWebhook({ ...event, user_id: event.self_id });
  assert.equal(requests.some(request => request.action === "set_group_ban"), false);
  assert.equal(logs.find(log => log.command === "banme")?.status, "error");
});
