import assert from "node:assert/strict";
import test from "node:test";
import { withOwnCourseNotes } from "../src/views/schedule/ownNotes";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import type { ScheduleResult } from "../src/views/schedule/types";

test("a custom course keeps the note its owner wrote when its periods are merged into one block", () => {
  const parsed: ScheduleResult = {
    scope: "semester",
    semesters: [],
    weeks: [{ value: "1", label: "第 1 周", current: true }],
    currentSemester: "2026-2027-1",
    currentWeek: "1",
    cells: [{ day: 1, bigSlot: 1, courses: [{ name: "药理学", weeks: "1-16周", weekList: [1], slotNote: "[01-02节]" }] }],
  };
  const edits = {
    hidden: [],
    custom: [
      { id: "custom-note", day: 4, bigSlot: 3, course: { name: "学生会例会", weeks: "第 1 周", weekList: [1], startSlot: 6, endSlot: 7, slotNote: "带上部门周报" } },
      { id: "custom-plain", day: 5, bigSlot: 1, course: { name: "自习", weeks: "第 1 周", weekList: [1], startSlot: 1, endSlot: 2, slotNote: "第 1-2 节" } },
    ],
  };
  const helpers = createScheduleViewModelHelpers({
    calendar: () => null,
    parsed: () => parsed,
    weeks: () => parsed.weeks,
    scheduleEdits: () => edits,
    activeDay: () => 1,
    currentWeekValue: () => "1",
    scheduleForWeek: () => parsed,
    allKnownScheduleSources: () => [parsed],
  });
  const merged = helpers.weekCourseBlocksFor(1, parsed);
  // Merging writes the period range over the note.
  assert.equal(merged.find((block) => block.course.name === "学生会例会")?.course.slotNote, "06-07节");

  const notes = Object.fromEntries(withOwnCourseNotes(merged, edits).map((block) => [block.course.name, block.course.slotNote]));
  // The note is what the quick look shows and what the editor saves back.
  assert.equal(notes["学生会例会"], "带上部门周报");
  // A note that only repeats the periods, and every official course, still reads as the merged range.
  assert.equal(notes["自习"], "01-02节");
  assert.equal(notes["药理学"], "01-02节");
  // Nothing to restore: the same list comes back.
  assert.equal(withOwnCourseNotes(merged, { custom: [] }), merged);
  assert.equal(withOwnCourseNotes(merged, { custom: [edits.custom[1]] }), merged);
});
