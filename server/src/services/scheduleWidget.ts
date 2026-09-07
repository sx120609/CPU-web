import { normalizeCalendarWeekDays } from "./jwxtParser";
import { courseMatchesWeek, normalizedCourseWeekList } from "../shared/scheduleWeeks";
export { parseWeekText as parseScheduleWidgetWeeks } from "../shared/scheduleWeeks";

export const SCHEDULE_WIDGET_PAYLOAD_VERSION = 11;

export function isScheduleWidgetCredentialActive<T extends { revokedAt?: Date | null }>(
  record: T | null | undefined,
): record is T {
  return Boolean(record && !record.revokedAt);
}

export function scheduleWidgetCredentialRefreshData(jwxtToken: string) {
  return {
    jwxtToken,
    expiresAt: null,
  };
}

export function parseScheduleWidgetCache(payload?: string | null) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as any).strictDate !== true) return null;
    if ((parsed as any).payloadVersion !== SCHEDULE_WIDGET_PAYLOAD_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function scheduleWidgetFallbackPayload(payload?: string | null, requestedWeek = "", now = new Date()) {
  const parsed = parseScheduleWidgetCache(payload);
  if (!parsed || String(parsed.requestedWeek || "") !== String(requestedWeek || "").trim()) return null;
  const candidates = [...(Array.isArray(parsed.weekDays) ? parsed.weekDays : []), ...(Array.isArray(parsed.days) ? parsed.days : [])];
  const known = new Map<string, any>();
  for (const item of candidates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item?.date || "") || !Array.isArray(item?.courses)) continue;
    const day = dayOfWeekForYmd(item.date);
    if (!day || addDaysToYmd(item.date, 0) !== item.date || (item.day && item.day !== day)) continue;
    if (item.courses.some((course: any) => course?.date && course.date !== item.date)) continue;
    if (!known.has(item.date)) known.set(item.date, { ...item, day, label: `${dayLabel(day)}·缓存`, isToday: false });
  }
  if (requestedWeek) {
    const weekDays = [...known.values()].filter((item) => Number(item.week) === Number(requestedWeek)).sort((a, b) => a.date.localeCompare(b.date));
    if (weekDays.length !== 7 || weekDays.some((item, index) => item.day !== index + 1 || item.date !== addDaysToYmd(weekDays[0].date, index))) return null;
    return { ...parsed, days: weekDays, weekDays, today: weekDays[0], upcoming: weekDays[0].courses.slice(0, 6), stale: true };
  }
  const today = chinaDateParts(now).ymd;
  const current = known.get(today);
  if (!current) return null;
  const remaining = (item: any) => item.courses.filter((course: WidgetCourse) => !course.endTime || courseEndMinutes(course) >= chinaMinutes(now));
  let selectedDate = remaining(current).length ? today : "";
  let completeWindow = true;
  for (let offset = 1; offset <= 7; offset++) {
    const date = addDaysToYmd(today, offset);
    const item = known.get(date);
    if (!item) { completeWindow = false; break; }
    if (!selectedDate && item.courses.length) selectedDate = date;
  }
  // 旧版两日组件会展示所选课程日和次日；未知日期不能冒充“没有课程”。
  if (!selectedDate && !completeWindow) return null;
  if (!known.has(addDaysToYmd(selectedDate || today, 1))) return null;
  const monday = addDaysToYmd(today, 1 - current.day);
  const weekDays = [...known.values()].filter((item) => item.date >= monday && item.date <= addDaysToYmd(monday, 6)).sort((a, b) => a.date.localeCompare(b.date));
  weekDays.forEach((item) => { item.isToday = item.date === today; });
  const days = [...known.values()].sort((a, b) => a.date.localeCompare(b.date)).map((item) => ({
    ...item, isToday: item.date === today, courses: item.date === today ? remaining(item) : item.courses,
  }));
  const active = days.find((item) => item.date === today)!;
  return {
    ...parsed,
    week: Number(current.week) || 0,
    currentWeek: Number(current.week) || 0,
    displayWeek: Number(current.week) || 0,
    teachingWeekActive: Number(current.week) > 0,
    today: active,
    upcoming: active.courses.slice(0, 6),
    days,
    weekDays,
    stale: true,
  };
}

const SMALL_SLOTS = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
  { no: 5, start: "13:30", end: "14:15" },
  { no: 6, start: "14:25", end: "15:10" },
  { no: 7, start: "15:25", end: "16:10" },
  { no: 8, start: "16:20", end: "17:05" },
  { no: 9, start: "18:30", end: "19:15" },
  { no: 10, start: "19:25", end: "20:10" },
  { no: 11, start: "20:20", end: "21:05" },
];
const MAX_SMALL_SLOT = SMALL_SLOTS[SMALL_SLOTS.length - 1]?.no ?? 11;

