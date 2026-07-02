import type { ScheduleCourse, WeekCourseBlock } from "./types";

export const smallSlots = [
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

export const MAX_SMALL_SLOT = smallSlots[smallSlots.length - 1]?.no ?? 10;

export function clampSlot(value: number) {
  return Math.max(1, Math.min(MAX_SMALL_SLOT, Number(value) || 1));
}

export function normalizeSlotRange(bigSlot: number, course: ScheduleCourse) {
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const start = Number.isFinite(course.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(MAX_SMALL_SLOT, start));
  const safeEnd = Math.max(safeStart, Math.min(MAX_SMALL_SLOT, end));
  return { start: safeStart, end: safeEnd };
}

export function normalizeSlotRangeForTablePosition(bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const overlapsCurrentBigSlot = range.end >= fallbackStart && range.start <= fallbackEnd;
  return overlapsCurrentBigSlot ? range : { start: fallbackStart, end: fallbackEnd };
}

export function mergeContinuousCourseBlocks(list: WeekCourseBlock[]) {
  const sorted = [...list].sort((a, b) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot);
  const merged: WeekCourseBlock[] = [];
  for (const block of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && block.startSlot <= prev.endSlot + 1) {
      prev.startSlot = Math.min(prev.startSlot, block.startSlot);
      prev.endSlot = Math.max(prev.endSlot, block.endSlot);
      prev.bigSlot = Math.max(1, Math.ceil(prev.startSlot / 2));
      prev.course = {
        ...prev.course,
        startSlot: prev.startSlot,
        endSlot: prev.endSlot,
        slotNote: formatSlotNote(prev.startSlot, prev.endSlot),
      };
    } else {
      merged.push({
        ...block,
        bigSlot: Math.max(1, Math.ceil(block.startSlot / 2)),
        course: {
          ...block.course,
          startSlot: block.startSlot,
          endSlot: block.endSlot,
          slotNote: formatSlotNote(block.startSlot, block.endSlot),
        },
      });
    }
  }
  return merged;
}

export function formatSlotNote(start: number, end: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}
