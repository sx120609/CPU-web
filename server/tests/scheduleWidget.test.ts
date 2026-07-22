import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduleWidgetPayload,
  parseScheduleWidgetWeeks,
  SCHEDULE_WIDGET_PAYLOAD_VERSION,
} from "../src/services/scheduleWidget";

const WEDNESDAY_1302_CHINA = new Date("2026-07-22T05:02:00.000Z");

function calendarFor(week: number, days: string[]) {
  return {
    currentWeek: week,
    weeks: [{ week, days }],
  };
}

function course(name: string, weeks: string, teacher: string, startSlot: number, endSlot: number) {
  return {
    name,
    weeks,
    weekList: [],
    teacher,
    location: "D301",
    startSlot,
    endSlot,
    slotNote: `${String(startSlot).padStart(2, "0")}-${String(endSlot).padStart(2, "0")}节`,
  };
}

test("schedule widget week parsing keeps odd and even ranges disjoint", () => {
  assert.deepEqual(parseScheduleWidgetWeeks("1-6周（单）"), [1, 3, 5]);
  assert.deepEqual(parseScheduleWidgetWeeks("1-6周（双）"), [2, 4, 6]);
  assert.deepEqual(parseScheduleWidgetWeeks("1、3、5周"), [1, 3, 5]);
});

test("schedule widget does not expose courses outside every teaching week", () => {
  const payload = buildScheduleWidgetPayload(
    {
      currentSemester: "2026-2027-1",
      currentWeek: "2",
      cells: [{
        day: 3,
        bigSlot: 1,
        courses: [
          course("单周课程", "1-16周(单)", "甲", 1, 2),
          course("双周课程", "1-16周(双)", "乙", 1, 2),
        ],
      }],
    },
    calendarFor(1, [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ]),
    "",
    WEDNESDAY_1302_CHINA,
  );

  assert.equal(payload.week, 0);
  assert.equal(payload.currentWeek, 0);
  assert.equal(payload.teachingWeekActive, false);
  assert.equal(payload.today.date, "2026-07-22");
  assert.deepEqual(payload.today.courses, []);
  assert.ok(payload.days.every((day) => day.courses.length === 0));
  assert.equal(payload.payloadVersion, SCHEDULE_WIDGET_PAYLOAD_VERSION);
});

test("schedule widget only exposes the matching odd-week course", () => {
  const payload = buildScheduleWidgetPayload(
    {
      currentSemester: "2025-2026-2",
      cells: [{
        day: 3,
        bigSlot: 4,
        courses: [
          course("药物合成反应", "1-16周(单)", "何玉立", 7, 8),
          course("药物合成反应", "1-16周(双)", "付文燕", 7, 8),
        ],
      }],
    },
    calendarFor(3, [
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
      "2026-07-24", "2026-07-25", "2026-07-26",
    ]),
    "",
    WEDNESDAY_1302_CHINA,
  );

  assert.equal(payload.week, 3);
  assert.equal(payload.teachingWeekActive, true);
  assert.deepEqual(payload.today.courses.map((item) => item.teacher), ["何玉立"]);
});

test("schedule widget only exposes the matching even-week course", () => {
  const payload = buildScheduleWidgetPayload(
    {
      currentSemester: "2025-2026-2",
      cells: [{
        day: 3,
        bigSlot: 4,
        courses: [
          course("药物合成反应", "1-16周(单)", "何玉立", 7, 8),
          course("药物合成反应", "1-16周(双)", "付文燕", 7, 8),
        ],
      }],
    },
    calendarFor(2, [
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
      "2026-07-24", "2026-07-25", "2026-07-26",
    ]),
    "",
    WEDNESDAY_1302_CHINA,
  );

  assert.equal(payload.week, 2);
  assert.deepEqual(payload.today.courses.map((item) => item.teacher), ["付文燕"]);
});

test("schedule widget removes today's completed courses from the API payload", () => {
  const payload = buildScheduleWidgetPayload(
    {
      currentSemester: "2025-2026-2",
      cells: [
        { day: 3, bigSlot: 1, courses: [course("上午课程", "1-16周", "甲", 1, 2)] },
        { day: 3, bigSlot: 3, courses: [course("下午课程", "1-16周", "乙", 5, 6)] },
      ],
    },
    calendarFor(3, [
      "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
      "2026-07-24", "2026-07-25", "2026-07-26",
    ]),
    "",
    WEDNESDAY_1302_CHINA,
  );

  assert.deepEqual(payload.today.courses.map((item) => item.name), ["下午课程"]);
  assert.deepEqual(payload.upcoming.map((item) => item.name), ["下午课程"]);
});
