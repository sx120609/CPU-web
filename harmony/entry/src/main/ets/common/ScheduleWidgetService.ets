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
}

interface WidgetCourseRow {
  name: string;
  time: string;
  meta: string;
  ended: boolean;
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
  semester: string;
  currentWeek: number;
  dimension: number;
}

interface LoadedSchedule {
  payload: SchedulePayload;
  stale: boolean;
}

interface UpcomingSelection {
  day: ScheduleDay;
  courses: ScheduleCourse[];
}

function normalizedTheme(value?: string): string {
  const supported = ['green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate', 'color-glass'];
  const theme = (value ?? '').trim().toLowerCase();
  return supported.includes(theme) ? theme : 'color-glass';
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
  dimension: number
): Promise<void> {
  const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
  records.push({ id: formId, dimension });
  await saveFormRecords(context, records);
}

export async function removeScheduleForm(context: common.Context, formId: string): Promise<void> {
  const records = (await formRecords(context)).filter((record: FormRecord) => record.id !== formId);
  await saveFormRecords(context, records);
}

export async function scheduleFormDimension(context: common.Context, formId: string): Promise<number> {
  const record = (await formRecords(context)).find((item: FormRecord) => item.id === formId);
  return record?.dimension ?? 2;
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

function loadingBinding(dimension: number, theme: string = 'color-glass'): ScheduleWidgetBinding {
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
    semester: '',
    currentWeek: 0,
    dimension
  };
}

export function initialScheduleWidgetBinding(dimension: number): ScheduleWidgetBinding {
  return loadingBinding(dimension);
}

function messageBinding(dimension: number, theme: string, state: string, subtitle: string, footer: string): ScheduleWidgetBinding {
  const binding = loadingBinding(dimension, theme);
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

function courseRows(source: ScheduleCourse[], current: number): WidgetCourseRow[] {
  return source.map((course: ScheduleCourse): WidgetCourseRow => {
    const start = normalizedText(course.startTime) || '--:--';
    const end = normalizedText(course.endTime);
    const metadata = [course.location, course.teacher, course.note || course.slotNote]
      .map((value: string | undefined) => normalizedText(value))
      .filter((value: string) => value.length > 0)
      .join(' · ');
    return {
      name: normalizedText(course.name) || '课程',
      time: end ? `${start} - ${end}` : start,
      meta: metadata || '地点待确认',
      ended: courseEnd(course) >= 0 && courseEnd(course) < current
    };
  });
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
  return date ? `${label} ${date}` : label;
}

function readyBinding(payload: SchedulePayload, dimension: number, theme: string, stale: boolean): ScheduleWidgetBinding {
  const current = nowMinutes();
  const today = resolveDay(payload, 0, true);
  const tomorrow = resolveDay(payload, 1, true);
  const selected = dimension === 2 ? upcoming(payload).day : today;
  const selectedCourses = dimension === 2 ? upcoming(payload).courses : courses(today).slice(0, dimension === 3 ? 3 : 4);
  const week = weekOf(payload, selected);
  return {
    state: 'ready',
    title: normalizedText(payload.title) || '药大课表',
    subtitle: `第 ${week > 0 ? week : '--'} 周 · ${dayTitle(selected)}`,
    leftTitle: dayTitle(today),
    rightTitle: dayTitle(tomorrow),
    primaryCourses: JSON.stringify(courseRows(selectedCourses, current)),
    secondaryCourses: JSON.stringify(courseRows(courses(tomorrow).slice(0, 4), -1)),
    footer: stale || payload.stale === true ? '缓存课表 · 打开 App 可刷新' : '每 30 分钟自动刷新',
    theme,
    semester: normalizedText(payload.semester),
    currentWeek: payload.currentWeek ?? week,
    dimension
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

async function bindingFor(context: common.Context, dimension: number): Promise<ScheduleWidgetBinding> {
  const prefs = await widgetPreferences(context);
  const theme = normalizedTheme(String(await prefs.get(THEME_KEY, 'color-glass')));
  try {
    const loaded = await loadSchedule(context);
    return readyBinding(loaded.payload, dimension, theme, loaded.stale);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unconfigured') {
      return messageBinding(dimension, theme, 'unconfigured', '尚未配置课表', '打开药大拾间，在课表菜单中添加小组件');
    }
    if (message === 'unauthorized') {
      return messageBinding(dimension, theme, 'unauthorized', '教务授权已失效', '打开药大拾间重新登录教务');
    }
    return messageBinding(dimension, theme, 'failed', '暂时无法刷新', '请检查网络，卡片会自动重试');
  }
}

export async function refreshScheduleForm(
  context: common.Context,
  formId: string,
  dimension: number
): Promise<void> {
  const binding = await bindingFor(context, dimension);
  await formProvider.updateForm(formId, formBindingData.createFormBindingData(binding));
}

export async function refreshAllScheduleForms(context: common.Context): Promise<void> {
  const records = await formRecords(context);
  await Promise.all(records.map((record: FormRecord) => {
    return refreshScheduleForm(context, record.id, record.dimension).catch(() => undefined);
  }));
}
