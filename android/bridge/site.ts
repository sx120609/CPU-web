import { useAuthStore, useJwxtStore } from './adapters';

export class SiteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * A same-origin site API call with the session headers the Web client sends.
 * Writes carry the CSRF token from the cookie, as the Web request layer does.
 */
export async function siteRequest(method: string, path: string, body?: unknown, fallback = '请求失败，请稍后重试') {
  const auth = useAuthStore(); const jwxt = useJwxtStore();
  const headers: Record<string,string> = { 'X-CPU-Auth-Mode':'cookie', 'X-CPU-Client':'android-app', 'Content-Type':'application/json' };
  if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = `Bearer ${auth.token}`;
  if (jwxt?.token && jwxt.token !== '__cpu_jwxt_cookie_session__') headers['X-Jwxt-Token'] = jwxt.token;
  if (method !== 'GET') {
    const cookie = (name:string) => document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1) || '';
    headers['X-CSRF-Token'] = decodeURIComponent(cookie('__Host-cpu-csrf') || cookie('cpu-csrf'));
  }
  const controller = new AbortController(); const timeout = setTimeout(()=>controller.abort(),30000);
  try {
    const response = await fetch('/api'+path, {
      method, credentials:'same-origin', headers, signal:controller.signal,
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.code !== 0) throw new SiteError(result?.message || fallback, response.status || 0);
    return result.data;
  } finally { clearTimeout(timeout); }
}
