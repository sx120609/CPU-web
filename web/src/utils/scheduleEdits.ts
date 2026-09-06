import { normalizedCourseWeekList } from "./scheduleWeeks";

export interface EditableScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  sourceKey?: string;
  customId?: string;
  custom?: boolean;
  orphaned?: boolean;
}

export interface EditableScheduleCell {
  day: number;
  bigSlot: number;
  courses: EditableScheduleCourse[];
}

export interface CustomScheduleItem {
  id: string;
  sourceKey?: string;
  day: number;
  bigSlot: number;
  course: EditableScheduleCourse;
}

export interface ScheduleEditState {
  hidden: string[];
  custom: CustomScheduleItem[];
}

const EDIT_KEY_PREFIX = "cpu-schedule-edits-v1";

export function emptyScheduleEdits(): ScheduleEditState {
  return { hidden: [], custom: [] };
}

export function normalizeScheduleEditsState(input: ScheduleEditState | null | undefined): ScheduleEditState {
  const hidden = Array.isArray(input?.hidden)
    ? [...new Set(input.hidden.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
  const custom = Array.isArray(input?.custom)
    ? input.custom
      .filter((item) => Boolean(
        item &&
        typeof item.id === "string" &&
        Number.isFinite(item.day) &&
        Number.isFinite(item.bigSlot) &&
        item.course &&
        typeof item.course.name === "string" &&
        Array.isArray(item.course.weekList)
      ))
      .map((item) => ({
        ...item,
        id: String(item.id).trim(),
        sourceKey: officialCourseSourceKey(item.sourceKey),
        course: {
          ...item.course,
          name: String(item.course.name || "").trim(),
          teacher: item.course.teacher?.trim() || undefined,
          location: item.course.location?.trim() || undefined,
          weeks: String(item.course.weeks || "").trim() || "全部周",
          weekList: [...new Set(item.course.weekList.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b),
          slotNote: item.course.slotNote?.trim() || undefined,
          startSlot: Number.isFinite(item.course.startSlot) ? Number(item.course.startSlot) : undefined,
          endSlot: Number.isFinite(item.course.endSlot) ? Number(item.course.endSlot) : undefined,
        },
      }))
    : [];
  return { hidden, custom };
}

export function customCourseWeeksLabel(weekList: number[]) {
  if (!weekList.length) return "全部周";
  if (weekList.length === 1) return `第 ${weekList[0]} 周`;
  const sorted = [...weekList].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = value;
    prev = value;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return `第 ${ranges.join("、")} 周`;
}

export function customCourseWeeksText(weekList: number[]) {
  return [...new Set(weekList.map(Number).filter(Boolean))].sort((a, b) => a - b).join(",");
}

export function noteFromCourse(course: EditableScheduleCourse) {
  const note = course.slotNote?.trim() || "";
  return /^第\s*\d+\s*-\s*\d+\s*节$/.test(note) ? "" : note;
}

export function scheduleEditKey(semester?: string | null) {
  return `${EDIT_KEY_PREFIX}:${semester || "current"}`;
}

export function readScheduleEdits(semester?: string | null): ScheduleEditState {
  try {
    const raw = localStorage.getItem(scheduleEditKey(semester));
    if (!raw) return emptyScheduleEdits();
    const parsed = JSON.parse(raw);
    return {
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((v: unknown) => typeof v === "string") : [],
      custom: Array.isArray(parsed?.custom) ? parsed.custom.filter(isCustomScheduleItem) : [],
    };
  } catch {
    return emptyScheduleEdits();
  }
}

export function writeScheduleEdits(semester: string | undefined | null, state: ScheduleEditState) {
  try {
    localStorage.setItem(scheduleEditKey(semester), JSON.stringify({
      hidden: Array.from(new Set(state.hidden)),
      custom: state.custom,
    }));
  } catch {
    /* ignore */
  }
}

export function courseEditKey(day: number, bigSlot: number, course: EditableScheduleCourse) {
  if (course.customId) return `custom:${course.customId}`;
  return [
    "jwxt",
    day,
    bigSlot,
    course.startSlot ?? "",
    course.endSlot ?? "",
    normalizeKeyPart(course.name),
    normalizeKeyPart(course.teacher),
    normalizeKeyPart(course.location),
    normalizeKeyPart(course.weeks),
  ].join("|");
}

export function applyScheduleEditsToCells<T extends EditableScheduleCell>(
  cells: T[] | null,
  edits: ScheduleEditState,
) {
  const hidden = new Set(edits.hidden);
  const sources = (cells ?? []).flatMap((cell) => cell.courses.map((course) => ({
    key: courseEditKey(cell.day, cell.bigSlot, course),
    day: cell.day,
    range: courseSourceRange(cell.bigSlot, course),
    identity: courseSourceIdentity(course),
  })));
  const byCell = new Map<string, EditableScheduleCourse[]>();
  for (const item of edits.custom) {
    const sourceKey = officialCourseSourceKey(item.sourceKey);
    const matches = sourceKey ? equivalentSourceKeys(sourceKey, sources) : [];
    // Equivalent formatting and split table cells must hide the same original as the saved key.
    if (sourceKey && hidden.has(sourceKey)) matches.forEach((key) => hidden.add(key));
    const key = cellKey(item.day, item.bigSlot);
    const list = byCell.get(key) ?? [];
    list.push({
      ...item.course,
      sourceKey,
      custom: true,
      customId: item.id,
      orphaned: sourceKey && cells !== null ? matches.length === 0 : undefined,
    });
    byCell.set(key, list);
  }

  const merged = (cells ?? []).map((cell) => {
    const courses = cell.courses.filter((course) => !hidden.has(courseEditKey(cell.day, cell.bigSlot, course)));
    const custom = byCell.get(cellKey(cell.day, cell.bigSlot)) ?? [];
    return { ...cell, courses: [...courses, ...custom] };
  });

  for (const [key, courses] of byCell.entries()) {
    const exists = merged.some((cell) => cellKey(cell.day, cell.bigSlot) === key);
    if (exists) continue;
    const [day, bigSlot] = key.split(":").map(Number);
    merged.push({ day, bigSlot, courses } as T);
  }

  return merged.filter((cell) => cell.courses.length);
}

export function officialCourseSourceKey(key?: string) {
  const value = key?.trim();
  return value && !value.startsWith("custom:") ? value : undefined;
}

export function keepScheduleCourseAsCustom(edits: ScheduleEditState, customId: string): ScheduleEditState {
  const target = edits.custom.find((item) => item.id === customId);
  if (!target) return edits;
  return {
    hidden: edits.hidden.filter((key) => key !== target.sourceKey),
    custom: edits.custom.map((item) => item.id === customId ? {
      ...item,
      sourceKey: undefined,
      course: { ...item.course, sourceKey: undefined, orphaned: undefined },
    } : item),
  };
}

export function scheduleCourseEditLabel(course: EditableScheduleCourse) {
  if (!course.customId && !course.custom) return "";
  if (course.orphaned) return "待核对";
  return officialCourseSourceKey(course.sourceKey) ? "已编辑" : "自定义";
}

function courseSourceIdentity(course: EditableScheduleCourse) {
  const text = (value?: string) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
  return JSON.stringify([
    text(course.name), text(course.teacher), text(course.location), normalizedCourseWeekList(course),
  ]);
}

function courseSourceRange(bigSlot: number, course: Pick<EditableScheduleCourse, "startSlot" | "endSlot">) {
  const start = course.startSlot ?? bigSlot * 2 - 1;
  return { start, end: course.endSlot ?? bigSlot * 2 };
}

function equivalentSourceKeys(
  key: string,
  sources: Array<{ key: string; day: number; range: { start: number; end: number }; identity: string }>,
) {
  const exact = sources.filter((source) => source.key === key);
  if (exact.length) return exact.map((source) => source.key);
  const parts = key.split("|");
  if (parts.length !== 9 || parts[0] !== "jwxt") return [];
  const [, day, bigSlot, start, end, name, teacher, location, weeks] = parts;
  const original = {
    name, teacher, location, weeks, weekList: [],
    startSlot: start ? Number(start) : undefined,
    endSlot: end ? Number(end) : undefined,
  };
  const range = courseSourceRange(Number(bigSlot), original);
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start) return [];
  const identity = courseSourceIdentity(original);
  const candidates = sources.filter((source) => (
    source.day === Number(day) && source.identity === identity
    && source.range.start >= range.start && source.range.end <= range.end
  )).sort((a, b) => a.range.start - b.range.start);
  let coveredEnd = range.start - 1;
  for (const source of candidates) {
    if (source.range.start > coveredEnd + 1) return [];
    coveredEnd = Math.max(coveredEnd, source.range.end);
  }
  return coveredEnd === range.end ? candidates.map((source) => source.key) : [];
}

export function createCustomCourseId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cellKey(day: number, bigSlot: number) {
  return `${day}:${bigSlot}`;
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function isCustomScheduleItem(value: unknown): value is CustomScheduleItem {
  const item = value as CustomScheduleItem;
  return Boolean(
    item &&
    typeof item.id === "string" &&
    (item.sourceKey === undefined || typeof item.sourceKey === "string") &&
    Number.isFinite(item.day) &&
    Number.isFinite(item.bigSlot) &&
    item.course &&
    typeof item.course.name === "string" &&
    Array.isArray(item.course.weekList)
  );
}
