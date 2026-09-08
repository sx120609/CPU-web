import { NativeScheduleStore, NativeCourseBlock } from './NativeScheduleStore';

const STARTS: string[] = ['08:00','08:55','09:55','10:50','13:30','14:25','15:25','16:20','18:30','19:25','20:20'];
const ENDS: string[] = ['08:45','09:40','10:40','11:35','14:15','15:10','16:10','17:05','19:15','20:10','21:05'];
const DAYS: string[] = ['周一','周二','周三','周四','周五','周六','周日'];

export function scheduleText(store: NativeScheduleStore): string {
  const lines: string[] = [`药大拾间 · ${store.selectedSemester} 第 ${store.selectedWeek} 周`];
  for (let day = 1; day <= 7; day++) {
    const blocks = store.blocksForDay(day);
    if (!blocks.length) continue;
    lines.push('', `${DAYS[day - 1]} ${store.dayDate(day)}`);
    blocks.forEach((block: NativeCourseBlock) => {
      lines.push(`${STARTS[block.startSlot - 1] || ''}–${ENDS[block.endSlot - 1] || ''} ${block.course.name}`);
      if (block.course.location) lines.push(block.course.location);
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

export function scheduleCalendar(store: NativeScheduleStore): string {
  const week = store.calendar?.weeks?.find(item => item.week === Number(store.selectedWeek));
  if (!week?.days?.length) throw new Error('当前校历没有明确日期，暂时无法导出日历');
  const lines: string[] = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CPU Time//HarmonyOS Schedule//ZH','CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  for (let day = 1; day <= 7; day++) {
    store.blocksForDay(day).forEach((block: NativeCourseBlock, index: number) => {
      const date = week.days[day - 1];
      const start = STARTS[block.startSlot - 1];
      const end = ENDS[block.endSlot - 1];
      if (!date || !start || !end) throw new Error('课程日期或节次不完整，无法安全导出');
      lines.push('BEGIN:VEVENT', `UID:${date}-${day}-${block.startSlot}-${index}@harmony.cputime.cn`,
        `DTSTAMP:${stamp}`, `DTSTART:${utcDate(date, start)}`, `DTEND:${utcDate(date, end)}`,
        `SUMMARY:${escapeText(block.course.name)}`, `LOCATION:${escapeText(block.course.location || '')}`,
        `DESCRIPTION:${escapeText(block.course.teacher || '')}`, 'END:VEVENT');
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
