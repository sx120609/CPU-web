import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCpuSsoSubmitBody,
  buildCpuSsoSubmitHeaders,
  encodeCpuSsoCredential,
  parseCpuSsoPasswordForm,
} from "../src/services/cpuSsoForm";
import { beginLogin, submitLoginForHandoff } from "../src/services/jwxtClient";

const pageUrl = "http://id.cpu.edu.cn/sso/login?service=http%3A%2F%2Fjsxsd.cpu.edu.cn%2Fcallback";
const service = "http://jsxsd.cpu.edu.cn/callback";

function loginPage(action = "/sso/login") {
  return `
    <form id="sjloginForm" action="/sso/mobile-login">
      <input type="hidden" name="execution" value="mobile-execution">
      <input type="hidden" name="service" value="https://evil.example/mobile">
    </form>
    <form id="loginForm" action="${action}">
      <input type="hidden" name="lt" value="LT-desktop">
      <input type="hidden" name="execution" value="desktop-execution">
      <input type="hidden" name="service" value="${service}">
      <input type="hidden" name="useVCode" value="false">
      <input type="hidden" name="isUseVCode" value="true">
      <input type="hidden" name="_eventId" value="submit">
      <input name="username">
      <input name="password" type="password">
      <input name="rememberpwd" type="checkbox" checked>
    </form>
  `;
}

function decodeCredential(value: string) {
  const once = Buffer.from(value, "base64").toString("utf8");
  return Buffer.from(once, "base64").toString("utf8");
}

test("CPU SSO parses only the desktop password form and uses its real action", () => {
  const form = parseCpuSsoPasswordForm(loginPage(), pageUrl);
  const submit = new URL(form.submitUrl);

  assert.equal(form.hidden.execution, "desktop-execution");
  assert.equal(form.hidden.service, service);
  assert.equal(form.needCaptcha, false);
  assert.equal(submit.host, "id.cpu.edu.cn");
  assert.equal(submit.pathname, "/sso/login");
  assert.equal(submit.searchParams.get("service"), service);
});

test("CPU SSO matches the page's double Base64 without normalizing fullwidth characters", () => {
  const username = "student-demo";
  const password = "demoCPU}｝";
  const form = parseCpuSsoPasswordForm(loginPage(), pageUrl);
  const body = buildCpuSsoSubmitBody(form.hidden, { username, password, captcha: "1234" });

  assert.notEqual(body.get("username"), username);
  assert.notEqual(body.get("password"), password);
  assert.equal(decodeCredential(body.get("username") || ""), username);
  assert.equal(decodeCredential(body.get("password") || ""), password);
  assert.equal(encodeCpuSsoCredential(password), body.get("password"));
  assert.equal(body.get("rememberpwd"), "on");
  assert.equal(body.get("rcode"), "1234");
  assert.equal(body.get("vCode"), "1234");
});

test("CPU SSO emits browser navigation headers and rejects an untrusted form action", () => {
  const form = parseCpuSsoPasswordForm(loginPage(), pageUrl);
  const headers = new Headers(buildCpuSsoSubmitHeaders(pageUrl, form.submitUrl));

  assert.equal(headers.get("origin"), "http://id.cpu.edu.cn");
  assert.equal(headers.get("referer"), pageUrl);
  assert.equal(headers.get("sec-fetch-mode"), "navigate");
  assert.throws(
    () => parseCpuSsoPasswordForm(loginPage("https://evil.example/sso/login"), pageUrl),
    /不受信任/,
  );
});

test("JWXT login submits the official CPU SSO protocol and stops before consuming the ticket", async () => {
  const username = "student-integration-test";
  const password = "testCPU}";
  const loginUrl = `http://id.cpu.edu.cn/sso/login?service=${encodeURIComponent(service)}`;
  const callbackUrl = "http://jsxsd.cpu.edu.cn/callback?ticket=ST-integration-test";
  const originalFetch = globalThis.fetch;
  let submitRequests = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/tyrz.jsp") {
      return new Response(null, { status: 302, headers: { location: loginUrl } });
    }

    if (url.hostname === "id.cpu.edu.cn" && url.pathname === "/sso/login" && init?.method !== "POST") {
      return new Response(loginPage(), {
        status: 200,
        headers: {
          "content-type": "text/html",
          "set-cookie": "SESSION=integration-session; Path=/; HttpOnly",
        },
      });
    }

    if (url.hostname === "id.cpu.edu.cn" && url.pathname === "/sso/login" && init?.method === "POST") {
      submitRequests += 1;
      const body = init.body as URLSearchParams;
      assert.equal(url.searchParams.get("service"), service);
      assert.equal(headers.get("origin"), "http://id.cpu.edu.cn");
      assert.equal(headers.get("referer"), loginUrl);
      assert.match(headers.get("cookie") || "", /SESSION=integration-session/);
      assert.equal(decodeCredential(body.get("username") || ""), username);
      assert.equal(decodeCredential(body.get("password") || ""), password);
      assert.equal(body.get("rememberpwd"), "on");
      return new Response(null, {
        status: 302,
        headers: {
          location: callbackUrl,
          "set-cookie": "bms_sso_password=must-not-persist; Path=/",
        },
      });
    }

    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const pending = await beginLogin();
    assert.equal(pending.needCaptcha, false);
    const result = await submitLoginForHandoff({
      pendingId: pending.pendingId,
      username,
      password,
    });

    assert.equal(result.ok, true);
    assert.equal(result.handoff?.callbackUrl, callbackUrl);
    assert.equal(result.handoff?.username, username);
    assert.equal(result.handoff?.cookies["id.cpu.edu.cn"]?.SESSION, "integration-session");
    assert.equal(result.handoff?.cookies["id.cpu.edu.cn"]?.bms_sso_password, undefined);
    assert.equal(submitRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
