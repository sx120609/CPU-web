import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDateIndex,
  buildMonthDays,
  calendarMonths,
  lunarDayName,
  monthDayTitle,
  monthCourseLines,
  monthRows,
  paperMonthTitle,
  shiftMonth,
} from "../src/views/schedule/monthModel";
import type { CalendarResult, WeekCourseBlock } from "../src/views/schedule/types";

function week(number: number, monday: string): CalendarResult["weeks"][number] {
  const start = new Date(`${monday}T00:00:00Z`).getTime();
  const days = Array.from({ length: 7 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  return { week: number, days, monday: days[0], sunday: days[6] };
}

const calendar: CalendarResult = {
  currentWeek: 5,
  semesterStart: "2026-09-07",
  semesterEnd: "2026-10-18",
  weeks: [week(4, "2026-09-28"), week(5, "2026-10-05"), week(6, "2026-10-12")],
  adjustments: [
    { date: "2026-10-01", kind: "off", note: "国庆节" },
    { date: "2026-10-10", kind: "swap", source: "2026-10-08" },
  ],
};

const course: WeekCourseBlock = {
  day: 3, bigSlot: 1, startSlot: 1, endSlot: 2, index: 0, course: { name: "药理学", weeks: "", weekList: [] },
};

test("dates map to their teaching week and weekday", () => {
  const index = buildDateIndex(calendar);
  assert.deepEqual(index.get("2026-10-07"), { week: 5, day: 3 });
  assert.deepEqual(index.get("2026-10-18"), { week: 6, day: 7 });
  assert.equal(index.get("2026-10-19"), undefined);
  assert.deepEqual(calendarMonths(calendar), ["2026-09", "2026-10"]);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("a month is laid out in whole weeks starting on Monday", () => {
  const asked: Array<[number, number]> = [];
  const days = buildMonthDays({
    monthKey: "2026-10",
    calendar,
    blocksFor: (weekNo, day) => {
      asked.push([weekNo, day]);
      return weekNo === 5 && day === 3 ? [course] : [];
    },
  });
  const rows = monthRows(days);
  assert.equal(days[0].date, "2026-09-28");
  assert.equal(days.at(-1)?.date, "2026-11-01");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.length === 7));
  assert.equal(days[0].inMonth, false);

  const seventh = days.find((day) => day.date === "2026-10-07");
  assert.deepEqual(seventh?.slot, { week: 5, day: 3 });
  assert.deepEqual(seventh?.blocks, [course]);
  // Outside the term there is no teaching week and nothing is asked for.
  const outside = days.find((day) => day.date === "2026-10-20");
  assert.equal(outside?.slot, null);
  assert.deepEqual(outside?.blocks, []);
  assert.equal(asked.length, 21);

  // A day off carries its reason; a make-up day is marked.
  const nationalDay = days.find((day) => day.date === "2026-10-01");
  assert.deepEqual([nationalDay?.adjustment?.kind, nationalDay?.subtitle, nationalDay?.isFestival], ["off", "国庆节", true]);
  assert.equal(days.find((day) => day.date === "2026-10-10")?.adjustment?.kind, "swap");
});

test("titles read as on the calendar", () => {
  assert.equal(monthDayTitle("2026-10-07"), "10 月 7 日 · 周三");
  assert.equal(paperMonthTitle("2026-10"), "二〇二六年 · 十月");
  assert.deepEqual([1, 10, 11, 20, 21, 29, 30].map(lunarDayName), ["初一", "初十", "十一", "二十", "廿一", "廿九", "三十"]);
});

test("a month cell lists three courses, or two and a count", () => {
  assert.deepEqual(monthCourseLines(["a", "b", "c"], 3), { shown: ["a", "b", "c"], more: 0 });
  assert.deepEqual(monthCourseLines(["a", "b", "c", "d", "e"], 3), { shown: ["a", "b"], more: 3 });
  assert.deepEqual(monthCourseLines([], 3), { shown: [], more: 0 });
  assert.deepEqual(monthCourseLines(["a", "b"], 1), { shown: ["a"], more: 1 });
});
