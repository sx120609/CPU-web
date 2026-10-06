import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCalendarWeekDays } from "../src/views/schedule/calendar";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

// The body the iOS app publishes, written by ios_next/tests/NativeSharedScheduleChecks.swift.
// The server stores `schedule` and `calendar` as they are, so this is also what
// /schedule/share/:code hands to ScheduleShare.vue.
const body = JSON.parse(readFileSync(new URL("../../ios_next/tests/fixtures/schedule-share-body.json", import.meta.url), "utf8")) as {
  schedule: ScheduleResult;
  calendar: CalendarResult;
};

test("a timetable shared from iOS lays out on the Web share page", () => {
  // The same wiring as ScheduleShare.vue.
  const helpers = createScheduleViewModelHelpers({
    calendar: () => body.calendar,
    parsed: () => body.schedule,
    weeks: () => body.calendar.weeks.map((item) => ({ value: String(item.week), label: `第 ${item.week} 周` })),
    scheduleEdits: () => ({ hidden: [], custom: [] }),
    activeDay: () => 1,
    currentWeekValue: () => "1",
    scheduleForWeek: () => body.schedule,
    allKnownScheduleSources: () => [body.schedule],
  });
  const blocks = helpers.weekCourseBlocksFor(1, body.schedule);
  assert.deepEqual(
    blocks.map((block) => [block.day, block.startSlot, block.endSlot, block.course.name]),
    [[1, 1, 2, "药理学"]],
  );
  assert.equal(normalizeCalendarWeekDays(body.calendar.weeks[0].days).length, 7);
  assert.deepEqual(body.calendar.periods?.map((item) => [item.id, item.start, item.end]), [[1, "08:00", "08:45"]]);
  assert.deepEqual(body.calendar.adjustments?.map((item) => item.kind), ["off"]);
});
