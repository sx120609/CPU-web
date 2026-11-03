import assert from "node:assert/strict";
import test from "node:test";
import { emptyWeekDots, weekDotCount, weekDotMatrix } from "../src/views/schedule/weekDots";

test("each pair of periods is one row and each weekday one column", () => {
  const dots = weekDotMatrix([
    { day: 1, startSlot: 1, endSlot: 2 },
    { day: 3, startSlot: 3, endSlot: 6 },
    { day: 7, startSlot: 11, endSlot: 12 },
    // An odd single period still lights its row.
    { day: 5, startSlot: 9, endSlot: 9 },
  ]);
  assert.equal(dots.length, 6);
  assert.ok(dots.every((row) => row.length === 7));
  assert.equal(dots[0][0], true);
  assert.equal(dots[1][2], true);
  assert.equal(dots[2][2], true);
  assert.equal(dots[5][6], true);
  assert.equal(dots[4][4], true);
  assert.equal(weekDotCount(dots), 5);
});

test("out-of-range days and periods are ignored instead of breaking the grid", () => {
  const dots = weekDotMatrix([
    { day: 0, startSlot: 1, endSlot: 2 },
    { day: 8, startSlot: 1, endSlot: 2 },
    { day: 2, startSlot: 12, endSlot: 14 },
  ]);
  assert.equal(weekDotCount(dots), 1);
  assert.equal(dots[5][1], true);
  assert.equal(weekDotCount(emptyWeekDots()), 0);
});
