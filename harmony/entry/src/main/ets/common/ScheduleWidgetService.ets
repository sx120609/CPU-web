import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import fs from '@ohos.file.fs';
import http from '@ohos.net.http';
import { formBindingData, formProvider } from '@kit.FormKit';
import {
  ChineseCalendar,
  ChineseCalendarDay,
  HolidayCountdown,
  PublishedHoliday,
  calendarDayBadge,
  countdownDateLabel,
  countdownPhrase,
  lunarShortLabel,
  windowDayCount
} from './ChineseCalendar';
import { systemLunarDate } from './SystemLunarCalendar';
import {
  normalizedWidgetTheme,
  widgetCourseAccent,
  widgetCourseColorIndex,
  widgetCourseTint,
  widgetThemeAccent
} from './ScheduleWidgetPalette';
import { NativeScheduleSnapshot } from '../schedule/NativeScheduleStore';
import { scheduleClassroomOnly } from '../schedule/ScheduleStyle';
import { LocalScheduleBlocks, LocalScheduleRecord, localScheduleRecord } from '../schedule/NativeWidgetLocalSchedule';

const PREFERENCES_NAME = 'schedule_widget';
const ENDPOINT_KEY = 'endpoint';
const THEME_KEY = 'theme';
const FORMS_KEY = 'forms';
const CACHE_KEY = 'cached_payload';
const CACHE_ENDPOINT_KEY = 'cached_endpoint';
const CACHE_TIME_KEY = 'cached_at';
// App 写本地课表时递增，刷新卡片途中换了数据就放弃这次结果。
const LOCAL_REVISION_KEY = 'local_revision';
// App 按日期展开写下的课表（docs/schedule-widget-rules.md 第 7 节），卡片优先读这一份。
const LOCAL_SCHEDULE_FILE = 'schedule-widget-local-days.json';
const LOCAL_SCHEDULE_MAX_BYTES = 4 * 1024 * 1024;
const DEVICE_CLOCK = new Date();
let formRecordWrite: Promise<void> = Promise.resolve();
let localScheduleWrite: Promise<void> = Promise.resolve();

interface WidgetInstallPayload {
  endpoint?: string;
  theme?: string;
}

export interface ScheduleWidgetSettings {
  configured: boolean;
  theme: string;
}

interface ScheduleCourse {
  name?: string;
  teacher?: string;
  location?: string;
  note?: string;
  slotNote?: string;
  startTime?: string;
  endTime?: string;
  startSlot?: number;
  endSlot?: number;
}

interface ScheduleDay {
  day?: number;
  label?: string;
  date?: string;
  week?: number;
  courses?: ScheduleCourse[];
}

// 一天法定放假（国务院放假安排，含连休里的周末），与 iOS 的 PublishedHoliday 同形。
interface ScheduleHoliday {
  date?: string;
  name?: string;
}

interface SchedulePayload {
  title?: string;
  semester?: string;
  week?: number;
  currentWeek?: number;
  displayWeek?: number;
  strictDate?: boolean;
  stale?: boolean;
  today?: ScheduleDay;
  days?: ScheduleDay[];
  weekDays?: ScheduleDay[];
  holidays?: ScheduleHoliday[];
}

// 本地课表文件读出来的样子，字段同 LocalScheduleRecord。
interface LocalScheduleFile {
  semester?: string;
  days?: ScheduleDay[];
  holidays?: ScheduleHoliday[];
}

interface ScheduleResponse {
  code?: number;
  message?: string;
  data?: SchedulePayload;
}

interface FormRecord {
  id: string;
  dimension: number;
  formName?: string;
}

interface WidgetCourseRow {
  name: string;
  start: string;
  time: string;
  meta: string;
  ended: boolean;
  accent: string;
  tint: string;
  // 多彩主题下取第几种颜色；深色底色随系统深浅色从资源里取，所以卡片要知道序号。
  colorIndex: number;
}

export interface ScheduleWidgetBinding {
  layout: string;
  state: string;
  title: string;
  subtitle: string;
  leftTitle: string;
  rightTitle: string;
  primaryCourses: string;
  secondaryCourses: string;
  footer: string;
  theme: string;
  accent: string;
  semester: string;
  currentWeek: number;
  primaryWeek: number;
  secondaryWeek: number;
  primaryRemaining: number;
  secondaryRemaining: number;
  dimension: number;
  variant: string;
  mode: string;
  dayNote: string;
  badge: string;
  restTitle: string;
  restDetail: string;
  lockLine: string;
  leadLabel: string;
  trailLabel: string;
  rightNote: string;
  lunar: string;
  badgeStatutory: boolean;
  // 两日课表右列那天的农历和节日（窄列里节日顶替农历）。
  rightLunar: string;
  rightBadge: string;
  rightBadgeStatutory: boolean;
  // 锁屏：矩形卡片第一行「明天 9.29 周二」，单行卡片开头「明天」或「周一」。
  lockTitle: string;
  lockDay: string;
}

