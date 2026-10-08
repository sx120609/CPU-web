import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GRADES_COMPACT_TABLE_MIN_WIDTH,
  GRADES_FULL_TABLE_MIN_WIDTH,
  GRADES_LAYOUT_HYSTERESIS,
  gradesLayoutTier,
} from "../src/components/jwxt/gradesLayout";

test("first measurement picks the tier from the pane width alone", () => {
  assert.equal(gradesLayoutTier(360), "cards");
  assert.equal(gradesLayoutTier(720), "cards"); // phone tree, also at iPad portrait widths
  assert.equal(gradesLayoutTier(GRADES_COMPACT_TABLE_MIN_WIDTH - 1), "cards");
  assert.equal(gradesLayoutTier(GRADES_COMPACT_TABLE_MIN_WIDTH), "compact");
  assert.equal(gradesLayoutTier(944), "compact"); // iPad Pro 13 portrait: 1024 minus page and tab padding
  assert.equal(gradesLayoutTier(1100), "compact"); // iPad Air landscape
  assert.equal(gradesLayoutTier(GRADES_FULL_TABLE_MIN_WIDTH - 1), "compact");
  assert.equal(gradesLayoutTier(GRADES_FULL_TABLE_MIN_WIDTH), "full");
  assert.equal(gradesLayoutTier(1200), "full");
});

test("shrinking switches at the threshold", () => {
  assert.equal(gradesLayoutTier(GRADES_FULL_TABLE_MIN_WIDTH - 1, "full"), "compact");
  assert.equal(gradesLayoutTier(GRADES_COMPACT_TABLE_MIN_WIDTH - 1, "compact"), "cards");
  assert.equal(gradesLayoutTier(500, "full"), "cards");
});

test("growing needs the hysteresis margin, so a scrollbar cannot make it oscillate", () => {
  const compactUp = GRADES_COMPACT_TABLE_MIN_WIDTH + GRADES_LAYOUT_HYSTERESIS;
  const fullUp = GRADES_FULL_TABLE_MIN_WIDTH + GRADES_LAYOUT_HYSTERESIS;
  assert.equal(gradesLayoutTier(GRADES_COMPACT_TABLE_MIN_WIDTH, "cards"), "cards");
  assert.equal(gradesLayoutTier(compactUp - 1, "cards"), "cards");
  assert.equal(gradesLayoutTier(compactUp, "cards"), "compact");
  assert.equal(gradesLayoutTier(fullUp - 1, "compact"), "compact");
  assert.equal(gradesLayoutTier(fullUp, "compact"), "full");
  // A jump across both thresholds stops one tier short when the margin is missing above the upper one.
  assert.equal(gradesLayoutTier(fullUp - 1, "cards"), "compact");
  assert.equal(gradesLayoutTier(fullUp, "cards"), "full");
  // Inside the band the current tier is kept in both directions.
  for (let width = GRADES_COMPACT_TABLE_MIN_WIDTH; width < compactUp; width += 1) {
    assert.equal(gradesLayoutTier(width, "compact"), "compact");
    assert.equal(gradesLayoutTier(width, "cards"), "cards");
  }
});

test("a hidden pane keeps its tier", () => {
  assert.equal(gradesLayoutTier(0, "cards"), "cards");
  assert.equal(gradesLayoutTier(Number.NaN, "compact"), "compact");
  assert.equal(gradesLayoutTier(0), "full");
});

test("GradesPane switches by pane width and no longer forces a 1060 px table", () => {
  const source = readFileSync(new URL("../src/components/jwxt/GradesPane.vue", import.meta.url), "utf8");
  assert.match(source, /new ResizeObserver\(/u);
  assert.match(source, /gradesLayoutTier\(/u);
  assert.doesNotMatch(source, /min-width:\s*1060px/u);
  assert.doesNotMatch(source, /@media \(max-width: 760px\)/u);
});
