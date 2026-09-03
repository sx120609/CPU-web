import assert from "node:assert/strict";
import test from "node:test";
import { isLegacyJwxtLoginPage } from "../src/services/legacyJwxtSso";
import {
  exportSessionSnapshot,
  importSessionSnapshot,
  jwxtFetchHtml,
  jwxtPostForm,
  logout,
} from "../src/services/jwxtClient";
import {
  getCalendar,
  getExams,
  getGrades,
  getMidtermGrades,
  getProgress,
  getPyfa,
} from "../src/services/jwxtFacade";

const legacyLoginHtml = `
  <html>
    <head><title>中国药科大学综合教务管理系统</title></head>
    <body>
      <div>请先登录系统</div>
      <form id="Form1" action="/zgykdx/xk/LoginToXk">
        <input name="USERNAME" type="text">
        <input name="PASSWORD" type="password">
      </form>
    </body>
  </html>
`;

test("legacy JWXT recognizes a same-host login page instead of parsing it as empty data", () => {
  assert.equal(isLegacyJwxtLoginPage(legacyLoginHtml), true);
  assert.equal(isLegacyJwxtLoginPage("<html><body><table><tr><td>药理学</td></tr></table></body></html>"), false);
});

test("legacy JWXT silently renews an expired same-host session through unified auth", async () => {
  const token = "legacy-sso-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-expired" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  let ssoEntries = 0;
  let gradeRequests = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    const cookie = headers.get("cookie") || "";

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/kscj/cjcx_list") {
      gradeRequests += 1;
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body || ""), /kksj=2025-2026-2/);
      if (!/JSESSIONID=legacy-restored/.test(cookie)) return new Response(legacyLoginHtml, { status: 200 });
      return new Response("<html><body><div>legacy grade list</div></body></html>", { status: 200 });
    }

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/framework/xsMain.jsp") {
      if (!/JSESSIONID=legacy-restored/.test(cookie)) return new Response(legacyLoginHtml, { status: 200 });
      return new Response("<html><body><div>authenticated legacy main</div></body></html>", { status: 200 });
    }

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/tyrz.jsp" && !url.searchParams.has("ticket")) {
      ssoEntries += 1;
      const service = encodeURIComponent("http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp");
      return new Response(null, {
        status: 302,
        headers: { location: `http://id.cpu.edu.cn/sso/login?service=${service}` },
      });
    }

    if (url.hostname === "id.cpu.edu.cn" && url.pathname === "/sso/login") {
      assert.match(cookie, /SESSION=unified-session/);
      return new Response(null, {
        status: 302,
        headers: { location: "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp?ticket=ST-legacy-test" },
      });
    }

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/tyrz.jsp" && url.searchParams.has("ticket")) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/zgykdx/framework/xsMain.jsp",
          "set-cookie": "JSESSIONID=legacy-restored; Path=/zgykdx; HttpOnly",
        },
      });
    }

    if (url.hostname === "jsxsd.cpu.edu.cn" && url.pathname === "/zgykdx/kscj/cjcx_query") {
      assert.match(cookie, /JSESSIONID=legacy-restored/);
      return new Response("<html><body><div>legacy query</div></body></html>", { status: 200 });
    }

    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const html = await jwxtPostForm(token, "/zgykdx/kscj/cjcx_list", {
      kksj: "2025-2026-2",
      kcxz: "",
      kcmc: "",
    });
    assert.match(html, /legacy grade list/);
    assert.equal(gradeRequests, 2);
    assert.equal(ssoEntries, 1);

    const query = await jwxtFetchHtml(token, "/zgykdx/kscj/cjcx_query");
    assert.match(query, /legacy query/);
    const snapshot = await exportSessionSnapshot(token);
    assert.equal(snapshot?.jar["jsxsd.cpu.edu.cn"]?.JSESSIONID, "legacy-restored");
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});

test("undergraduate academic data prefers modern JWXT", async () => {
  const token = "modern-routing-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jwxt.cpu.edu.cn": { JSESSIONID: "modern-valid" },
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-valid" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requestedPaths.push(`${url.hostname}${url.pathname}`);

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/kscj/cjcx_frm") {
      return new Response('<select name="kksj"><option value="2025-2026-2" selected>2025-2026-2</option></select>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/kscj/cjcx_list") {
      return new Response(JSON.stringify({
        code: 0,
        count: 1,
        data: [{
          xnxqid: "2025-2026-2",
          kch: "C001",
          kc_mc: "药理学",
          zcj: 70,
          zcjstr: "70",
          xf: 3,
          zxs: 51,
          jd: 2,
          kcsx: "必修",
          ksxz: "正常考试",
        }],
      }), { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/xsks/xsksap_query") {
      return new Response('<select id="xnxqid"><option value="2025-2026-2" selected>2025-2026-2</option></select>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/xsks/xsksap_list") {
      return new Response(JSON.stringify({
        code: 0,
        count: 1,
        data: [{
          xnxqid: "2025-2026-2",
          kch: "C001",
          kskcmc: "药理学",
          kssj: "2026-06-20 09:00-11:00",
          js_mc: "教学楼101",
        }],
      }), { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/jxzl/jxzl_query") {
      return new Response('<select id="xnxq01id"><option value="2025-2026-2" selected>2025-2026-2</option></select>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/xxwcqk/xxwcqkOnkclb.do") {
      return new Response('<div class="mod-total-area"><div class="total-list"></div></div>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/pyfa/pyfa_query") {
      return new Response(JSON.stringify({ code: 0, count: 0, data: [] }), { status: 200 });
    }

    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const grades = await getGrades(token, { semester: "2025-2026-2" });
    const midterm = await getMidtermGrades(token, { semester: "2025-2026-2" });
    const exams = await getExams(token, { semester: "2025-2026-2" });
    const calendar = await getCalendar(token, { semester: "2025-2026-2" });
    const progress = await getProgress(token);
    const pyfa = await getPyfa(token);

    assert.deepEqual(
      [grades.source, midterm.source, exams.source, calendar.source, progress.source, pyfa.source],
      ["modern", "modern", "modern", "modern", "modern", "modern"],
    );
    assert.equal(grades.list[0]?.score, "70");
    assert.equal(midterm.list[0]?.score, "70");
    assert.equal(exams.list[0]?.courseName, "药理学");
    assert.equal(requestedPaths.includes("jwxt.cpu.edu.cn/jsxsd/kscj/cjcx_list"), true);
    assert.equal(requestedPaths.includes("jsxsd.cpu.edu.cn/zgykdx/kscj/cjcx_list"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
