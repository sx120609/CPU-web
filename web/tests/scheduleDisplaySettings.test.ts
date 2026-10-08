import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_DISPLAY,
  isDefaultScheduleDisplay,
  normalizeScheduleDisplay,
  scheduleDisplayTextScale,
  scheduleWeekColumns,
  selectOffWeekBlocks,
} from "../src/views/schedule/displaySettings";
import type { WeekCourseBlock } from "../src/views/schedule/types";

function block(name: string, day: number, startSlot: number, endSlot: number, weekList: number[], index = 0): WeekCourseBlock {
  return {
    day,
    bigSlot: Math.ceil(startSlot / 2),
    startSlot,
    endSlot,
    index,
    course: { name, weeks: `${weekList.join(",")}周`, weekList },
  };
}

test("unknown or damaged settings fall back to the defaults", () => {
  assert.deepEqual(normalizeScheduleDisplay(null), { ...DEFAULT_SCHEDULE_DISPLAY });
  assert.deepEqual(normalizeScheduleDisplay("x"), { ...DEFAULT_SCHEDULE_DISPLAY });
  const settings = normalizeScheduleDisplay({ rowHeight: 999, textSize: "huge", compact: "yes", showSunday: false });
  assert.equal(settings.rowHeight, 180);
  assert.equal(settings.textSize, "standard");
  assert.equal(settings.compact, false);
  assert.equal(settings.showSunday, false);
  assert.equal(normalizeScheduleDisplay({ rowHeight: 12 }).rowHeight, 70);
  assert.equal(normalizeScheduleDisplay({ rowHeight: 123 }).rowHeight, 125);
  assert.equal(isDefaultScheduleDisplay(normalizeScheduleDisplay({})), true);
  assert.equal(isDefaultScheduleDisplay(settings), false);
});

test("text scale follows the size and tightens a little when compact", () => {
  const standard = normalizeScheduleDisplay({});
  assert.equal(scheduleDisplayTextScale(standard), 1);
  assert.ok(scheduleDisplayTextScale({ ...standard, textSize: "small" }) < 1);
  assert.ok(scheduleDisplayTextScale({ ...standard, textSize: "large" }) > 1);
  assert.ok(scheduleDisplayTextScale({ ...standard, compact: true }) < 1);
});

test("week columns honour the weekend switches and the Sunday-first order", () => {
  const base = normalizeScheduleDisplay({});
  const none = () => false;
  assert.deepEqual(scheduleWeekColumns(base, none), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(scheduleWeekColumns({ ...base, sundayFirst: true }, none), [7, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(scheduleWeekColumns({ ...base, showSaturday: false }, none), [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(scheduleWeekColumns({ ...base, showSaturday: false, showSunday: false }, none), [1, 2, 3, 4, 5]);
});

test("a hidden weekend day stays when it has classes", () => {
  const hidden = normalizeScheduleDisplay({ showSaturday: false, showSunday: false, sundayFirst: true });
  assert.deepEqual(scheduleWeekColumns(hidden, (day) => day === 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(scheduleWeekColumns(hidden, (day) => day === 7), [7, 1, 2, 3, 4, 5]);
});

test("off-week courses fill only the periods that are free this week", () => {
  const current = [block("高数", 1, 1, 2, [5])];
  const all = [
    ...current,
    block("线代", 1, 1, 2, [6]),
    block("物理", 1, 2, 3, [6]),
    block("英语", 1, 3, 4, [6]),
    block("体育", 2, 1, 2, [1, 2, 3]),
  ];
  const chosen = selectOffWeekBlocks(all, current, () => 5).map((item) => item.course.name);
  assert.deepEqual(chosen.sort(), ["体育", "英语"]);
});

test("the nearest upcoming course wins a shared free period", () => {
  const all = [
    block("已结课", 3, 1, 2, [1, 2, 3, 4]),
    block("下周开", 3, 1, 2, [6, 7]),
    block("期末开", 3, 1, 2, [15]),
  ];
  assert.deepEqual(selectOffWeekBlocks(all, [], () => 5).map((item) => item.course.name), ["下周开"]);
  assert.deepEqual(selectOffWeekBlocks(all, [], () => 16).map((item) => item.course.name), ["期末开"]);
});

test("days without a teaching week and courses without week lists are left out", () => {
  const all = [block("周日课", 7, 1, 2, [4, 6]), block("未知周次", 1, 1, 2, []), block("周一课", 1, 3, 4, [6])];
  // 周日排在首列：周日属于上一周（第 4 周，正好有课，不算非本周）。
  const weekOfDay = (day: number) => (day === 7 ? 4 : 5);
  assert.deepEqual(selectOffWeekBlocks(all, [], weekOfDay).map((item) => item.course.name), ["周一课"]);
  assert.deepEqual(selectOffWeekBlocks(all, [], () => 0), []);
});
