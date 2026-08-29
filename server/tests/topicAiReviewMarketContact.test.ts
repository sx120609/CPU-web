import assert from "node:assert/strict";
import test from "node:test";
import { isMarketSelfContactReply } from "../src/services/topicAiReview";

test("二手交流中的本人联系方式直接放行", () => {
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "v19118178085" }), true);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "加我微信 abc_123" }), true);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "QQ：3559330382" }), true);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "我的手机号 13800138000" }), true);
});

test("联系方式例外不扩散到其他内容", () => {
  assert.equal(isMarketSelfContactReply({ boardType: "general", content: "v19118178085" }), false);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "曝光骗子微信 v19118178085" }), false);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "低价代办，加我 v19118178085" }), false);
  assert.equal(isMarketSelfContactReply({ boardType: "market", content: "19118178085" }), false);
});
