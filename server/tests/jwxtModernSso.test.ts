import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModernJwxtSsoRedirect,
  isModernJwxtLoginPage,
} from "../src/services/modernJwxtSso";
import {
  exportSessionSnapshot,
  importSessionSnapshot,
  jwxtFetchModernHtml,
  logout,
} from "../src/services/jwxtClient";

const entryUrl = "https://jwxt.cpu.edu.cn/jsxsd/sso.jsp";
const ssoUrl = "http://id.cpu.edu.cn/sso/login?service=http%3A%2F%2Fjwxt.cpu.edu.cn%2Fjsxsd%2Fsso.jsp";

test("modern JWXT extracts the real unified-auth handoff from sso.jsp", () => {
  const html = `<script languge='javascript'>window.location.href='${ssoUrl}'</script>`;
  assert.equal(extractModernJwxtSsoRedirect(html, entryUrl), ssoUrl);
});

test("modern JWXT SSO handoff rejects untrusted redirect and service hosts", () => {
  assert.throws(
    () => extractModernJwxtSsoRedirect(
      `<script>window.location.href='https://evil.example/sso/login?service=${encodeURIComponent(entryUrl)}'</script>`,
      entryUrl,
    ),
    /不受信任/,
  );
  assert.throws(
    () => extractModernJwxtSsoRedirect(
      `<script>window.location.href='http://id.cpu.edu.cn/sso/login?service=${encodeURIComponent("https://evil.example/callback")}'</script>`,
      entryUrl,
    ),
    /不受信任/,
  );
  assert.throws(
    () => extractModernJwxtSsoRedirect("<html></html>", entryUrl),
    /未返回统一认证跳转地址/,
  );
});

test("modern JWXT still recognizes the independent login page as an expired SSO session", () => {
  const loginHtml = `
    <form action="/jsxsd/xk/LoginToXk">
      <input name="userAccount">
    </form>
  `;
  assert.equal(isModernJwxtLoginPage(loginHtml), true);
  assert.equal(isModernJwxtLoginPage(
    `<script>window.location.href='${ssoUrl}'</script>`,
  ), true);
  assert.equal(isModernJwxtLoginPage(`
    <form id="loginForm" action="/sso/login">
      <input name="execution" value="e1s1">
    </form>
  `), true);
  assert.equal(isModernJwxtLoginPage("<table class='qz-weeklyTable'></table>"), false);
});

test("modern JWXT reuses the unified-auth cookie and consumes the automatic SSO ticket", async () => {
  const token = "modern-sso-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-session" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  let scheduleRequests = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const cookie = new Headers(init?.headers).get("cookie") || "";

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/xskb/xskb_list.do") {
      scheduleRequests += 1;
      if (!/bzb_jsxsd=modern-session/.test(cookie)) {
        return new Response(`<script>window.location.href='${ssoUrl}'</script>`, {
          status: 200,
          headers: { "content-type": "text/html", "set-cookie": "bzb_jsxsd=pre-sso; Path=/jsxsd; HttpOnly" },
        });
      }
      assert.match(cookie, /bzb_jsxsd=modern-session/);
      return new Response('<table class="qz-weeklyTable"><tr><td>2026-2027-1</td></tr></table>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/sso.jsp" && !url.searchParams.has("ticket")) {
      return new Response(`<script>window.location.href='${ssoUrl}'</script>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.hostname === "id.cpu.edu.cn" && url.pathname === "/sso/login") {
      assert.match(cookie, /SESSION=unified-session/);
      return new Response(null, {
        status: 302,
        headers: { location: "http://jwxt.cpu.edu.cn/jsxsd/sso.jsp?ticket=ST-modern-test" },
      });
    }

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/sso.jsp" && url.searchParams.has("ticket")) {
      return new Response("<script>window.location.href='/jsxsd/framework/xsMainV.jsp'</script>", {
        status: 200,
        headers: { "content-type": "text/html", "set-cookie": "bzb_jsxsd=modern-session; Path=/jsxsd; HttpOnly" },
      });
    }

    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const html = await jwxtFetchModernHtml(token, "/jsxsd/xskb/xskb_list.do?viweType=0");
    assert.match(html, /2026-2027-1/);
    assert.equal(scheduleRequests, 4);
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});

test("concurrent modern requests share one SSO renewal and keep the restored cookie", async () => {
  const token = "modern-sso-concurrent-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-session" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  let ssoEntries = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const cookie = new Headers(init?.headers).get("cookie") || "";

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname.startsWith("/jsxsd/") && url.pathname !== "/jsxsd/sso.jsp") {
      if (/bzb_jsxsd=modern-session/.test(cookie)) {
        return new Response(`<html><body>${url.pathname}</body></html>`, { status: 200 });
      }
      return new Response('<form action="/jsxsd/xk/LoginToXk"><input name="userAccount"></form>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/sso.jsp" && !url.searchParams.has("ticket")) {
      ssoEntries += 1;
      return new Response(`<script>window.location.href='${ssoUrl}'</script>`, { status: 200 });
    }
    if (url.hostname === "id.cpu.edu.cn" && url.pathname === "/sso/login") {
      assert.match(cookie, /SESSION=unified-session/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(null, {
        status: 302,
        headers: { location: "http://jwxt.cpu.edu.cn/jsxsd/sso.jsp?ticket=ST-concurrent" },
      });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/sso.jsp" && url.searchParams.has("ticket")) {
      return new Response("<script>window.location.href='/jsxsd/framework/xsMainV.jsp'</script>", {
        status: 200,
        headers: { "set-cookie": "bzb_jsxsd=modern-session; Path=/jsxsd; HttpOnly" },
      });
    }
    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const [schedule, grades] = await Promise.all([
      jwxtFetchModernHtml(token, "/jsxsd/xskb/xskb_list.do?viweType=0"),
      jwxtFetchModernHtml(token, "/jsxsd/kscj/cjcx_frm"),
    ]);
    assert.match(schedule, /xskb/);
    assert.match(grades, /cjcx/);
    assert.equal(ssoEntries, 1);
    const snapshot = await exportSessionSnapshot(token);
    assert.equal(snapshot?.jar["jwxt.cpu.edu.cn"]?.bzb_jsxsd, "modern-session");
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
