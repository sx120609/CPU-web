/**
 * 教务（jsxsd）代登录 API 封装
 *
 * 浏览器只持有服务端 HttpOnly 会话 Cookie；旧版 sessionStorage token
 * 仅在升级后的首次加载中读入内存完成迁移，并会立即从 Web Storage 删除。
 */
import axios from "axios";
import { ElMessage } from "element-plus";
import { detectAnalyticsClient } from "@/utils/clientInfo";
import { COOKIE_SESSION_MARKER, getToken } from "./request";
import { shouldRetryJwxtRead, jwxtRetryDelay, waitForJwxtRetry } from "@/utils/jwxtReadRetry";
import {
  JWXT_AUTH_EXPIRED_CODE,
  isJwxtAuthExpiredResponse,
  type JwxtRequestError,
} from "@/utils/jwxtAuthErrors";

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
let authSessionGeneration = 0;
let authExpiredSignaled = false;

export function getJwxtToken() {
  return memoryJwxtToken;
}
/** 每次换上新的教务会话就加一；请求失败时据此判断会话是不是已经被别处续上了。 */
export function getJwxtAuthGeneration() {
  return authSessionGeneration;
}
/**
 * renewed：这是一次真正的新会话（统一认证登录成功）。只有它才换代次；
 * 状态检查只是确认服务端还存着会话，学校那边可能早过期了，不能让在路上的失败请求以为已经续上。
 */
export function setJwxtToken(t: string, options: { renewed?: boolean } = {}) {
  memoryJwxtToken = t;
  if (t) {
    if (options.renewed !== false) authSessionGeneration += 1;
    authExpiredSignaled = false;
  }
  try { sessionStorage.removeItem(JWXT_TOKEN_KEY); } catch { /* ignore */ }
}
export function clearJwxtToken() {
  memoryJwxtToken = "";
  try { sessionStorage.removeItem(JWXT_TOKEN_KEY); } catch { /* ignore */ }
}

const inst = axios.create({ baseURL: "/api/jwxt", timeout: 30000, withCredentials: true });
let lastErrorToast = { message: "", at: 0 };
function showJwxtError(message: string) {
  if (lastErrorToast.message === message && Date.now() - lastErrorToast.at < 2000) return;
  lastErrorToast = { message, at: Date.now() };
  ElMessage.error(message);
}

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

export {
  JWXT_AUTH_EXPIRED_CODE,
  isJwxtAuthExpiredResponse,
  isJwxtAuthFailure,
  type JwxtRequestError,
} from "@/utils/jwxtAuthErrors";

/** 本地发现没有可用教务会话时抛出的错误，和服务端回的授权失效同一种形状。 */
export function jwxtNotAuthorizedError(message = "请先登录教务系统") {
  const error = new Error(message) as JwxtRequestError;
  error.status = 401;
  error.code = JWXT_AUTH_EXPIRED_CODE;
  error.jwxtAuthExpired = true;
  error.authGeneration = authSessionGeneration;
  return error;
}

function requestAuthGeneration(config: unknown) {
  return Number((config as { cpuJwxtAuthGeneration?: number } | undefined)?.cpuJwxtAuthGeneration ?? authSessionGeneration);
}

function signalJwxtAuthExpired(config: unknown) {
  // A late 401 from the previous session must not clear a session that has
  // already been recovered while the old request was still in flight.
  const generation = requestAuthGeneration(config);
  if (generation !== authSessionGeneration) return;
  clearJwxtToken();
  if (authExpiredSignaled) return;
  authExpiredSignaled = true;
  window.dispatchEvent(new CustomEvent(JWXT_AUTH_EXPIRED_EVENT, { detail: { generation } }));
}