type WidgetCourse = {
  day: number;
  dayLabel: string;
  date: string;
  startSlot: number;
  endSlot: number;
  startTime: string;
  endTime: string;
  name: string;
  teacher: string;
  location: string;
  note: string;
  custom: boolean;
};

function normalizeSlotRange(bigSlot: number, course: any) {
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const start = Number.isFinite(course?.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course?.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(MAX_SMALL_SLOT, start));
  const safeEnd = Math.max(safeStart, Math.min(MAX_SMALL_SLOT, end));
  return { start: safeStart, end: safeEnd };
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function chinaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return { year, month, day, ymd: `${value("year")}-${value("month")}-${value("day")}` };
}

function chinaDayOfWeek(parts: ReturnType<typeof chinaDateParts>) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function dayOfWeekForYmd(ymd: string) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDaysToYmd(ymd: string, days: number) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function currentCalendarWeekDays(todayYmd: string, todayDay: number) {
  const monday = addDaysToYmd(todayYmd, 1 - todayDay);
  return Array.from({ length: 7 }, (_, index) => addDaysToYmd(monday, index));
}

function calendarWeekForDate(calendar: any | null, ymd: string) {
  for (const item of calendar?.weeks ?? []) {
    const days = normalizeCalendarWeekDays(Array.isArray(item?.days) ? item.days : []);
    const index = days.indexOf(ymd);
    if (index >= 0) return { week: Number(item.week) || 0, day: index + 1, days };
  }
  return { week: 0, day: 0, days: [] as string[] };
}

export function resolveScheduleWidgetCalendar(calendar: any | null, parsed: any) {
  if (!calendar?.weeks?.length) return null;
  if (calendar.currentSemester && parsed?.currentSemester && calendar.currentSemester !== parsed.currentSemester) return null;
  return calendar;
}

export function resolveScheduleWidgetPreviewWeeks(calendar: any | null, queryWeek = "", now = new Date()) {
  if (Number(queryWeek) > 0) return [] as number[];
  const today = chinaDateParts(now);
  const currentWeek = calendarWeekForDate(calendar, today.ymd).week;
  return [...new Set(Array.from({ length: 7 }, (_, index) => index + 1)
    .map((offset) => calendarWeekForDate(calendar, addDaysToYmd(today.ymd, offset)).week)
    .filter((week) => week > 0 && week !== currentWeek))];
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function chinaMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function courseEndMinutes(course: WidgetCourse) {
  const [hour, minute] = String(course.endTime || "00:00").split(":").map(Number);
  return hour * 60 + minute;
}

function dedupeWidgetCourses(courses: WidgetCourse[]) {
  const seen = new Map<string, WidgetCourse>();
  for (const course of courses) {
    const key = [
      course.day,
      course.startSlot,
      course.endSlot,
      normalizeKeyPart(course.name),
      normalizeKeyPart(course.teacher),
      normalizeKeyPart(course.location),
    ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, course);
      continue;
    }
    if (!existing.note && course.note) existing.note = course.note;
  }
  return [...seen.values()];
}

function coursesForWeek(parsed: any, week: number, calendarDays: string[]) {
  if (week <= 0) return [] as WidgetCourse[];
  return dedupeWidgetCourses((parsed?.cells ?? [])
    .flatMap((cell: any) => (cell.courses ?? [])
      .filter((course: any) => courseMatchesWeek(course, week))
      .map((course: any) => {
        const range = normalizeSlotRange(cell.bigSlot, course);
        return {
          day: Number(cell.day),
          dayLabel: dayLabel(Number(cell.day)),
          date: calendarDays[Number(cell.day) - 1] || "",
          startSlot: range.start,
          endSlot: range.end,
          startTime: SMALL_SLOTS[range.start - 1]?.start ?? "",
          endTime: SMALL_SLOTS[range.end - 1]?.end ?? "",
          name: String(course.name || ""),
          teacher: course.teacher || "",
          location: course.location || "",
          note: course.slotNote || course.weeks || "",
          custom: Boolean(course.custom),
        } satisfies WidgetCourse;
      }))
    .sort((a: WidgetCourse, b: WidgetCourse) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot));
}

