import assert from "node:assert/strict";
import test from "node:test";
import { renderQqBotAiReplyPage } from "../src/routes/qqbotAiReply";

test("QQbot 在线回答页复用拾间AI布局并渲染 Markdown", () => {
  const html = renderQqBotAiReplyPage({
    token: "abcdefghijklmnop",
    question: "为什么登录不了？",
    answer: [
      "# 登录问题",
      "",
      "**请先找回密码**",
      "",
      "- 打开 [统一身份认证](https://i.cpu.edu.cn)",
      "",
      "<script>alert('xss')</script>",
    ].join("\n"),
    actions: [{ label: "统一身份认证", url: "https://i.cpu.edu.cn" }],
    createdAt: new Date("2026-08-17T10:00:00Z"),
    expiresAt: new Date("2026-09-17T10:00:00Z"),
  });

  assert.match(html, /class="assistant-shell"/u);
  assert.match(html, /<h1>登录问题<\/h1>/u);
  assert.match(html, /<strong>请先找回密码<\/strong>/u);
  assert.match(html, /class="action-card"/u);
  assert.doesNotMatch(html, /\*\*请先找回密码\*\*/u);
  assert.doesNotMatch(html, /<script>/iu);
});
