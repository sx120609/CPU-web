import { config } from "../config";
import { Errors, HttpError } from "../utils/response";
import type * as local from "./jwxtFacade";
import type { LoginAttempt } from "./jwxtClient";
import { normalizeGradesResult } from "./jwxtParser";

type ApiEnvelope<T> = {
  code: number;
  data: T;
  message: string;
};

async function call<T>(path: string, body?: unknown, method: "GET" | "POST" = "POST"): Promise<T> {
  if (!config.jwxtProxyUrl) throw Errors.server("未配置教务代理地址");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.proxyTimeoutMs);
  const url = new URL(path, config.jwxtProxyUrl).toString();

  try {
    const headers: Record<string, string> = {
      "X-Proxy-Auth": config.jwxtProxyAuth,
    };
    let payload: string | undefined;
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body ?? {});
    }

    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    const json = await parseEnvelope(res);
    if (!res.ok || json.code !== 0) {
      const code = Number.isFinite(json.code) ? json.code : res.status === 401 ? 4001 : 5000;
      const message = json.message || `教务代理请求失败 (${res.status})`;
      throw new HttpError(res.status || 500, code, message);
    }
    return json.data as T;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (e?.name === "AbortError") throw Errors.server("教务代理请求超时");
    throw Errors.server("教务代理不可达: " + (e?.message ?? String(e)));
  } finally {
    clearTimeout(timer);
  }
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  if (!text) return { code: res.ok ? 0 : res.status, data: undefined as T, message: "" };
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new HttpError(res.status || 502, 5000, "教务代理返回非 JSON 响应");
  }
}

export function beginLogin(): ReturnType<typeof local.beginLogin> {
  return call("/v1/begin-login", {});
}

export function submitLogin(args: Parameters<typeof local.submitLogin>[0]): Promise<LoginAttempt> {
  return call("/v1/login", args);
}

/** 在固定 JWXT_PROXY_URL 节点消费登录池颁发的一次性会话交接。 */
export function consumeLoginHandoff(
  handoff: Parameters<typeof local.consumeLoginHandoff>[0],
): ReturnType<typeof local.consumeLoginHandoff> {
  return call("/v1/login-pool/consume-handoff", { handoff }) as ReturnType<typeof local.consumeLoginHandoff>;
}

export async function logout(token: string): Promise<boolean> {
  const r = await call<{ ok: boolean }>("/v1/logout", { token });
  return r.ok;
}

export function getStatus(token: string | undefined | null): ReturnType<typeof local.getStatus> {
  return call("/v1/status", { token }) as ReturnType<typeof local.getStatus>;
}

export function sessionStats(): ReturnType<typeof local.sessionStats> {
  return call("/v1/stats", undefined, "GET") as ReturnType<typeof local.sessionStats>;
}

export function getSchedule(token: string, args?: Parameters<typeof local.getSchedule>[1]): ReturnType<typeof local.getSchedule> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getSchedule>> }>("/v1/schedule", { token, ...(args ?? {}) })
    .then((r) => r.parsed) as ReturnType<typeof local.getSchedule>;
}

export function getGrades(token: string, args?: Parameters<typeof local.getGrades>[1]): ReturnType<typeof local.getGrades> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getGrades>> }>("/v1/grades", { token, ...(args ?? {}) })
    .then((r) => normalizeGradesResult(r.parsed)) as ReturnType<typeof local.getGrades>;
}

export function getMidtermGrades(token: string, args?: Parameters<typeof local.getMidtermGrades>[1]): ReturnType<typeof local.getMidtermGrades> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getMidtermGrades>> }>("/v1/midterm-grades", { token, ...(args ?? {}) })
    .then((r) => normalizeGradesResult(r.parsed)) as ReturnType<typeof local.getMidtermGrades>;
}

export function getExams(token: string, args?: Parameters<typeof local.getExams>[1]): ReturnType<typeof local.getExams> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getExams>> }>("/v1/exams", { token, ...(args ?? {}) })
    .then((r) => r.parsed) as ReturnType<typeof local.getExams>;
}

export function getCalendar(token: string): ReturnType<typeof local.getCalendar> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getCalendar>> }>("/v1/calendar", { token })
    .then((r) => r.parsed) as ReturnType<typeof local.getCalendar>;
}

export function getProgress(token: string): ReturnType<typeof local.getProgress> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getProgress>> }>("/v1/progress", { token })
    .then((r) => r.parsed) as ReturnType<typeof local.getProgress>;
}

export function getPyfa(token: string): ReturnType<typeof local.getPyfa> {
  return call<{ parsed: Awaited<ReturnType<typeof local.getPyfa>> }>("/v1/pyfa", { token })
    .then((r) => r.parsed) as ReturnType<typeof local.getPyfa>;
}

export function getIApps(token: string): ReturnType<typeof local.getIApps> {
  return call<{ apps: Awaited<ReturnType<typeof local.getIApps>> }>("/v1/iapps", { token })
    .then((r) => r.apps) as ReturnType<typeof local.getIApps>;
}

export function getGraduateSchedule(token: string, args?: Parameters<typeof local.getGraduateSchedule>[1]): ReturnType<typeof local.getGraduateSchedule> {
  return call<Awaited<ReturnType<typeof local.getGraduateSchedule>>>("/v1/graduate-schedule", { token, ...(args ?? {}) }) as ReturnType<typeof local.getGraduateSchedule>;
}

export function debugSnapshot(token: string): ReturnType<typeof local.debugSnapshot> {
  return call("/v1/debug-snapshot", { token });
}
