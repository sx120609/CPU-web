import assert from "node:assert/strict";
import test from "node:test";
import { applyScheduleTermConfig, mergeScheduleAdjustments, normalizeSchedulePeriods, normalizeScheduleTermConfig } from "../src/services/scheduleTermConfig";

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

test("manual term adjustments override public holiday defaults", () => {
  const result = mergeScheduleAdjustments(
    [{ date: "2026-10-01", kind: "off", note: "公开节假日" }],
    [{ date: "2026-10-01", kind: "swap", source: "2026-09-28", note: "学校调课" }],
  );
  assert.deepEqual(result, [{ date: "2026-10-01", kind: "swap", source: "2026-09-28", note: "学校调课" }]);
});

test("school-wide periods are validated on their own", () => {
  const periods = normalizeSchedulePeriods([
    { start: "08:00", end: "08:45" },
    { name: "第2节", start: "08:55", end: "09:40" },
  ]);
  assert.deepEqual(periods.map((item) => item.id), [1, 2]);
  assert.equal(periods[0].name, "第1节");
  assert.throws(() => normalizeSchedulePeriods([]), /节次数量必须是 1-30/);
  assert.throws(() => normalizeSchedulePeriods([{ start: "09:00", end: "08:00" }]), /第 1 节时间无效/);
  assert.throws(() => normalizeSchedulePeriods([{ start: "25:00", end: "26:00" }]), /第 1 节时间无效/);
});
