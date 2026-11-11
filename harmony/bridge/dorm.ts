import { useAuthStore } from './adapters';
export { createDormReaders } from '../../web/src/views/schedule/dorm';
import { createDormReaders, dormBusySpansForDate, dormDateLabel, dormDateRange, dormDayAvailability, dormDayName,
  dormFreeEmptyText, dormFreeWindowLabel, dormMorningDays, dormMorningNoneText, dormMorningSummaryText, dormNextMorning,
  dormTodayYmd, formatWindow, type DormDayReader } from '../../web/src/views/schedule/dorm';
import { dormWeekCellLevel, dormWeekCellSummary, dormWeekFreeRatio, dormWeekGrid, dormWeekMonday } from '../../web/src/views/schedule/dormWeek';

/** What the native sheet draws, worked out with the site's rules (also used by the acceptance harness). */
export function dormView(readers: DormDayReader[], status: any, input: any) {
  const today = dormTodayYmd();
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.monday || '')) ? dormWeekMonday(String(input.monday)) : dormWeekMonday(today);
  const freeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.freeDate || '')) ? String(input.freeDate) : today;
  const minFree = Number(input?.minFree) > 0 ? Number(input.minFree) : 0;
  const myId = status?.me?.id;
  const grid = dormWeekGrid(readers, monday, myId);
  const day = dormDayAvailability(readers, freeDate, { minFree: minFree || undefined });
  const morningDays = dormMorningDays(readers, dormDateRange(today, 7));
  const next = dormNextMorning(morningDays);
  const total = Math.max(1, status?.members?.length ?? readers.length);
  const relaxed = [...new Set([total - 1, Math.max(2, Math.ceil(total / 2))])].filter(value => value >= 2 && value < total).sort((a, b) => b - a);
  const name = (id: number) => readers.find(reader => reader.id === id)?.nickname || '室友';
  return {
    today, ready: readers.some(reader => reader.snapshot),
    week: {
      monday, thisWeek: monday === dormWeekMonday(today),
      title: [monday === dormWeekMonday(today) ? '本周' : '', grid.teachingWeek ? `第 ${grid.teachingWeek} 周` : '',
        `${grid.dates[0].slice(5)} – ${grid.dates[6].slice(5)}`].filter(Boolean).join(' · '),
      dates: grid.dates,
      rows: grid.rows.map(row => ({ start: row.period.start, end: row.period.end, label: String(row.period.no), breakBefore: row.breakBefore,
        cells: row.cells.map(cell => ({ ymd: cell.ymd, level: dormWeekCellLevel(cell), ratio: dormWeekFreeRatio(cell),
          summary: dormWeekCellSummary(cell), freeIds: cell.freeIds, unknownIds: cell.unknownIds,
          busy: cell.busy.map(item => ({ id: item.id, courses: item.courses })) })) })),
    },
    free: {
      date: freeDate, title: dormDateLabel(freeDate, today), minFree,
      options: [{ value: 0, label: day.unknownIds.length ? `已同步的人（${day.knownIds.length} 人）` : `全员（${total} 人）` },
        ...relaxed.map(value => ({ value, label: `至少 ${value} 人` }))],
      windowStart: day.window.start, windowEnd: day.window.end,
      windows: day.windows.map(window => ({ start: window.start, end: window.end, text: formatWindow(window),
        minutes: window.end - window.start, label: dormFreeWindowLabel(window, day), freeIds: window.freeIds })),
      empty: day.windows.length ? '' : dormFreeEmptyText(day, minFree > 0),
      unknownNames: day.unknownIds.map(name).join('、'),
      // One line per person: their classes that day, for the timeline under the windows.
      tracks: readers.map(reader => ({ id: reader.id, busy: (dormBusySpansForDate(reader, freeDate) ?? null) })),
      days: dormDateRange(today, 7).map(ymd => ({ ymd, name: dormDayName(ymd, today) })),
    },
    morning: {
      summary: morningDays.some(dayItem => dayItem.duties.length) ? '' : dormMorningSummaryText(morningDays),
      next: next ? { title: next.isToday ? '今天还有早八' : `${dormDateLabel(next.ymd, today)}早八`,
        names: next.duties.map(duty => duty.nickname).join('、') } : null,
      days: morningDays.map(dayItem => ({ ymd: dayItem.ymd, title: dormDateLabel(dayItem.ymd, today), none: dormMorningNoneText(dayItem),
        duties: dayItem.duties.map(duty => ({ id: duty.id, nickname: duty.nickname, color: duty.color, course: duty.course,
          time: `${duty.start}–${duty.end}` })) })),
    },
  };
}

