import { NativeCalendarWeek, NativeCourseBlock, NativeOccurrenceChange, NativeScheduleCell,
  NativeScheduleCourse } from './NativeScheduleStore';

// Single meetings changed on their own (iOS ScheduleCourseMenu / ScheduleOccurrenceEditor): 这次停课,
// 调整这一次 and 恢复原安排. The server keeps the changes with the schedule edits and the site writes
// them into the timetable (server/src/shared/scheduleOccurrences.ts); these are the rules the app
// needs around that, as plain values so they can be checked without a device.

const WEEKDAYS: string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** One entry of the long-press menu of a course. */
export interface CourseMenuAction {
  // detail | edit | adjust | cancel | readjust | restore | agenda
  id: string;
  label: string;
  destructive: boolean;
  // Entries of one group are drawn together; a divider goes between groups.
  group: number;
}

/** What the long-press menu needs to know about a course and the timetable it is on. */
export interface CourseMenuInput {
  partner: boolean;
  cancelled: boolean;
  moved: boolean;
  // The timetable can be edited (the user's own, not a graduate's).
  editable: boolean;
  // The site keeps single-meeting changes.
  occurrences: boolean;
  // The date of this meeting; empty when the calendar has none.
  date: string;
  // The date is a day off or a make-up day: its meetings cannot be changed one by one.
  adjusted: boolean;
  agenda: boolean;
}

