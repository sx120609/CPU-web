import assert from "node:assert/strict";
import test from "node:test";
import { officialScheduleCalendar } from "../src/views/schedule/officialCalendar";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import { buildSharePublishBody, readSharedSchedule } from "../src/views/schedule/sharedSchedules";
import { buildScheduleWidgetLocalRecord } from "../src/views/schedule/widgetLocalDays";
import { courseEditKey, type ScheduleEditState } from "../src/utils/scheduleEdits";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

function fixture() {
  const weeks = [4, 5, 6, 7].map((week) => {
    const days = Array.from({ length: 7 }, (_, day) => {
      const date = new Date("2026-09-21T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + (week - 4) * 7 + day);
      return date.toISOString().slice(0, 10);
    });
    return { week, days, monday: days[0], sunday: days[6] };
  });
  const rawCalendar: CalendarResult = {
    currentSemester: "2026-2027-1", currentWeek: 6,
    semesterStart: weeks[0].monday, semesterEnd: weeks.at(-1)!.sunday, weeks,
    adjustments: [
      { date: "2026-09-25", kind: "off", note: "中秋节" },
      { date: "2026-10-02", kind: "off", note: "国庆节" },
      { date: "2026-10-09", kind: "swap", source: "2026-10-02" },
      { date: "2026-10-10", kind: "swap", source: "2026-10-16" },
      { date: "2026-10-11", kind: "swap", source: "2026-10-16" },
    ],
  };
  // Based on the observed API shape: Friday excludes week 5, and Saturday
  // has its own week-6 occurrence. Different rooms expose accidental copies.
  const schedule: ScheduleResult = {
    source: "modern", scope: "semester", currentSemester: "2026-2027-1", currentWeek: "6",
    semesters: [], weeks: [], cells: [
      { day: 5, bigSlot: 1, courses: [{ name: "药事管理", weeks: "2-4,6-7周", weekList: [2, 3, 4, 6, 7], location: "常规教室" }] },
      { day: 6, bigSlot: 1, courses: [{ name: "药事管理", weeks: "6周", weekList: [6], location: "补课教室" }] },
    ],
  };
  return { rawCalendar, schedule };
}

function helpers(schedule: ScheduleResult, calendar: CalendarResult, edits: ScheduleEditState = { hidden: [], custom: [] }, known = [schedule]) {
  return createScheduleViewModelHelpers({
    parsed: () => schedule, calendar: () => calendar, weeks: () => [],
    scheduleEdits: () => edits, activeDay: () => 5, currentWeekValue: () => "6",
    scheduleForWeek: () => schedule, allKnownScheduleSources: () => known,
  });
}

test("Web keeps October 9 and the school's actual October 10 classes without copying the holiday", () => {
  const { rawCalendar, schedule } = fixture();
  const model = helpers(schedule, officialScheduleCalendar(rawCalendar)!);
  assert.deepEqual(model.weekCourseBlocksFor(6).map((block) => [block.day, block.course.location]), [
    [5, "常规教室"], [6, "补课教室"],
  ]);
  assert.deepEqual(model.dayCoursesFor(6, 7), [], "an empty official Sunday must not acquire Friday's classes");
  assert.deepEqual(model.weekCourseBlocksFor(5), [], "no guessed courses in the omitted holiday week");
  assert.deepEqual(model.dayCoursesFor(4, 5), [], "September 25 still obeys the explicit school closure");
});

test("Web adjustments do not mutate the calendar cached or supplied to native clients", () => {
  const { rawCalendar, schedule } = fixture();
  const before = structuredClone(rawCalendar);
  const display = officialScheduleCalendar(rawCalendar)!;
  assert.deepEqual(rawCalendar, before);
  assert.deepEqual(display.adjustments?.map((item) => item.kind), ["off", "off"]);
  assert.equal(display.weeks, rawCalendar.weeks);
  // Imported native/shared schedules keep their published adjustment semantics.
  assert.deepEqual(helpers(schedule, rawCalendar).dayCoursesFor(6, 5), []);
  assert.equal(helpers(schedule, rawCalendar).dayCoursesFor(6, 6)[0].course.location, "常规教室");
  assert.equal(officialScheduleCalendar(null), null);
});

test("an explicitly empty weekly response stays empty instead of borrowing another cached week", () => {
  const { rawCalendar, schedule } = fixture();
  const empty: ScheduleResult = { ...schedule, scope: "week", cells: [] };
  assert.deepEqual(helpers(empty, officialScheduleCalendar(rawCalendar)!, undefined, [empty, schedule]).cellsForWeek(6), []);
});

test("personal edits still apply to the actual makeup occurrence", () => {
  const { rawCalendar, schedule } = fixture();
  const course = schedule.cells[1].courses[0];
  const sourceKey = courseEditKey(6, 1, course);
  const edits: ScheduleEditState = {
    hidden: [sourceKey], custom: [{ id: "makeup-edit", sourceKey, day: 6, bigSlot: 1, course: { ...course, location: "个人教室" } }],
  };
  const model = helpers(schedule, officialScheduleCalendar(rawCalendar)!, edits);
  assert.deepEqual(model.dayCoursesFor(6, 6).map((item) => item.course.location), ["个人教室"]);
  assert.deepEqual(model.dayCoursesFor(6, 5).map((item) => item.course.location), ["常规教室"]);
});

test("Web widget days and published shares keep the same actual courses using the existing protocol", () => {
  const { rawCalendar, schedule } = fixture();
  const calendar = officialScheduleCalendar(rawCalendar)!;
  const model = helpers(schedule, calendar);
  const record = buildScheduleWidgetLocalRecord({
    semester: schedule.currentSemester, calendar, complete: true, weeks: [],
    blocksForWeek: (week) => model.weekCourseBlocksFor(week),
  })!;
  const day = (date: string) => record.days.find((item) => item.date === date)!;
  assert.equal(day("2026-10-09").courses[0].location, "常规教室");
  assert.equal(day("2026-10-10").courses[0].location, "补课教室");
  assert.deepEqual(day("2026-10-02").courses, []);
  assert.ok(record.holidays.some((item) => item.date === "2026-10-02" && item.name === "国庆节"));

  const body = buildSharePublishBody({ semester: schedule.currentSemester, schedule, calendar });
  const shared = readSharedSchedule({ ...body, code: "ABCD2345", owner: "同学", courseCount: 2, createdAt: "", updatedAt: "" });
  // The source marker is not needed by old native/shared readers: the published
  // calendar carries only closures, so they will not move the courses again.
  assert.equal(shared.schedule.source, undefined);
  assert.deepEqual(shared.calendar.adjustments?.map((item) => item.kind), ["off", "off"]);
  assert.deepEqual(helpers(shared.schedule, shared.calendar).weekCourseBlocksFor(6).map((block) => [block.day, block.course.location]), [
    [5, "常规教室"], [6, "补课教室"],
  ]);
});
