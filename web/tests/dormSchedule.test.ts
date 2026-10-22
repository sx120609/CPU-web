import assert from "node:assert/strict";
import test from "node:test";
import {
  DORM_COLORS,
  addDaysYmd,
  createDormReader,
  createDormReaders,
  dormDateLabel,
  dormDateRange,
  dormDayAvailability,
  dormDayName,
  dormDayWindow,
  dormFreeEmptyText,
  dormFreeWindowLabel,
  dormMorningDays,
  dormMorningDuties,
  dormMorningNoneText,
  dormMorningSummaryText,
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

test("an explicit head count is not lowered to the roommates who have data", () => {
  // 三人宿舍只有两人有课表：要求至少 3 人有空时无从判断，不能把两人的空档当结果。
  const readers = createDormReaders([zhang(), li(), member(3, "王五", null)]);
  const day = dormDayAvailability(readers, TUESDAY, { minFree: 3 });
  assert.equal(day.requiredFree, 3);
  assert.equal(day.insufficientData, true);
  assert.deepEqual(day.windows, []);
  assert.match(dormFreeEmptyText(day, true), /要 3 人同时有空，但这天只有 2 人有课表数据/u);
  // 要求 2 人时数据够用，照常给出窗口。
  const relaxed = dormDayAvailability(readers, TUESDAY, { minFree: 2 });
  assert.equal(relaxed.insufficientData, false);
  assert.equal(relaxed.windows.length, 2);
});

/** 只在周二上课、每节课用自定义时间的室友。 */
function timed(id: number, nickname: string, spans: Array<[string, string]>) {
  return member(id, nickname, snapshot(spans.map(([start, end], index) => ({
    day: 2,
    bigSlot: index + 1,
    courses: [course(`课${index + 1}`, index * 2 + 1, index * 2 + 2, { customStartTime: start, customEndTime: end })],
  }))));
}

test("a relaxed head count keeps an hour two roommates share while a third keeps coming and going", () => {
  // 10:00–11:00 里张三、李四一直有空；王五每 10 分钟上一次课。
  const wang = timed(3, "王五", [["10:00", "10:10"], ["10:20", "10:30"], ["10:40", "10:50"]]);
  const readers = createDormReaders([zhang(), li(), wang]);
  const hour = { start: 600, end: 660 };
  const relaxed = dormDayAvailability(readers, TUESDAY, { minFree: 2, minMinutes: 20, window: hour });
  assert.deepEqual(relaxed.windows, [{ start: 600, end: 660, freeIds: [1, 2] }]);
  // 默认要求全员：王五一直在上下课，没有 20 分钟以上三人同时空着的时段。
  assert.deepEqual(dormDayAvailability(readers, TUESDAY, { minMinutes: 20, window: hour }).windows, []);
});

test("windows never chain different pairs into one group", () => {
  // 张三 10:15 起有课，王五 10:15 前有课，李四一直有空：前 15 分钟是 {张三,李四}，之后是 {李四,王五}。
  const a = timed(1, "张三", [["10:15", "10:40"]]);
  const c = timed(3, "王五", [["10:00", "10:15"]]);
  const readers = createDormReaders([a, li(), c]);
  const day = dormDayAvailability(readers, TUESDAY, { minFree: 2, minMinutes: 20, window: { start: 600, end: 640 } });
  assert.deepEqual(day.windows, [{ start: 615, end: 640, freeIds: [2, 3] }]);
});

test("a short tail does not dissolve a longer window with more people free", () => {
  // 王五只在 10:00–10:10 有课：10:10 之后三人都空，不能被前面 10 分钟的两人段吞成“2 人有空”。
  const wang = timed(3, "王五", [["10:00", "10:10"]]);
  const readers = createDormReaders([zhang(), li(), wang]);
  const day = dormDayAvailability(readers, TUESDAY, { minFree: 2, minMinutes: 20, window: { start: 600, end: 780 } });
  assert.deepEqual(day.windows, [{ start: 610, end: 780, freeIds: [1, 2, 3] }]);
});

test("free windows only claim the whole dorm when everyone has data", () => {
  const complete = dormDayAvailability(createDormReaders([zhang(), li()]), TUESDAY);
  assert.equal(dormFreeWindowLabel(complete.windows[0], complete), "全宿舍都有空");

  const partial = dormDayAvailability(createDormReaders([zhang(), li(), member(3, "王五", null)]), TUESDAY);
  assert.equal(dormFreeWindowLabel(partial.windows[0], partial), "已同步的 2 人都有空");

  const loose = dormDayAvailability(createDormReaders([zhang(), li()]), TUESDAY, { minFree: 1 });
  assert.equal(dormFreeWindowLabel(loose.windows[0], loose), "1 人有空");
});

test("empty free-time text tells missing data apart from a genuinely full day", () => {
  const nobody = dormDayAvailability(createDormReaders([zhang(), li()]), "2027-03-01");
  assert.match(dormFreeEmptyText(nobody, false), /没有可用课表/u);

  // 只保留 10 小时以上的空档：数据齐全，确实没有全宿舍同时有空的时段。
  const complete = dormDayAvailability(createDormReaders([zhang(), li()]), TUESDAY, { minMinutes: 600 });
  assert.equal(complete.windows.length, 0);
  assert.equal(dormFreeEmptyText(complete, false), "这天没有全宿舍同时有空的时段。可以把条件放宽一点再看。");

  const partial = dormDayAvailability(createDormReaders([zhang(), member(2, "李四", null)]), TUESDAY, { minMinutes: 900 });
  assert.equal(partial.windows.length, 0);
  assert.equal(dormFreeEmptyText(partial, false), "已同步的 1 人里没有大家同时有空的时段。可以把条件放宽一点再看。");
});

test("the morning list does not promise a free night when someone has no data", () => {
  const complete = dormMorningDays(createDormReaders([li()]), dormDateRange(TUESDAY, 3));
  assert.equal(dormMorningNoneText(complete[0]), "没人早八");
  assert.equal(dormMorningSummaryText(complete), "未来 3 天都没有早八，晚上可以放心熬。");

  const partial = dormMorningDays(createDormReaders([li(), member(2, "王五", null)]), dormDateRange(TUESDAY, 3));
  assert.equal(partial[0].knownCount, 1);
  assert.equal(dormMorningNoneText(partial[0]), "已同步的人没有早八");
  assert.doesNotMatch(dormMorningSummaryText(partial), /放心熬/u);
  assert.match(dormMorningSummaryText(partial), /名单可能不全/u);

  const nothing = dormMorningDays(createDormReaders([member(1, "张三", null)]), dormDateRange(TUESDAY, 3));
  assert.equal(dormMorningNoneText(nothing[0]), "没有数据");
  assert.match(dormMorningSummaryText(nothing), /看不出谁有早八/u);
});

function hslToRgb(value: string) {
  const [h, s, l] = (value.match(/hsl\((\d+) (\d+)% (\d+)%\)/u) ?? []).slice(1).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance([r, g, b]: number[]) {
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: number[], b: number[]) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("roommate names stay readable on light and dark surfaces", () => {
  const white = [1, 1, 1];
  const darkSurface = [0x1f / 255, 0x23 / 255, 0x29 / 255];
  for (const color of DORM_COLORS) {
    assert.ok(contrast(hslToRgb(dormPersonTone(color, false).name), white) >= 4.5, `${color} name on light`);
    assert.ok(contrast(hslToRgb(dormPersonTone(color, true).name), darkSurface) >= 4.5, `${color} name on dark`);
  }
});
