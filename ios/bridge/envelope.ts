import { normalizedCourseWeekList } from "../../server/src/shared/scheduleWeeks";
import { normalizeSlotRange, smallSlots } from "../../web/src/views/schedule/slots";
import { CAMPUS_TIME_ZONE, addDaysToCalendarYmd, normalizeCalendarWeekDays } from "../../web/src/views/schedule/calendar";
import type { CalendarResult, ScheduleResult } from "../../web/src/views/schedule/types";

export type NativeSnapshot = {
  version: number; fetchedAt: number; completeSemester: boolean;
  data: ScheduleResult; calendar: CalendarResult | null;
  auth: { authenticated: boolean }; error?: string;
};

/** Explicit whitelist: never serialize auth state, API envelopes or raw objects. */
export async function scheduleEnvelope(input: NativeSnapshot) {
  if (input.version !== 1 || !input.auth?.authenticated || input.error) throw new Error("invalid source");
  const { data, calendar } = input;
  if (!data?.currentSemester || !calendar?.weeks?.length || calendar.weeks.length > 64) throw new Error("missing calendar");
  if (calendar.currentSemester && calendar.currentSemester !== data.currentSemester) throw new Error("semester mismatch");
  const mapped = calendar.weeks.map(item => ({ week: Number(item.week), days: normalizeCalendarWeekDays(item.days) }))
    .sort((a, b) => a.week - b.week);
  const first = mapped[0];
  if (first.week !== 1 || !first.days[0]) throw new Error("missing first teaching week");
  for (let index = 0; index < mapped.length; index++) {
    if (mapped[index].week !== index + 1 || mapped[index].days.length !== 7
      || mapped[index].days.some((day, offset) => day !== addDaysToCalendarYmd(first.days[0], index * 7 + offset))) {
      throw new Error("non-contiguous calendar");
    }
  }
  const coveredWeeks = input.completeSemester ? mapped.map(item => item.week) : [Number(data.currentWeek)];
  if (!coveredWeeks.every(week => mapped.some(item => item.week === week))) throw new Error("unknown coverage");
  const courses = new Map<string, any>();
  for (const cell of data.cells) {
    for (const course of cell.courses) {
      const range = normalizeSlotRange(cell.bigSlot, course);
      const normalized = normalizedCourseWeekList(course);
      const weeks = (normalized.length ? normalized : coveredWeeks).filter(week => coveredWeeks.includes(week));
      if (!weeks.length) continue;
      const fields = {
        name: course.name, teacher: course.teacher ?? null, room: course.location ?? null,
        campus: (course as any).campus ?? null, weekday: cell.day,
        startPeriod: range.start, endPeriod: range.end,
        startTime: smallSlots[range.start - 1]?.start, endTime: smallSlots[range.end - 1]?.end,
      };
      const identity = JSON.stringify([data.currentSemester, course.customId ?? null, fields]);
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const id = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
      const previous = courses.get(id);
      courses.set(id, { id, ...fields, weeks: [...new Set([...(previous?.weeks ?? []), ...weeks])].sort((a, b) => a - b) });
    }
  }
  // fetchedAt remains the source age when a cached semester is reused.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CAMPUS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(input.fetchedAt));
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  const generatedDay = `${part("year")}-${part("month")}-${part("day")}`;
  return {
    schemaVersion: 1, messageType: "schedule.snapshot", generatedAt: input.fetchedAt,
    semester: { id: data.currentSemester, startDate: first.days[0],
      endDate: mapped[mapped.length - 1].days[6], weekCount: mapped.length },
    timezone: CAMPUS_TIME_ZONE, currentWeek: mapped.find(item => item.days.includes(generatedDay))?.week ?? 0,
    periods: smallSlots.map(slot => ({ number: slot.no, startTime: slot.start, endTime: slot.end })),
    coveredWeeks, courses: [...courses.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
