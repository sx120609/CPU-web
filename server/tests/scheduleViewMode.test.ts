import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_VIEW_MODE,
  resolveScheduleViewMode,
} from "../../web/src/views/schedule/types";

test("schedule defaults to the week view without overriding a saved preference", () => {
  assert.equal(DEFAULT_SCHEDULE_VIEW_MODE, "week");
  assert.equal(resolveScheduleViewMode(undefined), "week");
  assert.equal(resolveScheduleViewMode("day"), "day");
  assert.equal(resolveScheduleViewMode("week"), "week");
  assert.equal(resolveScheduleViewMode("unexpected"), "week");
});
