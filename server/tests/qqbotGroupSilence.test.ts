import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("主动回答、广告过滤和禁言都关闭时，没人叫拾间AI就不在群里出声", async (t) => {
  const { prisma } = await import("../src/prisma");
  const answers: { message: string; resolve: (value: any) => void }[] = [];
  for (const [modulePath, overrides] of [
    ["../src/services/campusAssistant", {
      askCampusAssistant: ({ message }: any) => new Promise((resolve) => answers.push({ message, resolve })),
    }],
    ["../src/services/qqbotGroupAdReview", {
      reviewQqGroupMessageForAd: async () => assert.fail("the ad review must not run when both switches are off"),
    }],
  ] as const) {
    const original = require(modulePath);
    const cached = require.cache[require.resolve(modulePath)]!;
    cached.exports = { ...original, ...overrides };
    t.after(() => { cached.exports = original; });
  }
  const { handleQqBotWebhook } = await import("../src/services/qqbot");
  const group = { enabled: true, adFilterEnabled: false, assistantProactiveReplyEnabled: false, allowMute: false };
  const sent: any[] = [];
  const replace = (target: any, key: string, value: any) => {
    const previous = target[key];
    target[key] = value;
    t.after(() => { target[key] = previous; });
  };
  replace(prisma.qqBotConfig, "findUnique", async () => ({
    id: 1, enabled: true, botQqId: "10001", webhookSecret: "",
    connectionMode: "outbound", napcatBaseUrl: "https://napcat.test", accessToken: "",
    notifyCategories: "[]", superAdminQqIds: "[]",
  }));
  replace(prisma.qqBotGroup, "findUnique", async () => ({ ...group }));
  replace(prisma.qqBotGroupAdVerification, "findFirst", async () => null);
  replace(prisma.qqBotConversation, "findFirst", async () => null);
  replace(prisma.qqBotMessageLog, "create", async ({ data }: any) => data);
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    sent.push({ action: new URL(String(url)).pathname.slice(1), body: JSON.parse(options.body) });
    return Response.json({ status: "ok", retcode: 0, data: { message_id: 456 } });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let messageId = 1000;
  const send = (segments: unknown[], qqId = 30003) => handleQqBotWebhook({
    post_type: "message", message_type: "group", group_id: 20002,
    user_id: qqId, self_id: 10001, message_id: ++messageId,
    message: segments,
  });
  const text = (value: string) => ({ type: "text", data: { text: value } });
  const atBot = { type: "at", data: { qq: "10001" } };
  const flush = async (ms: number) => {
    t.mock.timers.tick(ms);
    await nextTurn();
  };

  // Line breaks and double spaces used to read as calling the bot by name.
  for (const [value, qqId] of [
    ["luna 平均1.5s\nsol 平均2-3s", 30003],
    ["Nishikigi 已运行 1945513s\n待审核: []\n待推送: [774]", 50005],
    ["大佬们  为什么这个只脱一个羧基", 30003],
    ["校科协宣传部剪辑岗扩招\n带上你的剪辑作品，问几个简单剪辑小问题。", 40004],
  ] as const) {
    assert.deepEqual(await send([text(value)], qqId), { ignored: true }, value);
  }
  assert.deepEqual(await send([text("/banme")]), { ok: true });
  await flush(20_000);
  assert.equal(answers.length, 0);
  assert.deepEqual(sent, []);

  // An explicit @ is still answered.
  await send([atBot, text(" 怎么查成绩")]);
  await flush(5_000);
  assert.equal(answers.length, 1);
  answers[0].resolve({
    answer: "测试回复", actions: [],
    images: [{ url: "/uploads/assistant-generated/2026/10/12345678-1234-1234-1234-123456789abc.png" }],
  });
  await nextTurn();
  assert.deepEqual(sent.map((request) => request.action), ["send_group_msg"]);

  // Quoting that answer to say thanks carries QQ's automatic @, but asks nothing.
  assert.deepEqual(await send([{ type: "reply", data: { id: "456" } }, atBot, text(" 谢谢大佬")]), { ignored: true });
  await flush(20_000);
  assert.equal(answers.length, 1);
  // Reading the quoted message is fine; nothing new may be sent.
  assert.deepEqual(sent.filter((request) => request.action.startsWith("send_")).length, 1);
});
