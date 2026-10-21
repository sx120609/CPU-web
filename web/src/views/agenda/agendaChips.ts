import { agendaClockMinutes, agendaGridOffset, agendaOn, type AgendaItem } from "@/utils/agenda";

/** 一条日程在课表周视图某一列里的位置（百分比，相对于整列从第一节到最后一节的高度）。 */
export interface AgendaChip {
  key: string;
  item: AgendaItem;
  date: string;
  done: boolean;
  top: number;
  height: number;
  /** 和这一天的课重叠：靠右窄一些，让课程还能看清。 */
  beside: boolean;
  label: string;
}

/** 没有结束时间的日程在格子上占这么久，能看清也点得到。 */
const UNTIMED_SPAN_MINUTES = 45;

/**
 * `date` 这一天有具体时间的日程在课表列里的位置。`clocks` 是节次表，`courses` 是这一天
 * 课程占的节次（第几节到第几节）。和 NEXT 的 AgendaColumnChips 同一种摆法，只是节次之间
 * 不留空隙：网页课表的格子是等高的行。
 */
export function agendaChips(
  items: AgendaItem[],
  date: string,
  clocks: Array<{ start: string; end: string }>,
  courses: Array<{ startSlot: number; endSlot: number }>,
): AgendaChip[] {
  if (!date || !clocks.length) return [];
  const rows = clocks.length;
  const offset = (minutes: number) => agendaGridOffset(minutes, clocks, 1, 0);
  return agendaOn(items, date).flatMap((entry) => {
    const start = agendaClockMinutes(entry.item.start);
    if (start === null) return [];
    const endValue = agendaClockMinutes(entry.item.end);
    const end = endValue !== null && endValue > start ? endValue : start + UNTIMED_SPAN_MINUTES;
    const from = offset(start);
    const to = Math.max(offset(end), Math.min(rows, from + 0.55));
    const beside = courses.some((course) => from < course.endSlot && course.startSlot - 1 < to);
    return [{
      key: `${entry.item.id}:${date}`,
      item: entry.item,
      date,
      done: entry.done,
      top: (Math.min(from, rows - 0.55) / rows) * 100,
      height: ((to - Math.min(from, rows - 0.55)) / rows) * 100,
      beside,
      label: entry.item.end ? `${entry.item.start}–${entry.item.end}` : entry.item.start,
    }];
  });
}

/** 这一天有没做完的全天日程或待办：周视图的表头上点一个点。 */
export function agendaHeaderDot(items: AgendaItem[], date: string) {
  return Boolean(date) && agendaOn(items, date).some((entry) => !entry.item.start && !entry.done);
}