/**
 * 宿舍课表 for the native sheet (docs/dorm-schedule.md), through the signed-in page: the dorm and its
 * members (/api/dorm), everyone's timetable snapshot, and the user's own going up. The week grid, the
 * free windows and the 早八 list are worked out here with the site's own rules (dorm.ts, dormWeek.ts),
 * so the app shows exactly what the Web dialog does. Replies are `{ data }` or `{ error, status }`.
 */
export function installHarmonyDorm() {
  const host = window as any;
  if (host.CPUHarmonyDorm) return;
  const cookie = (name: string) => {
    const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
  };
  class DormError extends Error { constructor(message: string, public status: number) { super(message); } }
  async function request(method: string, path: string, body?: unknown, fallback = '请求失败，请稍后再试') {
    const auth = useAuthStore();
    const headers: Record<string, string> = { 'X-CPU-Auth-Mode': 'cookie', 'X-CPU-Client': 'harmony-app' };
    if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = `Bearer ${auth.token}`;
    if (method !== 'GET') headers['X-CSRF-Token'] = cookie('__Host-cpu-csrf') || cookie('cpu-csrf');
    const init: RequestInit = { method, credentials: 'same-origin', headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api' + path, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
        throw new DormError(payload.message || fallback, response.status);
      }
      return typeof payload.code === 'number' ? payload.data : payload;
    } catch (error) {
      if (error instanceof DormError) throw error;
      throw new DormError('网络请求失败，请检查网络后重试', 0);
    } finally { clearTimeout(timeout); }
  }

  // The last members' timetables read, so turning a week or a day does not go to the server again.
  let cached: { owner: unknown; readers: DormDayReader[] } | null = null;

  host.CPUHarmonyDorm = async (payload: any) => {
    try {
      const auth = useAuthStore();
      const owner = auth?.user?.id;
      if (!auth?.isLoggedIn) throw new DormError('请先登录', 401);
      const action = String(payload?.action || '');
      const body = payload?.body ?? {};
      let data: unknown;
      if (action === 'view') {
        const status = await request('GET', '/dorm');
        if (status?.status !== 'active') { cached = null; data = { status }; }
        else {
          if (payload?.refresh || !cached || cached.owner !== owner) {
            const schedules = await request('GET', '/dorm/schedules');
            cached = { owner, readers: createDormReaders((schedules?.members ?? []).map((member: any) => ({
              id: member.id, nickname: member.nickname, color: member.color, snapshot: member.snapshot }))) };
          }
          data = { status, view: dormView(cached.readers, status, payload) };
        }
      } else if (action === 'status') data = await request('GET', '/dorm');
      else if (action === 'invite') data = await request('POST', '/dorm/invite', undefined, '宿舍码生成失败，请稍后重试');
      else if (action === 'cancelInvite') data = await request('DELETE', '/dorm/invite');
      else if (action === 'join') {
        data = await request('POST', '/dorm/join', { code: String(payload.code || '').trim().slice(0, 20) }, '加入失败，请检查宿舍码');
      } else if (action === 'settings') data = await request('PATCH', '/dorm', body);
      else if (action === 'leave') data = await request('DELETE', '/dorm');
      else if (action === 'remove') {
        const id = Number(payload?.userId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new DormError('成员不存在', 400);
        data = await request('DELETE', `/dorm/members/${id}`);
      } else if (action === 'sync') data = await request('PUT', '/dorm/schedule', body);
      else throw new DormError('不支持的宿舍课表操作', 400);
      if (action !== 'view') cached = null;
      if (owner !== useAuthStore()?.user?.id) throw new DormError('账号已变化，请重试', 409);
      return { data };
    } catch (error) {
      return { error: error instanceof Error && error.message ? error.message : '请求失败，请稍后重试',
        status: error instanceof DormError ? error.status : 0 };
    }
  };
}
