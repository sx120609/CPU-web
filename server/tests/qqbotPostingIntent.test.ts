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
});