interface LoadedSchedule {
  payload: SchedulePayload;
  stale: boolean;
}

interface DaySelection {
  mode: string;
  day: ScheduleDay;
  offset: number;
}

interface CourseWindow {
  courses: ScheduleCourse[];
  remainingCount: number;
}

function normalizedEndpoint(value?: string): string {
  const raw = (value ?? '').trim();
  if (!raw.toLowerCase().startsWith('https://')) return '';
  const authorityStart = 'https://'.length;
  let authorityEnd = raw.length;
  for (const separator of ['/', '?', '#']) {
    const position = raw.indexOf(separator, authorityStart);
    if (position >= 0 && position < authorityEnd) authorityEnd = position;
  }
  const host = raw.substring(authorityStart, authorityEnd).toLowerCase();
  if (host !== 'cputime.cn' && host !== 'cpu.lizmt.cn') return '';
  return `https://cputime.cn${raw.substring(authorityEnd)}`;
}

function endpointCandidates(endpoint: string): string[] {
  const candidates: string[] = [endpoint];
  const primaryPrefix = 'https://cputime.cn';
  if (endpoint.toLowerCase().startsWith(primaryPrefix)) {
    candidates.push(`https://cpu.lizmt.cn${endpoint.substring(primaryPrefix.length)}`);
  }
  return candidates;
}

async function widgetPreferences(context: common.Context): Promise<preferences.Preferences> {
  try {
    await preferences.removePreferencesFromCache(context, PREFERENCES_NAME);
  } catch (_) {
    // The store may not have been cached in this process yet.
  }
  return preferences.getPreferences(context, PREFERENCES_NAME);
}

async function formRecords(context: common.Context): Promise<FormRecord[]> {
  const prefs = await widgetPreferences(context);
  const stored = String(await prefs.get(FORMS_KEY, '[]'));
  try {
    return JSON.parse(stored) as FormRecord[];
  } catch (_) {
    return [];
  }
}

async function saveFormRecords(context: common.Context, records: FormRecord[]): Promise<void> {
  const prefs = await widgetPreferences(context);
  await prefs.put(FORMS_KEY, JSON.stringify(records));
  await prefs.flush();
}

function localSchedulePath(context: common.Context): string {
  return `${context.filesDir}/${LOCAL_SCHEDULE_FILE}`;
}

function readLocalScheduleText(context: common.Context): string {
  const path = localSchedulePath(context);
  try {
    if (fs.statSync(path).size > LOCAL_SCHEDULE_MAX_BYTES) return '';
    return fs.readTextSync(path);
  } catch (_) {
    return '';
  }
}

function readLocalSchedule(context: common.Context): LocalScheduleFile | undefined {
  const raw = readLocalScheduleText(context).trim();
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw) as LocalScheduleFile;
    if (!normalizedText(record.semester) || !Array.isArray(record.days) || record.days.length === 0) return undefined;
    return record;
  } catch (_) {
    return undefined;
  }
}

// 内容没变返回 false：不写、不刷新，省得每次切周都去催卡片。空串表示删除。
function writeLocalScheduleText(context: common.Context, raw: string): boolean {
  const path = localSchedulePath(context);
  if (raw === readLocalScheduleText(context)) return false;
  if (!raw) {
    try {
      fs.unlinkSync(path);
    } catch (_) {
      return false;
    }
    return true;
  }
  const temporary = `${path}.tmp`;
  const file = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
  try {
    fs.writeSync(file.fd, raw);
  } finally {
    fs.closeSync(file);
  }
  fs.renameSync(temporary, path);
  return true;
}

async function bumpLocalRevision(context: common.Context): Promise<void> {
  const prefs = await widgetPreferences(context);
  await prefs.put(LOCAL_REVISION_KEY, Number(await prefs.get(LOCAL_REVISION_KEY, 0)) + 1);
  await prefs.flush();
}

function enqueueLocalSchedule(task: () => Promise<void>): Promise<void> {
  const next = localScheduleWrite.then(task);
  localScheduleWrite = next.catch(() => undefined);
  return next;
}

