import { NativeCalendarPeriod, NativeCalendarWeek, NativeScheduleAdjustment, NativeScheduleCalendar,
  NativeScheduleCell, NativeScheduleCourse, NativeSchedulePeriod, NativeScheduleSemester, NativeScheduleSnapshot,
  NativeScheduleWeek } from './NativeScheduleStore';

// Shared timetables (NativeSharedSchedule on iOS): what the server says about a share, somebody
// else's timetable saved whole on this device, and the reader's library of them, as plain values
// so the rules can be checked without a device.

/** What the server says about a share without the timetable itself. */
export interface ScheduleShareMeta {
  code: string;
  // The nickname the publisher shared under; "同学" when they gave none.
  owner: string;
  semester: string;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedScheduleCalendar {
  semesterStart: string;
  semesterEnd: string;
  weeks: NativeCalendarWeek[];
  periods: NativeCalendarPeriod[];
  adjustments: NativeScheduleAdjustment[];
}

/**
 * Somebody else's timetable. It carries the publisher's own calendar (first Monday, week count,
 * make-up days), so it is laid out with theirs rather than the reader's.
 */
export interface SharedSchedule {
  meta: ScheduleShareMeta;
  cells: NativeScheduleCell[];
  calendar: SharedScheduleCalendar;
  // The reader's own name for it; only on this device.
  remark: string;
  fetchedAt: number;
  // The publisher withdrew the share. The saved copy still opens, it just will not change again.
  revoked: boolean;
}

export interface SharedScheduleLibrary {
  // The account the library was saved under. A different account signing in starts from an empty one.
  account: string;
  schedules: SharedSchedule[];
}

// The server's share document, before anything in it is trusted.
interface RawShareCourse {
  name?: string;
  teacher?: string;
  weeks?: string;
  weekList?: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  customStartTime?: string;
  customEndTime?: string;
}
interface RawShareCell { day?: number; bigSlot?: number; courses?: RawShareCourse[]; }
interface RawShareSchedule { cells?: RawShareCell[]; }
interface RawShareWeek { week?: number; days?: string[]; }
interface RawSharePeriod { id?: number; number?: number; name?: string; start?: string; end?: string; startTime?: string; endTime?: string; }
interface RawShareAdjustment { date?: string; kind?: string; source?: string; note?: string; }
interface RawShareCalendar {
  semesterStart?: string;
  semesterEnd?: string;
  weeks?: RawShareWeek[];
  periods?: RawSharePeriod[];
  adjustments?: RawShareAdjustment[];
}
export interface RawShareDocument {
  code?: string;
  owner?: string;
  semester?: string;
  courseCount?: number;
  createdAt?: string;
  updatedAt?: string;
  created?: boolean;
  changed?: boolean;
  schedule?: RawShareSchedule;
  calendar?: RawShareCalendar;
}

// The request body for publishing, in the shape the Web share page reads.
interface PublishCourse {
  name: string;
  weeks: string;
  weekList: number[];
  teacher?: string;
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  customStartTime?: string;
  customEndTime?: string;
}
interface PublishCell { day: number; bigSlot: number; courses: PublishCourse[]; }
interface PublishWeekOption { value: string; label: string; current: boolean; }
interface PublishSchedule {
  scope: string;
  semesters: NativeScheduleSemester[];
  weeks: PublishWeekOption[];
  currentSemester: string;
  currentWeek: string;
  cells: PublishCell[];
}
interface PublishCalendar {
  currentSemester: string;
  currentWeek: number;
  semesterStart: string;
  semesterEnd: string;
  weeks: NativeCalendarWeek[];
  periods: NativeCalendarPeriod[];
  adjustments: NativeScheduleAdjustment[];
}
export interface SharePublishBody {
  semester: string;
  schedule: PublishSchedule;
  calendar: PublishCalendar;
}

export const SHARED_SCHEDULE_MAX_COURSES: number = 600;
const CODE_ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

function text(value?: string, limit: number = 120): string {
  return typeof value === 'string' ? value.trim().substring(0, limit) : '';
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }

/**
 * A share code out of whatever was typed or pasted: any case, spaces or dashes, or a whole
 * `/schedule/share/CODE` link. Empty when none is there.
 */
export function normalizedShareCode(input: string): string {
  let value = (input ?? '').trim();
  const marker = value.toLowerCase().indexOf('/schedule/share/');
  if (marker >= 0) {
    value = value.substring(marker + '/schedule/share/'.length);
    const stop = value.search(/[?#/]/);
    if (stop >= 0) value = value.substring(0, stop);
  }
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== 8) return '';
  for (let index = 0; index < code.length; index += 1) {
    if (!CODE_ALPHABET.includes(code.charAt(index))) return '';
  }
  return code;
}

export function shareMetaFrom(raw: RawShareDocument): ScheduleShareMeta {
  return { code: text(raw.code, 16).toUpperCase(), owner: text(raw.owner, 40), semester: text(raw.semester, 80),
    courseCount: Number.isInteger(raw.courseCount) ? Number(raw.courseCount) : 0,
    createdAt: text(raw.createdAt, 40), updatedAt: text(raw.updatedAt, 40) };
}

/** The publisher's nickname, when they shared under one. */
export function shareOwnerName(meta: ScheduleShareMeta): string {
  const value = meta.owner.trim();
  return value === '同学' ? '' : value;
}

/** The remark wins: a nickname is the publisher's choice and may be shared by many. */
export function sharedScheduleName(schedule: SharedSchedule): string {
  return schedule.remark.trim() || shareOwnerName(schedule.meta) || '共享课表';
}

function utcTime(date: string): number {
  const parts = (date ?? '').trim().split('-');
  if (parts.length !== 3 || parts[0].length !== 4) return NaN;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return NaN;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? time : NaN;
}

/**
 * Seven dates, Monday first, out of a week as 教务 lists it: the list may start on Sunday or miss
 * days. The Web share page reads a week the same way (`normalizeCalendarWeekDays`), and a share
 * published there keeps the raw list. Empty when no entry is a date.
 */
export function mondayFirstDays(raw: string[]): string[] {
  // 1 is Monday, 7 is Sunday.
  const weekday = (time: number): number => (new Date(time).getUTCDay() + 6) % 7 + 1;
  const indexes: number[] = [];
  const times: number[] = [];
  (raw ?? []).forEach((value: string, index: number) => {
    const time = utcTime(String(value ?? ''));
    if (!isNaN(time)) { indexes.push(index); times.push(time); }
  });
  if (!times.length) return [];
  let sundayFirst = 0;
  let mondayFirst = 0;
  times.forEach((time: number, position: number) => {
    const index = indexes[position];
    if (weekday(time) === (index === 0 ? 7 : index)) sundayFirst += 1;
    if (weekday(time) === index + 1) mondayFirst += 1;
  });
  const offset = sundayFirst > mondayFirst ? (indexes[0] === 0 ? -1 : indexes[0] - 1) : indexes[0];
  const monday = times[0] - offset * 86400000;
  const days: string[] = [];
  for (let day = 0; day < 7; day += 1) days.push(new Date(monday + day * 86400000).toISOString().substring(0, 10));
  return days;
}

/**
 * Reads the server's share document. The server checks little more than that every course has a
 * name, so everything a grid indexes with is clamped here: a bad row is dropped instead of drawn
 * somewhere it cannot be. Throws an `Error` whose message can be shown.
 */
export function readSharedSchedule(document: RawShareDocument, fetchedAt: number): SharedSchedule {
  const meta = shareMetaFrom(document);
  let remaining = SHARED_SCHEDULE_MAX_COURSES;
  const cells: NativeScheduleCell[] = [];
  (Array.isArray(document.schedule?.cells) ? document.schedule?.cells ?? [] : []).forEach((cell: RawShareCell) => {
    const day = Number(cell?.day);
    const bigSlot = Number(cell?.bigSlot);
    if (!Number.isInteger(day) || day < 1 || day > 7 || !Number.isInteger(bigSlot) || bigSlot < 1 || bigSlot > 20) return;
    const courses: NativeScheduleCourse[] = [];
    (Array.isArray(cell.courses) ? cell.courses ?? [] : []).forEach((course: RawShareCourse) => {
      const name = text(course?.name, 80);
      if (!name || remaining <= 0) return;
      const weekList: number[] = [];
      (Array.isArray(course.weekList) ? course.weekList ?? [] : []).forEach((week: number) => {
        if (Number.isInteger(week) && week >= 1 && week <= 64 && !weekList.includes(week)) weekList.push(week);
      });
      weekList.sort((a: number, b: number) => a - b);
      // Edit identities belong to the publisher's account; a reader cannot edit this timetable,
      // so they are left behind.
      const saved: NativeScheduleCourse = { name, weeks: text(course.weeks, 120), weekList };
      if (text(course.teacher, 80)) saved.teacher = text(course.teacher, 80);
      if (text(course.location, 80)) saved.location = text(course.location, 80);
      if (text(course.slotNote, 120)) saved.slotNote = text(course.slotNote, 120);
      if (Number.isInteger(course.startSlot)) saved.startSlot = Math.min(Math.max(Number(course.startSlot), 1), 20);
      if (Number.isInteger(course.endSlot)) saved.endSlot = Math.min(Math.max(Number(course.endSlot), saved.startSlot ?? 1), 20);
      if (text(course.customStartTime, 8)) saved.customStartTime = text(course.customStartTime, 8);
      if (text(course.customEndTime, 8)) saved.customEndTime = text(course.customEndTime, 8);
      courses.push(saved);
      remaining -= 1;
    });
    if (courses.length) cells.push({ day, bigSlot, courses });
  });
  if (!cells.length) throw new Error('这份共享课表里没有课程');

  const weeks: NativeCalendarWeek[] = [];
  (Array.isArray(document.calendar?.weeks) ? document.calendar?.weeks ?? [] : []).forEach((week: RawShareWeek) => {
    const number = Number(week?.week);
    if (!Number.isInteger(number) || number < 1 || number > 64 || weeks.some((item: NativeCalendarWeek) => item.week === number)) return;
    const days = mondayFirstDays(Array.isArray(week.days) ? week.days ?? [] : []);
    if (days.length === 7) weeks.push({ week: number, days, monday: days[0], sunday: days[6] });
  });
  weeks.sort((left: NativeCalendarWeek, right: NativeCalendarWeek) => left.week - right.week);
  if (!weeks.length) throw new Error('这份共享课表没有校历，无法按周显示');

  const periods: NativeCalendarPeriod[] = [];
  (Array.isArray(document.calendar?.periods) ? document.calendar?.periods ?? [] : []).forEach((period: RawSharePeriod) => {
    const id = Number(period?.id ?? period?.number);
    const start = text(period?.start ?? period?.startTime, 8);
    const end = text(period?.end ?? period?.endTime, 8);
    if (Number.isInteger(id) && id >= 1 && id <= 30 && start && end && !periods.some((item: NativeCalendarPeriod) => item.id === id)) {
      periods.push({ id, name: `第${id}节`, start, end });
    }
  });
  const adjustments: NativeScheduleAdjustment[] = [];
  (Array.isArray(document.calendar?.adjustments) ? document.calendar?.adjustments ?? [] : []).forEach((item: RawShareAdjustment) => {
    const kind = text(item?.kind, 8);
    const date = text(item?.date, 10);
    if ((kind !== 'off' && kind !== 'swap') || isNaN(utcTime(date))) return;
    const adjustment: NativeScheduleAdjustment = { date, kind };
    if (text(item.source, 10)) adjustment.source = text(item.source, 10);
    if (text(item.note, 80)) adjustment.note = text(item.note, 80);
    adjustments.push(adjustment);
  });
  return { meta, cells, remark: '', fetchedAt, revoked: false,
    calendar: { semesterStart: text(document.calendar?.semesterStart, 10), semesterEnd: text(document.calendar?.semesterEnd, 10),
      weeks, periods, adjustments } };
}

/** `yyyy-MM-dd` in the timetable's time zone (Asia/Shanghai). */
export function shareDateKey(timestamp: number): string {
  return new Date(timestamp + 8 * 3600000).toISOString().substring(0, 10);
}

/**
 * The week `today` falls in. Before the term it is the first week and after it the last, so the
 * grid always has a week to show.
 */
export function sharedScheduleWeek(schedule: SharedSchedule, today: string): number {
  const weeks = schedule.calendar.weeks;
  const found = weeks.find((week: NativeCalendarWeek) => week.days.includes(today));
  if (found) return found.week;
  if (!weeks.length) return 1;
  return today < (weeks[0].days[0] ?? '') ? weeks[0].week : weeks[weeks.length - 1].week;
}

/** The semester value of the store showing a share. Prefixed so nothing mixes it up with one of the reader's own terms. */
export function sharedSemesterValue(schedule: SharedSchedule): string { return `share:${schedule.meta.code}`; }

/**
 * A complete-semester snapshot of the share, as the timetable store takes it. The current week is
 * worked out from `now`: the one saved in the share is whatever week the publisher shared it in.
 */
export function sharedScheduleSnapshot(schedule: SharedSchedule, now: number): NativeScheduleSnapshot {
  const current = sharedScheduleWeek(schedule, shareDateKey(now));
  const value = sharedSemesterValue(schedule);
  const semesters: NativeScheduleSemester[] = [{ value, label: sharedScheduleName(schedule), current: true }];
  const weeks: NativeScheduleWeek[] = schedule.calendar.weeks.map((week: NativeCalendarWeek): NativeScheduleWeek =>
    ({ value: String(week.week), label: `第 ${week.week} 周`, current: week.week === current }));
  const calendar: NativeScheduleCalendar = { source: 'shared', semesters, currentSemester: value, currentWeek: current,
    semesterStart: schedule.calendar.semesterStart, semesterEnd: schedule.calendar.semesterEnd,
    weeks: schedule.calendar.weeks, periods: schedule.calendar.periods, adjustments: schedule.calendar.adjustments };
  return { version: 1, completeSemester: true, source: 'shared', fetchedAt: schedule.fetchedAt,
    auth: { authenticated: true },
    data: { source: 'shared', semesters, weeks, currentSemester: value, currentWeek: String(current), cells: schedule.cells },
    calendar };
}

/**
 * The request body for publishing `snapshot`. Only what a reader needs to draw the timetable goes
 * out: the publisher's list of terms and the identities that tie a course to their account stay
 * behind. Throws an `Error` whose message can be shown.
 */
export function sharePublishBody(snapshot: NativeScheduleSnapshot | undefined, fallbackPeriods: NativeSchedulePeriod[]): SharePublishBody {
  const semester = (snapshot?.data?.currentSemester ?? '').trim();
  if (!snapshot || !snapshot.completeSemester || !snapshot.auth?.authenticated || !snapshot.data || !semester) {
    throw new Error('整学期课表还没有加载完，请刷新课表后再试');
  }
  const calendar = snapshot.calendar;
  if (!calendar || !calendar.weeks?.length) throw new Error('课表还没有校历，暂时不能分享');
  const cells: PublishCell[] = [];
  snapshot.data.cells.forEach((cell: NativeScheduleCell) => {
    const courses: PublishCourse[] = [];
    cell.courses.forEach((course: NativeScheduleCourse) => {
      const name = (course.name ?? '').trim();
      if (!name) return;
      const item: PublishCourse = { name, weeks: course.weeks ?? '', weekList: course.weekList ?? [] };
      if (course.teacher) item.teacher = course.teacher;
      if (course.location) item.location = course.location;
      if (course.slotNote) item.slotNote = course.slotNote;
      if (Number.isInteger(course.startSlot)) item.startSlot = course.startSlot;
      if (Number.isInteger(course.endSlot)) item.endSlot = course.endSlot;
      if (course.customStartTime) item.customStartTime = course.customStartTime;
      if (course.customEndTime) item.customEndTime = course.customEndTime;
      courses.push(item);
    });
    if (courses.length) cells.push({ day: cell.day, bigSlot: cell.bigSlot, courses });
  });
  if (!cells.length) throw new Error('这个学期没有课程，没有可以分享的内容');
  const periods: NativeCalendarPeriod[] = calendar.periods?.length
    ? calendar.periods.map((period: NativeCalendarPeriod): NativeCalendarPeriod =>
      ({ id: period.id, name: `第${period.id}节`, start: period.start, end: period.end }))
    : (snapshot.periods?.length ? snapshot.periods : fallbackPeriods).map((period: NativeSchedulePeriod): NativeCalendarPeriod =>
      ({ id: period.number, name: `第${period.number}节`, start: period.startTime, end: period.endTime }));
  const weeks: NativeCalendarWeek[] = calendar.weeks.map((week: NativeCalendarWeek): NativeCalendarWeek =>
    ({ week: week.week, days: week.days, monday: week.monday, sunday: week.sunday }));
  const adjustments: NativeScheduleAdjustment[] = (calendar.adjustments ?? []).map((item: NativeScheduleAdjustment): NativeScheduleAdjustment => {
    const adjustment: NativeScheduleAdjustment = { date: item.date, kind: item.kind };
    if (item.source) adjustment.source = item.source;
    if (item.note) adjustment.note = item.note;
    return adjustment;
  });
  return {
    semester,
    schedule: { scope: 'semester', semesters: [],
      weeks: weeks.map((week: NativeCalendarWeek): PublishWeekOption => ({ value: String(week.week), label: `第 ${week.week} 周`, current: false })),
      currentSemester: semester, currentWeek: String(weeks[0].week), cells },
    calendar: { currentSemester: semester, currentWeek: weeks[0].week, semesterStart: calendar.semesterStart ?? '',
      semesterEnd: calendar.semesterEnd ?? '', weeks, periods, adjustments }
  };
}

/** What the share sheet sends: the code, where to type it, and the link that opens it in a browser. */
export function shareInvitation(code: string, origin: string): string {
  let base = origin;
  while (base.endsWith('/')) base = base.substring(0, base.length - 1);
  return `我的课表分享码：${code}\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：${base}/schedule/share/${code}`;
}

/** "10 月 7 日 08:05" from an ISO timestamp, in the timetable's time zone; empty when it is not one. */
export function shareTimeLabel(iso: string): string {
  const time = Date.parse(iso ?? '');
  if (isNaN(time)) return '';
  const local = new Date(time + 8 * 3600000);
  return `${local.getUTCMonth() + 1} 月 ${local.getUTCDate()} 日 ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
}

// ---- The reader's library ----

export function emptySharedLibrary(): SharedScheduleLibrary { return { account: '', schedules: [] }; }

/** A saved library read back from disk; anything unreadable is an empty one. */
export function parseSharedLibrary(raw: string): SharedScheduleLibrary {
  try {
    const saved = JSON.parse(raw) as SharedScheduleLibrary;
    if (!saved || typeof saved.account !== 'string' || !Array.isArray(saved.schedules)) return emptySharedLibrary();
    const schedules = saved.schedules.filter((item: SharedSchedule) => {
      return !!item && !!item.meta && typeof item.meta.code === 'string' && Array.isArray(item.cells)
        && !!item.calendar && Array.isArray(item.calendar.weeks) && item.calendar.weeks.length > 0;
    });
    return { account: saved.account, schedules };
  } catch (_) {
    return emptySharedLibrary();
  }
}

function withRemark(schedule: SharedSchedule, remark: string): SharedSchedule {
  return { meta: schedule.meta, cells: schedule.cells, calendar: schedule.calendar, remark: remark.trim().substring(0, 20),
    fetchedAt: schedule.fetchedAt, revoked: schedule.revoked };
}

/** Saves a previewed share under the reader's remark. Importing a code again replaces the saved copy. */
export function librarySave(library: SharedScheduleLibrary, schedule: SharedSchedule, remark: string): SharedScheduleLibrary {
  const saved = withRemark(schedule, remark);
  const exists = library.schedules.some((item: SharedSchedule) => item.meta.code === saved.meta.code);
  return { account: library.account, schedules: exists
    ? library.schedules.map((item: SharedSchedule) => item.meta.code === saved.meta.code ? saved : item)
    : library.schedules.concat([saved]) };
}

/** A newer download of a saved share. The remark stays. */
export function libraryRefresh(library: SharedScheduleLibrary, schedule: SharedSchedule): SharedScheduleLibrary {
  return { account: library.account, schedules: library.schedules.map((item: SharedSchedule) => {
    return item.meta.code === schedule.meta.code ? withRemark(schedule, item.remark) : item;
  }) };
}

export function libraryRename(library: SharedScheduleLibrary, code: string, remark: string): SharedScheduleLibrary {
  return { account: library.account, schedules: library.schedules.map((item: SharedSchedule) => {
    return item.meta.code === code ? withRemark(item, remark) : item;
  }) };
}

/** The publisher withdrew it: keep the copy, stop treating it as live. */
export function libraryMarkRevoked(library: SharedScheduleLibrary, code: string): SharedScheduleLibrary {
  return { account: library.account, schedules: library.schedules.map((item: SharedSchedule): SharedSchedule => {
    return item.meta.code !== code ? item : { meta: item.meta, cells: item.cells, calendar: item.calendar, remark: item.remark,
      fetchedAt: item.fetchedAt, revoked: true };
  }) };
}

export function libraryRemove(library: SharedScheduleLibrary, code: string): SharedScheduleLibrary {
  return { account: library.account, schedules: library.schedules.filter((item: SharedSchedule) => item.meta.code !== code) };
}

/**
 * Starts over when another account signs in. An empty account (signed out, or a Web build that
 * sends none) changes nothing.
 */
export function libraryAdopt(library: SharedScheduleLibrary, account: string): SharedScheduleLibrary {
  const next = (account ?? '').trim();
  if (!next || next === library.account) return library;
  return { account: next, schedules: library.account ? [] : library.schedules };
}
