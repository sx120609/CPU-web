import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import http from '@ohos.net.http';
import { formBindingData, formProvider } from '@kit.FormKit';

const PREFERENCES_NAME = 'schedule_widget';
const ENDPOINT_KEY = 'endpoint';
const THEME_KEY = 'theme';
const FORMS_KEY = 'forms';
const CACHE_KEY = 'cached_payload';
const DEVICE_CLOCK = new Date();

interface WidgetInstallPayload {
  endpoint?: string;
  theme?: string;
}

interface ScheduleCourse {
  name?: string;
  teacher?: string;
  location?: string;
  note?: string;
  slotNote?: string;
  startTime?: string;
  endTime?: string;
}

interface ScheduleDay {
  day?: number;
  label?: string;
  date?: string;
  week?: number;
  courses?: ScheduleCourse[];
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
}

export interface ScheduleWidgetBinding {
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
}

interface LoadedSchedule {
  payload: SchedulePayload;
  stale: boolean;
}

interface UpcomingSelection {
  day: ScheduleDay;
  courses: ScheduleCourse[];
}

interface CourseWindow {
  courses: ScheduleCourse[];
  remainingCount: number;
}

const COLOR_GLASS_ACCENTS: string[] = [
  '#E85B4B', '#4A78F2', '#8B5CF6', '#17A69A', '#E0A224', '#EC70A1'
];
const COLOR_GLASS_TINTS: string[] = [
  '#FDECE9', '#EAF0FF', '#F2ECFF', '#E5F8F5', '#FFF7E0', '#FDEBF4'
];

function normalizedTheme(value?: string): string {
  const supported = ['green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate', 'color-glass'];
  const theme = (value ?? '').trim().toLowerCase();
  return supported.includes(theme) ? theme : 'color-glass';
}

function themeAccent(theme: string): string {
  if (theme === 'green') return '#168776';
  if (theme === 'blue') return '#2563EB';
  if (theme === 'teal') return '#0891B2';
  if (theme === 'indigo') return '#DB2777';
  if (theme === 'violet') return '#7C3AED';
  if (theme === 'orange') return '#EA580C';
  if (theme === 'rose') return '#E11D48';
  if (theme === 'slate') return '#475569';
  return '#6D5DFC';
}

function themeTint(theme: string): string {
  if (theme === 'green') return '#F4FBF8';
  if (theme === 'blue') return '#F3F8FF';
  if (theme === 'teal') return '#F0FBFF';
  if (theme === 'indigo') return '#FFF5FA';
  if (theme === 'violet') return '#FAF7FF';
  if (theme === 'orange') return '#FFF7F1';
  if (theme === 'rose') return '#FFF5F7';
  if (theme === 'slate') return '#F8FAFC';
  return '#F2ECFF';
}

function courseColorIndex(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) & 0x7FFFFFFF;
  }
  return hash % COLOR_GLASS_ACCENTS.length;
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

export async function registerScheduleForm(
  context: common.Context,
  formId: string,
  dimension: number,
  formName: string
): Promise<void> {
  const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
  records.push({ id: formId, dimension, formName });
  await saveFormRecords(context, records);
}

export async function removeScheduleForm(context: common.Context, formId: string): Promise<void> {
  const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
  await saveFormRecords(context, records);
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
  await prefs.put(ENDPOINT_KEY, endpoint);
  await prefs.put(THEME_KEY, normalizedTheme(payload.theme));
  await prefs.flush();
  return true;
}

export async function saveScheduleWidgetTheme(context: common.Context, value: string): Promise<void> {
  const prefs = await widgetPreferences(context);
  await prefs.put(THEME_KEY, normalizedTheme(value));
  await prefs.flush();
}

function formVariant(formName: string): string {
  if (formName === 'schedule_lock_inline') return 'lock-inline';
  if (formName === 'schedule_lock_circular') return 'lock-circular';
  if (formName === 'schedule_lock_rectangular') return 'lock-rectangular';
  return 'desktop';
}

