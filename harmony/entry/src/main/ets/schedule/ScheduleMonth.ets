import { NativeCourseBlock, NativeScheduleAdjustment } from './NativeScheduleStore';

// 月视图的数据：一张铺满整周的月历，每天带农历/节日、调休和当天的课。
// 和 iOS 的 NativeScheduleMonthView.buildDays 一致，界面在 ScheduleMonthView.ets。

export interface ScheduleMonthDay {
  // yyyy-MM-dd
  date: string;
  number: number;
  inMonth: boolean;
  // 1...7，周一为 1。
  weekday: number;
  // 教学周；不在学期内为 0。
  week: number;
  subtitle: string;
  isFestival: boolean;
  isStatutoryHoliday: boolean;
  // 'off'、'swap' 或空串。
  adjustmentKind: string;
  courses: NativeCourseBlock[];
}

export interface ScheduleMonthDayInfo {
  subtitle: string;
  isFestival: boolean;
  isStatutoryHoliday: boolean;
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }

function dateKey(time: number): string { return new Date(time).toISOString().substring(0, 10); }

function utcTime(date: string): number {
  const parts = (date ?? '').split('-');
  if (parts.length !== 3) return NaN;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return NaN;
  const time = Date.UTC(year, month - 1, day);
  return dateKey(time) === `${parts[0]}-${pad2(month)}-${pad2(day)}` ? time : NaN;
}

/** 1 is Monday, 7 is Sunday; 0 when the text is not a date. */
export function scheduleDateWeekday(date: string): number {
  const time = utcTime(date);
  return isNaN(time) ? 0 : (new Date(time).getUTCDay() + 6) % 7 + 1;
}

/** The grid starts on the Monday of the week holding the first of the month and fills whole weeks. */
export function buildScheduleMonth(
  anchor: string,
  info: (date: string) => ScheduleMonthDayInfo,
  week: (date: string) => number,
  adjustment: (date: string) => string,
  courses: (date: string) => NativeCourseBlock[]
): ScheduleMonthDay[] {
  const anchorTime = utcTime(anchor);
  if (isNaN(anchorTime)) return [];
  const anchorDate = new Date(anchorTime);
  const year = anchorDate.getUTCFullYear();
  const month = anchorDate.getUTCMonth();
  const first = Date.UTC(year, month, 1);
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const total = Math.ceil((leading + count) / 7) * 7;
  const days: ScheduleMonthDay[] = [];
  for (let offset = 0; offset < total; offset += 1) {
    const time = first + (offset - leading) * 86400000;
    const date = new Date(time);
    const key = dateKey(time);
    const detail = info(key);
    days.push({
      date: key, number: date.getUTCDate(), inMonth: date.getUTCMonth() === month,
      weekday: (date.getUTCDay() + 6) % 7 + 1, week: week(key),
      subtitle: detail.subtitle, isFestival: detail.isFestival, isStatutoryHoliday: detail.isStatutoryHoliday,
      adjustmentKind: adjustment(key), courses: courses(key)
    });
  }
  return days;
}

export function scheduleMonthRows(days: ScheduleMonthDay[]): ScheduleMonthDay[][] {
  const rows: ScheduleMonthDay[][] = [];
  for (let index = 0; index < days.length; index += 7) rows.push(days.slice(index, index + 7));
  return rows;
}

/** "2026 年 10 月" */
export function scheduleMonthTitle(anchor: string): string {
  const parts = (anchor ?? '').split('-');
  return parts.length >= 2 ? `${parts[0]} 年 ${Number(parts[1])} 月` : anchor;
}

function chineseNumber(value: number): string {
  const digits: string[] = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 0 || value > 31) return String(value);
  if (value < 10) return digits[value];
  return (value < 20 ? '十' : digits[Math.floor(value / 10)] + '十') + (value % 10 === 0 ? '' : digits[value % 10]);
}

/** "二〇二六年 · 十月" */
export function schedulePaperMonthTitle(date: string): string {
  const parts = (date ?? '').split('-');
  const digits: string[] = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (parts.length !== 3 || !Number.isInteger(Number(parts[1]))) return date;
  let year = '';
  for (let index = 0; index < parts[0].length; index += 1) year += digits[Number(parts[0].charAt(index))] ?? '';
  return `${year}年 · ${chineseNumber(Number(parts[1]))}月`;
}

/** "10 月 7 日 · 周三" */
export function scheduleSelectedDateTitle(date: string): string {
  const parts = (date ?? '').split('-');
  const labels: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const weekday = scheduleDateWeekday(date);
  if (parts.length !== 3 || !weekday) return date;
  return `${Number(parts[1])} 月 ${Number(parts[2])} 日 · ${labels[weekday - 1]}`;
}

/** At most four characters a row; the full name stays in the list below and for screen readers. */
export function scheduleShortCourseName(name: string): string {
  const characters = Array.from((name ?? '').trim());
  return characters.length <= 4 ? characters.join('') : characters.slice(0, 3).join('') + '…';
}

/** What an adjusted date means, in words. */
export function scheduleAdjustmentText(adjustment: NativeScheduleAdjustment): string {
  if (adjustment.kind === 'swap' && !adjustment.source) return '补班，课程待确认';
  const note = (adjustment.note ?? '').trim();
  if (note) return note;
  if (adjustment.kind === 'off') return '放假，不上课';
  const parts = (adjustment.source ?? '').split('-');
  return parts.length === 3 ? `上 ${parts[1]}.${parts[2]} 的课` : '调课';
}

/** "第 9 节" for one period, "第 5-6 节" otherwise. */
export function scheduleMonthSlotLabel(startSlot: number, endSlot: number): string {
  return startSlot === endSlot ? `第 ${startSlot} 节` : `第 ${startSlot}-${endSlot} 节`;
}
