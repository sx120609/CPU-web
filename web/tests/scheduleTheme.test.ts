import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_THEME,
  normalizeScheduleTheme,
} from "../src/components/jwxt/scheduleTheme";

test("uses the colorful schedule theme when no preference is saved", () => {
  assert.equal(DEFAULT_SCHEDULE_THEME, "color-glass");
  assert.equal(normalizeScheduleTheme(), "color-glass");
  assert.equal(normalizeScheduleTheme(null), "color-glass");
  assert.equal(normalizeScheduleTheme(""), "color-glass");
});

test("preserves an existing valid schedule theme preference", () => {
  assert.equal(normalizeScheduleTheme("green"), "green");
  assert.equal(normalizeScheduleTheme("blue"), "blue");
  assert.equal(normalizeScheduleTheme("color-glass"), "color-glass");
});

test("keeps legacy aliases and falls back to the colorful default", () => {
  assert.equal(normalizeScheduleTheme("colorful"), "color-glass");
  assert.equal(normalizeScheduleTheme("simple"), "green");
  assert.equal(normalizeScheduleTheme("unknown-theme"), "color-glass");
});
