import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCHEDULE_PRIORITIES,
  normalizeSchedulePriority,
  resolveSavedSchedulePriority,
  schedulePriorityKey,
} from "../src/shared/schedulePriority";

test("a priority key is the course name with whitespace collapsed", () => {
  assert.equal(schedulePriorityKey("  药物  化学 \n"), "药物 化学");
  assert.equal(schedulePriorityKey(undefined), "");
});

test("only positive whole numbers on real names survive", () => {
  assert.deepEqual(
    normalizeSchedulePriority({ " 高等数学 ": 2, 药理学: "3", 空: 0, 小数: 1.5, 负数: -1, 太大: 10000, "": 4 }),
    { 药理学: 3, 高等数学: 2 },
  );
  assert.deepEqual(normalizeSchedulePriority({}), {});
});

test("a missing field is not the same as an empty one", () => {
  assert.equal(normalizeSchedulePriority(undefined), undefined);
  assert.equal(normalizeSchedulePriority(null), undefined);
  assert.equal(normalizeSchedulePriority([1, 2]), undefined);
  assert.equal(normalizeSchedulePriority("高等数学"), undefined);
});

test("the highest priorities are kept when there are too many", () => {
  const input = Object.fromEntries(Array.from({ length: MAX_SCHEDULE_PRIORITIES + 5 }, (_, i) => [`课程${i}`, i + 1]));
  const result = normalizeSchedulePriority(input)!;
  assert.equal(Object.keys(result).length, MAX_SCHEDULE_PRIORITIES);
  assert.equal(result["课程0"], undefined);
  assert.equal(result[`课程${MAX_SCHEDULE_PRIORITIES + 4}`], MAX_SCHEDULE_PRIORITIES + 5);
});

test("a client that does not know about priority leaves the saved one alone", () => {
  assert.deepEqual(resolveSavedSchedulePriority(undefined, { 高等数学: 2 }), { 高等数学: 2 });
  assert.deepEqual(resolveSavedSchedulePriority({ 药理学: 1 }, { 高等数学: 2 }), { 药理学: 1 });
});

test("an explicit empty map clears the saved priority", () => {
  assert.equal(resolveSavedSchedulePriority({}, { 高等数学: 2 }), undefined);
  assert.equal(resolveSavedSchedulePriority(undefined, undefined), undefined);
  assert.equal(resolveSavedSchedulePriority(undefined, "broken"), undefined);
});
