import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysYmd,
  createDormReader,
  createDormReaders,
  dormDateLabel,
  dormDateRange,
  dormDayAvailability,
  dormDayName,
  dormDayWindow,
  dormMorningDays,
  dormMorningDuties,
  dormNextMorning,
  dormPersonTone,
  formatMinute,
  formatWindow,
  type DormMemberSchedule,
} from "../src/views/schedule/dorm";
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

// 2026-09-08 是周二。
const TUESDAY = "2026-09-08";

const zhang = () => member(1, "张三", snapshot([{ day: 2, bigSlot: 1, courses: [course("药理学", 1, 2)] }]));
const li = () => member(2, "李四", snapshot([{ day: 2, bigSlot: 3, courses: [course("有机化学", 5, 6)] }]));

test("the day window comes from the period table and falls back to 08:00-22:00", () => {
  assert.deepEqual(dormDayWindow(createDormReaders([zhang()])), { start: 480, end: 1320 });
  const early = member(1, "张三", snapshot([], calendar({ periods: [{ id: 1, start: "07:10", end: "21:05" }] })));
  assert.deepEqual(dormDayWindow(createDormReaders([early])), { start: 430, end: 1265 });
  assert.deepEqual(dormDayWindow([]), { start: 480, end: 1300 });
});

test("free windows need every member with data to be free by default", () => {
  const readers = createDormReaders([zhang(), li()]);
  const day = dormDayAvailability(readers, TUESDAY);
  assert.deepEqual(day.knownIds, [1, 2]);
  assert.deepEqual(day.unknownIds, []);
  assert.deepEqual(day.windows, [
    { start: 580, end: 810, freeIds: [1, 2] },
    { start: 910, end: 1320, freeIds: [1, 2] },
  ]);
  assert.deepEqual(day.allFreeWindows, day.windows);
});

test("relaxing the requirement exposes windows where only some roommates are free", () => {
  const readers = createDormReaders([zhang(), li()]);
  const day = dormDayAvailability(readers, TUESDAY, { minFree: 1 });
  assert.deepEqual(day.windows.map((window) => [window.start, window.end, window.freeIds]), [
    [480, 580, [2]],
    [580, 810, [1, 2]],
    [810, 910, [1]],
    [910, 1320, [1, 2]],
  ]);
});

test("short gaps are dropped so the list stays readable", () => {
  // 李四 09:40 下课、09:55 又开始，中间 15 分钟的空档低于默认门槛。
  const tight = member(2, "李四", snapshot([
    { day: 2, bigSlot: 1, courses: [course("英语", 2, 2, { customStartTime: "08:55", customEndTime: "09:40" })] },
    { day: 2, bigSlot: 2, courses: [course("数学", 3, 3, { customStartTime: "09:55", customEndTime: "10:40" })] },
  ]));
  const readers = createDormReaders([zhang(), tight]);
  const day = dormDayAvailability(readers, TUESDAY, { minFree: 2, minMinutes: 20 });
  assert.deepEqual(day.windows, [{ start: 640, end: 1320, freeIds: [1, 2] }]);
  const loose = dormDayAvailability(readers, TUESDAY, { minFree: 2, minMinutes: 0 });
  assert.deepEqual(loose.windows, [
    { start: 580, end: 595, freeIds: [1, 2] },
    { start: 640, end: 1320, freeIds: [1, 2] },
  ]);
});

test("roommates without data are reported instead of being treated as free", () => {
  const noData = member(3, "王五", null);
  const readers = createDormReaders([zhang(), li(), noData]);
  const day = dormDayAvailability(readers, TUESDAY);
  assert.deepEqual(day.knownIds, [1, 2]);
  assert.deepEqual(day.unknownIds, [3]);
  // 没数据的人不参与判断，所以两个人的空闲块仍然算“全员有空”。
  assert.deepEqual(day.windows, [
    { start: 580, end: 810, freeIds: [1, 2] },
    { start: 910, end: 1320, freeIds: [1, 2] },
  ]);
});

