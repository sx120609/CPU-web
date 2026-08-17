import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQqBotAiDisclosure,
  mergeQqBotDailyAssistantMessages,
  shouldHandleQqBotDailyAssistant,
} from "../src/services/qqbot/dailyAssistant";

test("QQ 群日常聊天只有明确 @ 机器人时才进入拾间AI", () => {
  const message = [{ type: "text", data: { text: "帮我看看课表怎么用" } }];
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "group",
    messageText: "帮我看看课表怎么用",
    botMentioned: false,
    message,
  }), false);
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "group",
    messageText: "帮我看看课表怎么用",
    botMentioned: true,
    message: [{ type: "at", data: { qq: "10001" } }, ...message],
  }), true);
});

test("开启群聊主动回答后只接受广告审核语义识别通过的纯文字消息", () => {
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "group",
    messageText: "教务处页面没有反应怎么办？",
    botMentioned: false,
    proactiveGroupReply: true,
    message: [{ type: "text", data: { text: "教务处页面没有反应怎么办？" } }],
  }), true);
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "group",
    messageText: "看看这个",
    botMentioned: false,
    proactiveGroupReply: true,
    message: [{ type: "text", data: { text: "看看这个" } }, { type: "image", data: {} }],
  }), false);
});

test("群聊首条消息已 @ 机器人后，短暂等待期间的后续纯文字会并入同一轮", () => {
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "group",
    messageText: "密码一直错误怎么办",
    botMentioned: false,
    allowUnmentionedContinuation: true,
    message: [{ type: "text", data: { text: "密码一直错误怎么办" } }],
  }), true);
  assert.equal(
    mergeQqBotDailyAssistantMessages(["密码一直错误怎么办", "为什么提示账号登不上去"]),
    "密码一直错误怎么办\n为什么提示账号登不上去",
  );
});

test("QQ 私聊普通文字可以进入拾间AI，但斜杠命令不会进入", () => {
  const message = [{ type: "text", data: { text: "教务处没有反应怎么办" } }];
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "private",
    messageText: "教务处没有反应怎么办",
    botMentioned: false,
    message,
  }), true);
  assert.equal(shouldHandleQqBotDailyAssistant({
    messageType: "private",
    messageText: "/帮助",
    botMentioned: false,
    message: [{ type: "text", data: { text: "/帮助" } }],
  }), false);
});

test("QQ 图片、语音和转发不会进入日常聊天 AI", () => {
  for (const segment of ["image", "record", "forward", "json"]) {
    assert.equal(shouldHandleQqBotDailyAssistant({
      messageType: "private",
      messageText: "看看这个",
      botMentioned: false,
      message: [
        { type: "text", data: { text: "看看这个" } },
        { type: segment, data: {} },
      ],
    }), false, segment);
  }
});

test("QQ AI 回复会明确提示内容由 AI 生成", () => {
  assert.match(
    appendQqBotAiDisclosure("请打开药大拾间首页。"),
    /由拾间AI生成.*自行鉴别/,
  );
});
