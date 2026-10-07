import assert from "node:assert/strict";
import test from "node:test";
import { buildWeekIcs, weekIcsFileName } from "../src/views/schedule/icsExport";
import { smallSlots } from "../src/views/schedule/slots";
import type { WeekCourseBlock } from "../src/views/schedule/types";

function block(name: string, start: number, end: number, extra: Partial<WeekCourseBlock["course"]> = {}): WeekCourseBlock {
  return { day: 1, bigSlot: Math.ceil(start / 2), startSlot: start, endSlot: end, index: 0, course: { name, weeks: "", weekList: [], ...extra } };
}

test("a week exports one event per course with Shanghai local times", () => {
  const ics = buildWeekIcs({
    week: 5,
    days: [
      { date: "2026-10-05", blocks: [block("药理学; 实验, A", 1, 2, { location: "A101", teacher: "王老师", slotNote: "01-02节" })] },
      // A day off carries no blocks, so it exports nothing.
      { date: "2026-10-06", blocks: [] },
      { date: "2026-10-07", blocks: [block("讲座", 9, 9, { customId: "custom-1", customStartTime: "18:00", customEndTime: "19:30" })] },
    ],
    clocks: smallSlots,
    stamp: new Date(Date.UTC(2026, 9, 7, 3, 4, 5)),
  });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 2);
  assert.ok(lines.includes("DTSTART;TZID=Asia/Shanghai:20261005T080000"));
  assert.ok(lines.includes("DTEND;TZID=Asia/Shanghai:20261005T094000"));
  assert.ok(lines.includes("SUMMARY:药理学\\; 实验\\, A"));
  assert.ok(lines.includes("LOCATION:A101"));
  assert.ok(lines.includes("DESCRIPTION:王老师 · 01-02节"));
  assert.ok(lines.includes("DTSTAMP:20261007T030405Z"));
  // A custom course's own clock times win over the bell schedule.
  assert.ok(lines.includes("DTSTART;TZID=Asia/Shanghai:20261007T180000"));
  assert.ok(lines.includes("DTEND;TZID=Asia/Shanghai:20261007T193000"));
  assert.ok(lines.includes("UID:5-2026-10-07-9-9-custom-1@cputime.cn"));
  // Identifiers stay ASCII.
  assert.ok(lines.filter((line) => line.startsWith("UID:")).every((line) => /^[\x20-\x7e]+$/u.test(line)));
  assert.equal(weekIcsFileName(5), "药大拾间-第5周课表.ics");
});

test("a course whose times cannot be resolved is left out", () => {
  const ics = buildWeekIcs({ week: 1, days: [{ date: "2026-09-07", blocks: [block("未知", 30, 31)] }], clocks: smallSlots });
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});
