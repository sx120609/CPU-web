// 课表显示：格子高度、字号、显示哪些信息、显示哪几天。只影响周视图怎么画，
// 不动课程数据、所选周次和编辑权限。默认值就是加这些开关之前的样子。
import { normalizedCourseWeekList } from "../../utils/scheduleWeeks";
import type { WeekCourseBlock } from "./types";

export type ScheduleTextSize = "small" | "standard" | "large";

export interface ScheduleDisplaySettings {
  /** 格子高度，百分比；100 是刚好铺满一屏。 */
  rowHeight: number;
  textSize: ScheduleTextSize;
  compact: boolean;
  showTeacher: boolean;
  /** 本周不上的课，在本周空着的节次里淡淡地画出来。 */
  showOffWeek: boolean;
  showSlotTime: boolean;
  /** 标出「现在」：节次栏上的时间和今天那一列的线。 */
  highlightNow: boolean;
  showBackToWeek: boolean;
  showSaturday: boolean;
  showSunday: boolean;
  /** 一周从周日开始：第一列是周一前一天的那个周日。 */
  sundayFirst: boolean;
}

export const SCHEDULE_DISPLAY_STORAGE_KEY = "cpu-schedule-display-v1";
export const SCHEDULE_ROW_HEIGHT_MIN = 70;
export const SCHEDULE_ROW_HEIGHT_MAX = 180;
export const SCHEDULE_ROW_HEIGHT_STEP = 5;

export const DEFAULT_SCHEDULE_DISPLAY: Readonly<ScheduleDisplaySettings> = Object.freeze({
  rowHeight: 100,
  textSize: "standard",
  compact: false,
  showTeacher: false,
  showOffWeek: false,
  showSlotTime: true,
  highlightNow: true,
  showBackToWeek: true,
  showSaturday: true,
  showSunday: true,
  sundayFirst: false,
});

export const scheduleTextSizeOptions: Array<{ key: ScheduleTextSize; label: string }> = [
  { key: "small", label: "小" },
  { key: "standard", label: "标准" },
  { key: "large", label: "大" },
];

const TEXT_SCALES: Record<ScheduleTextSize, number> = { small: 0.88, standard: 1, large: 1.16 };

function normalizeRowHeight(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SCHEDULE_DISPLAY.rowHeight;
  const stepped = Math.round(number / SCHEDULE_ROW_HEIGHT_STEP) * SCHEDULE_ROW_HEIGHT_STEP;
  return Math.min(SCHEDULE_ROW_HEIGHT_MAX, Math.max(SCHEDULE_ROW_HEIGHT_MIN, stepped));
}

/** 不认识或缺的字段回到默认值，所以以后加开关不用迁移。 */
export function normalizeScheduleDisplay(value: unknown): ScheduleDisplaySettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof ScheduleDisplaySettings) => (
    typeof source[key] === "boolean" ? (source[key] as boolean) : (DEFAULT_SCHEDULE_DISPLAY[key] as boolean)
  );
  return {
    rowHeight: normalizeRowHeight(source.rowHeight),
    textSize: source.textSize === "small" || source.textSize === "large" ? source.textSize : "standard",
    compact: flag("compact"),
    showTeacher: flag("showTeacher"),
    showOffWeek: flag("showOffWeek"),
    showSlotTime: flag("showSlotTime"),
    highlightNow: flag("highlightNow"),
    showBackToWeek: flag("showBackToWeek"),
    showSaturday: flag("showSaturday"),
    showSunday: flag("showSunday"),
    sundayFirst: flag("sundayFirst"),
  };
}

export function readStoredScheduleDisplay(): ScheduleDisplaySettings {
  try {
    const raw = localStorage.getItem(SCHEDULE_DISPLAY_STORAGE_KEY);
    return normalizeScheduleDisplay(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SCHEDULE_DISPLAY };
  }
}

export function writeStoredScheduleDisplay(settings: ScheduleDisplaySettings) {
  try {
    localStorage.setItem(SCHEDULE_DISPLAY_STORAGE_KEY, JSON.stringify(normalizeScheduleDisplay(settings)));
  } catch {
    /* 存不下只影响下次打开 */
  }
}

export function isDefaultScheduleDisplay(settings: ScheduleDisplaySettings) {
  return (Object.keys(DEFAULT_SCHEDULE_DISPLAY) as Array<keyof ScheduleDisplaySettings>)
    .every((key) => settings[key] === DEFAULT_SCHEDULE_DISPLAY[key]);
}

/** 课程文字的缩放；紧凑排版再收一点，好让同一格里多放一行。 */
export function scheduleDisplayTextScale(settings: ScheduleDisplaySettings) {
  return Number((TEXT_SCALES[settings.textSize] * (settings.compact ? 0.92 : 1)).toFixed(3));
}

/**
 * 周视图从左到右画哪几天（1 是周一，7 是周日）。
 * 关掉的周六、周日如果那天有课或者要补班，仍然留着，不会让课凭空消失。
 */
export function scheduleWeekColumns(settings: ScheduleDisplaySettings, keeps: (day: number) => boolean): number[] {
  const days = [1, 2, 3, 4, 5];
  if (settings.showSaturday || keeps(6)) days.push(6);
  if (settings.showSunday || keeps(7)) {
    if (settings.sundayFirst) days.unshift(7);
    else days.push(7);
  }
  return days;
}

function overlaps(a: WeekCourseBlock, b: WeekCourseBlock) {
  return a.day === b.day && a.startSlot <= b.endSlot && b.startSlot <= a.endSlot;
}

/** 离这一周最近的一次上课：先看后面的周，再看已经过去的周。 */
function occurrenceDistance(weeks: number[], week: number) {
  const upcoming = weeks.filter((value) => value > week);
  if (upcoming.length) return Math.min(...upcoming) - week;
  const past = weeks.filter((value) => value < week);
  return past.length ? 1000 + week - Math.max(...past) : Number.POSITIVE_INFINITY;
}

/**
 * 挑出要淡显的「非本周」课程：这一周不上、而且它的节次本周是空的。
 * 同一格有好几门时只留最近要上的那一门。`weekOfDay` 给出每一列对应的教学周
 * （周日排在首列时，周日属于上一周）；返回 0 的那一天不画。
 */
export function selectOffWeekBlocks(
  all: WeekCourseBlock[],
  current: WeekCourseBlock[],
  weekOfDay: (day: number) => number,
): WeekCourseBlock[] {
  const candidates = all
    .map((block) => {
      const week = weekOfDay(block.day);
      // 和本周课程用同一套周次解析，免得同一门课两边判断不一致。
      const weeks = normalizedCourseWeekList(block.course);
      if (!week || !weeks.length || weeks.includes(week)) return null;
      if (current.some((item) => overlaps(item, block))) return null;
      return { block, distance: occurrenceDistance(weeks, week) };
    })
    .filter((item): item is { block: WeekCourseBlock; distance: number } => Boolean(item) && Number.isFinite(item!.distance))
    .sort((a, b) => a.distance - b.distance || a.block.startSlot - b.block.startSlot || a.block.index - b.block.index);
  const chosen: WeekCourseBlock[] = [];
  for (const { block } of candidates) {
    if (!chosen.some((item) => overlaps(item, block))) chosen.push(block);
  }
  return chosen;
}
