import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

function replace(t: TestContext, target: any, key: string, value: any) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

function qqBotConfigRow() {
  return {
    id: 1,
    enabled: true,
    botQqId: "",
    connectionMode: "outbound",
    napcatBaseUrl: "",
    accessToken: "",
    webhookSecret: "",
    defaultBoardSlug: "general",
    allowPrivatePost: true,
    allowGroupPost: false,
    notificationEnabled: true,
    qrCodeSendingEnabled: false,
    notifyCategories: JSON.stringify(["reply", "mention", "like", "system", "service-tool", "lost-found", "school-feed"]),
    superAdminQqIds: "[]",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

test("QQBot 配置先只读查询、缺失时才创建，短时缓存返回副本，并在本进程更新后立即失效", async (t) => {
  const { prisma } = await import("../src/prisma");
  const qqbot = await import("../src/services/qqbot");
  let row: any = null;
  const calls = { findUnique: 0, upsert: 0 };
  replace(t, prisma.qqBotConfig, "findUnique", async () => {
    calls.findUnique += 1;
    return row && { ...row };
  });
  replace(t, prisma.qqBotConfig, "upsert", async ({ create, update }: any) => {
    calls.upsert += 1;
    row = row ? { ...row, ...update } : { ...qqBotConfigRow(), ...create };
    return { ...row };
  });

  const first = await qqbot.getQqBotConfigRaw();
  assert.deepEqual(calls, { findUnique: 1, upsert: 1 });
  first.enabled = false;
  const cached = await qqbot.getQqBotConfigRaw();
  assert.equal(cached.enabled, true);
  assert.deepEqual(calls, { findUnique: 1, upsert: 1 });

  const updated = await qqbot.updateQqBotConfig({ allowGroupPost: true });
  assert.equal(updated.allowGroupPost, true);
  assert.deepEqual(calls, { findUnique: 2, upsert: 2 });
  assert.equal((await qqbot.getQqBotConfigRaw()).allowGroupPost, true);
  assert.deepEqual(calls, { findUnique: 3, upsert: 2 });

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(5_001);
  assert.equal((await qqbot.getQqBotConfigRaw()).allowGroupPost, true);
  assert.deepEqual(calls, { findUnique: 4, upsert: 2 });
});

test("OneBot 心跳等 meta_event 帧不写入日志，其他被忽略的事件仍然记录", async (t) => {
  const { prisma } = await import("../src/prisma");
  const qqbot = await import("../src/services/qqbot");
  const logs: any[] = [];
  replace(t, prisma.qqBotConfig, "findUnique", async () => qqBotConfigRow());
  replace(t, prisma.qqBotMessageLog, "create", async ({ data }: any) => {
    logs.push(data);
    return data;
  });
  const heartbeat = { post_type: "meta_event", meta_event_type: "heartbeat", interval: 30_000 };
  const selfMessage = { post_type: "message_sent", message_type: "private" as const };

  assert.deepEqual(await qqbot.handleQqBotWebhook(heartbeat), { ignored: true });
  assert.equal(logs.length, 0);
  assert.deepEqual(await qqbot.handleQqBotWebhook(selfMessage), { ignored: true });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].eventType, "message_sent");
  assert.equal(logs[0].status, "ignored");
});

test("服务号配置同样先只读查询、短时缓存，并在本进程更新后立即失效", async (t) => {
  const { prisma } = await import("../src/prisma");
  const wechat = await import("../src/services/wechatService");
  let row: any = {
    id: 1,
    enabled: false,
    accountName: "",
    wechatId: "",
    appId: "",
    appSecret: "",
    token: "",
    encodingAesKey: "",
    messageMode: "safe",
    notificationEnabled: true,
    assistantEnabled: true,
    notifyCategories: "[\"reply\",\"system\"]",
    notificationTemplateId: "",
    workOrderTemplateId: "",
    paymentSuccessTemplateId: "",
    templateTitleField: "",
    templateContentField: "",
    templateTimeField: "",
    templateRemarkField: "",
    subscriptionEnabled: false,
    subscriptionTemplateId: "",
    subscriptionTitleField: "",
    subscriptionContentField: "",
    subscriptionTimeField: "",
    subscriptionRemarkField: "",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
  const calls = { findUnique: 0, upsert: 0, update: 0 };
  replace(t, prisma.wechatServiceConfig, "findUnique", async () => {
    calls.findUnique += 1;
    return { ...row };
  });
  replace(t, prisma.wechatServiceConfig, "upsert", async () => {
    calls.upsert += 1;
    return { ...row };
  });
  replace(t, prisma.wechatServiceConfig, "update", async ({ data }: any) => {
    calls.update += 1;
    row = { ...row, ...data };
    return { ...row };
  });

  assert.equal((await wechat.getWechatServiceConfigRaw()).accountName, "");
  assert.equal((await wechat.getWechatServiceConfigRaw()).accountName, "");
  assert.deepEqual(calls, { findUnique: 1, upsert: 0, update: 0 });

  const updated = await wechat.updateWechatServiceConfig({ accountName: "药大拾间" });
  assert.equal(updated.accountName, "药大拾间");
  assert.deepEqual(calls, { findUnique: 2, upsert: 0, update: 1 });
  assert.equal((await wechat.getWechatServiceConfigRaw()).accountName, "药大拾间");
  assert.deepEqual(calls, { findUnique: 3, upsert: 0, update: 1 });
});
