// Adapters for the shipped Web app. Keep its live Pinia stores and session
// recovery; only the read-only HTTP transport is supplied by the native bundle.
export function liveApp(): any {
  return (document.getElementById("app") as any)?.__vue_app__;
}
export function useAuthStore(): any { return liveApp()?.config.globalProperties.$pinia?._s.get("auth"); }
export function useJwxtStore(): any { return liveApp()?.config.globalProperties.$pinia?._s.get("jwxt"); }
export function isNativeScheduleShell() { return /CPUWebHarmonyApp\//i.test(navigator.userAgent); }

export function watch(getter: () => unknown, callback: () => void) {
  let previous = JSON.stringify(getter());
  const check = () => {
    const next = JSON.stringify(getter());
    if (next !== previous) { previous = next; callback(); }
  };
  useAuthStore().$subscribe(check, { detached: true, flush: "sync" });
  useJwxtStore().$subscribe(check, { detached: true, flush: "sync" });
}

async function get(path: string, params: Record<string, unknown> = {}) {
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  const account = auth.user?.id;
  const token = jwxt.token;
  const url = new URL(`/api/jwxt/${path}`, location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const headers: Record<string, string> = { "X-CPU-Auth-Mode": "cookie", "X-CPU-Client": "harmony-app" };
  if (token && token !== "__cpu_jwxt_cookie_session__") headers["X-Jwxt-Token"] = token;
  if (auth.token && auth.token !== "__cpu_cookie_session__") headers.Authorization = `Bearer ${auth.token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { credentials: "same-origin", headers, signal: controller.signal });
    const body = await response.json();
    if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
      const message = body.message || "课表服务暂时不可用，请重试。";
      const expired = response.status === 401 || /请先登录教务|教务会话已失效|重新登录|重新授权/.test(message);
      if (expired && account === auth.user?.id && token === jwxt.token) {
        window.dispatchEvent(new Event("cpu-jwxt-auth-expired"));
      }
      throw Object.assign(new Error(message), { status: expired ? 401 : response.status });
    }
    return typeof body.code === "number" ? body.data : body;
  } finally { clearTimeout(timeout); }
}

export const jwxtApi = {
  schedule: (params?: Record<string, unknown>) => get("schedule", params),
  graduateSchedule: (params?: Record<string, unknown>) => get("graduate-schedule", params),
  calendar: (params?: Record<string, unknown>) => get("calendar", params),
  getScheduleEdits: (semester: string) => get("schedule-edits", { semester }),
};
