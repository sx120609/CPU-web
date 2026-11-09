import { courseEditKey, customCourseWeeksLabel, type EditableScheduleCell, type EditableScheduleCourse } from "./scheduleEdits";
import { normalizedCourseWeekList } from "./scheduleWeeks";

/**
 * One meeting of a course changed on its own: 这次停课, or 调整这一次 (another
 * date, other periods or another room). The rest of the semester is untouched.
 *
 * `key` is the course's edit key (`courseEditKey`: `jwxt|…`, or `custom:<id>`
 * for a course the user made or edited) and `date` the day it was meant to be
 * held. Saved with the schedule edits, so every client of the account sees it.
 */
export interface ScheduleOccurrenceChange {
  key: string;
  /** YYYY-MM-DD, the original meeting. */
  date: string;
  cancelled?: boolean;
  /** YYYY-MM-DD; with no date, the meeting stays on `date`. */
  toDate?: string;
  startSlot?: number;
  endSlot?: number;
  location?: string;
  note?: string;
}

/** A course shown in place of a meeting that was moved; `occurrenceKey` and `occurrenceFrom` name that meeting. */
export interface MovedScheduleCourse extends EditableScheduleCourse {
  occurrenceKey?: string;
  occurrenceFrom?: string;
  nativeId?: string;
}

export const MAX_OCCURRENCE_CHANGES = 400;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function slot(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 48 ? number : undefined;
}

/**
 * Drops what cannot be applied and keeps one change per meeting (the last one
 * listed). A change that moves nothing and cancels nothing is no change.
 */
export function normalizeOccurrenceChanges(input: unknown): ScheduleOccurrenceChange[] {
  if (!Array.isArray(input)) return [];
  const byMeeting = new Map<string, ScheduleOccurrenceChange>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key || key.length > 180 || !validDate(item.date)) continue;
    const change: ScheduleOccurrenceChange = { key, date: item.date };
    if (item.cancelled === true) {
      change.cancelled = true;
    } else {
      if (validDate(item.toDate) && item.toDate !== item.date) change.toDate = item.toDate;
      const start = slot(item.startSlot);
      const end = slot(item.endSlot);
      if (start && end && end >= start) {
        change.startSlot = start;
        change.endSlot = end;
      }
      const location = typeof item.location === "string" ? item.location.trim().slice(0, 60) : "";
      if (location) change.location = location;
    }
    const note = typeof item.note === "string" ? item.note.trim().slice(0, 80) : "";
    if (note) change.note = note;
    // Neither cancelled nor moved, and nothing to say about it: no change.
    if (!change.cancelled && !change.toDate && !change.startSlot && !change.location && !change.note) continue;
    byMeeting.delete(`${key}@${item.date}`);
    byMeeting.set(`${key}@${item.date}`, change);
  }
  return [...byMeeting.values()].slice(-MAX_OCCURRENCE_CHANGES);
}

type CalendarWeek = { week: number; monday: string };

/** Week number and weekday (1 = Monday) of a date, from the term's Mondays. */
export function weekdayOf(date: string, weeks: readonly CalendarWeek[]) {
  if (!validDate(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  for (const week of weeks) {
    if (!validDate(week.monday)) continue;
    const offset = Math.round((time - Date.parse(`${week.monday}T00:00:00Z`)) / 86_400_000);
    if (offset >= 0 && offset < 7) return { week: week.week, day: offset + 1 };
  }
  return null;
}

/**
 * The timetable with each changed meeting taken out of its week, and a moved
 * one added on its new date as a one-week course. Run after the schedule edits
 * (`applyScheduleEditsToCells`), so an edited course is matched as its copy.
 *
 * Cells hold weekly courses, so a single meeting is expressed through weeks:
 * the course's week list loses the week of `date`. Everything that reads the
 * timetable (widgets, Live Activities, the watch, calendar files) then follows
 * the change without knowing about it.
 */
export function applyOccurrenceChanges<T extends EditableScheduleCell>(
  cells: T[],
  changes: readonly ScheduleOccurrenceChange[] | undefined,
  weeks: readonly CalendarWeek[] | undefined,
): T[] {
  if (!changes?.length || !weeks?.length) return cells;
  const allWeeks = [...new Set(weeks.map((week) => week.week).filter((week) => week > 0))].sort((a, b) => a - b);
  const next = cells.map((cell) => ({ ...cell, courses: cell.courses.map((course) => ({ ...course })) }));
  const added: Array<{ day: number; bigSlot: number; course: MovedScheduleCourse }> = [];
  const emptied = new Set<EditableScheduleCourse>();

  for (const change of changes) {
    const source = weekdayOf(change.date, weeks);
    if (!source) continue;
    let original: EditableScheduleCourse | undefined;
    let originalBigSlot = 0;
    for (const cell of next) {
      if (cell.day !== source.day) continue;
      for (const course of cell.courses) {
        if (courseEditKey(cell.day, cell.bigSlot, course) !== change.key) continue;
        const listed = normalizedCourseWeekList(course);
        const runs = listed.length ? listed : allWeeks;
        if (!runs.includes(source.week)) continue;
        original ??= { ...course, weekList: [source.week] };
        originalBigSlot ||= cell.bigSlot;
        // The week text is what every client reads first, so both change; the
        // original text stays behind for the edit key. An empty list means
        // every week, so a course whose only week this was goes.
        course.weekList = runs.filter((week) => week !== source.week);
        course.sourceWeeks ??= course.weeks;
        course.weeks = customCourseWeeksLabel(course.weekList);
        if (!course.weekList.length) emptied.add(course);
      }
      cell.courses = cell.courses.filter((course) => !emptied.has(course));
    }
    if (!original || change.cancelled) continue;
    const target = change.toDate ? weekdayOf(change.toDate, weeks) : source;
    if (!target) continue;
    const start = change.startSlot ?? original.startSlot ?? originalBigSlot * 2 - 1;
    const end = change.endSlot ?? original.endSlot ?? Math.max(start, originalBigSlot * 2);
    const moved: MovedScheduleCourse = {
      ...original,
      weekList: [target.week],
      weeks: `第 ${target.week} 周`,
      startSlot: start,
      endSlot: end,
      location: change.location ?? original.location,
      slotNote: change.note ?? original.slotNote,
      occurrenceKey: change.key,
      occurrenceFrom: change.date,
      // Its own identity: not the course it came from, which still runs other weeks.
      nativeId: `occ:${change.key}@${change.date}`,
    };
    delete moved.customId;
    delete moved.sourceKey;
    delete moved.custom;
    delete moved.orphaned;
    delete moved.sourceWeeks;
    added.push({ day: target.day, bigSlot: Math.max(1, Math.ceil(start / 2)), course: moved });
  }

  for (const item of added) {
    const cell = next.find((candidate) => candidate.day === item.day && candidate.bigSlot === item.bigSlot);
    if (cell) cell.courses.push(item.course);
    else next.push({ day: item.day, bigSlot: item.bigSlot, courses: [item.course] } as T);
  }
  return next.filter((cell) => cell.courses.length);
}
