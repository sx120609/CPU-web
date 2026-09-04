import { normalizedCourseWeekList } from "../../utils/scheduleWeeks";
import { normalizeSlotRange } from "./slots";
import type { ScheduleCourse, ScheduleResult } from "./types";

export interface OfficialScheduleChange {
  semester: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  changedCount: number;
}

const NOTICE_KEY_PREFIX = "cpu-jwxt-schedule-update-notice-v1";

export function detectOfficialScheduleChange(
  previous: ScheduleResult | null | undefined,
  next: ScheduleResult | null | undefined,
): OfficialScheduleChange | null {
  if (!previous || !next) return null;
  const previousSemester = normalizeText(previous.currentSemester);
  const nextSemester = normalizeText(next.currentSemester);
  if (previousSemester && nextSemester && previousSemester !== nextSemester) return null;

  const beforeEntries = canonicalScheduleEntries(previous);
  const afterEntries = canonicalScheduleEntries(next);
  const beforeFingerprint = fingerprintEntries(beforeEntries);
  const afterFingerprint = fingerprintEntries(afterEntries);
  if (beforeFingerprint === afterFingerprint) return null;

  const beforeCounts = entryCounts(beforeEntries);
  const afterCounts = entryCounts(afterEntries);
  let added = 0;
  let removed = 0;
  for (const [entry, count] of afterCounts) {
    added += Math.max(0, count - (beforeCounts.get(entry) ?? 0));
  }
  for (const [entry, count] of beforeCounts) {
    removed += Math.max(0, count - (afterCounts.get(entry) ?? 0));
  }

  return {
    semester: nextSemester || previousSemester || "current",
    beforeFingerprint,
    afterFingerprint,
    changedCount: Math.max(added, removed),
  };
}

export function claimOfficialScheduleChangeNotice(change: OfficialScheduleChange) {
  if (typeof localStorage === "undefined") return true;
  const key = `${NOTICE_KEY_PREFIX}:${change.semester}`;
  const transition = `${change.beforeFingerprint}>${change.afterFingerprint}`;
  try {
    if (localStorage.getItem(key) === transition) return false;
    localStorage.setItem(key, transition);
  } catch {
    return true;
  }
  return true;
}

function canonicalScheduleEntries(schedule: ScheduleResult) {
  const allWeeks = schedule.weeks
    .map((item) => Number(item.value))
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b);
  const entries: string[] = [];
  for (const cell of schedule.cells ?? []) {
    for (const course of cell.courses ?? []) {
      const range = normalizeSlotRange(cell.bigSlot, course);
      entries.push(JSON.stringify([
        cell.day,
        range.start,
        range.end,
        normalizeText(course.name),
        normalizeText(course.teacher),
        normalizeText(course.location),
        canonicalWeeks(course, allWeeks),
        canonicalNote(course.slotNote),
      ]));
    }
  }
  return entries.sort();
}

function canonicalWeeks(course: ScheduleCourse, allWeeks: number[]) {
  const weeks = normalizedCourseWeekList(course);
  if (!weeks.length) return "all";
  if (allWeeks.length === weeks.length && allWeeks.every((week, index) => week === weeks[index])) return "all";
  return weeks.join(",");
}

function canonicalNote(value?: string) {
  const note = normalizeText(value);
  return /^(?:第\s*)?\d+\s*(?:-\s*\d+)?\s*节$/u.test(note) ? "" : note;
}

function entryCounts(entries: string[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

function fingerprintEntries(entries: string[]) {
  const source = entries.join("\n");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${entries.length}-${(hash >>> 0).toString(36)}`;
}

function normalizeText(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
