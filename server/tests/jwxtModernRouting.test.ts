import assert from "node:assert/strict";
import test from "node:test";
import { importSessionSnapshot, logout } from "../src/services/jwxtClient";
import {
  getCalendar,
  getExams,
  getGrades,
  getMidtermGrades,
  getProgress,
  getPyfa,
} from "../src/services/jwxtFacade";

test("undergraduate academic data is read only from jwxt.cpu.edu.cn", async () => {
  const token = "modern-routing-test-token";
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: {
      "jwxt.cpu.edu.cn": { JSESSIONID: "modern-valid" },
      "id.cpu.edu.cn": { SESSION: "unified-session" },
    },
    username: "2020240444",
    createdAt: now,
    lastSeenAt: now,
  });

  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  let gradeDetailRequests = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requestedPaths.push(`${url.hostname}${url.pathname}`);

    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/kscj/cjcx_frm") {
      return new Response('<select name="kksj"><option value="2025-2026-2" selected>2025-2026-2</option></select>', { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/kscj/cjcx_list") {
      return new Response(JSON.stringify({
        code: 0,
        count: 2,
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
          xs0101id: "2020240444",
          jx0404id: "202520261000001",
          cj0708id: "GRADE-001",
        }, {
          xnxqid: "2025-2026-2",
          kch: "C002",
          kc_mc: "生物化学",
          zcj: 60,
          zcjstr: "60",
          xf: 2,
          xs0101id: "2020240444",
          jx0404id: "202520261000002",
          cj0708id: "GRADE-002",
        }],
      }), { status: 200 });
    }
    if (url.hostname === "jwxt.cpu.edu.cn" && url.pathname === "/jsxsd/kscj/pscj_list.do") {
      gradeDetailRequests += 1;
      assert.equal(url.searchParams.get("xs0101id"), "2020240444");
      if (url.searchParams.get("cj0708id") === "GRADE-002") {
        assert.equal(url.searchParams.get("jx0404id"), "202520261000002");
        assert.equal(url.searchParams.get("zcj"), "60");
        return new Response("detail temporarily unavailable", { status: 500 });
      }
      assert.equal(url.searchParams.get("jx0404id"), "202520261000001");
      assert.equal(url.searchParams.get("cj0708id"), "GRADE-001");
      assert.equal(url.searchParams.get("zcj"), "70");
      return new Response(`
        <script>
          let arr = [{"cjxm1":68,"zcj":"70","cjxm3":80,"cjxm2":65,"cjxm3bl":"30%","cjxm2bl":"20%","cjxm1bl":"50%"}];
        </script>
      `, { status: 200 });
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
      return new Response(`<select id="xnxq01id"><option value="2025-2026-2" selected>2025-2026-2</option></select>
        <table><tr><th>周次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>
        <tr><td>1</td><td>03月02日</td><td>03</td><td>04</td><td>05</td><td>06</td><td>07</td><td>08</td></tr></table>`, { status: 200 });
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
    assert.deepEqual(
      {
        usual: grades.list[0]?.usual,
        midterm: grades.list[0]?.midterm,
        final: grades.list[0]?.final,
        usualWeight: grades.list[0]?.usualWeight,
        midtermWeight: grades.list[0]?.midtermWeight,
        finalWeight: grades.list[0]?.finalWeight,
      },
      {
        usual: "80",
        midterm: "65",
        final: "68",
        usualWeight: "30%",
        midtermWeight: "20%",
        finalWeight: "50%",
      },
    );
    assert.equal(midterm.list[0]?.midterm, "65");
    assert.equal(gradeDetailRequests, 2);
    assert.equal(grades.list[1]?.score, "60");
    assert.equal(grades.list[1]?.usual, undefined);
    assert.equal("xs0101id" in (grades.list[0] as unknown as Record<string, unknown>), false);
    assert.equal(exams.list[0]?.courseName, "药理学");
    assert.equal(requestedPaths.includes("jwxt.cpu.edu.cn/jsxsd/kscj/cjcx_list"), true);
    assert.equal(requestedPaths.some((path) => path.startsWith("jsxsd.cpu.edu.cn/")), false);
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
