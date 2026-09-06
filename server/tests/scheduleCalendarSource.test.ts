import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { loadModernScheduleCalendar, parseScheduleDateHeaders } from "../src/services/scheduleCalendarSource";
import { Errors } from "../src/utils/response";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const semester = "2026-2027-1";
const now = new Date("2026-09-06T04:00:00Z");
const weekHeaders = (dates: string[]) => `<table class="qz-weeklyTable"><tr><th>节次</th>${dates.map((date, index) => (
  `<th><span>周${"一二三四五六日"[index]}<br></span><span>\n ${date}\n </span></th>`
)).join("")}</tr></table>`;

// Sanitized structures and dates read from the authenticated school pages on 2026-09-06.
const firstHeader = weekHeaders(["08-31", "09-01", "09-02", "09-03", "09-04", "09-05", "09-06"]);
const lastHeader = weekHeaders(["01-04", "01-05", "01-06", "01-07", "01-08", "01-09", "01-10"]);
const unpublishedCalendar = `<select id="xnxq01id"><option value="2025-2026-2">2025-2026-2</option></select>
  <h3>2026-2027 学年 第 1 学期 教学周历</h3>
  <table><thead><tr><th>周次</th><th>星期一</th><th>星期六</th><th>备注</th></tr></thead><tbody></tbody></table>`;

function source(overrides: { calendar?: string; range?: string; last?: string } = {}) {
  const paths: string[] = [];
  return {
    paths,
    read: async (path: string) => {
      paths.push(path);
      const url = new URL(path, "https://jwxt.cpu.edu.cn");
      if (url.pathname === "/jsxsd/xskb/xskb_list.do") {
        return `<select id="xnxq01id"><option value="${semester}" selected>${semester}</option></select><table id="kbtable"></table>`;
      }
      assert.equal(url.searchParams.get("xnxq01id"), semester);
      if (url.pathname === "/jsxsd/jxzl/jxzl_query") return overrides.calendar ?? unpublishedCalendar;
      if (url.pathname === "/jsxsd/xskb/jxzlzc_xnxq_ajax") return overrides.range ?? '[{"qszc":1,"jszc":19}]';
      if (url.pathname === "/jsxsd/framework/mainV_index_loadkb.htmlx") {
        assert.ok(["1", "19"].includes(url.searchParams.get("zc") || ""));
        return url.searchParams.get("zc") === "1" ? firstHeader : overrides.last ?? lastHeader;
      }
      throw new Error(`unexpected request: ${path}`);
    },
  };
}

test("unpublished teaching calendars use the school's timetable dates and week range", async () => {
  const fixture = source();
  const result = await loadModernScheduleCalendar(semester, fixture.read, now);
  assert.equal(result.calendarSource, "schedule-dates");
  assert.equal(result.currentSemester, semester);
  assert.equal(result.currentWeek, 1);
  assert.equal(result.weeks.length, 19);
  assert.equal(result.semesterStart, "2026-08-31");
  assert.equal(result.semesterEnd, "2027-01-10");
  assert.deepEqual(result.weeks[1].days, ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.equal(fixture.paths.length, 4);
});

test("default calendar queries resolve the current term from the timetable instead of the last published calendar", async () => {
  const fixture = source();
  const result = await loadModernScheduleCalendar("", fixture.read, now);
  assert.equal(result.currentSemester, semester);
  assert.ok(fixture.paths[0].startsWith("/jsxsd/xskb/xskb_list.do"));
  assert.equal(result.semesters.find((item) => item.current)?.value, semester);
});

test("published calendars keep their original path without additional date requests", async () => {
  const calendar = `<select id="xnxq01id"><option value="${semester}" selected>${semester}</option></select>
    <table><tr><th>周次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>
    <tr><td>1</td><td>09月07日</td><td>08</td><td>09</td><td>10</td><td>11</td><td>12</td><td>13</td></tr></table>`;
  const fixture = source({ calendar });
  const result = await loadModernScheduleCalendar(semester, fixture.read, now);
  assert.equal(result.calendarSource, "teaching-calendar");
  assert.equal(fixture.paths.length, 1);
});

test("date recovery rejects absent or ambiguous school week ranges", async () => {
  for (const range of ["[]", '[{"qszc":1,"jszc":0}]', '[{"qszc":1,"jszc":19},{"qszc":1,"jszc":20}]']) {
    await assert.rejects(loadModernScheduleCalendar(semester, source({ range }).read, now), /教学周范围/);
  }
});

test("date recovery rejects missing dates, wrong weekdays and an inconsistent final week", async () => {
  assert.throws(() => parseScheduleDateHeaders("<table></table>", semester), /完整的每周日期/);
  assert.throws(() => parseScheduleDateHeaders(weekHeaders(["09-01", "09-02", "09-03", "09-04", "09-05", "09-06", "09-07"]), semester), /日期表头不一致/);
  await assert.rejects(loadModernScheduleCalendar(semester, source({ last: firstHeader }).read, now), /首末周日期/);
});

test("calendar recovery preserves authorization failures", async () => {
  const expired = Errors.unauthorized("会话已过期");
  await assert.rejects(loadModernScheduleCalendar(semester, async () => { throw expired; }, now), (error) => error === expired);
});

test("shared page and widget reads recover real next-week courses when the published calendar is empty", async () => {
  const { createScheduleDataService } = await import("../src/services/scheduleData");
  const { loadScheduleWidgetData } = await import("../src/services/scheduleWidgetData");
  const fixture = source();
  const service = createScheduleDataService({
    now: () => now,
    getCalendar: async (_token, query = {}) => ({ ...await loadModernScheduleCalendar(query.semester || "", fixture.read, now), source: "modern" as const }),
    getSchedule: async (_token, query = {}) => ({
      title: "课表", pageRecognized: true, source: "modern" as const,
      currentSemester: semester, currentWeek: query.week || "1", semesters: [], weeks: [],
      cells: [{ day: 1, bigSlot: 1, courses: [{ name: "周一课程", weeks: "1-19周", weekList: [] }] }],
    }),
  });
  const token = randomUUID();
  const page = await service.readSchedule(token, { semester, week: "2", refresh: true });
  assert.equal(page.calendar?.weeks[1].monday, "2026-09-07");
  const widget = await loadScheduleWidgetData(token, "", async () => (schedule) => schedule, { service, now });
  assert.equal(widget.currentWeek, 1);
  assert.equal(widget.days.find((day) => day.date === "2026-09-07")?.courses[0]?.name, "周一课程");
});