// 课表页拿到登录后的快照（整学期或单周）就按日期展开写下来；snapshot 为 undefined 表示退出登录、
// 换账号，删掉这份，别让下一个人的卡片看到上一个人的课。写完刷新所有卡片。
export function saveLocalScheduleSnapshot(
  context: common.UIAbilityContext,
  snapshot: NativeScheduleSnapshot | undefined,
  blocks: LocalScheduleBlocks
): Promise<void> {
  return enqueueLocalSchedule(async () => {
    let raw = '';
    if (snapshot) {
      if (!snapshot.auth?.authenticated || snapshot.error) return;
      let existing: LocalScheduleRecord | undefined = undefined;
      try {
        const text = readLocalScheduleText(context).trim();
        existing = text ? JSON.parse(text) as LocalScheduleRecord : undefined;
      } catch (_) {
        existing = undefined;
      }
      const record = localScheduleRecord(snapshot, blocks, existing);
      if (!record) return;
      raw = JSON.stringify(record);
    }
    if (!writeLocalScheduleText(context, raw)) return;
    await bumpLocalRevision(context);
    void refreshAllScheduleForms(context).catch(() => undefined);
  });
}

function clearLocalSchedule(context: common.Context): Promise<void> {
  return enqueueLocalSchedule(async () => {
    if (writeLocalScheduleText(context, '')) await bumpLocalRevision(context);
  });
}

export async function registerScheduleForm(
  context: common.Context,
  formId: string,
  dimension: number,
  formName: string
): Promise<void> {
  const write = formRecordWrite.then(async () => {
    const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
    records.push({ id: formId, dimension, formName });
    await saveFormRecords(context, records);
  });
  formRecordWrite = write.catch(() => undefined);
  await write;
}

export async function removeScheduleForm(context: common.Context, formId: string): Promise<void> {
  const write = formRecordWrite.then(async () => {
    const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
    await saveFormRecords(context, records);
  });
  formRecordWrite = write.catch(() => undefined);
  await write;
}

export async function saveScheduleWidgetConfiguration(
  context: common.Context,
  rawPayload: string
): Promise<boolean> {
  let payload: WidgetInstallPayload = {};
  try {
    const raw = (rawPayload ?? '').trim();
    payload = raw.startsWith('https://') ? { endpoint: raw } : JSON.parse(raw) as WidgetInstallPayload;
  } catch (_) {
    return false;
  }
  const endpoint = normalizedEndpoint(payload.endpoint);
  if (!endpoint) return false;

  const prefs = await widgetPreferences(context);
  if (String(await prefs.get(ENDPOINT_KEY, '')) !== endpoint) {
    await prefs.delete(CACHE_KEY);
    await prefs.delete(CACHE_ENDPOINT_KEY);
    await prefs.delete(CACHE_TIME_KEY);
  }
  await prefs.put(ENDPOINT_KEY, endpoint);
  await prefs.put(THEME_KEY, normalizedWidgetTheme(payload.theme));
  await prefs.flush();
  return true;
}

export async function saveScheduleWidgetTheme(context: common.Context, value: string): Promise<void> {
  const prefs = await widgetPreferences(context);
  await prefs.put(THEME_KEY, normalizedWidgetTheme(value));
  await prefs.flush();
}

export async function readScheduleWidgetSettings(context: common.Context): Promise<ScheduleWidgetSettings> {
  const prefs = await widgetPreferences(context);
  const endpoint = String(await prefs.get(ENDPOINT_KEY, '')).trim();
  const theme = normalizedWidgetTheme(String(await prefs.get(THEME_KEY, 'color-glass')));
  return { configured: normalizedEndpoint(endpoint).length > 0 || readLocalSchedule(context) !== undefined, theme };
}

export async function clearScheduleWidgetAccount(context: common.UIAbilityContext): Promise<void> {
  const localCleared = clearLocalSchedule(context);
  const prefs = await widgetPreferences(context);
  await prefs.delete(ENDPOINT_KEY);
  await prefs.delete(CACHE_KEY);
  await prefs.delete(CACHE_ENDPOINT_KEY);
  await prefs.delete(CACHE_TIME_KEY);
  await prefs.flush();
  await localCleared.catch(() => undefined);
  await refreshAllScheduleForms(context);
}

function formVariant(formName: string): string {
  if (formName === 'schedule_lock_inline') return 'lock-inline';
  if (formName === 'schedule_lock_circular') return 'lock-circular';
  if (formName === 'schedule_lock_rectangular') return 'lock-rectangular';
  return 'desktop';
}

function formLayout(formName: string, dimension: number): string {
  if (formName === 'schedule_upcoming' || formName.startsWith('schedule_lock_')) return 'upcoming';
  if (formName === 'schedule_today') return 'today';
  if (formName === 'schedule_two_day') return 'two-day';
  return dimension === 2 ? 'upcoming' : dimension === 3 ? 'today' : 'two-day';
}

