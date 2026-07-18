/**
 * 教务（jsxsd）代登录 API 封装
 *
 * 浏览器只持有服务端 HttpOnly 会话 Cookie；旧版 sessionStorage token
 * 仅在升级后的首次加载中读入内存完成迁移，并会立即从 Web Storage 删除。
 */
import axios from "axios";
import { ElMessage } from "element-plus";
import { detectClientPlatform } from "@/utils/clientInfo";
import { COOKIE_SESSION_MARKER, getToken } from "./request";

const JWXT_TOKEN_KEY = "cpu-jwxt-token";
export const JWXT_COOKIE_SESSION_MARKER = "__cpu_jwxt_cookie_session__";
export const JWXT_AUTH_EXPIRED_EVENT = "cpu-jwxt-auth-expired";

let memoryJwxtToken = (() => {
  try {
    const legacyToken = sessionStorage.getItem(JWXT_TOKEN_KEY) ?? "";
    sessionStorage.removeItem(JWXT_TOKEN_KEY);
    return legacyToken;
  } catch {
    return "";
  }
})();

export function getJwxtToken() {
  return memoryJwxtToken;
}
export function setJwxtToken(t: string) {
  memoryJwxtToken = t;
  try { sessionStorage.removeItem(JWXT_TOKEN_KEY); } catch { /* ignore */ }
}
export function clearJwxtToken() {
  memoryJwxtToken = "";
  try { sessionStorage.removeItem(JWXT_TOKEN_KEY); } catch { /* ignore */ }
}

const inst = axios.create({ baseURL: "/api/jwxt", timeout: 30000, withCredentials: true });

function cookieValue(name: string) {
  const prefix = `${name}=`;
  const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(prefix.length)); } catch { return part.slice(prefix.length); }
}

function normalizeJwxtError(message?: string) {
  const raw = (message || "").trim();
  if (!raw || /fetch failed|network error/i.test(raw)) {
    return "暂时无法连接教务服务，请稍后重试";
  }
  return raw;
}

function shouldSuppressErrorMessage(config: unknown) {
  return Boolean((config as { suppressErrorMessage?: boolean } | undefined)?.suppressErrorMessage);
}

inst.interceptors.request.use((cfg) => {
  const tk = getJwxtToken();
  if (tk && tk !== JWXT_COOKIE_SESSION_MARKER) cfg.headers["X-Jwxt-Token"] = tk;
  cfg.headers["X-CPU-Auth-Mode"] = "cookie";
  const csrf = cookieValue("__Host-cpu-csrf") || cookieValue("cpu-csrf");
  if (csrf) cfg.headers["X-CSRF-Token"] = csrf;
  cfg.headers["X-CPU-Client"] = detectClientPlatform();
  // 站内登录 token 也带上，便于后端识别用户
  const siteToken = getToken();
  if (siteToken && siteToken !== COOKIE_SESSION_MARKER) cfg.headers.Authorization = `Bearer ${siteToken}`;
  return cfg;
});

inst.interceptors.response.use(
  (resp) => {
    const body = resp.data;
    if (body && typeof body.code === "number") {
      if (body.code !== 0) {
        const message = normalizeJwxtError(body.message || "请求失败");
        if (!shouldSuppressErrorMessage(resp.config)) {
          ElMessage.error(message);
        }
        return Promise.reject(new Error(message));
      }
      return body.data;
    }
    return resp.data;
  },
  (err) => {
    const msg = normalizeJwxtError(err.response?.data?.message ?? err.message);
    const status = Number(err.response?.status || 0);
    if (status === 401) {
      clearJwxtToken();
      window.dispatchEvent(new Event(JWXT_AUTH_EXPIRED_EVENT));
    }
    if (!shouldSuppressErrorMessage(err.config)) {
      ElMessage.error(msg);
    }
    const normalized = new Error(msg) as Error & { status?: number; response?: unknown };
    normalized.status = status || undefined;
    normalized.response = err.response;
    return Promise.reject(normalized);
  }
);

export interface BeginLoginResult {
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
}
export interface LoginResult {
  token?: string;
  ok?: boolean;
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
}

export interface CloudScheduleEdits {
  hidden: string[];
  custom: Array<{
    id: string;
    sourceKey?: string;
    day: number;
    bigSlot: number;
    course: {
      name: string;
      teacher?: string;
      weeks: string;
      weekList: number[];
      location?: string;
      slotNote?: string;
      startSlot?: number;
      endSlot?: number;
    };
  }>;
}

