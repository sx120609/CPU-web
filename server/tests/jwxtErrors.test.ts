import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, Errors } from "../src/utils/response";
import {
  JWXT_AUTH_EXPIRED_CODE,
  JWXT_UPSTREAM_REFUSED_CODE,
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
