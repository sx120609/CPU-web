import { courseMatchesWeek, normalizedCourseWeekList } from "@/utils/scheduleWeeks";
import type {
  CalendarResult,
  OfficialSemesterCalendar,
  ScheduleResult,
  SemesterDescriptor,
} from "./types";

const OFFICIAL_GRADUATE_SEMESTER_CALENDARS: Record<string, OfficialSemesterCalendar> = {
  "2025-2026学年一学期": { start: "2025-09-01", end: "2026-01-18", weeks: 20 },
  "2025-2026学年二学期": { start: "2026-03-02", end: "2026-07-05", weeks: 18 },
  "2024-2025学年一学期": { start: "2024-09-02", end: "2025-01-19", weeks: 20 },
  "2024-2025学年二学期": { start: "2025-02-24", end: "2025-07-06", weeks: 19 },
  "2023-2024学年一学期": { start: "2023-09-04", end: "2024-01-14", weeks: 19 },
  "2023-2024学年二学期": { start: "2024-02-26", end: "2024-07-07", weeks: 19 },
};

export function chinaTodayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    ymd: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

export function dayOfWeek() {
  const today = chinaTodayParts();
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function todayKey() {
  return chinaTodayParts().ymd;
}

export function shortDate(value: string) {
  const m = value.match(/-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

export function formatYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysToCalendarYmd(ymd: string, days: number): string {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function plusOneDay(ymd: string): string {
  return addDaysToCalendarYmd(ymd, 1);
}

export function dayOfWeekForCalendarYmd(ymd: string) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

export function normalizeCalendarWeekDays(days: string[]) {
  const raw = (days ?? []).map((item) => String(item || "").trim());
  if (raw.length >= 7 && dayOfWeekForCalendarYmd(raw[0]) === 7 && dayOfWeekForCalendarYmd(raw[1]) === 1) {
    return [...raw.slice(1, 7), plusOneDay(raw[6])];
  }

  const normalized = Array.from({ length: 7 }, () => "");
  for (const date of raw) {
    const day = dayOfWeekForCalendarYmd(date);
    if (day >= 1 && day <= 7) normalized[day - 1] = date;
  }
  return normalized.some(Boolean) ? normalized : raw;
}

export function normalizeSemesterLabel(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/第一学期/g, "一学期")
    .replace(/第二学期/g, "二学期")
    .trim();
}

export function officialGraduateSemesterCalendarFor(value: string) {
  return OFFICIAL_GRADUATE_SEMESTER_CALENDARS[normalizeSemesterLabel(value)] ?? null;
}

export function parseSemesterDescriptor(value: string): SemesterDescriptor | null {
  const normalized = String(value || "").trim();
  const match = normalized.match(/(\d{4})-(\d{4})/);
  if (!match) return null;
  const season = /第一学期|第1学期|1学期|一学期|秋学期|秋/.test(normalized)
    ? "first"
    : /第二学期|第2学期|2学期|二学期|春学期|春/.test(normalized)
      ? "second"
      : null;
  if (!season) return null;
  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
    season,
  };
}

export function inferSemesterDescriptorFromToday(): SemesterDescriptor {
  const today = chinaTodayParts();
  if (today.month >= 9) {
    return { startYear: today.year, endYear: today.year + 1, season: "first" };
  }
  if (today.month === 1) {
    return { startYear: today.year - 1, endYear: today.year, season: "first" };
  }
  return { startYear: today.year - 1, endYear: today.year, season: "second" };
}

export function semesterAnchorMonday(descriptor: SemesterDescriptor) {
  const anchor = descriptor.season === "first"
    ? formatYmd(descriptor.startYear, 9, 1)
    : formatYmd(descriptor.endYear, 3, 1);
  const day = dayOfWeekForCalendarYmd(anchor);
  return day ? addDaysToCalendarYmd(anchor, 1 - day) : anchor;
}

export function scheduleWeekCount(data: ScheduleResult | null) {
  const maxFromOptions = Math.max(
    0,
    ...(data?.weeks ?? []).map((item) => Number(item.value) || 0),
  );
  const maxFromCourses = Math.max(
    0,
    ...(data?.cells ?? []).flatMap((cell) => cell.courses.flatMap((course) => normalizedCourseWeekList(course))),
  );
  return Math.max(1, maxFromOptions, maxFromCourses, Number(data?.currentWeek || 0) || 0);
}

export function extendScheduleWeeksToCalendar(data: ScheduleResult | null, source: CalendarResult | null) {
  if (!data || !source?.weeks?.length) return data;
  const totalWeeks = Math.max(scheduleWeekCount(data), source.weeks.length);
  const weeks = Array.from({ length: totalWeeks }, (_, index) => {
    const value = String(index + 1);
    return {
      value,
      label: `第 ${value} 周`,
      current: value === String(source.currentWeek || data.currentWeek || ""),
    };
  });
  return {
    ...data,
    weeks,
  };
}

export function buildGraduateFallbackCalendar(data: ScheduleResult | null): CalendarResult | null {
  if (!data) return null;
  const officialCalendar = officialGraduateSemesterCalendarFor(data.currentSemester);
  const descriptor = parseSemesterDescriptor(data.currentSemester) ?? inferSemesterDescriptorFromToday();
  const semesterStart = officialCalendar?.start || semesterAnchorMonday(descriptor);
  const totalWeeks = Math.max(scheduleWeekCount(data), officialCalendar?.weeks || 0);
  const weeks = Array.from({ length: totalWeeks }, (_, index) => {
    const monday = addDaysToCalendarYmd(semesterStart, index * 7);
    const days = Array.from({ length: 7 }, (_, offset) => addDaysToCalendarYmd(monday, offset));
    return {
      week: index + 1,
      days,
      monday,
      sunday: days[6] || monday,
    };
  });
  const today = todayKey();
  const currentWeekByDate = weeks.find((item) => item.days.includes(today))?.week ?? 0;
  return {
    currentWeek: currentWeekByDate || 0,
    semesterStart,
    semesterEnd: officialCalendar?.end || weeks[weeks.length - 1]?.sunday || semesterStart,
    weeks,
  };
}

export function resolveCalendarCurrentWeek(source: CalendarResult | null | undefined) {
  if (!source?.weeks?.length) return source?.currentWeek ?? 0;
  const today = todayKey();
  const matched = source.weeks.find((item) => normalizeCalendarWeekDays(item.days).includes(today));
  return matched?.week ?? source.currentWeek ?? 0;
}

export function hydrateCalendar(source: CalendarResult | null | undefined): CalendarResult | null {
  if (!source) return null;
  return {
    ...source,
    currentWeek: resolveCalendarCurrentWeek(source),
  };
}

export function pickFirstCourseDay(data: ScheduleResult | null, weekValue: number) {
  if (!data) return 1;
  const courseDays = data.cells
    .filter((cell) => cell.courses.some((course) => courseMatchesWeek(course, weekValue)))
    .map((cell) => cell.day)
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b);
  return courseDays[0] || 1;
}

export function resolveGraduateInitialWeek(data: ScheduleResult | null, fallbackCalendar: CalendarResult | null) {
  const weekValues = new Set((data?.weeks ?? []).map((item) => String(item.value || "")));
  const currentByDate = String(fallbackCalendar?.currentWeek || "");
  if (currentByDate && weekValues.has(currentByDate)) return currentByDate;
  const currentBySchedule = String(data?.currentWeek || "");
  if (currentBySchedule && weekValues.has(currentBySchedule)) return currentBySchedule;
  return String(data?.weeks?.find((item) => item.current)?.value || data?.weeks?.[0]?.value || currentByDate || "");
}

export function resolveGraduateActiveDay(
  data: ScheduleResult | null,
  weekValue: string,
  fallbackCalendar: CalendarResult | null,
) {
  const weekNumber = Number(weekValue || 0);
  if (weekNumber && weekNumber === Number(fallbackCalendar?.currentWeek || 0)) return dayOfWeek();
  return pickFirstCourseDay(data, weekNumber);
}

export function formatCacheTime(ts: number) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
