import assert from "node:assert/strict";
import test from "node:test";
import { applyScheduleTermConfig, normalizeScheduleTermConfig } from "../src/services/scheduleTermConfig";

const base = {
  semester: "2026-2027-1",
  semesterStartMonday: "2026-09-14",
  weekCount: 2,
  periods: [{ id: 1, name: "第1节", start: "08:00", end: "08:45" }],
  adjustments: [],
  timezone: "Asia/Shanghai",
  note: "",
};

test("term config normalizes periods and rejects incomplete swap entries", () => {
  const value = normalizeScheduleTermConfig({
    ...base,
    periods: [{ start: "08:00", end: "08:45" }],
    adjustments: [{ date: "2026-10-01", kind: "off", note: "国庆节" }],
  });
  assert.equal(value.periods[0].id, 1);
  assert.equal(value.adjustments[0].kind, "off");
  assert.throws(
    () => normalizeScheduleTermConfig({ ...base, adjustments: [{ date: "2026-10-11", kind: "swap" }] }),
    /必须填写上哪一天的课/,
  );
  assert.throws(
    () => normalizeScheduleTermConfig({ ...base, adjustments: [{ date: "2026-10-11", kind: "swap", source: "2026-10-11" }] }),
    /不能调到自己当天/,
  );
});

test("term config supplies authoritative weeks and keeps adjustments in the calendar", () => {
  const config = normalizeScheduleTermConfig({
    ...base,
    adjustments: [{ date: "2026-09-20", kind: "off", note: "校庆" }],
  });
  const result = applyScheduleTermConfig({
    currentSemester: base.semester,
    currentWeek: 99,
    semesterStart: "2026-09-01",
    semesterEnd: "2026-12-31",
    today: "2026-09-19",
    semesters: [],
    weeks: [],
  }, { ...config, version: 1 });
  assert.equal(result.weeks.length, 2);
  assert.equal(result.weeks[0].monday, "2026-09-14");
  assert.equal(result.adjustments?.[0].date, "2026-09-20");
  assert.equal(result.periods?.[0].start, "08:00");
});