function loadingBinding(
  dimension: number,
  theme: string = 'color-glass',
  formName: string = 'schedule'
): ScheduleWidgetBinding {
  return {
    layout: formLayout(formName, dimension),
    state: 'loading',
    title: '药大课表',
    subtitle: '正在同步课程',
    leftTitle: '',
    rightTitle: '',
    primaryCourses: '[]',
    secondaryCourses: '[]',
    footer: '打开药大拾间完成教务授权',
    theme,
    accent: widgetThemeAccent(theme),
    semester: '',
    currentWeek: 0,
    primaryWeek: 0,
    secondaryWeek: 0,
    primaryRemaining: 0,
    secondaryRemaining: 0,
    dimension,
    variant: formVariant(formName),
    mode: 'today',
    dayNote: '',
    badge: '',
    restTitle: '今日无课',
    restDetail: '',
    lockLine: '今日无课',
    leadLabel: '当前',
    trailLabel: '接下来',
    rightNote: '',
    lunar: '',
    badgeStatutory: false,
    rightLunar: '',
    rightBadge: '',
    rightBadgeStatutory: false,
    lockTitle: '',
    lockDay: ''
  };
}

export function initialScheduleWidgetBinding(dimension: number, formName: string = 'schedule'): ScheduleWidgetBinding {
  return loadingBinding(dimension, 'color-glass', formName);
}

function messageBinding(
  dimension: number,
  theme: string,
  formName: string,
  state: string,
  subtitle: string,
  footer: string
): ScheduleWidgetBinding {
  const binding = loadingBinding(dimension, theme, formName);
  binding.state = state;
  binding.subtitle = subtitle;
  binding.footer = footer;
  return binding;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOffset(offset: number): Date {
  DEVICE_CLOCK.setTime(Date.now());
  DEVICE_CLOCK.setDate(DEVICE_CLOCK.getDate() + offset);
  return DEVICE_CLOCK;
}

function mondayBasedDay(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function emptyDay(date: Date): ScheduleDay {
  const day = mondayBasedDay(date);
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return { day, label: labels[day - 1], date: dateKey(date), courses: [] };
}

function findDate(days: ScheduleDay[] | undefined, target: string): ScheduleDay | undefined {
  return (days ?? []).find((day: ScheduleDay) => day.date === target);
}

function resolveDay(payload: SchedulePayload, offset: number, fullDay: boolean): ScheduleDay {
  const date = dateOffset(offset);
  const target = dateKey(date);
  if (fullDay) {
    const exact = findDate(payload.weekDays, target) ?? findDate(payload.days, target);
    if (exact) return exact;
  }
  if (offset === 0 && payload.today?.date === target) return payload.today;
  const exact = findDate(payload.days, target);
  if (exact) return exact;
  if (payload.strictDate === true) return emptyDay(date);
  const targetDay = mondayBasedDay(date);
  const fallback = (payload.days ?? []).find((day: ScheduleDay) => day.day === targetDay);
  return fallback ?? (offset === 0 && payload.today ? payload.today : emptyDay(date));
}

function minutes(value?: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? '').trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minute = Number(match[2]);
  return hours < 24 && minute < 60 ? hours * 60 + minute : -1;
}

function courseEnd(course: ScheduleCourse): number {
  const end = minutes(course.endTime);
  if (end >= 0) return end;
  const start = minutes(course.startTime);
  return start >= 0 ? start + 45 : -1;
}

function nowMinutes(): number {
  DEVICE_CLOCK.setTime(Date.now());
  return DEVICE_CLOCK.getHours() * 60 + DEVICE_CLOCK.getMinutes();
}

function courses(day: ScheduleDay): ScheduleCourse[] {
  return (day.courses ?? []).slice().sort((left: ScheduleCourse, right: ScheduleCourse) => {
    const first = minutes(left.startTime);
    const second = minutes(right.startTime);
    return (first < 0 ? 1440 : first) - (second < 0 ? 1440 : second);
  });
}

// 「接着显示下一次课」往后找几天，与各端规则一致。服务端只下发两周左右的日期，找不到的按没课处理。
const LOOKAHEAD_DAYS = 21;
const HOLIDAY_LOOKAHEAD_DAYS = 120;

function unfinished(course: ScheduleCourse, current: number): boolean {
  const end = courseEnd(course);
  return end >= current || (minutes(course.startTime) < 0 && end < 0);
}

function nextCourseDay(payload: SchedulePayload): DaySelection | undefined {
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const day = resolveDay(payload, offset, true);
    if (courses(day).length > 0) return { mode: 'ahead', day, offset };
  }
  return undefined;
}

