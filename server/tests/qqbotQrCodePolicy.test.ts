import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqBotGeneratedImageMessage,
  buildQqBotReplyMessage,
  buildSafetyPlatformGuideBlockLines,
  findQqBotSplitMessageIncidentRows,
  normalizeQqBotAssistantVisionMessage,
  renderQqBotDailyAssistantReply,
  shouldSendQqBotQrCode,
  splitQqMessageForSend,
} from "../src/services/qqbot";

test("QQBot 即时响应会引用触发消息，文本和图片使用同一规则", () => {
  assert.equal(
    buildQqBotReplyMessage("拾间AI回复", "123456"),
    "[CQ:reply,id=123456]拾间AI回复",
  );
  assert.equal(
    buildQqBotReplyMessage("[CQ:image,file=https://cputime.cn/result.png]", "123456"),
    "[CQ:reply,id=123456][CQ:image,file=https://cputime.cn/result.png]",
  );
  assert.equal(buildQqBotReplyMessage("拾间AI回复", ""), "拾间AI回复");
  assert.equal(
    buildQqBotReplyMessage("拾间AI回复", "12,3]"),
    "[CQ:reply,id=12&#44;3&#93;]拾间AI回复",
  );
});

test("QQBot 不会把引用回复中的 base64 图片拆成大量文本消息", () => {
  const imageMessage = `[CQ:image,file=base64://${"A".repeat(300_000)}]`;
  const replyMessage = buildQqBotReplyMessage(imageMessage, "123456");
  const chunks = splitQqMessageForSend(replyMessage);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], replyMessage);
});

test("QQBot 视觉问答不会把临时图片地址写进对话文字", () => {
  assert.equal(
    normalizeQqBotAssistantVisionMessage("这是什么？\n![图片](/uploads/forum/question.png)", 1),
    "这是什么？",
  );
  assert.equal(normalizeQqBotAssistantVisionMessage("[图片]", 1), "请描述并分析这张图片中的内容。");
});

test("QQBot 只把同群短时间内的大批量分片识别为可恢复事故", () => {
  const startedAt = new Date("2026-08-22T16:20:00.000Z");
  const rows = Array.from({ length: 50 }, (_, offset) => ({
    id: offset + 1,
    groupId: "704825850",
    content: `（${offset + 1}/312）\n${"A".repeat(100)}`,
    result: JSON.stringify({ status: "ok", data: { message_id: offset + 1000 } }),
    createdAt: new Date(startedAt.getTime() + offset * 500),
  }));

  assert.equal(findQqBotSplitMessageIncidentRows(rows).length, 50);
  assert.equal(findQqBotSplitMessageIncidentRows(rows.slice(0, 49)).length, 0);
  assert.equal(findQqBotSplitMessageIncidentRows(rows.map((row, index) => ({
    ...row,
    createdAt: new Date(startedAt.getTime() + index * 20_000),
  }))).length, 0);
  assert.equal(findQqBotSplitMessageIncidentRows(rows.map((row, index) => ({
    ...row,
    status: index < 42 ? "recalled" : "ok",
  }))).filter((row) => row.status === "ok").length, 8);
});

test("QQBot 二维码发送总开关默认关闭，并统一覆盖群聊和私聊", () => {
  assert.equal(shouldSendQqBotQrCode({}), false);
  assert.equal(shouldSendQqBotQrCode({ qrCodeSendingEnabled: false }), false);
  assert.equal(shouldSendQqBotQrCode({ qrCodeSendingEnabled: true }), true);
});

test("QQBot 只把本站持久化的 image2 结果转换为图片消息", () => {
  assert.equal(
    buildQqBotGeneratedImageMessage(
      "/uploads/assistant-generated/2026/08/123e4567-e89b-12d3-a456-426614174000.png",
      "https://cputime.cn/",
    ),
    "[CQ:image,file=https://cputime.cn/uploads/assistant-generated/2026/08/123e4567-e89b-12d3-a456-426614174000.png]",
  );
  assert.equal(buildQqBotGeneratedImageMessage("https://evil.example/image.png", "https://cputime.cn"), "");
  assert.equal(buildQqBotGeneratedImageMessage("/uploads/../secret.png", "https://cputime.cn"), "");
});

test("总开关关闭时安全教育帮助不再附带二维码图片", () => {
  const message = buildSafetyPlatformGuideBlockLines().join("\n");

  assert.doesNotMatch(message, /safety-platform-qrcode|\[CQ:image/iu);
  assert.match(message, /已关闭二维码发送/iu);
  assert.match(message, /704825850/u);
});

test("总开关关闭时拾间 AI 不创建二维码入口，并把功能入口改为文字链接", async () => {
  const rendered = await renderQqBotDailyAssistantReply(
    "电费在哪里查？",
    {
      answer: "可以使用宿舍电费查询。",
      actions: [{
        id: "electric",
        label: "宿舍电费查询",
        description: "查询宿舍电费",
        url: "https://cputime.cn/electric",
        icon: "⚡",
        owner: "药大拾间",
        requireLogin: true,
      }],
      suggestions: [],
      fallback: false,
    },
    { includeQrCode: false },
  );

  assert.equal(rendered.sourcePageUrl, undefined);
  assert.match(rendered.message, /宿舍电费查询：https:\/\/cputime\.cn\/electric/u);
});

test("QQBot 会把拾间 AI 联网来源显示为可复制的文字链接", async () => {
  const rendered = await renderQqBotDailyAssistantReply(
    "今天南京天气怎么样？",
    {
      answer: "今天南京多云。",
      actions: [],
      suggestions: [],
      fallback: false,
      sources: [
        { title: "南京市气象台", url: "https://weather.example/nanjing" },
        { title: "重复来源", url: "https://weather.example/nanjing" },
      ],
    },
    { includeQrCode: false },
  );

  assert.equal(rendered.sourcePageUrl, undefined);
  assert.match(rendered.message, /参考来源/u);
  assert.match(rendered.message, /南京市气象台：https:\/\/weather\.example\/nanjing/u);
  assert.equal(rendered.message.match(/https:\/\/weather\.example\/nanjing/gu)?.length, 1);
});
