import { emptyScheduleEdits } from "@/utils/scheduleEdits";
import { dayOfWeekForCalendarYmd, normalizeCalendarWeekDays } from "./calendar";
import { smallSlots } from "./slots";
import { createScheduleViewModelHelpers } from "./viewModels";
import type { CalendarResult, ScheduleCourse, ScheduleResult, WeekCourseBlock } from "./types";

/** 每人一种颜色，和服务端的 COUPLE_COLORS 一致。 */
export const COUPLE_COLORS = ["blue", "pink", "purple", "teal", "green", "amber", "orange"] as const;
export type CoupleColor = (typeof COUPLE_COLORS)[number];
export const COUPLE_COLOR_NAMES: Record<CoupleColor, string> = {
  blue: "蓝", pink: "粉", purple: "紫", teal: "青", green: "绿", amber: "黄", orange: "橙",
};

export interface CoupleScheduleSnapshot {
  semester: string;
  syncedAt: string;
  changedAt: string;
  schedule: ScheduleResult;
  calendar: CalendarResult;
}

export interface SlotTime {
  no: number;
  start: string;
  end: string;
}

export interface TimedCourse {
  course: ScheduleCourse;
  startSlot: number;
  endSlot: number;
  start: string;
  end: string;
}

export type CoupleNowStatus =
  | { kind: "no-data" }
  | { kind: "out-of-term" }
  | { kind: "in-class"; current: TimedCourse; next: TimedCourse | null }
  | { kind: "between"; next: TimedCourse; doneCount: number }
  | { kind: "done"; doneCount: number }
  | { kind: "free-day" };

export function periodsFor(calendar: CalendarResult | null | undefined): SlotTime[] {
  const configured = calendar?.periods;
  return configured?.length
    ? configured.map((item) => ({ no: item.id, start: item.start, end: item.end }))
    : smallSlots;
}

export function toMinutes(value: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/u);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

/** 北京时间的日期和当天分钟数，与课表使用的时区一致。 */
export function chinaClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    ymd: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function weekNumberForDate(calendar: CalendarResult | null | undefined, ymd: string) {
  for (const week of calendar?.weeks ?? []) {
    if (normalizeCalendarWeekDays(week.days).includes(ymd)) return week.week;
  }
  return null;
}

/** 为一份快照建立按日期查询课程块的函数；同一周的结果会被缓存。 */
export function createSnapshotDayReader(snapshot: CoupleScheduleSnapshot | null) {
  const cache = new Map<number, WeekCourseBlock[]>();
  const edits = emptyScheduleEdits();
  const helpers = createScheduleViewModelHelpers({
    calendar: () => snapshot?.calendar ?? null,
    parsed: () => snapshot?.schedule ?? null,
    weeks: () => (snapshot?.calendar.weeks ?? []).map((week) => ({ value: week.week })),
    scheduleEdits: () => edits,
    activeDay: () => 1,
    currentWeekValue: () => "",
    scheduleForWeek: () => snapshot?.schedule ?? null,
    allKnownScheduleSources: () => (snapshot?.schedule ? [snapshot.schedule] : []),
  });
  const periods = periodsFor(snapshot?.calendar);
  const periodMap = new Map(periods.map((item) => [item.no, item]));

  function blocksForDate(ymd: string): WeekCourseBlock[] | null {
    if (!snapshot) return null;
    const week = weekNumberForDate(snapshot.calendar, ymd);
    if (!week) return null;
    let blocks = cache.get(week);
    if (!blocks) {
      blocks = helpers.weekCourseBlocksFor(week, snapshot.schedule);
      cache.set(week, blocks);
    }
    const day = dayOfWeekForCalendarYmd(ymd);
    return blocks.filter((block) => block.day === day);
  }

  function timedCoursesForDate(ymd: string): TimedCourse[] | null {
    const blocks = blocksForDate(ymd);
    if (!blocks) return null;
    return blocks
      .map((block) => ({
        course: block.course,
        startSlot: block.startSlot,
        endSlot: block.endSlot,
        start: block.course.customStartTime?.trim() || periodMap.get(block.startSlot)?.start || "",
        end: block.course.customEndTime?.trim() || periodMap.get(block.endSlot)?.end || "",
      }))
      .sort((a, b) => a.start.localeCompare(b.start) || a.startSlot - b.startSlot);
  }

  return { blocksForDate, timedCoursesForDate, periods };
}

