// 日视图里的「下次课」：今天的课都上完了（或者今天没课）时，往后找最近的一节课，
// 省得一天天往后翻。今天还有课时不显示，那时日视图本身就是答案。
import { blockEnd, blockStart, clockMinutes, type SlotClock } from "./nowIndicator";
import type { WeekCourseBlock } from "./types";

export interface NextClassFound {
  date: string;
  week: number;
  day: number;
  block: WeekCourseBlock;
  /** "HH:mm"。 */
  start: string;
}

export interface NextClassState {
  /** 今天一共几节（按课程块算）。 */
  todayCount: number;
  next: NextClassFound | null;
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function findNextClass(input: {
  today: string;
  nowMinutes: number;
  clocks: SlotClock[];
  /** 校历里这一天是第几周星期几；不在学期里返回 undefined。 */
  dayAt: (date: string) => { week: number; day: number } | undefined;
  blocksOn: (week: number, day: number) => WeekCourseBlock[];
  /** 最多往后找几天。 */
  horizonDays?: number;
}): NextClassState | null {
  const status = { clocks: input.clocks, now: null, completedBefore: null };
  const todaySlot = input.dayAt(input.today);
  const todayBlocks = todaySlot ? input.blocksOn(todaySlot.week, todaySlot.day) : [];
  const stillToCome = todayBlocks.some((block) => {
    const end = clockMinutes(blockEnd(status, block));
    return end === null || end > input.nowMinutes;
  });
  if (stillToCome) return null;
  const horizon = input.horizonDays ?? 14;
  for (let offset = 1; offset <= horizon; offset += 1) {
    const date = shiftDate(input.today, offset);
    const slot = input.dayAt(date);
    if (!slot) continue;
    const blocks = input.blocksOn(slot.week, slot.day)
      .map((block) => ({ block, start: blockStart(status, block) }))
      .filter((item) => clockMinutes(item.start) !== null)
      .sort((a, b) => (clockMinutes(a.start) ?? 0) - (clockMinutes(b.start) ?? 0));
    if (blocks.length) return { todayCount: todayBlocks.length, next: { date, week: slot.week, day: slot.day, ...blocks[0] } };
  }
  return { todayCount: todayBlocks.length, next: null };
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** "明天"、"后天"，再远写成「周三 · 10月8日」。 */
export function nextClassDayLabel(today: string, found: Pick<NextClassFound, "date" | "day">) {
  if (found.date === shiftDate(today, 1)) return "明天";
  if (found.date === shiftDate(today, 2)) return "后天";
  const [, month, day] = found.date.split("-").map(Number);
  return `${WEEKDAYS[found.day - 1] ?? ""} · ${month}月${day}日`;
}
