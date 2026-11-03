import assert from "node:assert/strict";
import test from "node:test";
import { findNextClass, nextClassDayLabel } from "../src/views/schedule/nextClass";
import { smallSlots } from "../src/views/schedule/slots";
import type { WeekCourseBlock } from "../src/views/schedule/types";

function block(name: string, day: number, start: number, end: number, extra: Partial<WeekCourseBlock["course"]> = {}): WeekCourseBlock {
  return { day, bigSlot: Math.ceil(start / 2), startSlot: start, endSlot: end, index: 0, course: { name, weeks: "", weekList: [], ...extra } };
}

// 2026-10-05 is Monday of week 5.
const dayAt = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const offset = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 9, 5)) / 86_400_000);
  if (offset < 0 || offset >= 21) return undefined;
  return { week: 5 + Math.floor(offset / 7), day: (offset % 7) + 1 };
};

test("nothing is shown while today still has a class to come", () => {
  const state = findNextClass({
    today: "2026-10-05",
    nowMinutes: 9 * 60,
    clocks: smallSlots,
    dayAt,
    blocksOn: (week, day) => (week === 5 && day === 1 ? [block("药理学", 1, 1, 2), block("有机", 1, 3, 4)] : []),
  });
  assert.equal(state, null);
});

test("after today's last class the earliest class of the next teaching day is found", () => {
  const state = findNextClass({
    today: "2026-10-09",
    nowMinutes: 18 * 60,
    clocks: smallSlots,
    dayAt,
    blocksOn: (week, day) => {
      if (week === 5 && day === 5) return [block("体育", 5, 3, 4)];
      // The weekend is free; Monday of week 6 has two classes listed out of order.
      if (week === 6 && day === 1) return [block("英语", 1, 5, 6), block("讲座", 1, 9, 9, { customStartTime: "07:30", customEndTime: "08:00" })];
      return [];
    },
  });
  assert.equal(state?.todayCount, 1);
  assert.equal(state?.next?.block.course.name, "讲座");
  assert.equal(state?.next?.start, "07:30");
  assert.equal(state?.next?.date, "2026-10-12");
  assert.equal(state?.next?.week, 6);
  assert.equal(nextClassDayLabel("2026-10-09", state!.next!), "周一 · 10月12日");
  assert.equal(nextClassDayLabel("2026-10-11", state!.next!), "明天");
});

test("a free day with nothing in the next two weeks says so", () => {
  const state = findNextClass({ today: "2026-10-05", nowMinutes: 600, clocks: smallSlots, dayAt, blocksOn: () => [] });
  assert.deepEqual(state, { todayCount: 0, next: null });
});
