import assert from "node:assert/strict";
import test from "node:test";
import iconv from "iconv-lite";
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

test("all undergraduate academic data except schedule is routed to legacy JWXT", async () => {
  const token = "legacy-routing-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jsxsd.cpu.edu.cn": { JSESSIONID: "legacy-valid" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const gradeHtml = `
    <table>
      <tr><th>开课学期</th><th>课程编号</th><th>课程名称</th><th>平时成绩</th><th>期中成绩</th><th>期末成绩</th><th>总成绩</th><th>学分</th></tr>
      <tr><td>2025-2026-2</td><td>C001</td><td>药理学</td><td>97</td><td>100</td><td>50.5</td><td>70</td><td>3</td></tr>
    </table>
  `;
  const midtermHtml = `
    <table>
      <tr><th>开课学期</th><th>课程编号</th><th>课程名称</th><th>平时成绩</th><th>期中成绩</th></tr>
      <tr><td>2025-2026-2</td><td>C001</td><td>药理学</td><td>97</td><td>100</td></tr>
    </table>
  `;
  const examHtml = `
    <table>
      <tr><th>学期</th><th>课程编号</th><th>课程名称</th><th>考试时间</th><th>考试地点</th></tr>
      <tr><td>2025-2026-2</td><td>C001</td><td>药理学</td><td>2026-06-20</td><td>教学楼101</td></tr>
    </table>
  `;

  const originalFetch = globalThis.fetch;
  const requestedHosts: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requestedHosts.push(url.hostname);
    assert.equal(url.hostname, "jsxsd.cpu.edu.cn");
    assert.match(new Headers(init?.headers).get("cookie") || "", /JSESSIONID=legacy-valid/);

    if (url.pathname === "/zgykdx/kscj/cjcx_query" || url.pathname === "/zgykdx/kscj/qzcjcx_query") {
      return new Response('<select name="kksj"><option value="2025-2026-2" selected>2025-2026-2</option></select>', { status: 200 });
    }
    if (url.pathname === "/zgykdx/kscj/cjcx_list") {
      return new Response(iconv.encode(gradeHtml, "gbk"), {
        status: 200,
        headers: { "content-type": "text/html;charset=GBK" },
      });
    }
    if (url.pathname === "/zgykdx/kscj/qzcjcx_list") return new Response(midtermHtml, { status: 200 });
    if (url.pathname === "/zgykdx/xsks/xsksap_list") return new Response(examHtml, { status: 200 });
    if ([
      "/zgykdx/jxzl/jxzl_query",
      "/zgykdx/xywcqk/cxxywcqk",
      "/zgykdx/pyfa/pyfa_query",
    ].includes(url.pathname)) return new Response("<html><body><div>authenticated legacy data</div></body></html>", { status: 200 });

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
      ["legacy", "legacy", "legacy", "legacy", "legacy", "legacy"],
    );
    assert.deepEqual(
      { usual: grades.list[0]?.usual, midterm: grades.list[0]?.midterm, final: grades.list[0]?.final },
      { usual: "97", midterm: "100", final: "50.5" },
    );
    assert.equal(midterm.list[0]?.midterm, "100");
    assert.equal(exams.list[0]?.courseName, "药理学");
    assert.equal(requestedHosts.includes("jwxt.cpu.edu.cn"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