// 今天还有没下课的课就看今天；否则接着显示 21 天内下一个有课的日子；都没有就进休息状态。
function selectDay(payload: SchedulePayload, today: ScheduleDay, current: number): DaySelection {
  if (courses(today).some((course: ScheduleCourse) => unfinished(course, current))) {
    return { mode: 'today', day: today, offset: 0 };
  }
  return nextCourseDay(payload) ?? { mode: 'rest', day: today, offset: 0 };
}

function aheadNote(day: ScheduleDay, offset: number): string {
  if (offset === 1) return '明天的课';
  if (offset === 2) return '后天的课';
  const date = normalizedText(day.date);
  return date.length >= 10 ? `${Number(date.substring(5, 7))}/${Number(date.substring(8, 10))} 的课` : '';
}

// 农历用系统的 chinese 日历；放假安排用 App 写下的 holidays，没有发布的年份按节日离线推算。
let sharedCalendar: ChineseCalendar | undefined = undefined;
let sharedCalendarKey: string = '';

function chineseCalendar(payload: SchedulePayload): ChineseCalendar {
  const published: PublishedHoliday[] = [];
  (payload.holidays ?? []).forEach((item: ScheduleHoliday) => {
    const date = normalizedText(item.date);
    const name = normalizedText(item.name);
    if (date && name) published.push({ date, name });
  });
  const key = JSON.stringify(published);
  if (!sharedCalendar || key !== sharedCalendarKey) {
    sharedCalendar = new ChineseCalendar(systemLunarDate, published);
    sharedCalendarKey = key;
  }
  return sharedCalendar;
}

function normalizedText(value?: string): string {
  return (value ?? '').trim();
}

function courseRows(source: ScheduleCourse[], current: number, theme: string): WidgetCourseRow[] {
  return source.map((course: ScheduleCourse): WidgetCourseRow => {
    const start = normalizedText(course.startTime) || '--:--';
    const end = normalizedText(course.endTime);
    const metadata = [scheduleClassroomOnly(course.location ?? ''), course.teacher, course.note || course.slotNote]
      .map((value: string | undefined) => normalizedText(value))
      .filter((value: string) => value.length > 0)
      .join(' · ');
    const name = normalizedText(course.name) || '课程';
    return {
      name,
      start,
      time: end ? `${start} - ${end}` : start,
      meta: metadata || '地点待确认',
      ended: current >= 0 && courseEnd(course) >= 0 && courseEnd(course) < current,
      accent: widgetCourseAccent(name, theme),
      tint: widgetCourseTint(name, theme, false),
      colorIndex: widgetCourseColorIndex(name)
    };
  });
}

function courseWindow(source: ScheduleCourse[], limit: number, current: number): CourseWindow {
  const safeLimit = Math.max(0, limit);
  const overflow = Math.max(0, source.length - safeLimit);
  let completedPrefix = 0;
  if (current >= 0) {
    for (const course of source) {
      const end = courseEnd(course);
      if (end < 0 || end >= current) break;
      completedPrefix += 1;
    }
  }
  const skipped = Math.min(overflow, completedPrefix);
  const visible = source.slice(skipped, skipped + safeLimit);
  return {
    courses: visible,
    remainingCount: Math.max(0, source.length - skipped - visible.length)
  };
}

function compactDate(value?: string): string {
  const date = normalizedText(value);
  return date.length >= 10 ? `${Number(date.substring(5, 7))}.${Number(date.substring(8, 10))}` : '';
}

function weekOf(payload: SchedulePayload, day: ScheduleDay): number {
  return day.week ?? payload.week ?? payload.displayWeek ?? payload.currentWeek ?? 0;
}

function weekdayText(day: ScheduleDay): string {
  return normalizedText(day.label).replace(/今天/g, '').trim();
}

function dayTitle(day: ScheduleDay): string {
  const label = weekdayText(day);
  const date = compactDate(day.date);
  if (date && label) return `${date} ${label}`;
  return date || label || '课表';
}

// 锁屏上说「明天」「后天」「3 天后」，今天返回空串。
function aheadLabel(offset: number): string {
  if (offset <= 0) return '';
  if (offset === 1) return '明天';
  if (offset === 2) return '后天';
  return `${offset} 天后`;
}

interface DayMarks {
  lunar: string;
  badge: string;
  badgeStatutory: boolean;
}

function dayMarks(payload: SchedulePayload, date: string): DayMarks {
  const info: ChineseCalendarDay | undefined = date ? chineseCalendar(payload).info(date) : undefined;
  return {
    lunar: info?.lunar ? lunarShortLabel(info.lunar) : '',
    badge: info ? calendarDayBadge(info) : '',
    badgeStatutory: info !== undefined && info.holiday.length > 0
  };
}

