import assert from "node:assert/strict";
import test from "node:test";
import { createDormReaders, type DormMemberSchedule } from "../src/views/schedule/dorm";
import {
  dormWeekCellLevel,
  dormWeekCellSummary,
  dormWeekFreeRatio,
  dormWeekGrid,
  dormWeekMonday,
  dormWeekPeriods,
} from "../src/views/schedule/dormWeek";
import type { CalendarResult, ScheduleCourse, ScheduleResult } from "../src/views/schedule/types";
import type { CoupleScheduleSnapshot } from "../src/views/schedule/couple";

function days(monday: string) {
  const start = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

function calendar(extra: Partial<CalendarResult> = {}): CalendarResult {
  const weeks = [1, 2].map((week) => {
    const list = days(week === 1 ? "2026-09-07" : "2026-09-14");
    return { week, days: list, monday: list[0], sunday: list[6] };
  });
  return { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2026-09-20", weeks, ...extra };
}

function course(name: string, startSlot: number, endSlot: number, extra: Partial<ScheduleCourse> = {}): ScheduleCourse {
  return { name, weeks: "1-2周", weekList: [1, 2], startSlot, endSlot, location: "A201", ...extra };
}

function snapshot(cells: ScheduleResult["cells"], cal = calendar()): CoupleScheduleSnapshot {
  return {
    semester: "2026-2027-1",
    syncedAt: "2026-09-07T00:00:00.000Z",
    changedAt: "2026-09-07T00:00:00.000Z",
    calendar: cal,
    schedule: { scope: "semester", semesters: [], weeks: [], currentSemester: "2026-2027-1", currentWeek: "1", cells },
  };
}

function member(id: number, nickname: string, data: CoupleScheduleSnapshot | null): DormMemberSchedule {
  return { id, nickname, color: ["blue", "pink", "purple", "teal"][id - 1] as DormMemberSchedule["color"], snapshot: data };
}

const zhang = () => member(1, "张三", snapshot([{ day: 2, bigSlot: 1, courses: [course("药理学", 1, 2)] }]));
const li = () => member(2, "李四", snapshot([
  { day: 2, bigSlot: 1, courses: [course("有机化学", 2, 3)] },
  { day: 3, bigSlot: 1, courses: [course("体育", 1, 2)] },
]));

test("the week starts on Monday whatever day it is asked from", () => {
  assert.equal(dormWeekMonday("2026-09-07"), "2026-09-07");
  assert.equal(dormWeekMonday("2026-09-10"), "2026-09-07");
  assert.equal(dormWeekMonday("2026-09-13"), "2026-09-07");
});

test("every period of every day says who is free and who is in class", () => {
  const grid = dormWeekGrid(createDormReaders([zhang(), li()]), "2026-09-07");
  assert.deepEqual(grid.dates, days("2026-09-07"));
  assert.equal(grid.teachingWeek, 1);
  assert.equal(grid.rows.length, 12);

  const tuesday = (row: number) => grid.rows[row].cells[1];
  assert.deepEqual(tuesday(0).freeIds, [2]);
  assert.deepEqual(tuesday(0).busy, [{ id: 1, courses: ["药理学"] }]);
  assert.deepEqual(tuesday(1).freeIds, []);
  assert.deepEqual(tuesday(1).busy.map((item) => item.id), [1, 2]);
  assert.deepEqual(tuesday(2).freeIds, [1]);
  assert.deepEqual(tuesday(3).freeIds, [1, 2]);

  assert.equal(dormWeekCellLevel(tuesday(0)), "some");
  assert.equal(dormWeekCellLevel(tuesday(1)), "none");
  assert.equal(dormWeekCellLevel(tuesday(3)), "all");
  assert.equal(dormWeekCellSummary(tuesday(0)), "1 人有空");
  assert.equal(dormWeekCellSummary(tuesday(1)), "都在上课");
  assert.equal(dormWeekCellSummary(tuesday(3)), "全宿舍都有空");
  assert.equal(dormWeekFreeRatio(tuesday(0)), 0.5);
});

test("breaks between morning, afternoon and evening are marked", () => {
  const grid = dormWeekGrid(createDormReaders([zhang()]), "2026-09-07");
  assert.deepEqual(grid.rows.filter((row) => row.breakBefore).map((row) => row.period.no), [5, 9]);
});

test("members without data are unknown, never free", () => {
  const grid = dormWeekGrid(createDormReaders([zhang(), member(2, "李四", null)]), "2026-09-07");
  const cell = grid.rows[3].cells[1];
  assert.deepEqual(cell.freeIds, [1]);
  assert.deepEqual(cell.unknownIds, [2]);
  assert.equal(dormWeekCellLevel(cell), "all");
  assert.equal(dormWeekCellSummary(cell), "已同步的 1 人都有空");

  const nobody = dormWeekGrid(createDormReaders([member(1, "张三", null)]), "2026-09-07");
  assert.equal(dormWeekCellLevel(nobody.rows[0].cells[0]), "unknown");
  assert.equal(dormWeekCellSummary(nobody.rows[0].cells[0]), "没有课表数据");
  assert.equal(nobody.teachingWeek, null);
});

test("weeks outside the term have no data and no teaching week", () => {
  const grid = dormWeekGrid(createDormReaders([zhang(), li()]), "2026-10-05");
  assert.equal(grid.teachingWeek, null);
  assert.ok(grid.rows.every((row) => row.cells.every((cell) => dormWeekCellLevel(cell) === "unknown")));
});

test("custom course times are matched by the clock, not the period number", () => {
  const late = member(1, "张三", snapshot([{ day: 1, bigSlot: 1, courses: [course("实验", 1, 1, { customStartTime: "09:00", customEndTime: "10:00" })] }]));
  const grid = dormWeekGrid(createDormReaders([late]), "2026-09-07");
  const monday = grid.rows.map((row) => dormWeekCellLevel(row.cells[0]));
  assert.deepEqual(monday.slice(0, 4), ["all", "none", "none", "all"]);
});

test("the period table follows my own timetable first", () => {
  const mine = member(1, "张三", snapshot([], calendar({ periods: [{ id: 1, start: "07:30", end: "08:15" }] })));
  const theirs = member(2, "李四", snapshot([], calendar({ periods: [{ id: 1, start: "08:00", end: "08:45" }] })));
  const readers = createDormReaders([theirs, mine]);
  assert.equal(dormWeekPeriods(readers, 1)[0].start, "07:30");
  assert.equal(dormWeekPeriods(readers)[0].start, "08:00");
  assert.equal(dormWeekPeriods(createDormReaders([member(1, "张三", null)])).length, 12);
});
