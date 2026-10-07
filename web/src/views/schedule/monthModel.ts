// 月视图的数据：一张铺满整周的月历，每天带着教学周、农历或节日和当天的课程。
// 周视图和日视图按节次画网格；月视图是一张日历，下面跟着所选那天的课程清单。
import { addDaysToCalendarYmd, dayOfWeekForCalendarYmd, formatYmd, normalizeCalendarWeekDays } from "./calendar";
import type { CalendarResult, WeekCourseBlock } from "./types";

export interface MonthDaySlot {
  week: number;
  /** 1 是周一，7 是周日。 */
  day: number;
}

export interface MonthDay {
  /** "yyyy-MM-dd"。 */
  date: string;
  number: number;
  inMonth: boolean;
  /** 学期外的日期查不到教学周。 */
  slot: MonthDaySlot | null;
  /** 农历日或节日名。 */
  subtitle: string;
  isFestival: boolean;
  adjustment: { kind: "off" | "swap"; source?: string; note?: string } | null;
  blocks: WeekCourseBlock[];
}

/** 日期 → (教学周, 星期几)。来自课表校历。 */
export function buildDateIndex(calendar: Pick<CalendarResult, "weeks"> | null | undefined) {
  const index = new Map<string, MonthDaySlot>();
  for (const week of calendar?.weeks ?? []) {
    normalizeCalendarWeekDays(week.days ?? []).slice(0, 7).forEach((date, offset) => {
      if (date) index.set(date, { week: week.week, day: offset + 1 });
    });
  }
  return index;
}

/** "2026-10-07" → "2026-10"。 */
export function monthKeyOf(date: string) {
  return date.slice(0, 7);
}

export function shiftMonth(monthKey: string, delta: number) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/u);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 校历覆盖到的月份，按先后排好。 */
export function calendarMonths(calendar: Pick<CalendarResult, "weeks"> | null | undefined) {
  const months = new Set<string>();
  for (const date of buildDateIndex(calendar).keys()) months.add(monthKeyOf(date));
  return [...months].sort();
}

const SOLAR_FESTIVALS: Record<string, string> = {
  "01-01": "元旦",
  "02-14": "情人节",
  "03-08": "妇女节",
  "05-01": "劳动节",
  "05-04": "青年节",
  "06-01": "儿童节",
  "09-10": "教师节",
  "10-01": "国庆节",
  "12-25": "圣诞节",
};

const LUNAR_FESTIVALS: Record<string, string> = {
  "正月初一": "春节",
  "正月十五": "元宵",
  "五月初五": "端午",
  "七月初七": "七夕",
  "八月十五": "中秋",
  "九月初九": "重阳",
  "腊月初八": "腊八",
};

let lunarFormatter: Intl.DateTimeFormat | null | undefined;

function lunarParts(date: string) {
  if (lunarFormatter === undefined) {
    try {
      const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { timeZone: "UTC", month: "long", day: "numeric" });
      lunarFormatter = formatter.resolvedOptions().calendar === "chinese" ? formatter : null;
    } catch {
      lunarFormatter = null;
    }
  }
  if (!lunarFormatter) return null;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const parts = lunarFormatter.formatToParts(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const dayNumber = Number.parseInt(parts.find((part) => part.type === "day")?.value ?? "", 10);
  if (!month || !Number.isFinite(dayNumber)) return null;
  return { month, day: lunarDayName(dayNumber) };
}

export function lunarDayName(day: number) {
  const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (day <= 10) return `初${digits[day - 1]}`;
  if (day < 20) return `十${digits[day - 11]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${digits[day - 21]}`;
  return "三十";
}

/** 「八月廿六」；浏览器不支持农历时是空字符串。 */
export function lunarDateText(date: string) {
  const lunar = lunarParts(date);
  return lunar ? `${lunar.month}${lunar.day}` : "";
}

/** 月历格子里日期下面的那行字：节日名、农历月首的月份，或农历日。 */
export function daySubtitle(date: string) {
  const solar = SOLAR_FESTIVALS[date.slice(5)];
  const lunar = lunarParts(date);
  const lunarFestival = lunar ? LUNAR_FESTIVALS[`${lunar.month}${lunar.day}`] : undefined;
  if (lunarFestival) return { text: lunarFestival, isFestival: true };
  if (solar) return { text: solar, isFestival: true };
  if (!lunar) return { text: "", isFestival: false };
  return { text: lunar.day === "初一" ? lunar.month : lunar.day, isFestival: false };
}

/**
 * 一个月铺满整周的全部日期（周一开头）。`blocksFor` 给出某个教学周某一天的课程，
 * 调休已经在里面解析过了。
 */
export function buildMonthDays(input: {
  monthKey: string;
  calendar: Pick<CalendarResult, "weeks" | "adjustments"> | null | undefined;
  blocksFor: (week: number, day: number) => WeekCourseBlock[];
}): MonthDay[] {
  const match = input.monthKey.match(/^(\d{4})-(\d{2})$/u);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const first = formatYmd(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = formatYmd(year, month, daysInMonth);
  const start = addDaysToCalendarYmd(first, 1 - dayOfWeekForCalendarYmd(first));
  const end = addDaysToCalendarYmd(last, 7 - dayOfWeekForCalendarYmd(last));
  const index = buildDateIndex(input.calendar);
  const adjustments = new Map((input.calendar?.adjustments ?? []).map((item) => [item.date, item]));
  const days: MonthDay[] = [];
  for (let date = start; date && date <= end; date = addDaysToCalendarYmd(date, 1)) {
    const slot = index.get(date) ?? null;
    const adjustment = adjustments.get(date) ?? null;
    const subtitle = daySubtitle(date);
    const note = adjustment?.kind === "off" ? adjustment.note?.trim() : "";
    days.push({
      date,
      number: Number(date.slice(8)),
      inMonth: monthKeyOf(date) === input.monthKey,
      slot,
      subtitle: note || subtitle.text,
      isFestival: Boolean(note) || subtitle.isFestival,
      adjustment: adjustment ? { kind: adjustment.kind, source: adjustment.source, note: adjustment.note } : null,
      blocks: slot ? input.blocksFor(slot.week, slot.day) : [],
    });
    if (days.length > 42) break;
  }
  return days;
}

export function monthRows(days: MonthDay[]) {
  const rows: MonthDay[][] = [];
  for (let index = 0; index < days.length; index += 7) rows.push(days.slice(index, index + 7));
  return rows;
}

/** 「10 月 7 日 · 周三」 */
export function monthDayTitle(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return "";
  const weekday = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][dayOfWeekForCalendarYmd(date) - 1] ?? "";
  return `${Number(match[2])} 月 ${Number(match[3])} 日 · ${weekday}`;
}

/** 「二〇二六年 · 十月」，素笺的月份标题。 */
export function paperMonthTitle(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/u);
  if (!match) return "";
  const digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const year = match[1].split("").map((char) => digits[Number(char)]).join("");
  const months = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return `${year}年 · ${months[Number(match[2]) - 1]}月`;
}