inst.interceptors.request.use((cfg) => {
  (cfg as typeof cfg & { cpuJwxtAuthGeneration?: number }).cpuJwxtAuthGeneration = authSessionGeneration;
  const tk = getJwxtToken();
  if (tk && tk !== JWXT_COOKIE_SESSION_MARKER) cfg.headers["X-Jwxt-Token"] = tk;
  cfg.headers["X-CPU-Auth-Mode"] = "cookie";
  const csrf = cookieValue("__Host-cpu-csrf") || cookieValue("cpu-csrf");
  if (csrf) cfg.headers["X-CSRF-Token"] = csrf;
  cfg.headers["X-CPU-Client"] = detectAnalyticsClient();
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
        const authExpired = isJwxtAuthExpiredResponse(0, message, body.code);
        if (authExpired) {
          signalJwxtAuthExpired(resp.config);
        } else if (!shouldSuppressErrorMessage(resp.config)) {
          showJwxtError(message);
        }
        const normalized = new Error(message) as JwxtRequestError;
        normalized.status = authExpired ? 401 : undefined;
        normalized.code = body.code;
        normalized.jwxtAuthExpired = authExpired;
        normalized.authGeneration = requestAuthGeneration(resp.config);
        return Promise.reject(normalized);
      }
      return body.data;
    }
    return resp.data;
  },
  async (err) => {
    if (axios.isCancel(err)) return Promise.reject(err);
    const msg = normalizeJwxtError(err.response?.data?.message ?? err.message);
    const status = Number(err.response?.status || 0);
    const cfg = err.config;
    const retryCount = Number(cfg?.cpuJwxtRecoveryRetries || 0);
    // Only read operations are replayed. Login, logout and updates are never retried here.
    if (cfg && shouldRetryJwxtRead({ method: cfg.method, status, code: Number(err.response?.data?.code), message: msg, attempts: retryCount, aborted: cfg.signal?.aborted })) {
      const delay = jwxtRetryDelay(retryCount, err.response?.headers?.["retry-after"]);
      if (delay !== null) {
        cfg.cpuJwxtRecoveryRetries = retryCount + 1;
        await waitForJwxtRetry(delay, cfg.signal);
        if (cfg.signal?.aborted) return Promise.reject(new axios.CanceledError());
        return inst.request(cfg);
      }
    }
    const code = Number(err.response?.data?.code) || undefined;
    const authExpired = isJwxtAuthExpiredResponse(status, msg, code);
    if (authExpired) {
      // Session expiry is expected control flow: the JWXT store silently
      // performs one shared recovery and retries callers. Never toast here.
      signalJwxtAuthExpired(err.config);
    }
    if (!authExpired && !shouldSuppressErrorMessage(err.config)) {
      showJwxtError(msg);
    }
    const normalized = new Error(msg) as JwxtRequestError;
    normalized.status = status || undefined;
    normalized.code = code;
    normalized.response = err.response;
    normalized.jwxtAuthExpired = authExpired;
    normalized.authGeneration = requestAuthGeneration(err.config);
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
  /** 重叠课程的显示优先级：课程名 → 正整数。保存时不带这个字段，服务端沿用已保存的。 */
  priority?: Record<string, number>;
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

type JwxtDataResponse = {
  html?: string;
  parsed: any;
};

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
    inst.get<unknown, JwxtDataResponse>("/schedule", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  grades: (params?: { semester?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, JwxtDataResponse>("/grades", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  midtermGrades: (params?: { semester?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, JwxtDataResponse>("/midterm-grades", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  exams: (params?: { semester?: string; type?: string }, options?: { silent?: boolean }) =>
    inst.get<unknown, JwxtDataResponse>("/exams", {
      params,
      ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
    }),
  progress: (options?: { silent?: boolean }) => inst.get<unknown, JwxtDataResponse>("/progress", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  pyfa: (options?: { silent?: boolean }) => inst.get<unknown, JwxtDataResponse>("/pyfa", {
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  /** 课表、成绩之外的教务数据（空教室、课表检索、选课、教材、等级考试等），按 kind 取。 */
  records: (
    params: {
      kind: string; semester?: string; date?: string; scope?: string; keyword?: string;
      grade?: string; major?: string; classId?: string; refresh?: string;
    },
    options?: { silent?: boolean },
  ) => inst.get<unknown, JwxtDataResponse>("/records", {
    params,
    ...(options?.silent ? ({ suppressErrorMessage: true } as any) : undefined),
  }),
  /** ecert-zh / ecert-en：电子证明平台的预览件；jwxt：教务系统导出的版本。 */
  transcriptPdf: (variant: "ecert-zh" | "ecert-en" | "jwxt") => inst.get<unknown, Blob>("/transcript.pdf", {
    params: { variant },
    responseType: "blob",
    timeout: 60000,
    ...({ suppressErrorMessage: true } as any),
  }),
  calendar: (params?: { semester?: string }, options?: { silent?: boolean }) => inst.get<unknown, JwxtDataResponse>("/calendar", {
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
