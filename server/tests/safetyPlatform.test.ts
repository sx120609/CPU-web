import assert from "node:assert/strict";
import test from "node:test";
import {
  SAFETY_PLATFORM_COLLEGE_ID,
  buildSafetyAnswerTuples,
  loginSafetyPlatform,
  parseSafetyPlatformCredentials,
  runSafetyPlatform,
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

test("登录响应只有通用成功文案但缺少用户信息时返回明确错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    code: 200,
    success: true,
    message: "请求成功",
    data: "",
  }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      loginSafetyPlatform({ username: "2023123456", password: "secret" }),
      /登录失败，平台没有返回用户信息/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("新版流程为课程和考试创建会话并携带防作弊 token", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: URLSearchParams }> = [];
  let courseSubmitted = false;
  let examSubmitAttempts = 0;

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(String(init?.body || ""));
    requests.push({ path: url.pathname, body });

    let payload: Record<string, unknown> = { code: 200, success: true, data: {} };
    if (url.pathname.endsWith("/wap/jsUserLogin")) {
      payload = { code: 200, success: true, message: "请求成功", data: { userId: "user-1" } };
    } else if (url.pathname.endsWith("/wap/compulsory/list")) {
      payload = {
        code: 200,
        success: true,
        data: body.get("courseType") === "1"
          ? [{ id: "course-1", name: "入学安全", isFinsh: courseSubmitted }]
          : [],
      };
    } else if (url.pathname.endsWith("/wap/directory/list")) {
      payload = {
        code: 200,
        success: true,
        data: [{ list: [{ id: "article-1", isFinsh: false }] }],
      };
    } else if (url.pathname.endsWith("/wap/question/list")) {
      payload = {
        code: 200,
        success: true,
        data: { list: [{ id: "2080136617019842561", quesType: "3" }] },
      };
    } else if (url.pathname.endsWith("/wap/unitTest/create")) {
      payload = { code: 200, success: true, data: { logId: "unit-log", token: "unit-token" } };
    } else if (url.pathname.endsWith("/wap/unitTest")) {
      assert.equal(body.get("logId"), "unit-log");
      assert.equal(body.get("token"), "unit-token");
      courseSubmitted = true;
      payload = { code: 200, success: true, message: "请求成功", data: { isSuccess: true } };
    } else if (url.pathname.endsWith("/wap/test/getTest")) {
      payload = { code: 200, success: true, data: { id: "exam-1" } };
    } else if (url.pathname.endsWith("/wap/test/create")) {
      payload = { code: 200, success: true, data: { logId: "exam-log", token: "exam-token" } };
    } else if (url.pathname.endsWith("/wap/test/list")) {
      payload = {
        code: 200,
        success: true,
        data: { data: [{ questionId: "2080136617019842561", question: { id: "2080136617019842561", quesType: "3" } }] },
      };
    } else if (url.pathname.endsWith("/wap/imitateTest")) {
      assert.equal(body.get("logId"), "exam-log");
      assert.equal(body.get("token"), "exam-token");
      examSubmitAttempts += 1;
      payload = examSubmitAttempts === 1
        ? { code: 1006, success: false, message: "答题时间过短", data: "" }
        : { code: 200, success: true, data: { isSuccess: true, count: 100 } };
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await runSafetyPlatform(
      { username: "2023123456", password: "secret" },
      undefined,
      { minimumActionDelayMs: 0, shortDurationRetryDelayMs: 0 },
    );
    assert.equal(result.score, 100);
    assert.equal(examSubmitAttempts, 2);
    assert.ok(requests.some((request) => request.path.endsWith("/wap/unitTest/create")));
    assert.ok(requests.some((request) => request.path.endsWith("/wap/test/create")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
