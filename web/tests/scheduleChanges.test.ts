import assert from "node:assert/strict";
import test from "node:test";
import { detectOfficialScheduleChange } from "../src/views/schedule/scheduleChanges";
import type { ScheduleResult } from "../src/views/schedule/types";

function schedule(): ScheduleResult {
  return {
    currentSemester: "2026-2027-1",
    currentWeek: "1",
    semesters: [{ value: "2026-2027-1", label: "2026-2027-1", current: true }],
    weeks: Array.from({ length: 24 }, (_, index) => ({
      value: String(index + 1),
      label: `第 ${index + 1} 周`,
      current: index === 0,
    })),
    cells: [{
      day: 5,
      bigSlot: 1,
      courses: [{
        name: "马克思主义基本原理",
        teacher: "张云婷",
        location: "B301",
        weeks: "1-23周(单)",
        weekList: Array.from({ length: 12 }, (_, index) => index * 2 + 1),
        startSlot: 1,
        endSlot: 2,
        slotNote: "01-02节",
      }],
    }],
  };
}

test("ignores ordering, selected-week metadata and equivalent slot labels", () => {
  const previous = schedule();
  const next = structuredClone(previous);
  next.currentWeek = "2";
  next.weeks[0].current = false;
  next.weeks[1].current = true;
  next.cells[0].courses[0].slotNote = "第 1-2 节";
  assert.equal(detectOfficialScheduleChange(previous, next), null);
});

test("detects an official odd-week to even-week change", () => {
  const previous = schedule();
  const next = structuredClone(previous);
  next.cells[0].courses[0].weeks = "2-24周(双)";
  next.cells[0].courses[0].weekList = Array.from({ length: 12 }, (_, index) => index * 2 + 2);
  const change = detectOfficialScheduleChange(previous, next);
  assert.ok(change);
  assert.equal(change.changedCount, 1);
  assert.notEqual(change.beforeFingerprint, change.afterFingerprint);
});

test("detects teacher, location and time changes", () => {
  for (const mutate of [
    (next: ScheduleResult) => { next.cells[0].courses[0].teacher = "其他教师"; },
    (next: ScheduleResult) => { next.cells[0].courses[0].location = "B203"; },
    (next: ScheduleResult) => {
      next.cells[0].courses[0].startSlot = 3;
      next.cells[0].courses[0].endSlot = 4;
    },
  ]) {
    const previous = schedule();
    const next = structuredClone(previous);
    mutate(next);
    assert.equal(detectOfficialScheduleChange(previous, next)?.changedCount, 1);
  }
});

test("does not compare schedules from different semesters", () => {
  const previous = schedule();
  const next = structuredClone(previous);
  next.currentSemester = "2026-2027-2";
  assert.equal(detectOfficialScheduleChange(previous, next), null);
});

test("treats an implicit all-week course and an explicit all-week course as equivalent", () => {
  const previous = schedule();
  previous.cells[0].courses[0].weeks = "全部周";
  previous.cells[0].courses[0].weekList = [];
  const next = structuredClone(previous);
  next.cells[0].courses[0].weeks = "1-24周";
  next.cells[0].courses[0].weekList = Array.from({ length: 24 }, (_, index) => index + 1);
  assert.equal(detectOfficialScheduleChange(previous, next), null);
});
