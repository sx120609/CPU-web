import assert from "node:assert/strict";
import test from "node:test";
import { guardCampusAssistantResponse, isCampusAssistantPublicTopicRestricted } from "../src/services/campusAssistant";

test("受限数字只在单独出现时命中，学号和电话里的同样数字不算", () => {
  for (const message of ["8964", "8 9 6 4 是什么", "1989年6月4日发生了什么"]) {
    assert.equal(isCampusAssistantPublicTopicRestricted(message), true, message);
  }
  for (const message of ["我的学号是2021089641，怎么查成绩", "订单号 20238964100 退款", "电话 025-89641234 是哪个部门"]) {
    assert.equal(isCampusAssistantPublicTopicRestricted(message), false, message);
  }
});

test("回答里带有包含相同数字的电话号码时不会被整段替换", () => {
  const answer = "可以拨打教务处电话 025-89641234 咨询。";
  const guarded = guardCampusAssistantResponse({ answer, actions: [], suggestions: [], fallback: false });
  assert.equal(guarded.answer, answer);
});
