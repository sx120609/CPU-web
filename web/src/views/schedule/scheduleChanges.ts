import { normalizedCourseWeekList } from "../../utils/scheduleWeeks";
import { normalizeSlotRange } from "./slots";
import type { ScheduleCourse, ScheduleResult } from "./types";

export interface OfficialScheduleChange {
  semester: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  changedCount: number;
  details: OfficialScheduleChangeDetail[];
}

export interface OfficialScheduleChangeDetail {
  type: "changed" | "added" | "removed";
  text: string;
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

  const beforeEntries = scheduleEntries(previous);
  const afterEntries = scheduleEntries(next);
  const beforeFingerprint = fingerprintEntries(beforeEntries.map((entry) => entry.key));
  const afterFingerprint = fingerprintEntries(afterEntries.map((entry) => entry.key));
  if (beforeFingerprint === afterFingerprint) return null;
  const details = describeScheduleChanges(beforeEntries, afterEntries);

  return {
    semester: nextSemester || previousSemester || "current",
    beforeFingerprint,
    afterFingerprint,
    changedCount: details.length,
    details,
  };
}

export function claimOfficialScheduleChangeNotice(change: OfficialScheduleChange) {
  if (typeof localStorage === "undefined") return true;
  const key = `${NOTICE_KEY_PREFIX}:${change.semester}`;
  try {
    const seen = localStorage.getItem(key) || "";
    if (seen === change.afterFingerprint || seen.endsWith(`>${change.afterFingerprint}`)) return false;
    localStorage.setItem(key, change.afterFingerprint);
  } catch {
    return true;
  }
  return true;
}

interface ScheduleEntry {
  key: string;
  name: string;
  nameKey: string;
  teacher: string;
  teacherKey: string;
  location: string;
  locationKey: string;
  weeks: string;
  weeksKey: string;
  note: string;
  noteKey: string;
  day: number;
  startSlot: number;
  endSlot: number;
}

function scheduleEntries(schedule: ScheduleResult) {
  const allWeeks = schedule.weeks
    .map((item) => Number(item.value))
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b);
  const entries: ScheduleEntry[] = [];
  for (const cell of schedule.cells ?? []) {
    for (const course of cell.courses ?? []) {
      const range = normalizeSlotRange(cell.bigSlot, course);
      const name = normalizeText(course.name);
      const teacher = normalizeText(course.teacher);
      const location = normalizeText(course.location);
      const weeksKey = canonicalWeeks(course, allWeeks);
      const note = canonicalNote(course.slotNote);
      const entry: ScheduleEntry = {
        key: "",
        name,
        nameKey: normalizeKeyText(name),
        teacher,
        teacherKey: normalizeKeyText(teacher),
        location,
        locationKey: normalizeKeyText(location),
        weeks: displayWeeks(course, weeksKey),
        weeksKey,
        note,
        noteKey: normalizeKeyText(note),
        day: cell.day,
        startSlot: range.start,
        endSlot: range.end,
      };
      entry.key = JSON.stringify([
        entry.day,
        entry.startSlot,
        entry.endSlot,
        entry.nameKey,
        entry.teacherKey,
        entry.locationKey,
        entry.weeksKey,
        entry.noteKey,
      ]);
      entries.push(entry);
    }
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
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

function displayWeeks(course: ScheduleCourse, weeksKey: string) {
  const label = normalizeText(course.weeks);
  if (label) return label;
  return weeksKey === "all" ? "全部周" : `第 ${weeksKey.replace(/,/g, "、")} 周`;
}

function describeScheduleChanges(before: ScheduleEntry[], after: ScheduleEntry[]) {
  const remainingAfter = [...after];
  const remainingBefore: ScheduleEntry[] = [];
  for (const entry of before) {
    const exactIndex = remainingAfter.findIndex((candidate) => candidate.key === entry.key);
    if (exactIndex >= 0) remainingAfter.splice(exactIndex, 1);
    else remainingBefore.push(entry);
  }

  const details: OfficialScheduleChangeDetail[] = [];
  const removed: ScheduleEntry[] = [];
  for (const entry of remainingBefore) {
    const matchIndex = closestSameCourseIndex(entry, remainingAfter);
    if (matchIndex < 0) {
      removed.push(entry);
      continue;
    }
    const replacement = remainingAfter.splice(matchIndex, 1)[0];
    details.push({ type: "changed", text: describeChangedCourse(entry, replacement) });
  }
  for (const entry of remainingAfter) {
    details.push({ type: "added", text: `新增：${describeCourse(entry)}` });
  }
  for (const entry of removed) {
    details.push({ type: "removed", text: `移除：${describeCourse(entry)}` });
  }
  return details;
}

function closestSameCourseIndex(target: ScheduleEntry, candidates: ScheduleEntry[]) {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    if (candidate.nameKey !== target.nameKey) return;
    const score = Number(candidate.day !== target.day)
      + Number(candidate.startSlot !== target.startSlot || candidate.endSlot !== target.endSlot)
      + Number(candidate.teacherKey !== target.teacherKey)
      + Number(candidate.locationKey !== target.locationKey)
      + Number(candidate.weeksKey !== target.weeksKey)
      + Number(candidate.noteKey !== target.noteKey);
    if (score < bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function describeChangedCourse(before: ScheduleEntry, after: ScheduleEntry) {
  const fields: string[] = [];
  if (before.day !== after.day || before.startSlot !== after.startSlot || before.endSlot !== after.endSlot) {
    fields.push(`时间 ${displayTime(before)} → ${displayTime(after)}`);
  }
  if (before.weeksKey !== after.weeksKey) fields.push(`周次 ${before.weeks} → ${after.weeks}`);
  if (before.locationKey !== after.locationKey) fields.push(`地点 ${before.location || "未标注"} → ${after.location || "未标注"}`);
  if (before.teacherKey !== after.teacherKey) fields.push(`教师 ${before.teacher || "未标注"} → ${after.teacher || "未标注"}`);
  if (before.noteKey !== after.noteKey) fields.push(`备注 ${before.note || "无"} → ${after.note || "无"}`);
  return `调整：${after.name}：${fields.join("；")}`;
}

function describeCourse(entry: ScheduleEntry) {
  const parts = [displayTime(entry), entry.weeks];
  if (entry.location) parts.push(entry.location);
  if (entry.teacher) parts.push(entry.teacher);
  return `${entry.name}（${parts.join("，")}）`;
}

function displayTime(entry: ScheduleEntry) {
  return `${dayLabel(entry.day)} ${entry.startSlot}-${entry.endSlot}节`;
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
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

function normalizeKeyText(value?: string) {
  return normalizeText(value).toLocaleLowerCase();
}
