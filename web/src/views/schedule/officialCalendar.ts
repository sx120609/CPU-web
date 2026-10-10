import type { CalendarResult } from "./types";

/**
 * 教务已将补课列在实际的星期/周次上，Web 不再从来源日期搬课。
 * 学校停课并未全部从教务课表删除，仍保留明确的 off 规则和假期说明。
 * 返回独立的显示校历，原始缓存及原生桥使用的校历保持不变。
 */
export function officialScheduleCalendar(calendar: CalendarResult | null): CalendarResult | null {
  if (!calendar?.adjustments?.some((item) => item.kind === "swap")) return calendar;
  return { ...calendar, adjustments: calendar.adjustments.filter((item) => item.kind !== "swap") };
}
