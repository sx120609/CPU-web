import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitQqGroupPostIntent } from "../src/services/qqbot";

test("普通的群内设置咨询不会触发自动投稿", () => {
  assert.equal(hasExplicitQqGroupPostIntent("然后这个提示可以开关，是否在群内发送"), false);
  assert.equal(hasExplicitQqGroupPostIntent("投稿功能怎么开"), false);
});

test("明确要求把回复内容投稿时才允许自动投稿", () => {
  assert.equal(hasExplicitQqGroupPostIntent("回复这条，帮我投稿到论坛"), true);
  assert.equal(hasExplicitQqGroupPostIntent("请把上面的内容发到树洞"), true);
  assert.equal(hasExplicitQqGroupPostIntent("我要投稿"), true);
  assert.equal(hasExplicitQqGroupPostIntent("投稿一下"), true);
});

test("发给拾间AI的问题保留换行，多行内容不会被压成一行", async () => {
  const { normalizeQqBotAssistantVisionMessage } = await import("../src/services/qqbot");
  assert.equal(
    normalizeQqBotAssistantVisionMessage("下面哪门课是必修？\n1.  药物化学\n2. 大学体育\n\n\n\n![QQ图片](https://example.com/a.png)\n3. 选修课", 1),
    "下面哪门课是必修？\n1. 药物化学\n2. 大学体育\n\n3. 选修课",
  );
  assert.equal(normalizeQqBotAssistantVisionMessage("![QQ图片](https://example.com/a.png)", 1), "请描述并分析这张图片中的内容。");
});
