import assert from "node:assert/strict";
import test from "node:test";
import {
  placeCourseBlocks,
  schedulePriorityKey,
  schedulePriorityValue,
  topSchedulePriority,
  withCoursePreferred,
} from "../src/views/schedule/displayPriority";
import type { WeekCourseBlock } from "../src/views/schedule/types";

// The same cases as ios_next/tests/NativeSchedulePriorityChecks.swift, so the
// two clients lay overlapping courses out identically.
function block(name: string, start: number, end: number, day = 1): WeekCourseBlock {
  return { day, bigSlot: Math.ceil(start / 2), startSlot: start, endSlot: end, index: 0, course: { name, weeks: "", weekList: [] } };
}

function shape(blocks: WeekCourseBlock[], priorities: Record<string, number> = {}) {
  return placeCourseBlocks(blocks, priorities)
    .map((piece) => `${piece.block.course.name} ${piece.startSlot}-${piece.endSlot} L${piece.lane}`);
}

test("a priority is keyed by the course name with whitespace collapsed", () => {
  assert.equal(schedulePriorityKey("  药物  化学 \n"), "药物 化学");
  assert.equal(schedulePriorityValue("药物 化学", { "药物 化学": 3 }), 3);
  assert.equal(schedulePriorityValue("药理学", { "药物 化学": 3, 药理学: -2 }), 0);
  assert.equal(topSchedulePriority({}), 1);
  assert.equal(topSchedulePriority({ 甲: 4, 乙: 2 }), 5);
});

test("without a priority, or with equal ones, courses sit side by side as before", () => {
  const plain = [block("甲", 1, 2), block("乙", 1, 4), block("丙", 3, 4), block("丁", 5, 6)];
  const expected = ["甲 1-2 L0", "乙 1-4 L1", "丙 3-4 L0", "丁 5-6 L0"];
  assert.deepEqual(shape(plain), expected);
  assert.deepEqual(shape(plain, { 甲: 2, 乙: 2, 丙: 2 }), expected);
  assert.deepEqual(placeCourseBlocks(plain).map((piece) => piece.lanes), [2, 2, 2, 1]);
});

test("a course in front covers only the periods it shares", () => {
  const covered = placeCourseBlocks([block("甲", 1, 2), block("乙", 1, 4)], { 甲: 1 });
  assert.deepEqual(
    covered.map((piece) => `${piece.block.course.name} ${piece.startSlot}-${piece.endSlot} L${piece.lane}`),
    ["甲 1-2 L0", "乙 3-4 L0"],
  );
  assert.ok(covered[1].id.endsWith("-segment-3-4"));
  assert.ok(!covered[0].id.includes("segment"));
  // The original periods stay, for the quick look and the editor.
  assert.deepEqual([covered[1].block.startSlot, covered[1].block.endSlot], [1, 4]);
  assert.deepEqual(covered.map((piece) => piece.lanes), [1, 1]);
});

test("a fully covered course is not drawn and a course covered in the middle keeps both ends", () => {
  assert.deepEqual(shape([block("甲", 1, 4), block("乙", 2, 3)], { 甲: 1 }), ["甲 1-4 L0"]);
  assert.deepEqual(shape([block("甲", 3, 4), block("乙", 1, 6)], { 甲: 5 }), ["乙 1-2 L0", "甲 3-4 L0", "乙 5-6 L0"]);
  assert.deepEqual(shape([block("甲", 1, 2), block("乙", 1, 2), block("丙", 1, 4)], { 甲: 1, 乙: 2 }), ["乙 1-2 L0", "丙 3-4 L0"]);
});

test("courses on different days never cover each other", () => {
  assert.deepEqual(shape([block("甲", 1, 2, 1), block("乙", 1, 2, 2)], { 甲: 3 }), ["甲 1-2 L0", "乙 1-2 L0"]);
});

test("the editor switch puts a course in front of every ranked one and removes it again", () => {
  assert.deepEqual(withCoursePreferred({}, " 药物  化学", true), { "药物 化学": 1 });
  assert.deepEqual(withCoursePreferred({ 甲: 2 }, "乙", true), { 甲: 2, 乙: 3 });
  // Already alone in front: left as it is.
  assert.deepEqual(withCoursePreferred({ 甲: 2, 乙: 3 }, "乙", true), { 甲: 2, 乙: 3 });
  // Tied for first: moved in front.
  assert.deepEqual(withCoursePreferred({ 甲: 3, 乙: 3 }, "乙", true), { 甲: 3, 乙: 4 });
  assert.deepEqual(withCoursePreferred({ 甲: 2, 乙: 3 }, "乙", false), { 甲: 2 });
});
