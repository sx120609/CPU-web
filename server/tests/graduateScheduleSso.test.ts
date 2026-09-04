import assert from "node:assert/strict";
import test from "node:test";
import { getGraduateSchedule } from "../src/services/graduateScheduleService";
import {
  exportSessionSnapshot,
  importSessionSnapshot,
  logout,
} from "../src/services/jwxtClient";
import { HttpError } from "../src/utils/response";

const GRAD_HOST = "ygl.cpu.edu.cn";
const ID_HOST = "id.cpu.edu.cn";

function requestUrl(input: string | URL | Request) {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url);
}

test("研究生课表会在统一认证仍有效时自动换票并保留研究生会话", async () => {
  const token = "graduate-sso-renewal-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-session" },
      [ID_HOST]: { SESSION: "unified-session" },
    },
    username: "2026240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  let ticketRequests = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const cookie = new Headers(init?.headers).get("cookie") || "";

    if (url.hostname === GRAD_HOST && url.pathname === "/gmis5/student/default/bindterm") {
      if (!/GRAD_SESSION=restored/.test(cookie)) {
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://${ID_HOST}/sso/login?service=${encodeURIComponent("https://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk")}`,
          },
        });
      }
      return new Response(JSON.stringify([
        { termcode: "2026-1", termname: "2026-2027学年一学期", selected: true },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.hostname === ID_HOST && url.pathname === "/sso/login") {
      ticketRequests += 1;
      assert.match(cookie, /SESSION=unified-session/);
      return new Response(null, {
        status: 302,
        headers: { location: "https://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk?ticket=ST-graduate-test" },
      });
    }

    if (url.hostname === GRAD_HOST && url.pathname === "/gmis5/oauthLogin/zgyk") {
      if (url.searchParams.has("ticket")) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/gmis5/student/pygl/xskbcx",
            "set-cookie": "GRAD_SESSION=restored; Path=/gmis5; HttpOnly",
          },
        });
      }
      assert.match(cookie, /GRAD_SESSION=restored/);
      return new Response("<html><body>graduate schedule entry</body></html>", { status: 200 });
    }

    if (url.hostname === GRAD_HOST && url.pathname === "/gmis5/student/pygl/xskbcx") {
      assert.match(cookie, /GRAD_SESSION=restored/);
      return new Response("<html><body>graduate schedule page</body></html>", { status: 200 });
    }

    if (url.hostname === GRAD_HOST && url.pathname === "/gmis5/student/pygl/py_kbcx_ew") {
      assert.equal(init?.method, "POST");
      assert.match(cookie, /GRAD_SESSION=restored/);
      return new Response(JSON.stringify({
        rows: [{ mc: "第1节", z1: "药物分析进展[1-8周] 张老师[教学楼101]" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await getGraduateSchedule(token);
    assert.equal(ticketRequests, 1);
    assert.equal(result.parsed.currentSemester, "2026-2027学年一学期");
    assert.equal(result.parsed.cells[0]?.courses[0]?.name, "药物分析进展");
    const snapshot = await exportSessionSnapshot(token);
    assert.equal(snapshot?.jar[GRAD_HOST]?.GRAD_SESSION, "restored");
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});

test("研究生入口停在统一认证登录页时返回可恢复的 401 而不是最终域名错误", async () => {
  const token = "graduate-sso-expired-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-session" },
      [ID_HOST]: { SESSION: "expired-session" },
    },
    username: "2026240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = requestUrl(input);
    if (url.hostname === GRAD_HOST) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://${ID_HOST}/sso/login?service=${encodeURIComponent("https://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk")}`,
        },
      });
    }
    if (url.hostname === ID_HOST && url.pathname === "/sso/login") {
      return new Response('<form id="loginForm"><input name="execution" value="e1s1"></form>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => getGraduateSchedule(token),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 401);
        assert.doesNotMatch(error.message, /意外的最终域名/);
        return true;
      },
    );
    const snapshot = await exportSessionSnapshot(token);
    assert.equal(snapshot?.jar["jsxsd.cpu.edu.cn"]?.JSESSIONID, "legacy-session");
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
