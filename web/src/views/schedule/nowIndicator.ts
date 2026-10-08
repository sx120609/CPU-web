// 「现在」相关的计算：当前时间在节次表里的位置，以及某一天里每门课相对现在的状态。
// 时间一律按课表所在的时区（Asia/Shanghai）算。
import type { WeekCourseBlock } from "./types";

export interface SlotClock {
  no: number;
  start: string;
  end: string;
}

/** "08:00" → 480；解析不了就是 null。 */
export function clockMinutes(value: string | null | undefined) {
  const parts = String(value ?? "").split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

/** 上海时间从零点起的分钟数。 */
export function shanghaiMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

export function formatClock(minutes: number, padHour = false) {
  const hour = Math.floor(minutes / 60);
  return `${padHour ? String(hour).padStart(2, "0") : hour}:${String(minutes % 60).padStart(2, "0")}`;
}

export function slotSession(start: string | null | undefined) {
  const minutes = clockMinutes(start);
  if (minutes === null) return "课程";
  if (minutes < 12 * 60) return "上午";
  return minutes < 18 * 60 ? "下午" : "晚上";
}

/** 每个节次是不是上午／下午／晚上的第一节。 */
export function startsSession(rows: SlotClock[], index: number) {
  if (index <= 0) return true;
  return slotSession(rows[index - 1].start) !== slotSession(rows[index].start);
}

export function chineseNumeral(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (!(value > 0 && value < 100)) return String(value);
  if (value < 10) return digits[value];
  return (value < 20 ? "十" : `${digits[Math.floor(value / 10)]}十`) + (value % 10 === 0 ? "" : digits[value % 10]);
}

/** 教室名里可能已经带着开头的「@」，卡片上自己会加。 */
export function cleanLocation(raw: string | null | undefined) {
  const value = String(raw ?? "").trim().replace(/^[@＠\s]+/u, "").trim();
  return classroomOnly(value) || null;
}

/**
 * 理论课都在教学楼上，教室号本身就带楼栋（A–E）：「教学楼A102」只显示「A102」，课表格子里
 * 省下三个字。别的地点（实验楼、体育馆、教学楼后面不是楼栋加房号的）原样显示。
 * 只改显示，课程数据不动：隐藏和编辑记录是按原始地点认课的。
 */
export function classroomOnly(value: string) {
  const location = value.trim();
  return location.replace(/^教学楼\s*(?=[A-Ea-e]\s*[-－]?\s*\d)/u, "") || location;
}

/**
 * 「现在」落在节次表里的哪儿，以行数为单位（1.5 表示第二行的一半）。
 * 课间停在两节之间的缝里（返回整数行号并带 `gap`）；第一节之前和最后一节之后不画。
 */
export function nowRowPosition(current: number, rows: SlotClock[]): { row: number; fraction: number; inGap: boolean } | null {
  for (let index = 0; index < rows.length; index += 1) {
    const start = clockMinutes(rows[index].start);
    const end = clockMinutes(rows[index].end);
    if (start === null || end === null || end <= start) return null;
    if (current < start) return index === 0 ? null : { row: index, fraction: 0, inGap: true };
    if (current <= end) return { row: index, fraction: (current - start) / (end - start), inGap: false };
  }
  return null;
}

export type CoursePhase = "current" | "upcoming" | "completed";

export interface DayStatus {
  clocks: SlotClock[];
  /** 所看的这天是今天、并且要标出「现在」时，是当前的分钟数。 */
  now: number | null;
  /** 到这个分钟为止结束的课算已结束；过去的日期也会设它。 */
  completedBefore: number | null;
}

function ownClock(value: string | undefined) {
  const trimmed = String(value ?? "").trim();
  return clockMinutes(trimmed) === null ? null : trimmed;
}

/** 自定义课程可以带自己的上下课时间，有的话优先于作息表。 */
export function blockStart(status: DayStatus, block: Pick<WeekCourseBlock, "startSlot" | "course">) {
  return ownClock(block.course.customStartTime) ?? status.clocks.find((slot) => slot.no === block.startSlot)?.start ?? "—";
}

export function blockEnd(status: DayStatus, block: Pick<WeekCourseBlock, "endSlot" | "course">) {
  return ownClock(block.course.customEndTime) ?? status.clocks.find((slot) => slot.no === block.endSlot)?.end ?? "—";
}

export function blockPhase(status: DayStatus, block: WeekCourseBlock): CoursePhase {
  const start = clockMinutes(blockStart(status, block));
  const end = clockMinutes(blockEnd(status, block));
  if (start === null || end === null) return "upcoming";
  const limit = status.completedBefore ?? status.now;
  if (limit !== null && end <= limit) return "completed";
  if (status.now !== null && start <= status.now && status.now < end) return "current";
  return "upcoming";
}

export function blockStatusLabel(status: DayStatus, block: WeekCourseBlock) {
  const phase = blockPhase(status, block);
  if (phase === "completed") return "已结束";
  if (phase === "current") {
    const remaining = (clockMinutes(blockEnd(status, block)) ?? 0) - (status.now ?? 0);
    return `正在上 · 还剩 ${Math.max(1, remaining)} 分`;
  }
  const start = clockMinutes(blockStart(status, block));
  if (status.now === null || start === null || start <= status.now) return null;
  return start - status.now < 60 ? `${start - status.now} 分钟后` : null;
}

export function slotText(block: Pick<WeekCourseBlock, "startSlot" | "endSlot">) {
  return `第 ${block.startSlot}${block.startSlot === block.endSlot ? "" : `–${block.endSlot}`} 节`;
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function weekdayLabel(day: number) {
  return WEEKDAYS[day - 1] ?? `周${day}`;
}

/** 课程速览里的「周一 · 第 1–2 节 · 08:00–09:40」。 */
export function blockScheduleLine(block: WeekCourseBlock, clocks: SlotClock[]) {
  const status: DayStatus = { clocks, now: null, completedBefore: null };
  const start = blockStart(status, block);
  const end = blockEnd(status, block);
  return [
    weekdayLabel(block.day),
    slotText(block),
    start !== "—" && end !== "—" ? `${start}–${end}` : "",
  ].filter(Boolean).join(" · ");
}
