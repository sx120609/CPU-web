import { dayOfWeekForCalendarYmd } from "./calendar";
import { periodsFor, toMinutes, weekNumberForDate, type SlotTime } from "./couple";
import { addDaysYmd, type DormDayReader } from "./dorm";

/**
 * 宿舍课表的「一周」总表：一行一节课、一列一天，每格写清这一节谁有空、谁在上课。
 * 和按天的空闲时段不同，这里按节次看，方便一眼扫完整周。
 */

/** 节次之间隔这么久（午休、晚饭）就在表里空开一点。 */
const BREAK_MINUTES = 30;

export interface DormWeekBusy {
  id: number;
  /** 这一节在上的课；同一节排了两门时都列出来。 */
  courses: string[];
}

export interface DormWeekCell {
  ymd: string;
  period: SlotTime;
  freeIds: number[];
  busy: DormWeekBusy[];
  /** 这天没有课表数据的人，不算有空也不算有课。 */
  unknownIds: number[];
}

export interface DormWeekRow {
  period: SlotTime;
  breakBefore: boolean;
  cells: DormWeekCell[];
}

export interface DormWeekGrid {
  monday: string;
  dates: string[];
  /** 这周是第几教学周；不在学期内时为 null。 */
  teachingWeek: number | null;
  rows: DormWeekRow[];
}

export type DormWeekLevel = "unknown" | "none" | "some" | "all";

/** ymd 所在那一周的周一。 */
export function dormWeekMonday(ymd: string) {
  return addDaysYmd(ymd, 1 - dayOfWeekForCalendarYmd(ymd));
}

/**
 * 表格用谁的节次表：优先自己的，自己没同步就用第一个有课表的人；都没有就用默认节次。
 * 判断忙闲按分钟算，所以室友的节次表和这里不一样也不会算错。
 */
export function dormWeekPeriods(readers: DormDayReader[], preferredId?: number): SlotTime[] {
  const source = readers.find((reader) => reader.id === preferredId && reader.snapshot)
    ?? readers.find((reader) => reader.snapshot);
  const periods = source ? source.periods : periodsFor(null);
  return periods.filter((period) => {
    const start = toMinutes(period.start);
    const end = toMinutes(period.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  });
}

function overlapsPeriod(course: { start: string; end: string; startSlot: number; endSlot: number }, period: SlotTime) {
  const start = toMinutes(course.start);
  const end = toMinutes(course.end);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return start < toMinutes(period.end) && end > toMinutes(period.start);
  }
  // 没有起止时间的课退回按节次号判断。
  return course.startSlot <= period.no && course.endSlot >= period.no;
}

export function dormWeekGrid(readers: DormDayReader[], monday: string, preferredId?: number): DormWeekGrid {
  const dates = Array.from({ length: 7 }, (_item, index) => addDaysYmd(monday, index));
  const periods = dormWeekPeriods(readers, preferredId);
  const coursesByDate = dates.map((ymd) => readers.map((reader) => ({ id: reader.id, courses: reader.coursesForDate(ymd) })));

  const rows = periods.map((period, index) => {
    const previous = periods[index - 1];
    const breakBefore = Boolean(previous && toMinutes(period.start) - toMinutes(previous.end) >= BREAK_MINUTES);
    const cells = dates.map((ymd, dayIndex) => {
      const freeIds: number[] = [];
      const busy: DormWeekBusy[] = [];
      const unknownIds: number[] = [];
      for (const entry of coursesByDate[dayIndex]) {
        if (!entry.courses) {
          unknownIds.push(entry.id);
          continue;
        }
        const names = entry.courses.filter((course) => overlapsPeriod(course, period)).map((course) => course.course.name);
        if (names.length) busy.push({ id: entry.id, courses: [...new Set(names)] });
        else freeIds.push(entry.id);
      }
      return { ymd, period, freeIds, busy, unknownIds };
    });
    return { period, breakBefore, cells };
  });

  let teachingWeek: number | null = null;
  const preferred = readers.find((reader) => reader.id === preferredId && reader.snapshot);
  for (const reader of preferred ? [preferred, ...readers] : readers) {
    if (!reader.snapshot) continue;
    teachingWeek = dates.map((ymd) => weekNumberForDate(reader.snapshot?.calendar, ymd)).find((week) => week !== null) ?? null;
    if (teachingWeek !== null) break;
  }

  return { monday, dates, teachingWeek, rows };
}

export function dormWeekCellLevel(cell: DormWeekCell): DormWeekLevel {
  const known = cell.freeIds.length + cell.busy.length;
  if (!known) return "unknown";
  if (cell.freeIds.length === known) return "all";
  return cell.freeIds.length ? "some" : "none";
}

/** 一格的结论。有人没数据时只能说“已同步的人都有空”，不能说全宿舍。 */
export function dormWeekCellSummary(cell: DormWeekCell) {
  const level = dormWeekCellLevel(cell);
  const known = cell.freeIds.length + cell.busy.length;
  if (level === "unknown") return "没有课表数据";
  if (level === "none") return known > 1 ? "都在上课" : "在上课";
  if (level === "some") return `${cell.freeIds.length} 人有空`;
  if (cell.unknownIds.length) return `已同步的 ${known} 人都有空`;
  return known > 1 ? "全宿舍都有空" : "有空";
}

/** 有空人数占已知人数的比例，用来给格子上色；没有数据时为 0。 */
export function dormWeekFreeRatio(cell: DormWeekCell) {
  const known = cell.freeIds.length + cell.busy.length;
  return known ? cell.freeIds.length / known : 0;
}
