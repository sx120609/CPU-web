import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, Errors } from "../src/utils/response";
import {
  JWXT_AUTH_EXPIRED_CODE,
  JWXT_UPSTREAM_REFUSED_CODE,
  JWXT_UPSTREAM_UNREACHABLE_CODE,
  JWXT_UPSTREAM_UNREADABLE_CODE,
  classifyJwxtError,
  jwxtErrorStats,
  normalizeJwxtErrorMessage,
  recordJwxtOutcome,
  resetJwxtErrorStats,
} from "../src/services/jwxtErrors";

function mapped(error: unknown) {
  const result = classifyJwxtError(error) as HttpError;
  return { status: result.status, code: result.code, message: result.message };
}

test("every JWXT session expiry carries the dedicated code", () => {
  for (const message of [
    "请先登录教务系统",
    "教务会话已失效，请重新登录",
    "统一认证会话已失效，请重新登录",
    "该教务会话所属 Agent 已移除，请重新登录",
    "该教务授权已随账户删除失效，请重新登录",
  ]) {
    assert.deepEqual(mapped(Errors.unauthorized(message)), { status: 401, code: JWXT_AUTH_EXPIRED_CODE, message });
  }
});

test("site sign-in failures stay site errors so clients keep the JWXT session", () => {
  for (const message of ["请先登录", "登录已过期，请重新登录", "账号不存在或已失效，请重新登录"]) {
    assert.deepEqual(mapped(Errors.unauthorized(message)), { status: 401, code: 4001, message });
  }
});

test("the school refusing a request is not a login expiry", () => {
  for (const status of [401, 403]) {
    const result = mapped(new HttpError(401, 4001, `教务请求失败 (${status})`));
    assert.equal(result.status, 502);
    assert.equal(result.code, JWXT_UPSTREAM_REFUSED_CODE);
    assert.doesNotMatch(result.message, /失效|重新登录|重新授权/u);
  }
});

test("school-side network failures and unreadable pages become 502, not our own 500", () => {
  const cases: Array<[unknown, number]> = [
    [new TypeError("fetch failed"), JWXT_UPSTREAM_UNREACHABLE_CODE],
    [new HttpError(500, 5000, "fetch failed"), JWXT_UPSTREAM_UNREACHABLE_CODE],
    [Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), JWXT_UPSTREAM_UNREACHABLE_CODE],
    [new SyntaxError(`Unexpected token '<', "<HTML><HEA"... is not valid JSON`), JWXT_UPSTREAM_UNREADABLE_CODE],
    [new HttpError(500, 5000, `Unexpected token '<', "\n<!DOCTYPE "... is not valid JSON`), JWXT_UPSTREAM_UNREADABLE_CODE],
    [new Error("教务未返回统一认证跳转地址"), JWXT_UPSTREAM_UNREADABLE_CODE],
  ];
  for (const [error, code] of cases) {
    const result = mapped(error);
    assert.equal(result.status, 502);
    assert.equal(result.code, code);
    assert.doesNotMatch(result.message, /失效|重新登录|重新授权/u);
  }
  // 我们自己的 502/503 和其他 500 不改。
  const parse = Errors.badGateway("学校教务暂时没有返回可识别的课表页面");
  assert.equal(classifyJwxtError(parse), parse);
  const own = new HttpError(500, 5000, "数据库写入失败");
  assert.equal(classifyJwxtError(own), own);
});

test("non-401 errors pass through untouched", () => {
  const busy = Errors.unavailable("教务会话暂时无法读取，请稍后重试");
  assert.equal(classifyJwxtError(busy), busy);
  const plain = new Error("boom");
  assert.equal(classifyJwxtError(plain), plain);
});

test("error stats group by kind over the last day", () => {
  resetJwxtErrorStats();
  const now = Date.UTC(2026, 10, 1, 12);
  recordJwxtOutcome({ path: "/jwxt/schedule", status: 200, now });
  recordJwxtOutcome({ path: "/jwxt/schedule", status: 503, code: 5031, message: "教务 Agent 图书馆-01 当前繁忙", now });
  recordJwxtOutcome({ path: "/jwxt/calendar", status: 503, code: 5031, message: "教务 Agent 图书馆-02 当前繁忙", now });
  recordJwxtOutcome({ path: "/jwxt/schedule", status: 401, code: JWXT_AUTH_EXPIRED_CODE, message: "统一认证会话已失效，请重新登录", now });

  const stats = jwxtErrorStats(now);
  assert.equal(stats.requests, 4);
  assert.equal(stats.errors, 3);
  assert.equal(stats.kinds[0].message, "教务 Agent * 当前繁忙");
  assert.equal(stats.kinds[0].count, 2);
  assert.deepEqual(stats.kinds[0].paths.map((item) => item.path).sort(), ["/jwxt/calendar", "/jwxt/schedule"]);

  const later = jwxtErrorStats(now + 25 * 60 * 60 * 1000);
  assert.equal(later.requests, 0);
  assert.equal(later.kinds.length, 0);
});

test("messages are normalised so the same failure counts once", () => {
  assert.equal(normalizeJwxtErrorMessage("教务请求超时 12034ms"), "教务请求超时 Nms");
});
