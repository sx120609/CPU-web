import assert from "node:assert/strict";
import test from "node:test";
import { JWXT_AUTH_EXPIRED_CODE, isJwxtAuthExpiredResponse, isJwxtAuthFailure } from "../src/utils/jwxtAuthErrors";

test("the dedicated code always means the JWXT authorization expired", () => {
  assert.equal(isJwxtAuthExpiredResponse(401, "随便什么", JWXT_AUTH_EXPIRED_CODE), true);
  assert.equal(isJwxtAuthExpiredResponse(0, "", JWXT_AUTH_EXPIRED_CODE), true);
});

test("a site sign-in failure on a JWXT route does not clear the JWXT session", () => {
  assert.equal(isJwxtAuthExpiredResponse(401, "登录已过期，请重新登录", 4001), false);
  assert.equal(isJwxtAuthExpiredResponse(401, "请先登录", 4001), false);
});

test("outages and refusals with their own codes are not authorization failures", () => {
  assert.equal(isJwxtAuthExpiredResponse(503, "教务会话暂时无法读取，请稍后重试", 5032), false);
  assert.equal(isJwxtAuthExpiredResponse(502, "学校教务系统暂时拒绝了请求，请稍后重试", 5021), false);
  assert.equal(isJwxtAuthExpiredResponse(504, "教务 Agent 图书馆-01 请求超时", 5004), false);
});

test("uncoded 401s from older servers still count by their wording", () => {
  assert.equal(isJwxtAuthExpiredResponse(401, "教务会话已失效，请重新登录"), true);
  assert.equal(isJwxtAuthExpiredResponse(0, "统一认证会话已失效，请重新登录"), true);
  assert.equal(isJwxtAuthExpiredResponse(0, "某个功能需要重新登录站点"), false);
});

test("errors carry their verdict so every caller agrees", () => {
  assert.equal(isJwxtAuthFailure(Object.assign(new Error("x"), { jwxtAuthExpired: true })), true);
  assert.equal(isJwxtAuthFailure(Object.assign(new Error("请先登录教务系统"), { status: 401, jwxtAuthExpired: false })), false);
  assert.equal(isJwxtAuthFailure(Object.assign(new Error("x"), { response: { status: 401, data: { code: 4011 } } })), true);
  assert.equal(isJwxtAuthFailure(new Error("network error")), false);
  assert.equal(isJwxtAuthFailure(null), false);
});
