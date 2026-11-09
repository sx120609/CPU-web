import type { SchoolCelebration } from "@/api/site";

/** 第几周年：校庆日的年份减建校年份。 */
export function celebrationYears(celebration: SchoolCelebration): number {
  return Number(celebration.date.slice(0, 4)) - celebration.founded;
}

/** 北京时间的今天，YYYY-MM-DD。校庆日按学校所在地算，不按访问者设备的时区。 */
export function beijingToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 离校庆日还有几天：当天为 0，过了为负数。 */
export function daysUntilCelebration(celebration: SchoolCelebration, now = new Date()): number {
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  return Math.round(day(celebration.date) - day(beijingToday(now)));
}

/** 「11 月 16 日」 */
export function celebrationDateLabel(celebration: SchoolCelebration): string {
  const [, month, day] = celebration.date.split("-").map(Number);
  return `${month} 月 ${day} 日`;
}
