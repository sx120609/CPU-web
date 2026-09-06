import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const semester = "2026-2027-1";
const days = (monday: string) => Array.from({ length: 7 }, (_, index) => {
  const date = new Date(`${monday}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

async function fixture() {
  const { createScheduleDataService } = await import("../src/services/scheduleData");
  let now = new Date("2026-09-06T04:00:00Z");
  let name = "周一课程";
  let failWeek = "";
  let calendarAvailable = true;
  let calendarHasNextWeek = true;
  const calls: Array<{ semester?: string; week?: string }> = [];
  const service = createScheduleDataService({
    now: () => now,
    getSchedule: async (_token, query = {}) => {
      calls.push(query);
      if (failWeek && (query.week === failWeek || failWeek === "*")) throw new Error("教务暂时不可用");
      return {
        title: "课表", source: "modern" as const, pageRecognized: true,
        currentSemester: semester, currentWeek: query.week || "1", semesters: [], weeks: [],
        cells: [{ day: 1, bigSlot: 1, courses: [{ name, weeks: "1-20周", weekList: [], startSlot: 1, endSlot: 2 }] }],
      };
    },
    getCalendar: async () => {
      if (!calendarAvailable) throw new Error("校历不可用");
      return {
        source: "modern" as const, currentSemester: semester, semesters: [],
        semesterStart: "2026-08-31", semesterEnd: "2026-09-13", currentWeek: 1, today: "2026-09-06",
        weeks: (calendarHasNextWeek ? ["2026-08-31", "2026-09-07"] : ["2026-08-31"]).map((monday, index) => ({
          week: index + 1, monday, sunday: days(monday)[6], days: days(monday),
        })),
      };
    },
  });
  const token = randomUUID();
  const { loadScheduleWidgetData } = await import("../src/services/scheduleWidgetData");
  const widget = () => loadScheduleWidgetData(token, "", async () => (value) => value, { service, now });
  return {
    service, token, calls, widget,
    setName(value: string) { name = value; },
    setNow(value: string) { now = new Date(value); },
    fail(week: string) { failWeek = week; },
    failCalendar() { calendarAvailable = false; },
    omitCalendarWeek() { calendarHasNextWeek = false; },
  };
}

test("page and widget reuse the same semester/week responses, including a page refresh", async () => {
  const f = await fixture();
  await f.service.readSchedule(f.token, { semester, week: "2" });
  const first = await f.widget();
  assert.equal(first.days.find((day) => day.date === "2026-09-07")?.courses[0]?.name, "周一课程");
  assert.equal(f.calls.filter((item) => item.semester === semester && item.week === "2").length, 1);
  f.setName("调课后的课程");
  await f.service.readSchedule(f.token, { semester, week: "2", refresh: true });
  const next = await f.widget();
  assert.equal(next.days.find((day) => day.date === "2026-09-07")?.courses[0]?.name, "调课后的课程");
  assert.equal(f.calls.filter((item) => item.semester === semester && item.week === "2").length, 2);
});

test("cached calendars and schedule responses advance by date across Sunday midnight", async () => {
  const f = await fixture();
  const before = await f.widget();
  f.setNow("2026-09-06T16:01:00Z");
  const after = await f.widget();
  assert.equal(before.currentWeek, 1);
  assert.equal(after.currentWeek, 2);
  assert.equal(after.today.date, "2026-09-07");
  assert.equal(after.today.courses[0]?.name, "周一课程");
  assert.equal(after.weekDays[0].date, "2026-09-07");
});

test("a widget can use the page's cached current and next week without a new upstream request", async () => {
  const f = await fixture();
  await f.service.readSchedule(f.token, { semester, week: "1" });
  await f.service.readSchedule(f.token, { semester, week: "2" });
  const callsBefore = f.calls.length;
  f.fail("*");
  f.failCalendar();
  const payload = await f.widget();
  assert.equal(payload.days.find((day) => day.date === "2026-09-07")?.courses[0]?.name, "周一课程");
  assert.equal(f.calls.length, callsBefore);
});

test("missing next-week data fails instead of manufacturing an empty Monday", async () => {
  const f = await fixture();
  f.fail("2");
  await assert.rejects(f.widget(), /教务暂时不可用/);
});

test("an incomplete calendar cannot turn a missing teaching week into an empty schedule", async () => {
  const f = await fixture();
  f.omitCalendarWeek();
  await assert.rejects(f.widget(), /校历缺少近期日期/);
});

test("missing calendars leave the page readable but never guess dates for a widget", async () => {
  const f = await fixture();
  f.failCalendar();
  const page = await f.service.readSchedule(f.token);
  assert.equal(page.parsed.cells[0].courses[0].name, "周一课程");
  assert.equal(page.calendar, null);
  await assert.rejects(f.widget(), /暂未返回可用的课表日期/);
});

test("different credentials do not share a student's cached schedule", async () => {
  const f = await fixture();
  await f.service.readSchedule(f.token, { semester, week: "2" });
  f.setName("另一个账户的课程");
  const other = await f.service.readSchedule(randomUUID(), { semester, week: "2" });
  assert.equal(other.parsed.cells[0].courses[0].name, "另一个账户的课程");
  const first = await f.service.readSchedule(f.token, { semester, week: "2" });
  assert.equal(first.parsed.cells[0].courses[0].name, "周一课程");
});

test("an upstream response for a different week is rejected before it enters shared cache", async () => {
  const { createScheduleDataService } = await import("../src/services/scheduleData");
  const f = await fixture();
  const sample = await f.service.readSchedule(f.token, { semester, week: "1" });
  const service = createScheduleDataService({ getSchedule: async () => sample.parsed, getCalendar: async () => sample.calendar! });
  await assert.rejects(service.readSchedule(randomUUID(), { semester, week: "2" }), /周次与请求不一致/);
});
