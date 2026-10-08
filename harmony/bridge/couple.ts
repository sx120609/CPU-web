import { useAuthStore } from './adapters';

// The couple timetable for the native grid (/api/couple), sent through the signed-in Web session
// like the share codes: who the user is bound to, the partner's timetable snapshot, and the user's
// own snapshot going up. Replies are { ok, status, data } or { ok: false, status, error }.
export function installHarmonyCouple() {
  const host = window as any;
  if (host.CPUHarmonyCouple) return;
  const cookie = (name: string) => {
    const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
  };
  async function request(method: string, path: string, body?: unknown) {
    const auth = useAuthStore();
    const headers: Record<string, string> = { 'X-CPU-Auth-Mode': 'cookie', 'X-CPU-Client': 'harmony-app' };
    if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = `Bearer ${auth.token}`;
    if (method !== 'GET') headers['X-CSRF-Token'] = cookie('__Host-cpu-csrf') || cookie('cpu-csrf');
    // Never from the HTTP cache: a binding that was just made or undone must not come back as it was.
    const init: RequestInit = { method, credentials: 'same-origin', headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/couple' + path, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
        return { ok: false, status: response.status, error: payload.message || '请求失败，请稍后再试' };
      }
      return { ok: true, status: response.status, data: (typeof payload.code === 'number' ? payload.data : payload) ?? {} };
    } catch (error) {
      return { ok: false, status: 0, error: '网络请求失败，请检查网络后重试' };
    } finally { clearTimeout(timeout); }
  }
  host.CPUHarmonyCouple = async (payload: any) => {
    const auth = useAuthStore();
    const account = auth?.user?.id;
    if (!auth?.isLoggedIn) return { ok: false, status: 401, error: '请先登录' };
    const action = String(payload?.action || '');
    let result: any;
    if (action === 'status') result = await request('GET', '');
    else if (action === 'schedules') result = await request('GET', '/schedules');
    else if (action === 'invite') result = await request('POST', '/invite');
    else if (action === 'cancelInvite') result = await request('DELETE', '/invite');
    else if (action === 'accept') result = await request('POST', '/accept', { code: String(payload.code ?? '').trim().slice(0, 20) });
    else if (action === 'unbind') result = await request('DELETE', '');
    else if (action === 'settings') result = await request('PATCH', '', payload.body ?? {});
    else if (action === 'sync') result = await request('PUT', '/schedule', payload.body ?? {});
    else return { ok: false, status: 400, error: '不支持的情侣课表操作' };
    // An answer that belongs to an account that has since signed out is not handed over.
    if (account !== useAuthStore()?.user?.id) return { ok: false, status: 401, error: '账号已变化，请重试' };
    return result;
  };
}
