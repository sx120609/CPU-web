import assert from "node:assert/strict";
import test from "node:test";
import {
  arrangementConflicts,
  arrangementCustomItems,
  arrangementTimeSummary,
} from "../src/views/schedule/arrangements";
import { isOriginalCourseEditUnchanged, buildCustomCourseItem, createCustomCourseForm } from "../src/views/schedule/courseEditor";
import { blockScheduleLine, courseCardNote } from "../src/views/schedule/nowIndicator";
import { smallSlots } from "../src/views/schedule/slots";
import { customTimeSlotRange, normalizeCustomTimeRange } from "../src/utils/scheduleCustomTime";
import { applyScheduleEditsToCells, normalizeScheduleEditsState } from "../src/utils/scheduleEdits";
import type { ScheduleCell, WeekCourseBlock } from "../src/views/schedule/types";

test("a time is drawn on the periods it overlaps, or on the nearest one", () => {
  assert.deepEqual(customTimeSlotRange("16:30", "18:00", smallSlots), { start: 8, end: 8 });
  assert.deepEqual(customTimeSlotRange("14:00", "16:00", smallSlots), { start: 5, end: 7 });
  // In the lunch break, 25 minutes after period 4 and 30 before period 5.
  assert.deepEqual(customTimeSlotRange("12:00", "13:00", smallSlots), { start: 4, end: 4 });
  assert.deepEqual(customTimeSlotRange("17:30", "18:20", smallSlots), { start: 9, end: 9 });
  assert.deepEqual(customTimeSlotRange("7:00", "7:50", smallSlots), { start: 1, end: 1 });
  assert.deepEqual(customTimeSlotRange("22:10", "23:00", smallSlots), { start: 12, end: 12 });
  assert.equal(customTimeSlotRange("18:00", "18:00", smallSlots), null);
  assert.equal(customTimeSlotRange("25:00", "26:00", smallSlots), null);
  assert.equal(customTimeSlotRange("08:00", "09:00", []), null);
});

test("times are written with two-digit hours and need both ends in order", () => {
  assert.deepEqual(normalizeCustomTimeRange("8:05", " 9:40 "), { start: "08:05", end: "09:40" });
  assert.equal(normalizeCustomTimeRange("09:40", "08:05"), null);
  assert.equal(normalizeCustomTimeRange("08:00", ""), null);
  assert.equal(normalizeCustomTimeRange("8:60", "9:00"), null);
});

test("saved edits keep a valid pair of times and drop a broken one", () => {
  const course = { name: "讲座", weeks: "第 3 周", weekList: [3], startSlot: 8, endSlot: 8 };
  const state = normalizeScheduleEditsState({
    hidden: [],
    custom: [
      { id: "a", day: 2, bigSlot: 4, course: { ...course, customStartTime: "16:30", customEndTime: "18:00" } },
      { id: "b", day: 2, bigSlot: 4, course: { ...course, customStartTime: "18:00" } },
      { id: "c", day: 2, bigSlot: 4, course: { ...course, customStartTime: "18:00", customEndTime: "17:00" } },
    ],
  });
  assert.deepEqual(state.custom.map((item) => [item.course.customStartTime, item.course.customEndTime]), [
    ["16:30", "18:00"], [undefined, undefined], [undefined, undefined],
  ]);
  // Old payloads look exactly as before once serialized.
  assert.equal(JSON.stringify(state.custom[1].course).includes("custom"), false);
  const cells = applyScheduleEditsToCells([], state);
  assert.equal(cells[0].courses[0].customStartTime, "16:30");
});

