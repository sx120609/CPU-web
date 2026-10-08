import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQqBotAiDisclosure,
  getQqBotDailyAssistantDebounceMs,
  mergeQqBotDailyAssistantMessages,
  QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS,
  QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS,
  shouldHandleQqBotPrivateAssistant,
} from "../src/services/qqbot/dailyAssistant";

test("QQBot 日常问答按触发方式选择等待时间", () => {
  assert.equal(QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS, 5_000);
  assert.equal(QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS, 20_000);
  for (const trigger of ["private", "mention", "name", "reply-to-bot", "summoned", "continuation", "follow-up"] as const) {
    assert.equal(getQqBotDailyAssistantDebounceMs(trigger), 5_000, trigger);
  }
  assert.equal(getQqBotDailyAssistantDebounceMs("proactive"), 20_000);
});

test("同一轮里连续发送的多行会合并成一个问题", () => {
  assert.equal(
    mergeQqBotDailyAssistantMessages(["密码一直错误怎么办", " ", "为什么提示账号登不上去"]),
    "密码一直错误怎么办\n为什么提示账号登不上去",
  );
});

test("QQ 私聊普通文字可以进入拾间AI，但斜杠命令不会进入", () => {
  assert.equal(shouldHandleQqBotPrivateAssistant({
    messageText: "教务处没有反应怎么办",
    message: [{ type: "text", data: { text: "教务处没有反应怎么办" } }],
  }), true);
  assert.equal(shouldHandleQqBotPrivateAssistant({
    messageText: "/帮助",
    message: [{ type: "text", data: { text: "/帮助" } }],
  }), false);
});

test("QQ 私聊带表情的文字仍会进入拾间AI", () => {
  assert.equal(shouldHandleQqBotPrivateAssistant({
    messageText: "课表怎么导出",
    message: [{ type: "text", data: { text: "课表怎么导出" } }, { type: "face", data: { id: "14" } }],
  }), true);
  assert.equal(shouldHandleQqBotPrivateAssistant({
    messageText: "课表怎么导出",
    message: "课表怎么导出[CQ:face,id=14]",
  }), true);
});

test("QQ 私聊图片可以进入视觉问答，语音和转发仍不会进入", () => {
  assert.equal(shouldHandleQqBotPrivateAssistant({
    messageText: "看看这个",
    message: [
      { type: "text", data: { text: "看看这个" } },
      { type: "image", data: { file: "question.png" } },
    ],
  }), true);
  for (const segment of ["record", "forward", "json"]) {
    assert.equal(shouldHandleQqBotPrivateAssistant({
      messageText: "看看这个",
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