interface HolidayText {
  lunar: string;
  badge: string;
  badgeStatutory: boolean;
  restTitle: string;
  restDetail: string;
  lockLine: string;
}

// 日期栏：今天的农历和节日徽标（法定假日 > 节日 > 节气）。休息状态：法定假日道贺，其余「今日无课」；
// 副文案是 120 天内最近的一段法定假期。锁屏单行：祝福 → 假期倒计时 → 「今日无课」。文案同 iOS。
function holidayText(payload: SchedulePayload, today: string): HolidayText {
  const calendar = chineseCalendar(payload);
  const marks = dayMarks(payload, today);
  const greeting = calendar.restGreeting(today);
  const countdown: HolidayCountdown | undefined = calendar.countdown(today, HOLIDAY_LOOKAHEAD_DAYS);
  let restDetail = '';
  let upcoming = '';
  if (countdown && countdown.daysAway > 0) {
    upcoming = countdownPhrase(countdown);
    restDetail = `${upcoming} · ${countdownDateLabel(countdown)}`;
  } else if (countdown && windowDayCount(countdown.window) > 1) {
    // 已经在假期里：再说「今天是中秋节」跟祝福重复了，改说这一段连休几天。
    restDetail = `假期 ${countdownDateLabel(countdown)}`;
  }
  return {
    lunar: marks.lunar,
    badge: marks.badge,
    badgeStatutory: marks.badgeStatutory,
    restTitle: greeting || '今日无课',
    restDetail,
    lockLine: greeting || upcoming || '今日无课'
  };
}

function readyBinding(
  payload: SchedulePayload,
  dimension: number,
  theme: string,
  stale: boolean,
  formName: string
): ScheduleWidgetBinding {
  const current = nowMinutes();
  const todayKey = dateKey(dateOffset(0));
  const today = resolveDay(payload, 0, true);
  const todayCurrent = today.date === todayKey ? current : -1;
  const selection = selectDay(payload, today, current);
  // 两日课表的右列默认是之后最近有课的一天，找不到才是明天。
  const next = nextCourseDay(payload);
  const right: DaySelection = next ?? { mode: 'ahead', day: resolveDay(payload, 1, true), offset: 1 };
  const variant = formVariant(formName);
  const layout = formLayout(formName, dimension);
  const holiday = holidayText(payload, todayKey);
  const selectedCourses = selection.mode === 'rest' ? [] : courses(selection.day);
  const selectedCurrent = selection.mode === 'today' ? todayCurrent : -1;
  let primaryWindow: CourseWindow;
  if (layout === 'two-day') {
    primaryWindow = courseWindow(courses(today), 5, todayCurrent);
  } else if (layout === 'upcoming') {
    const visible = selection.mode === 'today'
      ? selectedCourses.filter((course: ScheduleCourse) => unfinished(course, current))
      : selectedCourses;
    primaryWindow = { courses: visible.slice(0, 2), remainingCount: 0 };
  } else {
    primaryWindow = courseWindow(selectedCourses, dimension === 3 ? 2 : 7, selectedCurrent);
  }
  const rightWindow = courseWindow(courses(right.day), 5, -1);
  const first = primaryWindow.courses.length > 0 ? primaryWindow.courses[0] : undefined;
  const inClass = selection.mode === 'today' && first !== undefined
    && minutes(first.startTime) >= 0 && minutes(first.startTime) <= current;
  const week = weekOf(payload, today);
  const rightMarks = dayMarks(payload, normalizedText(right.day.date));
  const lockOffset = selection.mode === 'ahead' ? selection.offset : 0;
  const lockDay = aheadLabel(lockOffset) || weekdayText(selection.day) || compactDate(selection.day.date) || '今天';
  return {
    layout,
    state: 'ready',
    title: normalizedText(payload.title) || '药大课表',
    subtitle: '',
    leftTitle: dayTitle(today),
    rightTitle: dayTitle(right.day),
    primaryCourses: JSON.stringify(courseRows(primaryWindow.courses, layout === 'two-day' ? todayCurrent : selectedCurrent, theme)),
    secondaryCourses: JSON.stringify(courseRows(rightWindow.courses, -1, theme)),
    footer: stale || payload.stale === true ? '打开 App 可刷新' : '',
    theme,
    accent: widgetThemeAccent(theme),
    semester: normalizedText(payload.semester),
    currentWeek: payload.currentWeek ?? week,
    primaryWeek: week,
    secondaryWeek: weekOf(payload, right.day),
    primaryRemaining: primaryWindow.remainingCount,
    secondaryRemaining: rightWindow.remainingCount,
    dimension,
    variant,
    mode: layout === 'two-day' ? 'today' : selection.mode,
    dayNote: layout !== 'two-day' && selection.mode === 'ahead' ? aheadNote(selection.day, selection.offset) : '',
    badge: holiday.badge,
    restTitle: holiday.restTitle,
    restDetail: holiday.restDetail,
    lockLine: holiday.lockLine,
    leadLabel: selection.mode !== 'today' ? '第一节' : inClass ? '当前' : '下一节',
    trailLabel: selection.mode !== 'today' || inClass ? '接下来' : '之后',
    rightNote: right.offset === 1 ? '' : aheadNote(right.day, right.offset),
    lunar: holiday.lunar,
    badgeStatutory: holiday.badgeStatutory,
    rightLunar: rightMarks.lunar,
    rightBadge: rightMarks.badge,
    rightBadgeStatutory: rightMarks.badgeStatutory,
    lockTitle: [aheadLabel(lockOffset), dayTitle(selection.day)].filter((value: string) => value.length > 0).join(' '),
    lockDay
  };
}

