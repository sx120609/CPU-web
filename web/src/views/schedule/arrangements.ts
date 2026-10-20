// 课程编辑器里的「上课时间」：一个星期几、任意几节（可以不连续）和它上课的周次。
//
// 各端共用的课表编辑数据里，一条自定义课程只描述一段连续的节次，所以一个上课时间
// 按每段连续节次各存一条。数据格式没有新增任何东西，其他客户端照常读取
// （iOS 见 NativeCourseArrangement.swift）。
//
// 不按节次上的课可以改填具体时间（`time`）：这时整段只存一条，带上 `customStartTime`／
// `customEndTime`，节次取和这段时间重叠的那几节（见 shared/scheduleCustomTime.ts）。
import {
  createCustomCourseId,
  customCourseWeeksLabel,
  officialCourseSourceKey,
  type CustomScheduleItem,
} from "@/utils/scheduleEdits";
import { normalizedCourseWeekList } from "@/utils/scheduleWeeks";
import {
  courseCustomTime,
  customClockMinutes,
  customTimeSlotRange,
  customTimeText,
  normalizeCustomTimeRange,
  type CustomTimeRange,
} from "@/utils/scheduleCustomTime";
import { normalizeSlotRange, smallSlots } from "./slots";
import type { ScheduleCell, ScheduleCourse } from "./types";

export interface CourseArrangement {
  day: number;
  slots: number[];
  /** 空数组表示全部周。 */
  weekList: number[];
  /** 不按节次上时的具体时间；有它时不看 `slots`，课表上占的节次按时间算。 */
  time?: CustomTimeRange;
}

type SlotClock = { no: number; start: string; end: string };

/** 按时间上课时，课表网格上占的那一段节次。时间不合法时为 null。 */
export function arrangementTimeRun(time: CustomTimeRange, clocks: SlotClock[] = smallSlots): SlotRun | null {
  return customTimeSlotRange(time.start, time.end, clocks);
}

/** 这个上课时间在网格上占的连续节次段。 */
function arrangementSlotRuns(arrangement: CourseArrangement, clocks: SlotClock[]) {
  if (!arrangement.time) return arrangementRuns(arrangement.slots);
  const run = arrangementTimeRun(arrangement.time, clocks);
  return run ? [run] : [];
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
  /** 按时间上课时用来算占哪几节的作息表。 */
  clocks?: SlotClock[];
}): CustomScheduleItem[] {
  const makeId = input.makeId ?? createCustomCourseId;
  const items: CustomScheduleItem[] = [];
  for (const arrangement of input.arrangements) {
    const weekList = cleanWeekList(arrangement.weekList);
    // 周次文字沿用网页编辑器一直以来的写法（「第 1-3、5 周」）。
    const weeks = customCourseWeeksLabel(weekList);
    const time = arrangement.time ? normalizeCustomTimeRange(arrangement.time.start, arrangement.time.end) : null;
    for (const run of arrangementSlotRuns(arrangement, input.clocks ?? smallSlots)) {
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
          ...(time ? { customStartTime: time.start, customEndTime: time.end } : {}),
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
 *
 * 按时间上课的一方（这个上课时间或表上那门课）按分钟比较，别的照旧按节次比较。
 */
export function arrangementConflicts(
  arrangement: CourseArrangement,
  cells: ScheduleCell[],
  ignore: (course: ScheduleCourse, cell: ScheduleCell) => boolean = () => false,
  clocks: SlotClock[] = smallSlots,
) {
  const runs = arrangementSlotRuns(arrangement, clocks);
  if (!runs.length) return [];
  const slots = new Set(runs.flatMap((run) => Array.from({ length: run.end - run.start + 1 }, (_, index) => run.start + index)));
  const ownMinutes = arrangement.time
    ? [minutesOfTime(normalizeCustomTimeRange(arrangement.time.start, arrangement.time.end))]
    : runs.map((run) => minutesOfRun(run, clocks));
  const weeks = new Set(arrangement.weekList);
  const names: string[] = [];
  for (const cell of cells) {
    if (cell.day !== arrangement.day) continue;
    for (const course of cell.courses) {
      if (ignore(course, cell)) continue;
      const range = normalizeSlotRange(cell.bigSlot, course);
      const courseTime = courseCustomTime(course);
      let overlaps = false;
      if (arrangement.time || courseTime) {
        const other = courseTime ? minutesOfTime(courseTime) : minutesOfRun(range, clocks);
        overlaps = ownMinutes.some((own) => Boolean(own && other && own.start < other.end && other.start < own.end));
      } else {
        for (let slot = range.start; slot <= range.end; slot += 1) {
          if (slots.has(slot)) { overlaps = true; break; }
        }
      }
      if (!overlaps) continue;
      const courseWeeks = normalizedCourseWeekList(course);
      if (weeks.size && courseWeeks.length && !courseWeeks.some((week) => weeks.has(week))) continue;
      if (!names.includes(course.name)) names.push(course.name);
    }
  }
  return names;
}

function minutesOfTime(time: CustomTimeRange | null) {
  if (!time) return null;
  const start = customClockMinutes(time.start);
  const end = customClockMinutes(time.end);
  return start === null || end === null ? null : { start, end };
}

function minutesOfRun(run: SlotRun, clocks: SlotClock[]) {
  const start = customClockMinutes(clocks.find((slot) => slot.no === run.start)?.start);
  const end = customClockMinutes(clocks.find((slot) => slot.no === run.end)?.end);
  return start === null || end === null ? null : { start, end };
}

/** 「16:30–18:00 · 课表上排在第 8–9 节」；时间没填好时说哪里不对。 */
export function arrangementTimeSummary(time: CustomTimeRange, clocks: SlotClock[] = smallSlots) {
  if (customClockMinutes(time.start) === null || customClockMinutes(time.end) === null) return "填写开始和结束时间";
  const normalized = normalizeCustomTimeRange(time.start, time.end);
  if (!normalized) return "结束时间要晚于开始时间";
  const run = arrangementTimeRun(normalized, clocks);
  const slots = run ? ` · 课表上排在第 ${run.start === run.end ? run.start : `${run.start}–${run.end}`} 节` : "";
  return `${customTimeText(normalized)}${slots}`;
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
