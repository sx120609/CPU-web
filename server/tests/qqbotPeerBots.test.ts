import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("拾间AI 不接同群其他机器人的话，真人照常回答", async (t) => {
  const { prisma } = await import("../src/prisma");
  const answers: { message: string; resolve: (value: any) => void }[] = [];
  for (const [modulePath, overrides] of [
    ["../src/services/campusAssistant", {
      askCampusAssistant: ({ message }: any) => new Promise((resolve) => answers.push({ message, resolve })),
    }],
    ["../src/services/qqbotGroupAdReview", {
      reviewQqGroupMessageForAd: async () => ({ action: "allow", assistantIntent: true }),
    }],
  ] as const) {
    const original = require(modulePath);
    const cached = require.cache[require.resolve(modulePath)]!;
    cached.exports = { ...original, ...overrides };
    t.after(() => { cached.exports = original; });
  }
  const { handleQqBotWebhook, formatQqBotConfig } = await import("../src/services/qqbot");
  const { resetQqGroupAssistantState } = await import("../src/services/qqbot/groupAssistantTrigger");
  t.after(() => resetQqGroupAssistantState());
  const config = {
    id: 1, enabled: true, botQqId: "10001", webhookSecret: "",
    connectionMode: "outbound", napcatBaseUrl: "https://napcat.test", accessToken: "",
    notifyCategories: "[]", superAdminQqIds: "[]", peerBotQqIds: JSON.stringify(["30009"]),
  };
  const replace = (target: any, key: string, value: any) => {
    const previous = target[key];
    target[key] = value;
    t.after(() => { target[key] = previous; });
  };
  replace(prisma.qqBotConfig, "findUnique", async () => ({ ...config }));
  replace(prisma.qqBotGroup, "findUnique", async () => ({ enabled: true, adFilterEnabled: false, assistantProactiveReplyEnabled: true }));
  replace(prisma.qqBotGroupAdWhitelist, "findUnique", async () => null);
  replace(prisma.qqBotGroupAdVerification, "findFirst", async () => null);
  replace(prisma.qqBotConversation, "findFirst", async () => null);
  replace(prisma.qqBotMessageLog, "create", async ({ data }: any) => data);
  const sent: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/get_msg")) {
      return Response.json({ status: "ok", retcode: 0, data: { sender: { user_id: 10001 }, message: [{ type: "text", data: { text: "上一条回答" } }] } });
    }
    sent.push(body);
    return Response.json({ status: "ok", retcode: 0, data: { message_id: 456 } });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let messageId = 1000;
  const send = (qqId: number, message: any[]) => handleQqBotWebhook({
    post_type: "message", message_type: "group", group_id: 20002,
    user_id: qqId, self_id: 10001, message_id: ++messageId, message,
  });
  const flush = async (ms: number) => {
    t.mock.timers.tick(ms);
    await nextTurn();
  };

  assert.deepEqual(formatQqBotConfig(config as any).peerBotQqIds, ["30009"]);

  const peerBotLines = [
    [{ type: "at", data: { qq: "10001" } }, { type: "text", data: { text: " 你能打卫戍协议吗" } }],
    [{ type: "text", data: { text: "拾间AI，你是高速模型还是低速模型？" } }],
    [{ type: "reply", data: { id: "999" } }, { type: "text", data: { text: "这也太较真了，你到底是谁啊？" } }],
    [{ type: "text", data: { text: "校友会小程序上面的吉祥物怎么没卖了？" } }],
  ];
  for (const line of peerBotLines) {
    assert.deepEqual(await send(30009, line), { ignored: true });
    await flush(20_000);
  }
  assert.equal(answers.length, 0);
  assert.equal(sent.length, 0);

  await send(30003, [{ type: "at", data: { qq: "10001" } }, { type: "text", data: { text: " 教务处登不上去怎么办" } }]);
  await flush(5_000);
  assert.equal(answers.length, 1);
  assert.match(answers[0].message, /教务处登不上去/);
});