export interface ScheduleWidgetTokenResult {
  id: number;
  name?: string;
  tokenSuffix: string;
  expiresAt?: string;
  createdAt: string;
  token: string;
  endpoint: string;
}

export const jwxtApi = {
  beginLogin: (options?: { silent?: boolean }) =>
    inst.post<unknown, BeginLoginResult>(
      "/begin-login",
      undefined,
      options?.silent ? ({ suppressErrorMessage: true } as any) : undefined
    ),
  login: (p: { pendingId: string; username: string; password: string; captcha?: string }) =>
    inst.post<unknown, LoginResult>("/login", p),
  logout: () => inst.post<unknown, { ok: boolean }>("/logout"),
  status: (options?: { silent?: boolean }) =>
    inst.get<unknown, { active: boolean; since?: number; username?: string }>(
      "/status",
      options?.silent ? ({ suppressErrorMessage: true } as any) : undefined
    ),
  identity: (options?: { silent?: boolean }) =>
    inst.get<unknown, {
      identity: "undergraduate" | "graduate";
      source: "detected" | "fallback";
      capabilities: {
        undergraduate: boolean;
        graduate: boolean;
      };
    }>(
      "/identity",
      options?.silent ? ({ suppressErrorMessage: true } as any) : undefined
    ),
  schedule: (params?: { semester?: string; week?: string; refresh?: boolean | string }, options?: { silent?: boolean }) =>
    inst.get<unknown, { html: string; parsed: any }>("/schedule", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  grades: (params?: { semester?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, { html: string; parsed: any }>("/grades", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  midtermGrades: (params?: { semester?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, { html: string; parsed: any }>("/midterm-grades", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  exams: (params?: { semester?: string; type?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, { html: string; parsed: any }>("/exams", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  progress: (options?: { silent?: boolean }) => inst.get<unknown, { parsed: any }>("/progress", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  pyfa: (options?: { silent?: boolean }) => inst.get<unknown, { parsed: any }>("/pyfa", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  calendar: (params?: { semester?: string }, options?: { silent?: boolean }) => inst.get<unknown, { parsed: any }>("/calendar", {
    params,
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  iapps: (options?: { silent?: boolean }) => inst.get<unknown, { apps: any[] }>("/iapps", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  getScheduleEdits: (semester: string, options?: { silent?: boolean }) =>
    inst.get<unknown, { semester: string; edits: CloudScheduleEdits }>("/schedule-edits", {
      params: { semester },
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  saveScheduleEdits: (
    payload: { semester: string; edits: CloudScheduleEdits },
    options?: { silent?: boolean },
  ) => inst.put<unknown, { semester: string; edits: CloudScheduleEdits }>(
    "/schedule-edits",
    payload,
    options?.silent ? ({ suppressErrorMessage: true } as any) : undefined
  ),
  createScheduleWidgetToken: (payload?: { name?: string }) =>
    inst.post<unknown, ScheduleWidgetTokenResult>("/schedule-widget-tokens", payload ?? {}),
  refreshScheduleWidgetTokens: (options?: { silent?: boolean }) =>
    inst.post<unknown, { updated: number }>(
      "/schedule-widget-tokens/refresh",
      undefined,
      options?.silent ? ({ suppressErrorMessage: true } as any) : undefined
    ),
  listScheduleWidgetTokens: () =>
    inst.get<unknown, Array<Omit<ScheduleWidgetTokenResult, "token" | "endpoint">>>("/schedule-widget-tokens"),
  revokeScheduleWidgetToken: (id: number) =>
    inst.delete<unknown, { ok: boolean }>(`/schedule-widget-tokens/${id}`),
  textbook: (options?: { silent?: boolean }) => inst.get<unknown, { parsed: any }>("/textbook", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  debugSnapshot: () => inst.post<unknown, { saved: string[]; errors: string[] }>("/debug/snapshot"),
  graduateSchedule: (params?: { semester?: string; termcode?: string; refresh?: boolean | string }, options?: { silent?: boolean }) =>
    inst.get<unknown, {
      parsed: any;
      source: {
        mode?: "live" | "debug-fallback";
        semester?: string;
        termcode?: string;
        fetchedAt?: string;
        path?: string;
        savedAt?: string;
      };
    }>("/graduate-schedule", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  graduateDebugSchedule: (params?: { semester?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, { parsed: any; source: { path: string; savedAt?: string } }>("/graduate-debug/schedule", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  probe: (path: string) => inst.get<unknown, { html: string }>("/probe", { params: { path } }),
};