function loadingBinding(
  dimension: number,
  theme: string = 'color-glass',
  formName: string = 'schedule'
): ScheduleWidgetBinding {
  return {
    state: 'loading',
    title: '药大课表',
    subtitle: '正在同步课程',
    leftTitle: '',
    rightTitle: '',
    primaryCourses: '[]',
    secondaryCourses: '[]',
    footer: '打开药大拾间完成教务授权',
    theme,
    accent: themeAccent(theme),
    semester: '',
    currentWeek: 0,
    primaryWeek: 0,
    secondaryWeek: 0,
    primaryRemaining: 0,
    secondaryRemaining: 0,
    dimension,
    variant: formVariant(formName)
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
  return Number(match[1]) * 60 + Number(match[2]);
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
  return day.courses ?? [];
}

function upcoming(payload: SchedulePayload): UpcomingSelection {
  const current = nowMinutes();
  const today = resolveDay(payload, 0, false);
  const remaining = courses(today).filter((course: ScheduleCourse) => {
    const end = courseEnd(course);
    return end >= current || (minutes(course.startTime) < 0 && end < 0);
  });
  const useTomorrow = current >= 22 * 60 || (courses(today).length > 0 && remaining.length === 0);
  if (useTomorrow) {
    const tomorrow = resolveDay(payload, 1, false);
    return { day: tomorrow, courses: courses(tomorrow).slice(0, 2) };
  }
  if (remaining.length > 0) return { day: today, courses: remaining.slice(0, 2) };
  const tomorrow = resolveDay(payload, 1, false);
  return { day: tomorrow, courses: courses(tomorrow).slice(0, 2) };
}

function normalizedText(value?: string): string {
  return (value ?? '').trim();
}

function courseRows(source: ScheduleCourse[], current: number, theme: string): WidgetCourseRow[] {
  return source.map((course: ScheduleCourse): WidgetCourseRow => {
    const start = normalizedText(course.startTime) || '--:--';
    const end = normalizedText(course.endTime);
    const metadata = [course.location, course.teacher, course.note || course.slotNote]
      .map((value: string | undefined) => normalizedText(value))
      .filter((value: string) => value.length > 0)
      .join(' · ');
    const name = normalizedText(course.name) || '课程';
    const colorIndex = courseColorIndex(name);
    return {
      name,
      start,
      time: end ? `${start} - ${end}` : start,
      meta: metadata || '地点待确认',
      ended: current >= 0 && courseEnd(course) >= 0 && courseEnd(course) < current,
      accent: theme === 'color-glass' ? COLOR_GLASS_ACCENTS[colorIndex] : themeAccent(theme),
      tint: theme === 'color-glass' ? COLOR_GLASS_TINTS[colorIndex] : themeTint(theme)
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

function dayTitle(day: ScheduleDay): string {
  const label = normalizedText(day.label) || '课表';
  const date = compactDate(day.date);
  return date ? `${date} ${label}` : label;
}

function readyBinding(
  payload: SchedulePayload,
  dimension: number,
  theme: string,
  stale: boolean,
  formName: string
): ScheduleWidgetBinding {
  const current = nowMinutes();
  const today = resolveDay(payload, 0, true);
  const tomorrow = resolveDay(payload, 1, true);
  const upcomingSelection = upcoming(payload);
  const variant = formVariant(formName);
  const useUpcoming = dimension === 2 || variant !== 'desktop';
  const selected = useUpcoming ? upcomingSelection.day : today;
  const todayWindow = courseWindow(courses(today), dimension === 3 ? 2 : 5, current);
  const tomorrowWindow = courseWindow(courses(tomorrow), 5, -1);
  const primaryWindow: CourseWindow = useUpcoming
    ? { courses: upcomingSelection.courses, remainingCount: 0 }
    : todayWindow;
  const week = weekOf(payload, selected);
  return {
    state: 'ready',
    title: normalizedText(payload.title) || '药大课表',
    subtitle: '',
    leftTitle: dayTitle(selected),
    rightTitle: dayTitle(tomorrow),
    primaryCourses: JSON.stringify(courseRows(primaryWindow.courses, current, theme)),
    secondaryCourses: JSON.stringify(courseRows(tomorrowWindow.courses, -1, theme)),
    footer: stale || payload.stale === true ? '打开 App 可刷新' : '',
    theme,
    accent: themeAccent(theme),
    semester: normalizedText(payload.semester),
    currentWeek: payload.currentWeek ?? week,
    primaryWeek: week,
    secondaryWeek: weekOf(payload, tomorrow),
    primaryRemaining: primaryWindow.remainingCount,
    secondaryRemaining: tomorrowWindow.remainingCount,
    dimension,
    variant
  };
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
      const body = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
      const wrapper = JSON.parse(body) as ScheduleResponse;
      if (status === 401 || status === 403 || wrapper.code === 401) throw new Error('unauthorized');
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

async function loadSchedule(context: common.Context): Promise<LoadedSchedule> {
  const prefs = await widgetPreferences(context);
  const endpoint = String(await prefs.get(ENDPOINT_KEY, '')).trim();
  if (!endpoint) throw new Error('unconfigured');
  try {
    const payload = await fetchEndpoint(endpoint);
    await prefs.put(CACHE_KEY, JSON.stringify(payload));
    await prefs.flush();
    return { payload, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unauthorized') throw new Error('unauthorized');
    const cached = String(await prefs.get(CACHE_KEY, '')).trim();
    if (cached) return { payload: JSON.parse(cached) as SchedulePayload, stale: true };
    throw new Error(message || 'network');
  }
}

async function bindingFor(context: common.Context, dimension: number, formName: string): Promise<ScheduleWidgetBinding> {
  const prefs = await widgetPreferences(context);
  const theme = normalizedTheme(String(await prefs.get(THEME_KEY, 'color-glass')));
  try {
    const loaded = await loadSchedule(context);
    return readyBinding(loaded.payload, dimension, theme, loaded.stale, formName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unconfigured') {
      return messageBinding(dimension, theme, formName, 'unconfigured', '尚未配置课表', '打开药大拾间，在课表菜单中添加小组件');
    }
    if (message === 'unauthorized') {
      return messageBinding(dimension, theme, formName, 'unauthorized', '教务授权已失效', '打开药大拾间重新登录教务');
    }
    return messageBinding(dimension, theme, formName, 'failed', '暂时无法刷新', '请检查网络，卡片会自动重试');
  }
}

export async function refreshScheduleForm(
  context: common.Context,
  formId: string,
  dimension: number,
  formName: string = 'schedule'
): Promise<void> {
  const binding = await bindingFor(context, dimension, formName);
  await formProvider.updateForm(formId, formBindingData.createFormBindingData(binding));
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
