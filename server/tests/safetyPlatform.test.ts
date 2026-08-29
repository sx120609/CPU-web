import assert from "node:assert/strict";
import test from "node:test";
import {
  SAFETY_PLATFORM_COLLEGE_ID,
  buildSafetyAnswerTuples,
  loginSafetyPlatform,
  parseSafetyPlatformCredentials,
  validateSafetyPlatformCredentials,
} from "../src/services/safetyPlatform";

test("安全教育平台固定使用指定学校 ID", () => {
  assert.equal(SAFETY_PLATFORM_COLLEGE_ID, "1224316225859555329");
});

test("按用户名和密码格式解析私聊输入，并保留密码中的空格", () => {
  assert.deepEqual(parseSafetyPlatformCredentials(" 2023123456  my password "), {
    username: "2023123456",
    password: "my password",
  });
  assert.equal(parseSafetyPlatformCredentials("2023123456\npassword"), null);
  assert.equal(parseSafetyPlatformCredentials("2023123456"), null);
  assert.equal(parseSafetyPlatformCredentials("用户名 密码\n第二行"), null);
});

test("拒绝空的登录字段，并能从当前题库构造答案", () => {
  assert.equal(validateSafetyPlatformCredentials({ username: "", password: "password" }), null);
  assert.equal(validateSafetyPlatformCredentials({ username: "username", password: "" }), null);
  const answer = buildSafetyAnswerTuples("2080136617019842561", "3");
  assert.equal(answer?.questionId, "2080136617019842561");
  assert.equal(answer?.quesType, "3");
});

test("登录请求携带固定学校 ID，并从响应中取得平台用户 ID", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body || "") });
    return new Response(JSON.stringify({
      code: 200,
      success: true,
      data: { userId: "1234567890123456789" },
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "SESSION=test-session; Path=/",
      },
    });
  }) as typeof fetch;
  try {
    const session = await loginSafetyPlatform({ username: "2023123456", password: "secret" });
    assert.equal(session.userId, "1234567890123456789");
    assert.match(requests[0]?.url || "", /jsUserLogin$/);
    assert.match(requests[0]?.body || "", /collegeId=1224316225859555329/);
    assert.match(requests[0]?.body || "", /account=2023123456/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