export function buildScheduleWidgetPayload(
  parsed: any,
  calendar: any | null,
  queryWeek = "",
  now = new Date(),
  schedulesByWeek: Record<number, any> = {},
) {
  const today = chinaDateParts(now);
  const todayDay = chinaDayOfWeek(today);
  const effectiveCalendar = resolveScheduleWidgetCalendar(calendar, parsed);
  const calendarToday = calendarWeekForDate(effectiveCalendar, today.ymd);
  const requestedWeek = Number(queryWeek || 0);
  const explicitWeek = Number.isFinite(requestedWeek) && requestedWeek > 0;
  const week = explicitWeek ? requestedWeek : calendarToday.week;
  const teachingWeekActive = calendarToday.week > 0;
  const activeDay = explicitWeek && requestedWeek !== calendarToday.week
    ? 1
    : (calendarToday.day || todayDay);
  const requestedCalendarDays = (effectiveCalendar?.weeks ?? []).find((item: any) => Number(item.week) === week)?.days ?? [];
  const normalizedRequestedDays = normalizeCalendarWeekDays(requestedCalendarDays);
  const calendarDays = normalizedRequestedDays.some(Boolean)
    ? normalizedRequestedDays
    : currentCalendarWeekDays(today.ymd, todayDay);
  const canExposeCourses = week > 0 && (explicitWeek || teachingWeekActive);

  const allCourses = canExposeCourses ? coursesForWeek(parsed, week, calendarDays) : [];

  const nowMinutes = chinaMinutes(now);
  const visibleCourses = allCourses.filter((course) => (
    explicitWeek
    || course.day !== activeDay
    || courseEndMinutes(course) >= nowMinutes
  ));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    return {
      day,
      label: dayLabel(day),
      date: calendarDays[index] || "",
      week,
      isToday: day === activeDay && !explicitWeek && calendarDays[index] === today.ymd,
      courses: visibleCourses.filter((course) => course.day === day),
    };
  });

  if (!explicitWeek) {
    for (const offset of Array.from({ length: 7 }, (_, index) => index + 1)) {
      const date = addDaysToYmd(today.ymd, offset);
      if (days.some((day) => day.date === date)) continue;
      const targetCalendar = calendarWeekForDate(effectiveCalendar, date);
      const targetDay = targetCalendar.day || dayOfWeekForYmd(date);
      const targetWeek = targetCalendar.week;
      const targetDays = targetCalendar.days.some(Boolean)
        ? targetCalendar.days
        : currentCalendarWeekDays(date, targetDay);
      const targetSchedule = schedulesByWeek[targetWeek] ?? parsed;
      const targetCourses = targetWeek > 0
        ? coursesForWeek(targetSchedule, targetWeek, targetDays).filter((course) => course.day === targetDay)
        : [];
      days.push({
        day: targetDay,
        label: dayLabel(targetDay),
        date,
        week: targetWeek,
        isToday: false,
        courses: targetCourses,
      });
    }
    // 预览周已经整周取回，保留这些真实日期，供跨午夜或离线时重新选日。
    for (const [previewWeek, previewSchedule] of Object.entries(schedulesByWeek)) {
      const weekNumber = Number(previewWeek);
      const dates = normalizeCalendarWeekDays((effectiveCalendar?.weeks ?? []).find((item: any) => Number(item.week) === weekNumber)?.days ?? []);
      if (dates.length !== 7 || dates.some((date) => !date)) continue;
      const courses = coursesForWeek(previewSchedule, weekNumber, dates);
      dates.forEach((date, index) => {
        if (!days.some((day) => day.date === date)) days.push({
          day: index + 1, label: dayLabel(index + 1), date, week: weekNumber, isToday: false,
          courses: courses.filter((course) => course.date === date),
        });
      });
    }
  }
  const displayWeek = week > 0
    ? week
    : (days.find((day) => Number(day.week) > 0)?.week ?? 0);
  const displayCalendarDays = normalizeCalendarWeekDays(
    (effectiveCalendar?.weeks ?? []).find((item: any) => Number(item.week) === displayWeek)?.days ?? [],
  );
  const displaySchedule = displayWeek === week
    ? parsed
    : (schedulesByWeek[displayWeek] ?? parsed);
  const displayCourses = displayWeek > 0
    ? coursesForWeek(displaySchedule, displayWeek, displayCalendarDays)
    : [];
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    return {
      day,
      label: dayLabel(day),
      date: displayCalendarDays[index] || "",
      week: displayWeek,
      isToday: displayCalendarDays[index] === today.ymd,
      courses: displayCourses.filter((course) => course.day === day),
    };
  });
  const upcoming = visibleCourses.filter((course) => course.day === activeDay);

  return {
    title: "药大课表",
    generatedAt: now.toISOString(),
    semester: parsed?.currentSemester || "",
    week,
    currentWeek: calendarToday.week,
    displayWeek,
    teachingWeekActive,
    today: days[activeDay - 1],
    days,
    weekDays,
    upcoming: upcoming.slice(0, 6),
    strictDate: true,
    payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION,
  };
}
