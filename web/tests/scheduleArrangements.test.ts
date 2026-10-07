import assert from "node:assert/strict";
import test from "node:test";
import {
  arrangementConflicts,
  arrangementCustomItems,
  arrangementRuns,
  arrangementSlotSummary,
} from "../src/views/schedule/arrangements";
import { applyScheduleEditsToCells } from "../src/utils/scheduleEdits";
import type { ScheduleCell } from "../src/views/schedule/types";

test("periods are grouped into runs of consecutive ones", () => {
  assert.deepEqual(arrangementRuns([9, 1, 2, 6, 5, 2]), [{ start: 1, end: 2 }, { start: 5, end: 6 }, { start: 9, end: 9 }]);
  assert.deepEqual(arrangementRuns([]), []);
  assert.equal(arrangementSlotSummary([1, 2, 5]), "第 1–2、5 节 · 08:00–09:40、13:30–14:15");
  assert.equal(arrangementSlotSummary([]), "轻点选择上课的节次，可以不连续");
});

test("each run becomes one existing-format edit item and only the first keeps the edited identity", () => {
  let next = 0;
  const items = arrangementCustomItems({
    details: { name: " 药理学 ", teacher: "王老师", location: "", note: "" },
    arrangements: [
      { day: 1, slots: [1, 2, 5], weekList: [3, 1, 2] },
      { day: 3, slots: [7, 8], weekList: [] },
    ],
    primaryId: "custom-primary",
    primarySourceKey: "jwxt|1|1|1|2|药理学|王老师||1-16周",
    makeId: () => `custom-extra-${next += 1}`,
  });
  assert.deepEqual(items.map((item) => [item.id, item.day, item.bigSlot, item.course.startSlot, item.course.endSlot]), [
    ["custom-primary", 1, 1, 1, 2],
    ["custom-extra-1", 1, 3, 5, 5],
    ["custom-extra-2", 3, 4, 7, 8],
  ]);
  assert.equal(items[0].sourceKey, "jwxt|1|1|1|2|药理学|王老师||1-16周");
  assert.equal(items[1].sourceKey, undefined);
  assert.equal(items[0].course.name, "药理学");
  assert.deepEqual(items[0].course.weekList, [1, 2, 3]);
  assert.equal(items[0].course.weeks, "第 1-3 周");
  assert.equal(items[2].course.weeks, "全部周");
  assert.equal(items[1].course.slotNote, "第 5-5 节");

  // The other clients read the result with the code they already have.
  const cells = applyScheduleEditsToCells([], { hidden: [], custom: items });
  assert.deepEqual(
    cells.flatMap((cell) => cell.courses.map((course) => [cell.day, cell.bigSlot, course.startSlot, course.endSlot])),
    [[1, 1, 1, 2], [1, 3, 5, 5], [3, 4, 7, 8]],
  );
});

test("a conflict needs the same weekday, shared periods and a week in common", () => {
  const cells: ScheduleCell[] = [
    { day: 1, bigSlot: 1, courses: [
      { name: "高等数学", weeks: "1-8周", weekList: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: "体育", weeks: "9-16周", weekList: [9, 10, 11, 12, 13, 14, 15, 16] },
    ] },
    { day: 1, bigSlot: 3, courses: [{ name: "实验", weeks: "", weekList: [], startSlot: 5, endSlot: 8 }] },
    { day: 2, bigSlot: 1, courses: [{ name: "英语", weeks: "", weekList: [] }] },
  ];
  assert.deepEqual(arrangementConflicts({ day: 1, slots: [2, 3], weekList: [1] }, cells), ["高等数学"]);
  // Alternating weeks in the same periods do not collide.
  assert.deepEqual(arrangementConflicts({ day: 1, slots: [1], weekList: [9] }, cells), ["体育"]);
  // Every week meets both; a course without a week list meets every week.
  assert.deepEqual(arrangementConflicts({ day: 1, slots: [1, 6], weekList: [] }, cells), ["高等数学", "体育", "实验"]);
  assert.deepEqual(arrangementConflicts({ day: 1, slots: [], weekList: [] }, cells), []);
  assert.deepEqual(arrangementConflicts({ day: 1, slots: [1], weekList: [] }, cells, (course) => course.name === "体育"), ["高等数学"]);
});
