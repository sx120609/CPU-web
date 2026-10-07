import assert from "node:assert/strict";
import test from "node:test";
import {
  blockPhase,
  blockScheduleLine,
  blockStatusLabel,
  chineseNumeral,
  cleanLocation,
  clockMinutes,
  nowRowPosition,
  shanghaiMinutes,
  slotSession,
  type DayStatus,
} from "../src/views/schedule/nowIndicator";
import { smallSlots } from "../src/views/schedule/slots";
import type { WeekCourseBlock } from "../src/views/schedule/types";

function block(start: number, end: number, extra: Partial<WeekCourseBlock["course"]> = {}): WeekCourseBlock {
  return { day: 3, bigSlot: Math.ceil(start / 2), startSlot: start, endSlot: end, index: 0, course: { name: "药理学", weeks: "", weekList: [], ...extra } };
}

test("clock helpers read the timetable's own time zone", () => {
  assert.equal(clockMinutes("08:00"), 480);
  assert.equal(clockMinutes("课间"), null);
  assert.equal(shanghaiMinutes(new Date(Date.UTC(2026, 9, 7, 3, 5))), 11 * 60 + 5);
  assert.equal(shanghaiMinutes(new Date(Date.UTC(2026, 9, 7, 16, 30))), 30);
  assert.deepEqual([slotSession("08:00"), slotSession("13:30"), slotSession("18:30"), slotSession("")], ["上午", "下午", "晚上", "课程"]);
  assert.deepEqual([chineseNumeral(3), chineseNumeral(10), chineseNumeral(12), chineseNumeral(20), chineseNumeral(21)], ["三", "十", "十二", "二十", "二十一"]);
  assert.equal(cleanLocation(" @ A101 "), "A101");
  assert.equal(cleanLocation("＠"), null);
});

test("now rests inside a period, in the gap of a break, and is not drawn outside the day", () => {
  assert.equal(nowRowPosition(7 * 60, smallSlots), null);
  assert.deepEqual(nowRowPosition(8 * 60, smallSlots), { row: 0, fraction: 0, inGap: false });
  const middle = nowRowPosition(8 * 60 + 15, smallSlots);
  assert.equal(middle?.row, 0);
  assert.ok(Math.abs((middle?.fraction ?? 0) - 15 / 45) < 1e-9);
  assert.deepEqual(nowRowPosition(8 * 60 + 50, smallSlots), { row: 1, fraction: 0, inGap: true });
  assert.deepEqual(nowRowPosition(12 * 60 + 30, smallSlots), { row: 4, fraction: 0, inGap: true });
  assert.equal(nowRowPosition(22 * 60 + 30, smallSlots), null);
});

test("a course is finished, in progress or still to come relative to now", () => {
  const status = (now: number | null, completedBefore: number | null = null): DayStatus => ({ clocks: smallSlots, now, completedBefore });
  assert.equal(blockPhase(status(9 * 60), block(1, 2)), "current");
  assert.equal(blockStatusLabel(status(9 * 60), block(1, 2)), "正在上 · 还剩 40 分");
  assert.equal(blockPhase(status(9 * 60 + 40), block(1, 2)), "completed");
  assert.equal(blockStatusLabel(status(9 * 60 + 40), block(1, 2)), "已结束");
  assert.equal(blockPhase(status(9 * 60), block(3, 4)), "upcoming");
  assert.equal(blockStatusLabel(status(9 * 60 + 30), block(3, 4)), "25 分钟后");
  assert.equal(blockStatusLabel(status(8 * 60), block(3, 4)), null);
  // A past day: everything is finished without a "now" to count from.
  assert.equal(blockPhase(status(null, 24 * 60), block(9, 10)), "completed");
  // No "now" and no limit: nothing is marked.
  assert.equal(blockPhase(status(null), block(1, 2)), "upcoming");
  // A custom course's own clock times win.
  assert.equal(blockPhase(status(18 * 60 + 10), block(9, 9, { customStartTime: "18:00", customEndTime: "19:30" })), "current");
});

test("the quick look line names the weekday, the periods and the times", () => {
  assert.equal(blockScheduleLine(block(1, 2), smallSlots), "周三 · 第 1–2 节 · 08:00–09:40");
  assert.equal(blockScheduleLine(block(9, 9), smallSlots), "周三 · 第 9 节 · 18:30–19:15");
});
