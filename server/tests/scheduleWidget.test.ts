import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduleWidgetPayload,
  isScheduleWidgetCredentialActive,
  parseScheduleWidgetCache,
  parseScheduleWidgetWeeks,
  resolveScheduleWidgetCalendar,
  resolveScheduleWidgetPreviewWeeks,
  scheduleWidgetCredentialRefreshData,
  scheduleWidgetFallbackPayload,
  SCHEDULE_WIDGET_PAYLOAD_VERSION,
} from "../src/services/scheduleWidget";

const WEDNESDAY_1302_CHINA = new Date("2026-07-22T05:02:00.000Z");

test("schedule widget credentials remain active until explicitly revoked", () => {
  assert.equal(isScheduleWidgetCredentialActive({ revokedAt: null }), true);
  assert.equal(isScheduleWidgetCredentialActive({ revokedAt: new Date() }), false);
  assert.equal(isScheduleWidgetCredentialActive(null), false);
});

test("refreshing widget credentials preserves the last successful payload", () => {
  assert.deepEqual(scheduleWidgetCredentialRefreshData("new-session-token"), {
    jwxtToken: "new-session-token",
    expiresAt: null,
  });
  assert.equal("cachedPayload" in scheduleWidgetCredentialRefreshData("new-session-token"), false);
  assert.equal("cachedAt" in scheduleWidgetCredentialRefreshData("new-session-token"), false);
});

test("fallback requires the complete widget date window, not merely a valid payload version", () => {
  const cached = JSON.stringify({
    payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION,
    strictDate: true,
    generatedAt: "2026-09-02T23:44:53.448Z",
    days: [],
  });

  assert.equal(scheduleWidgetFallbackPayload(cached), null);
  const now = new Date("2026-09-06T04:00:00Z");
  const valid = JSON.stringify({ ...JSON.parse(cached), days: Array.from({ length: 8 }, (_, offset) => ({
    date: `2026-09-${String(6 + offset).padStart(2, "0")}`, courses: [],
  })) });
  assert.deepEqual(scheduleWidgetFallbackPayload(valid, "", now), JSON.parse(valid));
  assert.equal(scheduleWidgetFallbackPayload(valid, "2", now), null);
  assert.equal(scheduleWidgetFallbackPayload(valid, "", new Date("2026-09-07T04:00:00Z")), null);
});

test("the immediate widget fallback rejects malformed or incompatible payloads", () => {
  assert.equal(parseScheduleWidgetCache("not-json"), null);
  assert.equal(parseScheduleWidgetCache(JSON.stringify({
    payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION - 1,
    strictDate: true,
  })), null);
  assert.equal(parseScheduleWidgetCache(JSON.stringify({
    payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION,
    strictDate: false,
  })), null);
});

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
  assert.deepEqual(payload.weekDays[2].courses.map((item) => item.name), ["上午课程", "下午课程"]);
});

test("schedule widget includes the next seven days so an empty day can advance to the next course day", () => {
  const calendar = {
    currentSemester: "2025-2026-2",
    currentWeek: 3,
    weeks: [
      { week: 3, days: ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"] },
      { week: 4, days: ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"] },
    ],
  };
  const currentSchedule = { currentSemester: "2025-2026-2", cells: [] };
  const nextWeekSchedule = {
    currentSemester: "2025-2026-2",
    cells: [{ day: 3, bigSlot: 1, courses: [course("下周课程", "4周", "甲", 1, 2)] }],
  };
  assert.deepEqual(resolveScheduleWidgetPreviewWeeks(calendar, "", WEDNESDAY_1302_CHINA), [4]);
  const payload = buildScheduleWidgetPayload(currentSchedule, calendar, "", WEDNESDAY_1302_CHINA, { 4: nextWeekSchedule });
  assert.equal(payload.days.find((day) => day.date === "2026-07-29")?.courses[0]?.name, "下周课程");
});

test("widget dates require the matching school calendar and never infer the first teaching week", () => {
  const parsed = { currentSemester: "2026-2027-1", cells: [] };
  assert.equal(resolveScheduleWidgetCalendar(null, parsed), null);
  const oldCalendar = { ...calendarFor(1, ["2026-03-02"]), currentSemester: "2025-2026-2" };
  assert.equal(resolveScheduleWidgetCalendar(oldCalendar, parsed), null);
  const matching = { ...calendarFor(1, ["2026-09-07"]), currentSemester: "2026-2027-1" };
  assert.equal(resolveScheduleWidgetCalendar(matching, parsed), matching);
});
