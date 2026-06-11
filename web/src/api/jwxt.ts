/**
 * 教务（jsxsd）代登录 API 封装
 *
 * 重要：教务 token 与站内登录 token 是分开的两条线。
 *  - 站内 token：localStorage / Authorization 头
 *  - 教务 token：sessionStorage / X-Jwxt-Token 头（关闭浏览器即清空）
 */
import axios from "axios";
import { ElMessage } from "element-plus";
import { detectClientPlatform } from "@/utils/clientInfo";

const JWXT_TOKEN_KEY = "cpu-jwxt-token";

export function getJwxtToken() {
  return sessionStorage.getItem(JWXT_TOKEN_KEY) ?? "";
}
export function setJwxtToken(t: string) {
  sessionStorage.setItem(JWXT_TOKEN_KEY, t);
}
export function clearJwxtToken() {
  sessionStorage.removeItem(JWXT_TOKEN_KEY);
}

const inst = axios.create({ baseURL: "/api/jwxt", timeout: 30000 });

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
  if (tk) cfg.headers["X-Jwxt-Token"] = tk;
  cfg.headers["X-CPU-Client"] = detectClientPlatform();
  // 站内登录 token 也带上，便于后端识别用户
  const siteToken = localStorage.getItem("cpu-web-token");
  if (siteToken) cfg.headers.Authorization = `Bearer ${siteToken}`;
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
    if (!shouldSuppressErrorMessage(err.config)) {
      ElMessage.error(msg);
    }
    return Promise.reject(new Error(msg));
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
  schedule: (params?: { semester?: string; week?: string }, options?: { silent?: boolean }) =>
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
  progress: () => inst.get<unknown, { parsed: any }>("/progress"),
  pyfa: () => inst.get<unknown, { parsed: any }>("/pyfa"),
  calendar: () => inst.get<unknown, { parsed: any }>("/calendar"),
  iapps: () => inst.get<unknown, { apps: any[] }>("/iapps"),
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
  textbook: () => inst.get<unknown, { parsed: any }>("/textbook"),
  debugSnapshot: () => inst.post<unknown, { saved: string[]; errors: string[] }>("/debug/snapshot"),
  graduateSchedule: (params?: { semester?: string; termcode?: string }, options?: { silent?: boolean }) =>
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