// 下次刷新：今天每节课开始、结束后 1 分钟，午夜 00:01 换日，兜底 30 分钟。
function nextRefreshMinutes(payload: SchedulePayload): number {
  const current = nowMinutes();
  const today = resolveDay(payload, 0, true);
  let next = 24 * 60 + 1 - current;
  if (today.date === dateKey(dateOffset(0))) {
    for (const course of courses(today)) {
      for (const boundary of [minutes(course.startTime), courseEnd(course)]) {
        if (boundary >= 0 && boundary + 1 > current) next = Math.min(next, boundary + 1 - current);
      }
    }
  }
  // 系统不接受 5 分钟以内的下次刷新。
  return Math.max(5, Math.min(30, next));
}

async function fetchEndpoint(endpoint: string): Promise<SchedulePayload> {
  let lastMessage = 'network';
  for (const candidate of endpointCandidates(endpoint)) {
    const request = http.createHttp();
    try {
      const joiner = candidate.includes('?') ? '&' : '?';
      const response = await request.request(`${candidate}${joiner}_widgetRefresh=${Date.now()}`, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000,
        header: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const status = Number(response.responseCode);
      if (status === 401 || status === 403) throw new Error('unauthorized');
      const body = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
      const wrapper = JSON.parse(body) as ScheduleResponse;
      if (wrapper.code === 401 || wrapper.code === 403) throw new Error('unauthorized');
      if (status >= 200 && status < 300 && wrapper.code === 0 && wrapper.data) return wrapper.data;
      lastMessage = normalizedText(wrapper.message) || 'server';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'unauthorized') throw new Error('unauthorized');
      lastMessage = message || lastMessage;
    } finally {
      request.destroy();
    }
  }
  throw new Error(lastMessage);
}

// App 写下的课表按日期精确匹配：不在里面的日子就是没课，不借别的周同一天的课。
function localPayload(record: LocalScheduleFile): SchedulePayload {
  const days = record.days ?? [];
  return { semester: record.semester, strictDate: true, days, weekDays: days, holidays: record.holidays ?? [] };
}

