import { NativeCalendarWeek, NativeScheduleStore, NativeCourseBlock } from './NativeScheduleStore';
import { scheduleCleanLocation, scheduleClockMinutes } from './ScheduleStyle';

const DAYS: string[] = ['周一','周二','周三','周四','周五','周六','周日'];

// A course on its own time exports that time, not the bell times of the periods it is drawn on.
function blockTimes(store: NativeScheduleStore, block: NativeCourseBlock): string[] {
  const start = (block.course.customStartTime ?? '').trim();
  const end = (block.course.customEndTime ?? '').trim();
  return scheduleClockMinutes(start) >= 0 && scheduleClockMinutes(end) > scheduleClockMinutes(start)
    ? [start, end] : [store.slotStart(block.startSlot), store.slotEnd(block.endSlot)];
}

export function scheduleText(store: NativeScheduleStore): string {
  const lines: string[] = [`药大拾间 · ${store.selectedSemester} 第 ${store.selectedWeek} 周`];
  for (let day = 1; day <= 7; day++) {
    const blocks = store.blocksForDay(day);
    if (!blocks.length) continue;
    lines.push('', `${DAYS[day - 1]} ${store.dayDate(day)}`);
    blocks.forEach((block: NativeCourseBlock) => {
      const times = blockTimes(store, block);
      lines.push(`${times[0]}–${times[1]} ${block.course.name}`);
      if (scheduleCleanLocation(block.course.location)) lines.push(scheduleCleanLocation(block.course.location));
    });
  }
  return lines.join('\n');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  let folded = '';
  let bytes = 0;
  for (const character of line) {
    const point = character.codePointAt(0) ?? 0;
    const size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes + size > 75) { folded += '\r\n '; bytes = 1; }
    folded += character;
    bytes += size;
  }
  return folded;
}

function utcDate(date: string, time: string): string {
  return new Date(`${date}T${time}:00+08:00`).toISOString().replace(/[-:]/g, '').replace('.000', '');
}

/**
 * The whole term as one calendar file: every date of the calendar with the courses actually held
 * then. Days off have none, make-up days carry the day they make up, and a meeting cancelled or
 * moved on its own is where the site put it. `store` must hold the complete term.
 */
export function scheduleSemesterCalendar(store: NativeScheduleStore): string {
  const weeks: NativeCalendarWeek[] = store.calendar?.weeks ?? [];
  if (!weeks.length || !store.completeSemester) throw new Error('整学期课表还没有加载完，请刷新课表后再试');
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CPU Time//HarmonyOS Schedule//ZH', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:' + escapeText(`课表 ${store.selectedSemester}`)];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  let count = 0;
  weeks.forEach((week: NativeCalendarWeek) => {
    (week.days ?? []).forEach((date: string) => {
      store.blocksOnDate(date).forEach((block: NativeCourseBlock, index: number) => {
        const times = blockTimes(store, block);
        if (!date || !times[0] || !times[1]) return;
        count += 1;
        lines.push('BEGIN:VEVENT', `UID:${date}-${block.startSlot}-${index}-${count}@harmony.cputime.cn`,
          `DTSTAMP:${stamp}`, `DTSTART:${utcDate(date, times[0])}`, `DTEND:${utcDate(date, times[1])}`,
          `SUMMARY:${escapeText(block.course.name)}`, `LOCATION:${escapeText(scheduleCleanLocation(block.course.location))}`,
          `DESCRIPTION:${escapeText([block.course.teacher || '', block.course.occurrenceFrom ? '调课' : ''].filter((value: string) => !!value).join(' · '))}`,
          'END:VEVENT');
      });
    });
  });
  if (!count) throw new Error('这个学期没有可以导出的课程');
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function scheduleCalendar(store: NativeScheduleStore): string {
  const week = store.calendar?.weeks?.find(item => item.week === Number(store.selectedWeek));
  if (!week?.days?.length) throw new Error('当前校历没有明确日期，暂时无法导出日历');
  const lines: string[] = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CPU Time//HarmonyOS Schedule//ZH','CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  for (let day = 1; day <= 7; day++) {
    store.blocksForDay(day).forEach((block: NativeCourseBlock, index: number) => {
      const date = week.days[day - 1];
      const times = blockTimes(store, block);
      const start = times[0];
      const end = times[1];
      if (!date || !start || !end) throw new Error('课程日期或节次不完整，无法安全导出');
      lines.push('BEGIN:VEVENT', `UID:${date}-${day}-${block.startSlot}-${index}@harmony.cputime.cn`,
        `DTSTAMP:${stamp}`, `DTSTART:${utcDate(date, start)}`, `DTEND:${utcDate(date, end)}`,
        `SUMMARY:${escapeText(block.course.name)}`, `LOCATION:${escapeText(scheduleCleanLocation(block.course.location))}`,
        `DESCRIPTION:${escapeText(block.course.teacher || '')}`, 'END:VEVENT');
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
