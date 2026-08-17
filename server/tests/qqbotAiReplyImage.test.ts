import assert from "node:assert/strict";
import test from "node:test";
import {
  containsQqBotMarkdown,
  renderQqBotAiReplyAsQqMessage,
  renderQqBotAiReplyImage,
} from "../src/services/qqbot/aiReplyImage";

test("QQbot Markdown AI 回复会渲染为带拾间AI顶栏的 PNG", () => {
  const reply = [
    "# 登录问题",
    "",
    "**1. 登录入口**",
    "打开 [药大拾间](https://cputime.cn)，然后使用学校统一身份认证登录。",
    "",
    "- 不要使用默认密码",
    "- 遇到锁定请按官方提示处理",
    "",
    "以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。",
  ].join("\n");

  assert.equal(containsQqBotMarkdown(reply), true);
  const png = renderQqBotAiReplyImage(reply);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const message = renderQqBotAiReplyAsQqMessage(reply);
  assert.match(message || "", /^\[CQ:image,file=base64:\/\//);
  assert.equal(message?.includes("**1. 登录入口**"), false);
});

test("QQbot 普通短 AI 回复也渲染为图片", () => {
  assert.equal(containsQqBotMarkdown("请打开药大拾间首页。"), false);
  assert.match(
    renderQqBotAiReplyAsQqMessage("请打开药大拾间首页。") || "",
    /^\[CQ:image,file=base64:\/\//,
  );
});

test("QQbot AI 图片把单次对话提示放在页脚并为入口生成二维码卡片", () => {
  const options = {
    footerNotice: "提示：当前仅支持单次对话，无上下文功能。",
    qrEntries: [{ label: "校园服务", url: "https://cputime.cn/services" }],
  };
  const png = renderQqBotAiReplyImage("可以打开校园服务入口。", options);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const message = renderQqBotAiReplyAsQqMessage("可以打开校园服务入口。", options);
  assert.match(message || "", /^\[CQ:image,file=base64:\/\//);
  // A short answer should not leave a tall empty body or a two-row footer.
  const compactPng = renderQqBotAiReplyImage("可以打开校园服务入口。", {
    footerNotice: options.footerNotice,
  });
  assert.ok(compactPng.readUInt32BE(20) < 300);
});
