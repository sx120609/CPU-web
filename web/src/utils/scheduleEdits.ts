export interface EditableScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  customId?: string;
  custom?: boolean;
}

export interface EditableScheduleCell {
  day: number;
  bigSlot: number;
  courses: EditableScheduleCourse[];
}

export interface CustomScheduleItem {
  id: string;
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
  cells: T[],
  edits: ScheduleEditState,
) {
  const hidden = new Set(edits.hidden);
  const byCell = new Map<string, EditableScheduleCourse[]>();
  for (const item of edits.custom) {
    const key = cellKey(item.day, item.bigSlot);
    const list = byCell.get(key) ?? [];
    list.push({
      ...item.course,
      custom: true,
      customId: item.id,
    });
    byCell.set(key, list);
  }

  const merged = cells.map((cell) => {
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
    Number.isFinite(item.day) &&
    Number.isFinite(item.bigSlot) &&
    item.course &&
    typeof item.course.name === "string" &&
    Array.isArray(item.course.weekList)
  );
}
