import { NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';

// 上课闹钟 (NapTable's 作息响铃, iOS NativeRoutineAlarms): an alarm before the first class of a
// morning and one before the first class after the noon break, for the next seven days. Days off,
// make-up days and single meetings moved or cancelled are already in the timetable it reads.

export const ALARM_MORNING_LEADS: number[] = [30, 45, 60, 90];
export const ALARM_NAP_LEADS: number[] = [10, 15, 20, 30];
// A class beginning before this (minutes) is a morning class.
const MORNING_ENDS: number = 12 * 60;
export const ALARM_DAYS: number = 7;

/** One day's classes as clock minutes, in order. */
export interface AlarmMeeting {
  start: number;
  end: number;
  name: string;
}

export interface ClassAlarm {
  // morning | nap
  kind: string;
  date: string;
  // Epoch milliseconds, in the timetable's time zone (UTC+8).
  at: number;
  title: string;
}

function clockMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The epoch time of `minute` on `date` in Beijing time. */
export function alarmMoment(date: string, minute: number): number {
  return Date.UTC(Number(date.substring(0, 4)), Number(date.substring(5, 7)) - 1, Number(date.substring(8, 10)), 0, minute) - 8 * 3600000;
}

/**
 * The alarms the timetable calls for, from `now` to seven days ahead. `morning` and `nap` are the
 * leads in minutes, 0 for off. An afternoon class that follows on from a morning one without a
 * break of half an hour gets no alarm of its own.
 */
export function planClassAlarms(meetings: (date: string) => AlarmMeeting[], today: string, morning: number, nap: number,
  now: number): ClassAlarm[] {
  const result: ClassAlarm[] = [];
  if (!morning && !nap) return result;
  for (let offset = 0; offset < ALARM_DAYS; offset += 1) {
    const date = new Date(Date.UTC(Number(today.substring(0, 4)), Number(today.substring(5, 7)) - 1, Number(today.substring(8, 10)) + offset))
      .toISOString().substring(0, 10);
    const list = meetings(date).slice().sort((left: AlarmMeeting, right: AlarmMeeting) => left.start - right.start);
    if (!list.length) continue;
    const first = list[0];
    if (morning > 0 && first.start < MORNING_ENDS && first.start - morning >= 0) {
      const at = alarmMoment(date, first.start - morning);
      if (at > now) result.push({ kind: 'morning', date, at, title: `早课：${clockText(first.start)}「${first.name}」` });
    }
    const afternoon = list.find((item: AlarmMeeting) => item.start >= MORNING_ENDS);
    if (nap > 0 && afternoon && !list.some((item: AlarmMeeting) => item.start < MORNING_ENDS && item.end > afternoon.start - 30)) {
      const at = alarmMoment(date, afternoon.start - nap);
      if (at > now) result.push({ kind: 'nap', date, at, title: `午休结束：${clockText(afternoon.start)}「${afternoon.name}」` });
    }
  }
  return result;
}

/** The meetings of a date from a store holding the whole term. */
export function alarmMeetings(store: NativeScheduleStore, date: string): AlarmMeeting[] {
  const list: AlarmMeeting[] = [];
  store.blocksOnDate(date).forEach((block: NativeCourseBlock) => {
    const start = clockMinutes(store.blockStart(block));
    const end = clockMinutes(store.blockEnd(block));
    if (start >= 0 && end > start) list.push({ start, end, name: block.course.name });
  });
  return list;
}

/** "45 分钟", "1 小时 30 分". */
export function alarmLeadText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  return minutes % 60 === 0 ? `${minutes / 60} 小时` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
