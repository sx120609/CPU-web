import type { SchedulePeriod } from "./scheduleTermConfig";

/// 广播频道上的 end 会结束该频道的全部活动，所以频道粒度必须等于"服务器有权结束
/// 的最小单位"。学校节次就是那个单位；课间短休相连的节次合并成一个课节块，学生连堂
/// 时只有一个岛，而上午的 end 在结构上不可能触达下午的活动。
export const BLOCK_GAP_MINUTES = 20;

export type ScheduleBlock = {
  /// 课节块开始时刻 HHMM。用时刻而不是序号，管理员在别处插入节次时频道键不会错位。
  id: string;
  startClock: string;
  endClock: string;
  periods: SchedulePeriod[];
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function clockSeconds(clock: string) {
  return Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3, 5)) * 60;
}

/// 按真实下课时间切块，不使用任何写死的小时边界。
export function scheduleBlocks(periods: SchedulePeriod[], gapMinutes = BLOCK_GAP_MINUTES): ScheduleBlock[] {
  const sorted = periods
    .filter(period => CLOCK.test(period.start) && CLOCK.test(period.end) && period.start < period.end)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const blocks: ScheduleBlock[] = [];
  for (const period of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && clockSeconds(period.start) - clockSeconds(last.endClock) <= gapMinutes * 60) {
      last.periods.push(period);
      // 跨块的长节次不存在，但重叠节次要按最晚下课时间收口。
      if (period.end > last.endClock) last.endClock = period.end;
      continue;
    }
    blocks.push({ id: period.start.replace(":", ""), startClock: period.start, endClock: period.end, periods: [period] });
  }
  return blocks;
}
