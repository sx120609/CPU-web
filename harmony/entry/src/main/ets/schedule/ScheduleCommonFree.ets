import { NativeCalendarWeek, NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';

// 找共同空闲 (iOS ScheduleCommonFree): the times on each day when nobody of the chosen timetables has
// a class. Each timetable keeps its own bells and calendar (days off, make-up days, single meetings
// moved or cancelled), so people at different schools compare by clock time.

export interface CommonFreeWindow {
  date: string;
  // Minutes since midnight.
  start: number;
  end: number;
}

export interface CommonFreeDay {
  date: string;
  windows: CommonFreeWindow[];
  // Everybody's classes as [start, end] minute ranges, merged, for the bar that draws the day.
  busy: number[][];
}

/** The part of the day looked at: 白天, 晚上 or 全天. */
export function commonFreeSpan(span: string): number[] {
  if (span === 'day') return [8 * 60, 18 * 60];
  if (span === 'evening') return [18 * 60, 22 * 60 + 30];
  return [8 * 60, 22 * 60 + 30];
}

function clockMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

/** Overlapping or touching ranges joined, in order. */
export function commonFreeMerge(ranges: number[][]): number[][] {
  const merged: number[][] = [];
  ranges.slice().sort((left: number[], right: number[]) => left[0] - right[0]).forEach((range: number[]) => {
    const last = merged.length ? merged[merged.length - 1] : undefined;
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  });
  return merged;
}

/** Every date of a term's calendar, in order. */
export function commonFreeTermDates(weeks: NativeCalendarWeek[]): string[] {
  const dates: string[] = [];
  weeks.forEach((week: NativeCalendarWeek) => (week.days ?? []).forEach((date: string) => {
    if (date.length === 10 && !dates.includes(date)) dates.push(date);
  }));
  return dates.sort();
}

/** One timetable's classes on a date as minute ranges, read with its own bells. */
export function commonFreeBusy(store: NativeScheduleStore, date: string): number[][] {
  const ranges: number[][] = [];
  store.blocksOnDate(date).forEach((block: NativeCourseBlock) => {
    const start = clockMinutes(store.blockStart(block));
    const end = clockMinutes(store.blockEnd(block));
    if (start >= 0 && end > start) ranges.push([start, end]);
  });
  return ranges;
}

/**
 * The days from `from` to `to` (both included) that every timetable's term covers, with the windows
 * of at least `minimum` minutes between `earliest` and `latest`. Days before `today` are left out;
 * on `today` nothing before `nowMinute`, rounded up to the quarter hour, counts.
 */
export function commonFreeDays(terms: string[][], busy: (date: string) => number[][], from: string, to: string,
  earliest: number, latest: number, minimum: number, today: string, nowMinute: number): CommonFreeDay[] {
  if (!terms.length || from > to || earliest >= latest || minimum <= 0) return [];
  let first = from;
  let last = to;
  for (const dates of terms) {
    if (!dates.length) return [];
    if (dates[0] > first) first = dates[0];
    if (dates[dates.length - 1] < last) last = dates[dates.length - 1];
  }
  if (first > last) return [];
  const result: CommonFreeDay[] = [];
  let date = first;
  let guard = 0;
  while (date <= last && guard < 366) {
    guard += 1;
    if (date >= today) {
      const merged = commonFreeMerge(busy(date));
      let cursor = earliest;
      if (date === today) cursor = Math.max(cursor, Math.ceil(nowMinute / 15) * 15);
      const windows: CommonFreeWindow[] = [];
      merged.forEach((range: number[]) => {
        if (range[1] <= cursor || range[0] >= latest) return;
        if (range[0] - cursor >= minimum) windows.push({ date, start: cursor, end: range[0] });
        cursor = Math.max(cursor, range[1]);
      });
      if (latest - cursor >= minimum) windows.push({ date, start: cursor, end: latest });
      result.push({ date, windows, busy: merged });
    }
    date = new Date(Date.UTC(Number(date.substring(0, 4)), Number(date.substring(5, 7)) - 1, Number(date.substring(8, 10)) + 1))
      .toISOString().substring(0, 10);
  }
  return result;
}

/** "1 小时 45 分". */
export function commonFreeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

export function commonFreeClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