async function loadSchedule(context: common.Context): Promise<LoadedSchedule> {
  // 优先读 App 写在本地的课表；还没打开过新版 App 时才退回服务端小组件接口。
  const local = readLocalSchedule(context);
  if (local) return { payload: localPayload(local), stale: false };
  const prefs = await widgetPreferences(context);
  const endpoint = String(await prefs.get(ENDPOINT_KEY, '')).trim();
  if (!endpoint) throw new Error('unconfigured');
  try {
    const payload = await fetchEndpoint(endpoint);
    if (String(await prefs.get(ENDPOINT_KEY, '')) !== endpoint) throw new Error('unconfigured');
    await prefs.put(CACHE_KEY, JSON.stringify(payload));
    await prefs.put(CACHE_ENDPOINT_KEY, endpoint);
    await prefs.put(CACHE_TIME_KEY, Date.now());
    await prefs.flush();
    return { payload, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (String(await prefs.get(ENDPOINT_KEY, '')) !== endpoint) throw new Error('unconfigured');
    if (message === 'unauthorized') {
      await prefs.delete(CACHE_KEY);
      await prefs.delete(CACHE_ENDPOINT_KEY);
      await prefs.flush();
      throw new Error('unauthorized');
    }
    const cached = String(await prefs.get(CACHE_KEY, '')).trim();
    const cachedEndpoint = String(await prefs.get(CACHE_ENDPOINT_KEY, ''));
    const cachedAt = Number(await prefs.get(CACHE_TIME_KEY, 0));
    if (cached && cachedEndpoint === endpoint && Date.now() - cachedAt < 12 * 60 * 60 * 1000) {
      return { payload: JSON.parse(cached) as SchedulePayload, stale: true };
    }
    throw new Error(message || 'network');
  }
}

interface FormContent {
  binding: ScheduleWidgetBinding;
  refreshMinutes: number;
}

async function contentFor(context: common.Context, dimension: number, formName: string): Promise<FormContent> {
  const prefs = await widgetPreferences(context);
  const theme = normalizedWidgetTheme(String(await prefs.get(THEME_KEY, 'color-glass')));
  try {
    const loaded = await loadSchedule(context);
    return {
      binding: readyBinding(loaded.payload, dimension, theme, loaded.stale, formName),
      refreshMinutes: nextRefreshMinutes(loaded.payload)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unconfigured') {
      return { binding: messageBinding(dimension, theme, formName, 'unconfigured', '尚未配置课表', '打开药大拾间，在课表菜单中添加小组件'), refreshMinutes: 30 };
    }
    if (message === 'unauthorized') {
      return { binding: messageBinding(dimension, theme, formName, 'unauthorized', '教务授权已失效', '打开药大拾间重新登录教务'), refreshMinutes: 30 };
    }
    return { binding: messageBinding(dimension, theme, formName, 'failed', '暂时无法刷新', '请检查网络，卡片会自动重试'), refreshMinutes: 30 };
  }
}

async function bindingFor(context: common.Context, dimension: number, formName: string): Promise<ScheduleWidgetBinding> {
  return (await contentFor(context, dimension, formName)).binding;
}

export async function readScheduleWidgetPreview(context: common.Context, dimension: number, formName: string): Promise<ScheduleWidgetBinding> {
  if (readLocalSchedule(context)) return bindingFor(context, dimension, formName);
  const prefs = await widgetPreferences(context);
  const endpoint = String(await prefs.get(ENDPOINT_KEY, ''));
  const cachedAt = Number(await prefs.get(CACHE_TIME_KEY, 0));
  const cachedEndpoint = String(await prefs.get(CACHE_ENDPOINT_KEY, ''));
  const cached = String(await prefs.get(CACHE_KEY, ''));
  if (endpoint && cachedEndpoint === endpoint && cached && Date.now() - cachedAt >= 0 && Date.now() - cachedAt < 60000) {
    try {
      return readyBinding(JSON.parse(cached) as SchedulePayload, dimension,
        normalizedWidgetTheme(String(await prefs.get(THEME_KEY, 'color-glass'))), false, formName);
    } catch (_) {}
  }
  return bindingFor(context, dimension, formName);
}

export async function refreshScheduleForm(
  context: common.Context,
  formId: string,
  dimension: number,
  formName: string = 'schedule'
): Promise<void> {
  const prefs = await widgetPreferences(context);
  const endpoint = String(await prefs.get(ENDPOINT_KEY, ''));
  const theme = String(await prefs.get(THEME_KEY, ''));
  const revision = Number(await prefs.get(LOCAL_REVISION_KEY, 0));
  const content = await contentFor(context, dimension, formName);
  // 算卡片内容时 App 可能换了账号、主题或本地课表，重新读一次，变了就丢掉这次结果。
  const latest = await widgetPreferences(context);
  if (endpoint !== String(await latest.get(ENDPOINT_KEY, '')) || theme !== String(await latest.get(THEME_KEY, ''))
    || revision !== Number(await latest.get(LOCAL_REVISION_KEY, 0))) return;
  await formProvider.updateForm(formId, formBindingData.createFormBindingData(content.binding));
  try {
    // 配置里的 30 分钟定时刷新对不上上下课，这里按课程边界另约一次，系统到点回调 onUpdateForm。
    await formProvider.setFormNextRefreshTime(formId, content.refreshMinutes);
  } catch (_) {
    // 刷新次数用完或卡片已移除时系统会拒绝，保留定时刷新即可。
  }
}

export async function refreshRegisteredScheduleForm(context: common.Context, formId: string): Promise<void> {
  const record = (await formRecords(context)).find((item: FormRecord) => item.id === formId);
  await refreshScheduleForm(context, formId, record?.dimension ?? 2, record?.formName ?? 'schedule');
}

export async function refreshAllScheduleForms(context: common.UIAbilityContext): Promise<void> {
  const records = await formRecords(context);
  await Promise.all(records.map((record: FormRecord) => {
    return refreshScheduleForm(context, record.id, record.dimension, record.formName ?? 'schedule')
      .catch(() => undefined);
  }));
}
