import { useAuthStore } from './adapters';

// Share codes for the native timetable (/api/schedule-shares), sent through the signed-in Web
// session like the schedule edits. Publishing and revoking follow the site account; what somebody
// else shared is kept by the native side, on the device.
export function installHarmonySharing() {
  const host = window as any;
  if (host.CPUHarmonyShares) return;
  const cookie = (name: string) => {
    const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
  };
  async function request(method: string, path: string, body?: unknown) {
    const auth = useAuthStore();
    const headers: Record<string, string> = { 'X-CPU-Auth-Mode': 'cookie', 'X-CPU-Client': 'harmony-app' };
    if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = `Bearer ${auth.token}`;
    if (method !== 'GET') headers['X-CSRF-Token'] = cookie('__Host-cpu-csrf') || cookie('cpu-csrf');
    // Never from the HTTP cache: a share that was just updated or withdrawn must not come back as it was.
    const init: RequestInit = { method, credentials: 'same-origin', headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/schedule-shares' + path, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
        return { ok: false, status: response.status, error: payload.message || '请求失败，请稍后再试' };
      }
      return { ok: true, status: response.status, data: (typeof payload.code === 'number' ? payload.data : payload) ?? {} };
    } catch (error) {
      return { ok: false, status: 0, error: '网络请求失败，请检查网络后重试' };
    } finally { clearTimeout(timeout); }
  }
  const code = (value: unknown) => encodeURIComponent(String(value ?? '').trim().toUpperCase());
  host.CPUHarmonyShares = async (payload: any) => {
    const auth = useAuthStore();
    const account = auth?.user?.id;
    let result: any;
    if (payload?.action === 'get') result = await request('GET', '/' + code(payload.code));
    else if (payload?.action === 'meta') result = await request('GET', '/' + code(payload.code) + '/meta');
    else if (!auth?.isLoggedIn) return { ok: false, status: 401, error: '请先登录' };
    else if (payload?.action === 'mine') result = await request('GET', '/mine');
    else if (payload?.action === 'publish') {
      // The share is named after the site nickname; the native side never sees the account.
      const ownerName = String(auth.user?.nickname || '').trim().slice(0, 40);
      result = await request('POST', '', { ...payload.body, ...(ownerName ? { ownerName } : {}) });
    } else if (payload?.action === 'revoke') result = await request('DELETE', '/' + code(payload.code));
    else return { ok: false, status: 400, error: '不支持的共享课表操作' };
    // An answer that belongs to an account that has since signed out is not handed over.
    if (account !== useAuthStore()?.user?.id) return { ok: false, status: 401, error: '账号已变化，请重试' };
    return result;
  };
}
