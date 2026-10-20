// 不按节次上的课（讲座、实验、社团活动）可以带自己的上下课时间：`customStartTime`、
// `customEndTime`，都是 24 小时制的「HH:MM」。
//
// 课表网格仍然按节次排，所以这样的课照样存 `startSlot`／`endSlot`：取和这段时间重叠的
// 节次；落在课间或作息表以外时取离它最近的一节。不认识这两个字段的旧客户端因此仍把课
// 放在差不多的位置，认识的客户端显示真实时间。

export interface ClockPeriod {
  no: number;
  start: string;
  end: string;
}

export interface CustomTimeRange {
  start: string;
  end: string;
}

/** 「8:05」「08:05」→ 485；不是合法时间时为 null。 */
export function customClockMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatCustomClock(minutes: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** 两个时间都合法并且结束晚于开始时，返回补齐成两位数的写法。 */
export function normalizeCustomTimeRange(start: unknown, end: unknown): CustomTimeRange | null {
  const from = customClockMinutes(start);
  const to = customClockMinutes(end);
  if (from === null || to === null || to <= from) return null;
  return { start: formatCustomClock(from), end: formatCustomClock(to) };
}

/** 课程自己的时间；只填了一个、写错了或结束不晚于开始的都不算。 */
export function courseCustomTime(course: { customStartTime?: string; customEndTime?: string } | null | undefined) {
  return normalizeCustomTimeRange(course?.customStartTime, course?.customEndTime);
}

/**
 * 这段时间在课表网格上占哪几节：和它重叠的节次；一节都不重叠时取离它最近的一节。
 * 作息表为空或时间不合法时为 null。
 */
export function customTimeSlotRange(start: unknown, end: unknown, periods: ClockPeriod[]) {
  const range = normalizeCustomTimeRange(start, end);
  if (!range) return null;
  const from = customClockMinutes(range.start)!;
  const to = customClockMinutes(range.end)!;
  const timed = periods
    .map((period) => ({ no: period.no, start: customClockMinutes(period.start), end: customClockMinutes(period.end) }))
    .filter((period): period is { no: number; start: number; end: number } => (
      Number.isInteger(period.no) && period.no > 0 && period.start !== null && period.end !== null
    ))
    .sort((a, b) => a.no - b.no);
  if (!timed.length) return null;
  const overlapping = timed.filter((period) => period.start < to && from < period.end);
  if (overlapping.length) {
    return { start: overlapping[0].no, end: overlapping[overlapping.length - 1].no };
  }
  let nearest = timed[0];
  let best = Number.POSITIVE_INFINITY;
  for (const period of timed) {
    const distance = period.end <= from ? from - period.end : period.start - to;
    if (distance < best) {
      best = distance;
      nearest = period;
    }
  }
  return { start: nearest.no, end: nearest.no };
}

/** 「16:30–18:00」 */
export function customTimeText(range: CustomTimeRange) {
  return `${range.start}–${range.end}`;
}
