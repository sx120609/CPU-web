import assert from "node:assert/strict";
import test from "node:test";
import { resolveScheduleCurrentWeek } from "../src/views/schedule/calendar";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

function schedule(selectedWeek = "2"): ScheduleResult {
  return {
    currentSemester: "2026-2027-1",
    currentWeek: selectedWeek,
    semesters: [{ value: "2026-2027-1", label: "2026-2027-1", current: true }],
    weeks: Array.from({ length: 20 }, (_, index) => ({
      value: String(index + 1),
      label: `第 ${index + 1} 周`,
      current: String(index + 1) === selectedWeek,
    })),
    cells: [],
  };
}

test("finds today from the semester fallback when the school calendar is empty", () => {
  const emptyCalendar: CalendarResult = {
    currentSemester: "",
    semesterStart: "",
    semesterEnd: "",
    weeks: [],
    currentWeek: 0,
  };

  assert.equal(resolveScheduleCurrentWeek(emptyCalendar, schedule("2"), "2026-09-06"), 1);
});

test("prefers a dated school-calendar match over the inferred semester calendar", () => {
  const schoolCalendar: CalendarResult = {
    currentSemester: "2026-2027-1",
    semesterStart: "2026-08-17",
    semesterEnd: "2027-01-17",
    currentWeek: 4,
    weeks: [{
      week: 4,
      monday: "2026-09-07",
      sunday: "2026-09-13",
      days: [
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-12",
        "2026-09-13",
      ],
    }],
  };

  assert.equal(resolveScheduleCurrentWeek(schoolCalendar, schedule("2"), "2026-09-10"), 4);
});