test("an arrangement on its own time is one item across the periods it overlaps", () => {
  const items = arrangementCustomItems({
    details: { name: "学术讲座", teacher: "", location: "图书馆报告厅", note: "" },
    arrangements: [
      { day: 2, slots: [1, 2], weekList: [3], time: { start: "14:00", end: "16:00" } },
      { day: 4, slots: [1, 2, 5], weekList: [3] },
    ],
    primaryId: "custom-primary",
    makeId: () => "custom-extra",
  });
  assert.deepEqual(items.map((item) => [item.day, item.bigSlot, item.course.startSlot, item.course.endSlot,
    item.course.customStartTime, item.course.customEndTime]), [
    [2, 3, 5, 7, "14:00", "16:00"],
    [4, 1, 1, 2, undefined, undefined],
    [4, 3, 5, 5, undefined, undefined],
  ]);
  assert.equal(arrangementTimeSummary({ start: "14:00", end: "16:00" }), "14:00–16:00 · 课表上排在第 5–7 节");
  assert.equal(arrangementTimeSummary({ start: "16:00", end: "14:00" }), "结束时间要晚于开始时间");
  assert.equal(arrangementTimeSummary({ start: "", end: "" }), "填写开始和结束时间");
});

test("courses on their own time are compared by the minute", () => {
  const cells: ScheduleCell[] = [{
    day: 2,
    bigSlot: 4,
    courses: [
      { name: "第八节", weeks: "", weekList: [], startSlot: 8, endSlot: 8 },
      { name: "晚讲座", weeks: "", weekList: [], startSlot: 9, endSlot: 9, customStartTime: "17:30", customEndTime: "18:20" },
    ],
  }];
  // 16:20–17:05 is period 8; a 17:10 start meets neither it nor the evening talk.
  assert.deepEqual(arrangementConflicts({ day: 2, slots: [], weekList: [], time: { start: "17:06", end: "17:25" } }, cells), []);
  assert.deepEqual(arrangementConflicts({ day: 2, slots: [], weekList: [], time: { start: "17:00", end: "17:40" } }, cells),
    ["第八节", "晚讲座"]);
  // Period 9 starts at 18:30, after the talk has ended.
  assert.deepEqual(arrangementConflicts({ day: 2, slots: [9], weekList: [] }, cells), []);
  assert.deepEqual(arrangementConflicts({ day: 2, slots: [8], weekList: [] }, cells), ["第八节"]);
});

test("the bridge item builder carries the times and an edited official course is never unchanged", () => {
  const form = { ...createCustomCourseForm(2), name: "学术讲座", startSlot: 5, endSlot: 7, customStartTime: "14:00", customEndTime: "16:00" };
  const { item } = buildCustomCourseItem(form, { weekList: [3] });
  assert.equal(item.course.customStartTime, "14:00");
  assert.equal(item.course.customEndTime, "16:00");
  const plain = buildCustomCourseItem({ ...form, customStartTime: "", customEndTime: "" }, { weekList: [3] }).item;
  assert.equal("customStartTime" in plain.course, false);
  const block: WeekCourseBlock = {
    day: 2, bigSlot: 3, startSlot: 5, endSlot: 7, index: 0,
    course: { name: "学术讲座", weeks: "第 3 周", weekList: [3], startSlot: 5, endSlot: 7 },
  };
  assert.equal(isOriginalCourseEditUnchanged(block, { ...plain, day: 2 }, [3]), true);
  assert.equal(isOriginalCourseEditUnchanged(block, { ...item, day: 2 }, [3]), false);
});

test("cards and the quick look show a course's own time instead of its periods", () => {
  const block: WeekCourseBlock = {
    day: 2, bigSlot: 4, startSlot: 8, endSlot: 8, index: 0,
    course: { name: "讲座", weeks: "第 3 周", weekList: [3], slotNote: "08节", customStartTime: "16:30", customEndTime: "18:00" },
  };
  assert.equal(blockScheduleLine(block, smallSlots), "周二 · 16:30–18:00");
  assert.equal(courseCardNote(block.course), "16:30–18:00");
  const plain = { ...block, course: { ...block.course, customStartTime: undefined, customEndTime: undefined } };
  assert.equal(blockScheduleLine(plain, smallSlots), "周二 · 第 8 节 · 16:20–17:05");
  assert.equal(courseCardNote(plain.course), "08节");
});