export function describeNow(snapshot: CoupleScheduleSnapshot | null, now: Date): CoupleNowStatus {
  if (!snapshot) return { kind: "no-data" };
  const clock = chinaClock(now);
  const courses = createSnapshotDayReader(snapshot).timedCoursesForDate(clock.ymd);
  if (!courses) return { kind: "out-of-term" };
  if (!courses.length) return { kind: "free-day" };
  const current = courses.find((item) => toMinutes(item.start) <= clock.minutes && clock.minutes < toMinutes(item.end));
  const upcoming = courses.filter((item) => toMinutes(item.start) > clock.minutes);
  const doneCount = courses.filter((item) => toMinutes(item.end) <= clock.minutes).length;
  if (current) return { kind: "in-class", current, next: upcoming.find((item) => item !== current) ?? null };
  if (upcoming.length) return { kind: "between", next: upcoming[0], doneCount };
  return { kind: "done", doneCount };
}

export function daysTogether(anniversary: string | null | undefined, todayYmd: string) {
  if (!anniversary || !/^\d{4}-\d{2}-\d{2}$/u.test(anniversary)) return null;
  const start = Date.parse(`${anniversary}T00:00:00Z`);
  const today = Date.parse(`${todayYmd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null;
  return Math.round((today - start) / 86_400_000) + 1;
}

/** 课表内容指纹：用于判断快照是否变化，从而跳过重复上传。 */
export function snapshotFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

const COUPLE_COLOR_FAMILIES: Record<CoupleColor, { hue: number; spread: number }> = {
  blue: { hue: 214, spread: 14 },
  pink: { hue: 338, spread: 10 },
  purple: { hue: 268, spread: 12 },
  teal: { hue: 178, spread: 10 },
  green: { hue: 138, spread: 12 },
  amber: { hue: 42, spread: 8 },
  orange: { hue: 22, spread: 8 },
};

function nameHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * 双人模式按人配色：同一个人的课都在一个色系里，课程之间只在色相和明暗上
 * 稍有差别，方便一眼分清是谁的课，又能区分相邻的两门课。
 */
export function coupleCourseTone(color: CoupleColor, name: string, dark: boolean) {
  const family = COUPLE_COLOR_FAMILIES[color] ?? COUPLE_COLOR_FAMILIES.blue;
  const hash = nameHash(name);
  const hue = Math.round(family.hue + ((hash % 5) - 2) * (family.spread / 2));
  const shift = ((hash >>> 4) % 3) - 1;
  return dark
    ? { bg: `hsl(${hue} 48% ${29 + shift * 3}%)`, border: `hsl(${hue} 62% ${50 + shift * 3}%)`, text: "#f5f7ff" }
    : { bg: `hsl(${hue} 88% ${93 - shift * 2}%)`, border: `hsl(${hue} 72% ${77 - shift * 3}%)`, text: `hsl(${hue} 58% 27%)` };
}

/** 一个人的颜色：这个人所有的课都用它，不按课程名再变化。 */
export function couplePersonTone(color: CoupleColor, dark: boolean) {
  const hue = (COUPLE_COLOR_FAMILIES[color] ?? COUPLE_COLOR_FAMILIES.blue).hue;
  return dark
    ? { bg: `hsl(${hue} 48% 29%)`, border: `hsl(${hue} 62% 50%)`, text: "#f5f7ff" }
    : { bg: `hsl(${hue} 88% 93%)`, border: `hsl(${hue} 72% 77%)`, text: `hsl(${hue} 58% 27%)` };
}
