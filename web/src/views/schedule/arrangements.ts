// 课程编辑器里的「上课时间」：一个星期几、任意几节（可以不连续）和它上课的周次。
//
// 各端共用的课表编辑数据里，一条自定义课程只描述一段连续的节次，所以一个上课时间
// 按每段连续节次各存一条。数据格式没有新增任何东西，其他客户端照常读取
// （iOS 见 NativeCourseArrangement.swift）。
import {
  createCustomCourseId,
  customCourseWeeksLabel,
  officialCourseSourceKey,
  type CustomScheduleItem,
} from "@/utils/scheduleEdits";
import { normalizedCourseWeekList } from "@/utils/scheduleWeeks";
import { normalizeSlotRange, smallSlots } from "./slots";
import type { ScheduleCell, ScheduleCourse } from "./types";

export interface CourseArrangement {
  day: number;
  slots: number[];
  /** 空数组表示全部周。 */
  weekList: number[];
}

export interface SlotRun {
  start: number;
  end: number;
}

/** 按顺序排好的连续节次段：[1, 2, 5, 6, 9] → 1–2、5–6、9–9。 */
export function arrangementRuns(slots: Iterable<number>): SlotRun[] {
  const sorted = [...new Set([...slots].map(Number).filter((slot) => Number.isInteger(slot) && slot > 0))]
    .sort((a, b) => a - b);
  const runs: SlotRun[] = [];
  for (const slot of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.end + 1 === slot) last.end = slot;
    else runs.push({ start: slot, end: slot });
  }
  return runs;
}

function cleanWeekList(weekList: number[]) {
  return [...new Set(weekList.map(Number).filter((week) => Number.isInteger(week) && week > 0))].sort((a, b) => a - b);
}

export interface ArrangementDetails {
  name: string;
  teacher: string;
  location: string;
  note: string;
}

/**
 * 一门课全部上课时间对应的编辑条目。
 *
 * 第一个上课时间的第一段保留 `primaryId` 和 `primarySourceKey`：它就是正在编辑的
 * 那一块，教务课程靠它继续对应被替换的原课程。其余每一段都是普通的自定义条目。
 */
export function arrangementCustomItems(input: {
  details: ArrangementDetails;
  arrangements: CourseArrangement[];
  primaryId: string;
  primarySourceKey?: string;
  makeId?: () => string;
}): CustomScheduleItem[] {
  const makeId = input.makeId ?? createCustomCourseId;
  const items: CustomScheduleItem[] = [];
  for (const arrangement of input.arrangements) {
    const weekList = cleanWeekList(arrangement.weekList);
    // 周次文字沿用网页编辑器一直以来的写法（「第 1-3、5 周」）。
    const weeks = customCourseWeeksLabel(weekList);
    for (const run of arrangementRuns(arrangement.slots)) {
      const isPrimary = items.length === 0;
      const sourceKey = isPrimary ? officialCourseSourceKey(input.primarySourceKey) : undefined;
      items.push({
        id: isPrimary ? input.primaryId : makeId(),
        sourceKey,
        day: arrangement.day,
        bigSlot: Math.ceil(run.start / 2),
        course: {
          name: input.details.name.trim(),
          teacher: input.details.teacher.trim() || undefined,
          location: input.details.location.trim() || undefined,
          weeks,
          weekList,
          startSlot: run.start,
          endSlot: run.end,
          slotNote: input.details.note.trim() || `第 ${run.start}-${run.end} 节`,
        },
      });
    }
  }
  return items;
}

/**
 * 这个上课时间会压在哪些课上：同一个星期几、节次有交集、至少有一周相同。
 * 只是在同几节里隔周上的课不算。
 *
 * `ignore` 用来排除正在编辑的课程本身。没有周次列表的课程视为每周都上。
 */
export function arrangementConflicts(
  arrangement: CourseArrangement,
  cells: ScheduleCell[],
  ignore: (course: ScheduleCourse, cell: ScheduleCell) => boolean = () => false,
) {
  if (!arrangement.slots.length) return [];
  const slots = new Set(arrangement.slots);
  const weeks = new Set(arrangement.weekList);
  const names: string[] = [];
  for (const cell of cells) {
    if (cell.day !== arrangement.day) continue;
    for (const course of cell.courses) {
      if (ignore(course, cell)) continue;
      const range = normalizeSlotRange(cell.bigSlot, course);
      let overlaps = false;
      for (let slot = range.start; slot <= range.end; slot += 1) {
        if (slots.has(slot)) { overlaps = true; break; }
      }
      if (!overlaps) continue;
      const courseWeeks = normalizedCourseWeekList(course);
      if (weeks.size && courseWeeks.length && !courseWeeks.some((week) => weeks.has(week))) continue;
      if (!names.includes(course.name)) names.push(course.name);
    }
  }
  return names;
}

/** 「第 1–2、5 节 · 08:00–09:40、13:30–14:15」 */
export function arrangementSlotSummary(slots: Iterable<number>, clocks: Array<{ no: number; start: string; end: string }> = smallSlots) {
  const runs = arrangementRuns(slots);
  if (!runs.length) return "轻点选择上课的节次，可以不连续";
  const numbers = runs.map((run) => (run.start === run.end ? `${run.start}` : `${run.start}–${run.end}`));
  const times = runs.flatMap((run) => {
    const start = clocks.find((slot) => slot.no === run.start)?.start;
    const end = clocks.find((slot) => slot.no === run.end)?.end;
    return start && end ? [`${start}–${end}`] : [];
  });
  return `第 ${numbers.join("、")} 节${times.length ? ` · ${times.join("、")}` : ""}`;
}