test("dates outside everyone's term produce no windows at all", () => {
  const readers = createDormReaders([zhang(), li()]);
  const day = dormDayAvailability(readers, "2027-03-01");
  assert.deepEqual(day.knownIds, []);
  assert.deepEqual(day.unknownIds, [1, 2]);
  assert.deepEqual(day.windows, []);
  assert.deepEqual(day.allFreeWindows, []);
});

test("a course on the first period counts as an early class", () => {
  const duty = dormMorningDuties(createDormReaders([zhang()]), TUESDAY);
  assert.deepEqual(duty.map((item) => [item.nickname, item.course, item.start]), [["张三", "药理学", "08:00"]]);
  // 李四第一节没课。
  assert.deepEqual(dormMorningDuties(createDormReaders([li()]), TUESDAY), []);
});

test("a custom time does not turn a later period into an early class", () => {
  const late = member(3, "王五", snapshot([
    { day: 2, bigSlot: 2, courses: [course("体育", 3, 4, { customStartTime: "07:40", customEndTime: "09:00" })] },
  ]));
  assert.deepEqual(dormMorningDuties(createDormReaders([late]), TUESDAY), []);
});

test("the morning table covers the requested days and counts missing data", () => {
  const readers = createDormReaders([zhang(), member(2, "李四", null)]);
  const table = dormMorningDays(readers, dormDateRange(TUESDAY, 3));
  assert.deepEqual(table.map((item) => item.ymd), ["2026-09-08", "2026-09-09", "2026-09-10"]);
  assert.equal(table[0].duties.length, 1);
  assert.equal(table[0].unknownCount, 1);
  assert.deepEqual(table[1].duties, []);
});

test("the next early class skips today once it has started", () => {
  const readers = createDormReaders([zhang()]);
  const table = dormMorningDays(readers, dormDateRange(TUESDAY, 2));
  const beforeClass = dormNextMorning(table, new Date("2026-09-08T07:00:00+08:00"));
  assert.equal(beforeClass?.isToday, true);
  assert.equal(beforeClass?.ymd, TUESDAY);
  // 08:30 已经在上课了，下一条要等下一个有早八的日子；这里两份快照都只有周二有课。
  const duringClass = dormNextMorning(table, new Date("2026-09-08T08:30:00+08:00"));
  assert.equal(duringClass, null);
});

test("date helpers stay inside China time and cross month ends", () => {
  assert.equal(addDaysYmd("2026-09-30", 1), "2026-10-01");
  assert.equal(addDaysYmd("2026-01-01", -1), "2025-12-31");
  assert.deepEqual(dormDateRange("2026-09-29", 3), ["2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.equal(dormDateLabel("2026-09-08", "2026-09-08"), "今天 周二");
  assert.equal(dormDateLabel("2026-09-09", "2026-09-08"), "明天 周三");
  assert.equal(dormDateLabel("2026-09-11", "2026-09-08"), "周五 09-11");
  // 早八列表里日期单独成行，所以名字这一层只给“今天／明天／周几”。
  assert.equal(dormDayName("2026-09-08", "2026-09-08"), "今天");
  assert.equal(dormDayName("2026-09-09", "2026-09-08"), "明天");
  assert.equal(dormDayName("2026-09-11", "2026-09-08"), "周五");
  assert.equal(dormDayName("2026-09-13", "2026-09-08"), "周日");
});

test("minutes format as clock time", () => {
  assert.equal(formatMinute(480), "08:00");
  assert.equal(formatMinute(1320), "22:00");
  assert.equal(formatMinute(0), "00:00");
  assert.equal(formatWindow({ start: 580, end: 810 }), "09:40–13:30");
});

test("each roommate keeps their own hue", () => {
  const hueOf = (value: string) => Number(value.match(/^hsl\((\d+)/u)?.[1]);
  assert.equal(hueOf(dormPersonTone("blue", false).bg), 214);
  assert.equal(hueOf(dormPersonTone("red", false).bg), 358);
  assert.deepEqual(dormPersonTone("teal", true), dormPersonTone("teal", true));
});

test("readers with no snapshot answer nothing for any date", () => {
  const reader = createDormReader(member(1, "张三", null));
  assert.equal(reader.coursesForDate(TUESDAY), null);
  assert.deepEqual(reader.periods, []);
});