/** "11月12日 周四" for yyyy-MM-dd; the input itself when it is not a date. */
export function occurrenceDateText(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return date ?? '';
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${Number(match[2])}月${Number(match[3])}日 ${WEEKDAYS[new Date(time).getUTCDay()]}`;
}

/** The long-press menu, iOS's order: look and edit, this meeting, then the rest. */
export function courseMenuActions(input: CourseMenuInput): CourseMenuAction[] {
  const actions: CourseMenuAction[] = [{ id: 'detail', label: '查看详情', destructive: false, group: 0 }];
  if (input.partner) return actions;
  if (input.cancelled) {
    return [{ id: 'restore', label: '恢复原安排', destructive: false, group: 0 },
      { id: 'detail', label: '查看详情', destructive: false, group: 1 }];
  }
  if (input.editable && !input.moved) actions.push({ id: 'edit', label: '编辑整门课', destructive: false, group: 0 });
  if (input.editable && input.occurrences && input.date && !input.adjusted) {
    if (input.moved) {
      actions.push({ id: 'readjust', label: '再调整这一次', destructive: false, group: 1 });
      actions.push({ id: 'restore', label: '恢复原安排', destructive: false, group: 1 });
    } else {
      actions.push({ id: 'adjust', label: '调整这一次', destructive: false, group: 1 });
      actions.push({ id: 'cancel', label: '这次停课', destructive: true, group: 1 });
    }
  }
  if (input.agenda && input.date) actions.push({ id: 'agenda', label: '在这节课加日程', destructive: false, group: 2 });
  return actions;
}

/** The edit keys a meeting of this course is saved under: one per row the site merged into it. */
export function occurrenceKeysOf(course: NativeScheduleCourse): string[] {
  return (course.editKeys ?? []).filter((key: string) => !!key);
}

/** The keys a cancelled meeting is restored under: the course's and the one the change names. */
export function cancelledKeysOf(block: NativeCourseBlock): string[] {
  const keys = occurrenceKeysOf(block.course);
  const own = block.cancelled?.key ?? '';
  return own && !keys.includes(own) ? keys.concat([own]) : keys;
}

/** The keys of every row moved together with `key` on `from` (one change per merged row). */
export function movedKeys(changes: NativeOccurrenceChange[], key: string, from: string): string[] {
  const base = changes.find((change: NativeOccurrenceChange) => change.key === key && change.date === from);
  if (!base) return [key];
  return changes.filter((change: NativeOccurrenceChange) => change.date === from && (change.key === key
    || (change.toDate === base.toDate && change.startSlot === base.startSlot && change.endSlot === base.endSlot
      && change.location === base.location))).map((change: NativeOccurrenceChange) => change.key);
}

/** Where the course normally meets, [start, end], from any of its rows; empty when none is found. */
export function originalSlotsOf(cells: NativeScheduleCell[], keys: string[]): number[] {
  for (const cell of cells) {
    for (const course of cell.courses) {
      if (!(course.editKeys ?? []).some((key: string) => keys.includes(key))) continue;
      const start = Number(course.startSlot) || cell.bigSlot * 2 - 1;
      return [start, Math.max(start, Number(course.endSlot) || cell.bigSlot * 2)];
    }
  }
  return [];
}

/** The change a 调整这一次 form makes: only what differs from the planned meeting is written down. */
export function occurrenceMove(key: string, date: string, target: string, startSlot: number, endSlot: number,
  originalStart: number, originalEnd: number, location: string, originalLocation: string, note: string): NativeOccurrenceChange {
  const change: NativeOccurrenceChange = { key, date };
  if (target && target !== date) change.toDate = target;
  if (startSlot !== originalStart || endSlot !== originalEnd) {
    change.startSlot = Math.min(startSlot, endSlot);
    change.endSlot = Math.max(startSlot, endSlot);
  }
  const room = (location ?? '').trim().substring(0, 60);
  if (room && room !== (originalLocation ?? '').trim()) change.location = room;
  const text = (note ?? '').trim().substring(0, 80);
  if (text) change.note = text;
  return change;
}

/** A change that would change nothing: the server drops it, so the form says so instead of saving it. */
export function occurrenceChangesNothing(change: NativeOccurrenceChange): boolean {
  return !change.cancelled && !change.toDate && !change.startSlot && !change.location && !change.note;
}

/** Names of the courses a moved meeting would sit on: same date, intersecting periods. */
export function occurrenceClashes(blocks: NativeCourseBlock[], keys: string[], startSlot: number, endSlot: number): string[] {
  const names: string[] = [];
  const from = Math.min(startSlot, endSlot);
  const to = Math.max(startSlot, endSlot);
  blocks.forEach((block: NativeCourseBlock) => {
    if (block.cancelled || (block.course.editKeys ?? []).some((key: string) => keys.includes(key))) return;
    if (keys.includes(block.course.occurrenceKey ?? '')) return;
    if (block.startSlot <= to && from <= block.endSlot && !names.includes(block.course.name)) names.push(block.course.name);
  });
  return names;
}

function weekText(weeks: number[]): string {
  if (!weeks.length) return '';
  const ranges: string[] = [];
  let start = weeks[0];
  let end = weeks[0];
  weeks.slice(1).forEach((week: number) => {
    if (week === end + 1) { end = week; return; }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = week; end = week;
  });
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `${ranges.join(',')}周`;
}

function weekdayOf(date: string, weeks: NativeCalendarWeek[]): number[] {
  for (const week of weeks) {
    const index = (week.days ?? []).indexOf(date);
    if (index >= 0) return [week.week, index + 1];
  }
  return [];
}

/**
 * The timetable with each change written in, as the site does it before a client sees it (the
 * acceptance harness, which has no site, uses this; `occurrence-parity.test.mjs` holds it to the
 * server's `applyOccurrenceChanges`). A cancelled meeting's week leaves the course; a moved one
 * becomes a one-week course on its new date.
 */
export function applyOccurrencesToCells(cells: NativeScheduleCell[], changes: NativeOccurrenceChange[],
  weeks: NativeCalendarWeek[]): NativeScheduleCell[] {
  if (!changes.length || !weeks.length) return cells;
  const allWeeks: number[] = weeks.map((week: NativeCalendarWeek) => week.week).filter((week: number) => week > 0)
    .sort((left: number, right: number) => left - right);
  const next: NativeScheduleCell[] = cells.map((cell: NativeScheduleCell): NativeScheduleCell => ({ day: cell.day, bigSlot: cell.bigSlot,
    courses: cell.courses.map((course: NativeScheduleCourse): NativeScheduleCourse => {
      const copy: NativeScheduleCourse = JSON.parse(JSON.stringify(course)) as NativeScheduleCourse;
      return copy;
    }) }));
  const added: NativeScheduleCell[] = [];
  changes.forEach((change: NativeOccurrenceChange) => {
    const source = weekdayOf(change.date, weeks);
    if (!source.length) return;
    // The course as planned, and its row; filled in by the loop below.
    const found: NativeScheduleCourse[] = [];
    const bigSlots: number[] = [];
    next.forEach((cell: NativeScheduleCell) => {
      if (cell.day !== source[1]) return;
      cell.courses.forEach((course: NativeScheduleCourse) => {
        if (!(course.editKeys ?? []).includes(change.key)) return;
        const listed = course.weekList?.length ? course.weekList : allWeeks;
        if (!listed.includes(source[0])) return;
        if (!found.length) {
          found.push(JSON.parse(JSON.stringify(course)) as NativeScheduleCourse);
          bigSlots.push(cell.bigSlot);
        }
        course.weekList = listed.filter((week: number) => week !== source[0]);
        if (course.sourceWeeks === undefined) course.sourceWeeks = course.weeks;
        course.weeks = weekText(course.weekList);
        // An empty list means every week, so a course whose only week this was goes.
        if (!course.weekList.length) course.name = '';
      });
      cell.courses = cell.courses.filter((course: NativeScheduleCourse) => !!course.name);
    });
    if (!found.length || change.cancelled) return;
    const from: NativeScheduleCourse = found[0];
    const originalBigSlot = bigSlots[0];
    const target = change.toDate ? weekdayOf(change.toDate, weeks) : source;
    if (!target.length) return;
    const start = change.startSlot ?? from.startSlot ?? originalBigSlot * 2 - 1;
    const end = change.endSlot ?? from.endSlot ?? Math.max(start, originalBigSlot * 2);
    const moved: NativeScheduleCourse = { name: from.name, teacher: from.teacher, weeks: `第 ${target[0]} 周`, weekList: [target[0]],
      location: change.location ?? from.location, slotNote: change.note ?? from.slotNote, startSlot: start, endSlot: end,
      occurrenceKey: change.key, occurrenceFrom: change.date, nativeId: `occ:${change.key}@${change.date}`, editKeys: from.editKeys };
    added.push({ day: target[1], bigSlot: Math.max(1, Math.ceil(start / 2)), courses: [moved] });
  });
  added.forEach((item: NativeScheduleCell) => {
    const cell = next.find((candidate: NativeScheduleCell) => candidate.day === item.day && candidate.bigSlot === item.bigSlot);
    if (cell) cell.courses.push(item.courses[0]); else next.push(item);
  });
  return next.filter((cell: NativeScheduleCell) => cell.courses.length > 0);
}
