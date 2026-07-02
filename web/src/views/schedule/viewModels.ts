import { applyScheduleEditsToCells, courseEditKey, type ScheduleEditState } from "@/utils/scheduleEdits";
import { courseMatchesWeek } from "@/utils/scheduleWeeks";
import { normalizeCalendarWeekDays, shortDate, todayKey } from "./calendar";
import { mergeContinuousCourseBlocks, normalizeSlotRange, normalizeSlotRangeForTablePosition } from "./slots";
import type {
  CalendarResult,
  FlatCourse,
  ScheduleCourse,
  SchedulePageModel,
  ScheduleResult,
  WeekCourseBlock,
} from "./types";

export interface ScheduleViewModelContext {
  calendar: () => CalendarResult | null;
  parsed: () => ScheduleResult | null;
  weeks: () => Array<{ value: string | number }>;
  scheduleEdits: () => ScheduleEditState;
  activeDay: () => number;
  currentWeekValue: () => string;
  scheduleForWeek: (weekValue: string | number) => ScheduleResult | null;
  allKnownScheduleSources: () => ScheduleResult[];
}

export function createScheduleViewModelHelpers(context: ScheduleViewModelContext) {
  function weekInfoFor(value: string | number) {
    return context.calendar()?.weeks.find((w) => w.week === Number(value)) ?? null;
  }

  function weekRangeFor(value: string | number) {
    const w = weekInfoFor(value);
    if (!w || w.days.length < 7) return "";
    const dates = normalizeCalendarWeekDays(w.days);
    const monday = dates[0];
    const sunday = dates[6];
    return `${shortDate(monday)} - ${shortDate(sunday)}`;
  }

  function dayTabsForWeek(value: string | number) {
    const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const dates = normalizeCalendarWeekDays(weekInfoFor(value)?.days ?? []);
    const today = todayKey();
    return labels.map((label, i) => ({
      day: i + 1,
      label,
      date: shortDate(dates[i] ?? ""),
      isToday: dates[i] === today,
    }));
  }

  function cellsForWeek(wk: number, source: ScheduleResult | null = context.parsed()) {
    return applyScheduleEditsToCells((source?.cells ?? []), context.scheduleEdits())
      .map((cell) => ({
        ...cell,
        courses: wk ? cell.courses.filter((course) => courseMatchesWeek(course, wk)) : cell.courses,
      }))
      .filter((cell) => cell.courses.length);
  }

  function dayCoursesFor(wk: number, day: number, source: ScheduleResult | null = context.parsed()) {
    const list: FlatCourse[] = [];
    for (const cell of cellsForWeek(wk, source)) {
      if (cell.day !== day) continue;
      cell.courses.forEach((course, index) => list.push({ bigSlot: cell.bigSlot, index, course }));
    }
    return list.sort((a, b) => a.bigSlot - b.bigSlot);
  }

  function weekCourseBlocksFor(wk: number, source: ScheduleResult | null = context.parsed()) {
    const byCourse = new Map<string, WeekCourseBlock[]>();
    for (const cell of cellsForWeek(wk, source)) {
      cell.courses.forEach((course, index) => {
        const range = normalizeSlotRangeForTablePosition(cell.bigSlot, course);
        const key = [
          cell.day,
          normalizeScheduleKeyPart(course.name),
          normalizeScheduleKeyPart(course.teacher),
          normalizeScheduleKeyPart(course.location),
          normalizeScheduleKeyPart(course.weeks),
        ].join("|");
        const list = byCourse.get(key) ?? [];
        list.push({ day: cell.day, bigSlot: cell.bigSlot, startSlot: range.start, endSlot: range.end, index, course });
        byCourse.set(key, list);
      });
    }
    const blocks: WeekCourseBlock[] = [];
    for (const list of byCourse.values()) {
      for (const block of mergeContinuousCourseBlocks(list)) blocks.push(block);
    }
    return blocks.sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
  }

  function dayCourseBlocksFor(wk: number, day: number, source: ScheduleResult | null = context.parsed()) {
    return weekCourseBlocksFor(wk, source).filter((block) => block.day === day);
  }

  function weekPageModel(delta: number): SchedulePageModel {
    const weekValue = delta === 0 ? context.currentWeekValue() : nextWeekValueFrom(context.currentWeekValue(), delta) || context.currentWeekValue();
    const weekNo = Number(weekValue || 0);
    const source = context.scheduleForWeek(weekValue);
    const blocks = weekCourseBlocksFor(weekNo, source);
    return {
      delta,
      key: `week-${delta}`,
      weekValue,
      day: context.activeDay(),
      title: "整周",
      dayTabs: dayTabsForWeek(weekValue),
      courseCount: blocks.length,
      dayCourseBlocks: dayCourseBlocksFor(weekNo, context.activeDay(), source),
      weekCourseBlocks: blocks,
    };
  }

  function dayPageModel(delta: number): SchedulePageModel {
    const target = dayTarget(delta);
    const weekNo = Number(target.weekValue || 0);
    const source = context.scheduleForWeek(target.weekValue);
    const blocks = dayCourseBlocksFor(weekNo, target.day, source);
    const tabs = dayTabsForWeek(target.weekValue);
    return {
      delta,
      key: `day-${delta}`,
      weekValue: target.weekValue,
      day: target.day,
      title: tabs.find((d) => d.day === target.day)?.label ?? "今日",
      courseCount: blocks.length,
      dayCourseBlocks: blocks,
      weekCourseBlocks: weekCourseBlocksFor(weekNo, source),
      dayTabs: tabs,
    };
  }

  function dayTarget(delta: number) {
    if (delta === 0) return { weekValue: context.currentWeekValue(), day: context.activeDay() };
    if (delta < 0) {
      if (context.activeDay() > 1) return { weekValue: context.currentWeekValue(), day: context.activeDay() - 1 };
      return { weekValue: nextWeekValueFrom(context.currentWeekValue(), -1) || context.currentWeekValue(), day: 7 };
    }
    if (context.activeDay() < 7) return { weekValue: context.currentWeekValue(), day: context.activeDay() + 1 };
    return { weekValue: nextWeekValueFrom(context.currentWeekValue(), 1) || context.currentWeekValue(), day: 1 };
  }

  function nextWeekValueFrom(current: string, delta: number) {
    const values = context.weeks().map((w) => String(w.value)).filter(Boolean);
    const index = values.indexOf(current);
    if (index >= 0) return values[index + delta] || "";
    const next = Number(current) + delta;
    if (!Number.isFinite(next) || next < 1) return "";
    if (context.calendar()?.weeks.length && next > context.calendar()!.weeks.length) return "";
    return String(next);
  }

  function courseFamilySourceKeys(day: number, bigSlot: number, course: ScheduleCourse) {
    const targetFamilyKey = buildCourseFamilyKey(day, bigSlot, course);
    const keys = new Set<string>();
    for (const source of context.allKnownScheduleSources()) {
      for (const cell of source.cells ?? []) {
        for (const sourceCourse of cell.courses ?? []) {
          if (buildCourseFamilyKey(cell.day, cell.bigSlot, sourceCourse) !== targetFamilyKey) continue;
          keys.add(courseEditKey(cell.day, cell.bigSlot, sourceCourse));
        }
      }
    }
    return keys;
  }

  return {
    weekInfoFor,
    weekRangeFor,
    dayTabsForWeek,
    cellsForWeek,
    dayCoursesFor,
    weekCourseBlocksFor,
    dayCourseBlocksFor,
    weekPageModel,
    dayPageModel,
    dayTarget,
    nextWeekValueFrom,
    courseTitle,
    courseFamilyKey: buildCourseFamilyKey,
    courseFamilySourceKeys,
    dayLabel,
  };
}

export function courseTitle(course: ScheduleCourse) {
  return [
    course.name,
    course.teacher ? `教师：${course.teacher}` : "",
    course.location ? `地点：${course.location}` : "",
    course.weeks,
    course.slotNote,
  ].filter(Boolean).join("\n");
}

export function buildCourseFamilyKey(day: number, bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  return [
    "jwxt-family",
    day,
    range.start,
    range.end,
    normalizeScheduleKeyPart(course.name),
    normalizeScheduleKeyPart(course.teacher),
    normalizeScheduleKeyPart(course.location),
  ].join("|");
}

export function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function normalizeScheduleKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
