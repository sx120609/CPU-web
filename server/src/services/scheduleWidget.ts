import { normalizeCalendarWeekDays } from "./jwxtParser";

export const SCHEDULE_WIDGET_PAYLOAD_VERSION = 7;

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

function normalizeWeekText(text?: string | null) {
  return String(text ?? "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－–—~～]/g, "-")
    .replace(/第/g, "")
    .replace(/\s+/g, "");
}

function parseWeekKind(text: string): "all" | "odd" | "even" {
  if (/单双周/.test(text)) return "all";
  if (/单周|\(单\)|[^双]单/.test(text)) return "odd";
  if (/双周|\(双\)|双/.test(text)) return "even";
  return "all";
}

export function parseScheduleWidgetWeeks(text?: string | null) {
  const source = normalizeWeekText(text);
  if (!source) return [] as number[];
  const out = new Set<number>();
  const clauses = source.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);

  for (const clause of clauses.length ? clauses : [source]) {
    const kind = parseWeekKind(clause);
    const matches = [...clause.matchAll(/(\d{1,2})\s*(?:[-~至到]\s*(\d{1,2}))?/g)];
    for (const match of matches) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(64, Math.max(start, end));
      for (let week = min; week <= max; week += 1) {
        if (kind === "odd" && week % 2 === 0) continue;
        if (kind === "even" && week % 2 === 1) continue;
        out.add(week);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

function normalizedCourseWeekList(course: any) {
  const parsed = parseScheduleWidgetWeeks(course?.weeks);
  if (parsed.length) return parsed;
  return Array.isArray(course?.weekList)
    ? [...new Set<number>(course.weekList.map(Number).filter((week: number) => Number.isFinite(week) && week > 0))]
      .sort((a, b) => a - b)
    : [];
}

function courseMatchesWeek(course: any, week: number) {
  if (!week) return false;
  const list = normalizedCourseWeekList(course);
  return list.length ? list.includes(week) : true;
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

function semesterAnchorMonday(semester: string) {
  const match = String(semester || "").match(/^(\d{4})-(\d{4})-(1|2)$/);
  if (!match) return "";
  const anchor = match[3] === "1"
    ? `${match[1]}-09-01`
    : `${match[2]}-03-01`;
  const day = dayOfWeekForYmd(anchor);
  return day ? addDaysToYmd(anchor, 1 - day) : "";
}

export function inferScheduleWidgetSemester(now = new Date(), previewDays = 2) {
  const target = addDaysToYmd(chinaDateParts(now).ymd, Math.max(0, previewDays));
  const year = Number(target.slice(0, 4));
  if (!Number.isFinite(year)) return "";
  const fallSemester = `${year}-${year + 1}-1`;
  if (target >= semesterAnchorMonday(fallSemester)) return fallSemester;
  const springSemester = `${year - 1}-${year}-2`;
  if (target >= semesterAnchorMonday(springSemester)) return springSemester;
  return `${year - 1}-${year}-1`;
}

function scheduleWeekCount(parsed: any) {
  const optionMax = Math.max(0, ...(parsed?.weeks ?? []).map((item: any) => Number(item?.value) || 0));
  const courseMax = Math.max(0, ...(parsed?.cells ?? [])
    .flatMap((cell: any) => (cell?.courses ?? []).flatMap((course: any) => normalizedCourseWeekList(course))));
  return Math.max(20, optionMax, courseMax);
}

export function resolveScheduleWidgetCalendar(calendar: any | null, parsed: any, now = new Date()) {
  const semester = String(parsed?.currentSemester || "").trim();
  const anchorMonday = semesterAnchorMonday(semester);
  const today = chinaDateParts(now).ymd;
  const calendarWeekOne = normalizeCalendarWeekDays(
    (calendar?.weeks ?? []).find((item: any) => Number(item?.week) === 1)?.days ?? [],
  )[0] || "";
  const sameSemester = semester && String(calendar?.currentSemester || "").trim() === semester;
  const containsToday = (calendar?.weeks ?? []).some((item: any) => (
    normalizeCalendarWeekDays(item?.days ?? []).includes(today)
  ));
  if (calendar?.weeks?.length && (sameSemester || containsToday || (anchorMonday && calendarWeekOne === anchorMonday))) {
    return calendar;
  }
  if (!anchorMonday) return calendar;

  const weeks = Array.from({ length: scheduleWeekCount(parsed) }, (_, index) => {
    const monday = addDaysToYmd(anchorMonday, index * 7);
    const days = Array.from({ length: 7 }, (_, offset) => addDaysToYmd(monday, offset));
    return { week: index + 1, days, monday, sunday: days[6] };
  });
  return {
    currentSemester: semester,
    semesterStart: anchorMonday,
    semesterEnd: weeks[weeks.length - 1]?.sunday || anchorMonday,
    currentWeek: weeks.find((item) => item.days.includes(today))?.week ?? 0,
    today,
    weeks,
  };
}

export function resolveScheduleWidgetPreviewWeeks(calendar: any | null, queryWeek = "", now = new Date()) {
  if (Number(queryWeek) > 0) return [] as number[];
  const today = chinaDateParts(now);
  const currentWeek = calendarWeekForDate(calendar, today.ymd).week;
  return [...new Set([1, 2]
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
  const effectiveCalendar = resolveScheduleWidgetCalendar(calendar, parsed, now);
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
    for (const offset of [1, 2]) {
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
  }
  const upcoming = visibleCourses.filter((course) => course.day === activeDay);

  return {
    title: "药大课表",
    generatedAt: now.toISOString(),
    semester: parsed?.currentSemester || "",
    week,
    currentWeek: calendarToday.week,
    teachingWeekActive,
    today: days[activeDay - 1],
    days,
    upcoming: upcoming.slice(0, 6),
    strictDate: true,
    payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION,
  };
}
