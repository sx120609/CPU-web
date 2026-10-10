import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("群聊问答只合并等待窗口内的续聊，并在主动回答开关关闭后停止发送", async (t) => {
  const { prisma } = await import("../src/prisma");
  const answers: { message: string; resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  let reviewHook = () => {};
  // Replace dependencies before loading the webhook, leaving real routing,
  // debounce, policy lookups and outgoing message handling under test.
  for (const [modulePath, overrides] of [
    ["../src/services/campusAssistant", {
      askCampusAssistant: ({ message }: any) => new Promise((resolve, reject) => answers.push({ message, resolve, reject })),
    }],
    ["../src/services/qqbotGroupAdReview", {
      reviewQqGroupMessageForAd: async () => {
        reviewHook();
        return { action: "allow", assistantIntent: true };
      },
    }],
  ] as const) {
    const original = require(modulePath);
    const cached = require.cache[require.resolve(modulePath)]!;
    cached.exports = { ...original, ...overrides };
    t.after(() => { cached.exports = original; });
  }
  const { handleQqBotWebhook } = await import("../src/services/qqbot");
  const { resetQqGroupAssistantState } = await import("../src/services/qqbot/groupAssistantTrigger");
  const group = { enabled: true, adFilterEnabled: true, assistantProactiveReplyEnabled: false };
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
  replace(prisma.qqBotGroupAdWhitelist, "findUnique", async () => null);
  replace(prisma.qqBotGroupAdVerification, "findFirst", async () => null);
  replace(prisma.qqBotConversation, "findFirst", async () => null);
  replace(prisma.qqBotMessageLog, "create", async ({ data }: any) => data);
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    assert.match(String(url), /^https:\/\/napcat\.test\//);
    sent.push(JSON.parse(options.body));
    return Response.json({ status: "ok", retcode: 0, data: { message_id: 456 } });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let messageId = 1000;
  const send = (text: string, mentioned = false, qqId = 30003) => handleQqBotWebhook({
    post_type: "message", message_type: "group", group_id: 20002,
    user_id: qqId, self_id: 10001, message_id: ++messageId,
    message: [
      ...(mentioned ? [{ type: "at", data: { qq: "10001" } }] : []),
      { type: "text", data: { text } },
    ],
  });
  const flush = async (ms: number) => {
    t.mock.timers.tick(ms);
    await nextTurn();
  };
  const finish = async (index: number) => {
    answers[index].resolve({
      answer: "测试回复", actions: [],
      images: [{ url: "/uploads/assistant-generated/2026/10/12345678-1234-1234-1234-123456789abc.png" }],
    });
    await nextTurn();
  };
  const recruitment = "校科协宣传部剪辑岗扩招，带上你的剪辑作品，只要基础合格，问几个简单剪辑小问题。";

  // Even an erroneous review result cannot bypass a disabled group switch.
  assert.deepEqual(await send(recruitment), { ignored: true });
  await flush(20_000);
  assert.equal(answers.length, 0);

  await send("教务处登不上去怎么办", true);
  await send("一直提示密码错误");
  assert.deepEqual(await send(recruitment, false, 40004), { ignored: true });
  await flush(5_000);
  assert.equal(answers.length, 1);
  assert.match(answers[0].message, /一直提示密码错误/);
  // Generation is still pending; a new unmentioned post must not queue a reply.
  assert.deepEqual(await send(recruitment), { ignored: true });
  await finish(0);
  await flush(20_000);
  assert.equal(answers.length, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(await send(recruitment), { ignored: true });
  assert.deepEqual(await send("还有几个问题需要解释一下？"), { ignored: true });
  resetQqGroupAssistantState();

  // Disable while the moderation model is running.
  group.assistantProactiveReplyEnabled = true;
  reviewHook = () => { group.assistantProactiveReplyEnabled = false; };
  assert.deepEqual(await send("怎么查成绩？"), { ignored: true });
  reviewHook = () => {};
  await flush(20_000);
  assert.equal(answers.length, 1);

  // Disable while waiting for the proactive debounce.
  group.assistantProactiveReplyEnabled = true;
  await send("怎么查成绩？");
  group.assistantProactiveReplyEnabled = false;
  assert.deepEqual(await send(recruitment), { ignored: true });
  await flush(20_000);
  assert.equal(answers.length, 1);

  // Disable after generation starts: its completed answer must not be sent.
  group.assistantProactiveReplyEnabled = true;
  await send("怎么查成绩？");
  await flush(20_000);
  assert.equal(answers.length, 2);
  group.assistantProactiveReplyEnabled = false;
  await finish(1);
  assert.equal(sent.length, 1);

  // An explicit mention can upgrade a queued proactive request.
  group.assistantProactiveReplyEnabled = true;
  await send("怎么查成绩？");
  await send("帮我解释一下", true);
  group.assistantProactiveReplyEnabled = false;
  await flush(5_000);
  assert.equal(answers.length, 3);
  await finish(2);
  assert.equal(sent.length, 2);
  resetQqGroupAssistantState();

  // A second explicit question during generation still gets its own answer.
  await send("怎么查课表？", true);
  await flush(5_000);
  await send("成绩在哪里看？", true);
  assert.deepEqual(await send(recruitment), { ignored: true });
  await finish(3);
  await flush(5_000);
  assert.equal(answers.length, 5);
  assert.match(answers[4].message, /成绩在哪里看/);
  assert.doesNotMatch(answers[4].message, /剪辑/);
  await finish(4);
  assert.equal(sent.length, 4);
  resetQqGroupAssistantState();

  // Failures must not send an unsolicited error reply after disabling either.
  group.assistantProactiveReplyEnabled = true;
  await send("怎么查成绩？");
  await flush(20_000);
  group.assistantProactiveReplyEnabled = false;
  answers[5].reject(new Error("model unavailable"));
  await nextTurn();
  assert.equal(sent.length, 4);
});
