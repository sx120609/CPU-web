import assert from "node:assert/strict";
import test from "node:test";
import { detectHarmlessQqGroupAdBypassReason } from "../src/services/qqbotGroupAdReview";

test("allows long KFC Thursday meme copy that imitates an advertisement", () => {
  const content = [
    "🎉KFC疯狂星期四｜V我50专业团队",
    "专注炸鸡、汉堡、蛋挞、薯条、可乐、鸡翅、鸡块、香辣鸡腿堡疯狂辅导。",
    "承接：疯狂星期四代吃、代点、代馋、代排队、代发朋友圈、代喊“V我50”",
    "微信号：V我50即可",
    "👍服务范围包括：选餐、凑券、下单、加辣、加冰、吃到满意、饭后回血、精神续命、周四快乐指导，包满足！",
    "有需要的请联络、惠存。今天不V，明天后悔；现在V我50，立刻开启肯德基人生新篇章！",
  ].join("\n");

  assert.match(detectHarmlessQqGroupAdBypassReason(content) || "", /疯狂星期四/);
});

test("does not bypass a KFC meme that contains a real diversion link", () => {
  assert.equal(
    detectHarmlessQqGroupAdBypassReason("疯狂星期四 V我50，详情见 https://example.com/order"),
    null,
  );
});
