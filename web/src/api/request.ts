import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { ElMessage } from "element-plus";
import { reactive } from "vue";
import { detectClientPlatform } from "@/utils/clientInfo";

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

const TOKEN_KEY = "cpu-web-token";
const AUTH_PRESENCE_KEY = "cpu-authenticated";
const AUTH_CACHE_SCOPE_KEY = "cpu-auth-cache-scope";
export const COOKIE_SESSION_MARKER = "__cpu_cookie_session__";
export const AUTH_EXPIRED_EVENT = "cpu-auth-expired";

let memoryToken = (() => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
})();
let memoryAuthCacheScope = (() => {
  try { return sessionStorage.getItem(AUTH_CACHE_SCOPE_KEY) || ""; } catch { return ""; }
})();

export type RequestOptions = AxiosRequestConfig & {
  suppressAuthRedirect?: boolean;
  suppressAuthMessage?: boolean;
  suppressErrorMessage?: boolean;
  /** 仅记录曝光等被动事件时，不清空页面的 GET 响应缓存。 */
  preserveResponseCache?: boolean;
  /** 内存响应缓存；设为 0 可强制跳过。默认仅覆盖高频只读页面。 */
  cacheTtlMs?: number;
  /** 过期后仍可立即展示并在后台刷新的时间；设为 0 可禁用 stale-while-revalidate。 */
  cacheStaleTtlMs?: number;
};

type ResponseCacheEntry = {
  version: 1;
  url: string;
  freshUntil: number;
  staleUntil: number;
  savedAt: number;
  value: unknown;
};

const RESPONSE_CACHE_STORAGE_PREFIX = "cpu-api-get-cache-v1:";
const RESPONSE_CACHE_MAX_ENTRIES = 80;
const RESPONSE_CACHE_MAX_ITEM_CHARS = 600_000;
const RESPONSE_CACHE_MAX_TOTAL_CHARS = 3_500_000;
const getResponseCache = new Map<string, ResponseCacheEntry>();
const getRequestsInFlight = new Map<string, Promise<unknown>>();
let responseCacheGeneration = 0;
let responseCacheMutationVersion = 0;

function invalidateResponseCache() {
  responseCacheGeneration += 1;
  responseCacheMutationVersion += 1;
  getResponseCache.clear();
  getRequestsInFlight.clear();
  clearPersistedResponseCache();
}

function markResponseCacheStale() {
  responseCacheMutationVersion += 1;
  // 写请求完成后，旧版本的在途 GET 不能阻止新一轮刷新；旧响应会被版本号挡住，
  // 这里仅解除去重占位，不取消网络请求。
  getRequestsInFlight.clear();
  for (const [key, entry] of getResponseCache.entries()) {
    entry.freshUntil = 0;
    persistResponseCacheEntry(key, entry);
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const storageKey = sessionStorage.key(i) || "";
      if (!storageKey.startsWith(RESPONSE_CACHE_STORAGE_PREFIX)) continue;
      try {
        const entry = JSON.parse(sessionStorage.getItem(storageKey) || "null") as ResponseCacheEntry | null;
        if (!entry || entry.version !== 1) continue;
        entry.freshUntil = 0;
        sessionStorage.setItem(storageKey, JSON.stringify(entry));
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
  } catch {
    /* ignore */
  }
}

function stableParams(params?: Record<string, unknown>) {
  if (!params) return "";
  return JSON.stringify(Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
  ));
}

function defaultGetCacheTtl(url: string) {
  // 登录握手、教务会话、支付和一次性凭据有独立状态机，不能由通用响应缓存接管。
  if (/^\/(auth|jwxt|oauth|payments|storage|uploads|course-bot)(\/|$)/.test(url)) return 0;
  if (/^\/(site|boards|services)(\/|$)/.test(url)) return 60_000;
  // 其余 GET 统一短时 fresh、长时 stale；数据变化后会被写请求标成 stale 并后台刷新。
  return 15_000;
}

function defaultGetStaleTtl(url: string, freshTtlMs: number) {
  if (freshTtlMs <= 0) return 0;
  if (/^\/(site|boards|services)(\/|$)/.test(url)) return 6 * 60 * 60_000;
  if (/^\/(home|topics|courses|search|market|lost-found|forum-ads)(\/|$)/.test(url)) return 60 * 60_000;
  return Math.max(10 * 60_000, freshTtlMs * 20);
}

function cacheKey(url: string, params?: Record<string, unknown>) {
  const authScope = memoryToken || hasAuthPresence()
    ? (memoryAuthCacheScope || "auth-pending")
    : "guest";
  return `${responseCacheGeneration}:${authScope}:${url}:${stableParams(params)}`;
}

function toReactiveCacheValue<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return reactive(value as object) as T;
}

function updateReactiveCacheValue(current: unknown, next: unknown) {
  if (Array.isArray(current) && Array.isArray(next)) {
    current.splice(0, current.length, ...next);
    return current;
  }
  if (
    current && next
    && typeof current === "object"
    && typeof next === "object"
    && !Array.isArray(current)
    && !Array.isArray(next)
  ) {
    const target = current as Record<string, unknown>;
    const source = next as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (!(key in source)) delete target[key];
    }
    Object.assign(target, source);
    return current;
  }
  return toReactiveCacheValue(next);
}

function responseCacheStorageKey(key: string) {
  return `${RESPONSE_CACHE_STORAGE_PREFIX}${key}`;
}

function clearPersistedResponseCache() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i) || "";
      if (key.startsWith(RESPONSE_CACHE_STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* sessionStorage 不可用时仍保留当前页面的内存缓存。 */
  }
}

function prunePersistedResponseCache() {
  try {
    const now = Date.now();
    const entries: Array<{ key: string; savedAt: number; chars: number }> = [];
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i) || "";
      if (!key.startsWith(RESPONSE_CACHE_STORAGE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(sessionStorage.getItem(key) || "null") as Partial<ResponseCacheEntry> | null;
        if (!parsed || parsed.version !== 1 || Number(parsed.staleUntil) <= now) {
          sessionStorage.removeItem(key);
          continue;
        }
        entries.push({ key, savedAt: Number(parsed.savedAt) || 0, chars: (sessionStorage.getItem(key) || "").length });
      } catch {
        sessionStorage.removeItem(key);
      }
    }
    let retainedChars = 0;
    entries
      .sort((a, b) => b.savedAt - a.savedAt)
      .forEach((entry, index) => {
        const overBudget = index >= RESPONSE_CACHE_MAX_ENTRIES
          || retainedChars + entry.chars > RESPONSE_CACHE_MAX_TOTAL_CHARS;
        if (overBudget) sessionStorage.removeItem(entry.key);
        else retainedChars += entry.chars;
      });
  } catch {
    /* ignore */
  }
}

function persistResponseCacheEntry(key: string, entry: ResponseCacheEntry) {
  try {
    const serialized = JSON.stringify(entry);
    if (serialized.length > RESPONSE_CACHE_MAX_ITEM_CHARS) {
      sessionStorage.removeItem(responseCacheStorageKey(key));
      return;
    }
    sessionStorage.setItem(responseCacheStorageKey(key), serialized);
    if (sessionStorage.length % 12 === 0) prunePersistedResponseCache();
  } catch {
    prunePersistedResponseCache();
    try {
      const serialized = JSON.stringify(entry);
      if (serialized.length <= RESPONSE_CACHE_MAX_ITEM_CHARS) {
        sessionStorage.setItem(responseCacheStorageKey(key), serialized);
      }
    } catch {
      /* ignore */
    }
  }
}

function readPersistedResponseCacheEntry(key: string, url: string) {
  try {
    const storageKey = responseCacheStorageKey(key);
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResponseCacheEntry>;
    if (
      parsed.version !== 1
      || parsed.url !== url
      || !Number.isFinite(parsed.freshUntil)
      || !Number.isFinite(parsed.staleUntil)
      || Number(parsed.staleUntil) <= Date.now()
    ) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    const entry: ResponseCacheEntry = {
      version: 1,
      url,
      freshUntil: Number(parsed.freshUntil),
      staleUntil: Number(parsed.staleUntil),
      savedAt: Number(parsed.savedAt) || 0,
      value: toReactiveCacheValue(parsed.value),
    };
    getResponseCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function readResponseCacheEntry(key: string, url: string) {
  const memory = getResponseCache.get(key);
  if (memory) {
    if (memory.staleUntil > Date.now()) return memory;
    getResponseCache.delete(key);
  }
  return readPersistedResponseCacheEntry(key, url);
}

function storeResponseCacheValue(
  key: string,
  url: string,
  value: unknown,
  freshTtlMs: number,
  staleTtlMs: number,
) {
  const now = Date.now();
  const existing = getResponseCache.get(key);
  const cachedValue = existing
    ? updateReactiveCacheValue(existing.value, value)
    : toReactiveCacheValue(value);
  const entry: ResponseCacheEntry = {
    version: 1,
    url,
    freshUntil: now + freshTtlMs,
    staleUntil: now + freshTtlMs + staleTtlMs,
    savedAt: now,
    value: cachedValue,
  };
  getResponseCache.set(key, entry);
  persistResponseCacheEntry(key, entry);
  if (getResponseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = [...getResponseCache.entries()]
      .sort(([, a], [, b]) => a.savedAt - b.savedAt)[0]?.[0];
    if (oldest) getResponseCache.delete(oldest);
  }
  return cachedValue;
}

export function getToken() {
  return memoryToken;
}

export function hasAuthPresence() {
  try { return localStorage.getItem(AUTH_PRESENCE_KEY) === "1"; } catch { return false; }
}

export function setToken(token: string, userId?: number | string | null) {
  // Cookie sessions use a stable marker instead of exposing the HttpOnly cookie.
  // 用用户 ID 区分会话：普通刷新仍能复用 sessionStorage，真正切换账号时必须硬清空。
  const nextScope = token
    ? (userId !== undefined && userId !== null ? `user-${userId}` : (memoryAuthCacheScope || "auth-pending"))
    : "guest";
  if (nextScope !== (memoryAuthCacheScope || (hasAuthPresence() ? "auth-pending" : "guest"))) {
    invalidateResponseCache();
  }
  memoryToken = token;
  memoryAuthCacheScope = nextScope;
  try {
    localStorage.removeItem(TOKEN_KEY);
    if (token) {
      localStorage.setItem(AUTH_PRESENCE_KEY, "1");
      sessionStorage.setItem(AUTH_CACHE_SCOPE_KEY, nextScope);
    } else {
      localStorage.removeItem(AUTH_PRESENCE_KEY);
      sessionStorage.removeItem(AUTH_CACHE_SCOPE_KEY);
    }
  } catch { /* ignore */ }
}

export function clearToken() {
  if (memoryToken || hasAuthPresence() || memoryAuthCacheScope) invalidateResponseCache();
  memoryToken = "";
  memoryAuthCacheScope = "";
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_PRESENCE_KEY);
    sessionStorage.removeItem(AUTH_CACHE_SCOPE_KEY);
  } catch { /* ignore */ }
}

function cookieValue(name: string) {
  const prefix = `${name}=`;
  const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(prefix.length)); } catch { return part.slice(prefix.length); }
}

export function getCsrfToken() {
  return cookieValue("__Host-cpu-csrf") || cookieValue("cpu-csrf");
}

const instance: AxiosInstance = axios.create({
  baseURL: "/api",
  timeout: 15000,
  withCredentials: true,
});

instance.interceptors.request.use((config) => {
  const token = getToken();
  if (token && token !== COOKIE_SESSION_MARKER) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["X-CPU-Auth-Mode"] = "cookie";
  const csrf = getCsrfToken();
  if (csrf) config.headers["X-CSRF-Token"] = csrf;
  config.headers["X-CPU-Client"] = detectClientPlatform();
  return config;
});

instance.interceptors.response.use(
  (resp) => {
    const config = resp.config as RequestOptions | undefined;
    const body = resp.data as ApiResponse<unknown>;
    if (body && typeof body.code === "number") {
      if (body.code !== 0) {
        if (!config?.suppressErrorMessage) ElMessage.error(body.message || "请求失败");
        return Promise.reject(new Error(body.message || "请求失败"));
      }
      return body.data;
    }
    return resp.data;
  },
  (err: AxiosError<ApiResponse<unknown>>) => {
    const config = err.config as RequestOptions | undefined;
    if (err.response?.status === 401) {
      clearToken();
      sessionStorage.removeItem("cpu-jwxt-token");
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      if (!config?.suppressAuthMessage) ElMessage.warning("登录已过期，请重新登录");
      if (!config?.suppressAuthRedirect && window.location.pathname !== "/login") {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${redirect}`;
      }
    } else if (!config?.suppressErrorMessage) {
      const message = err.response?.data?.message ?? err.message ?? "网络请求失败";
      ElMessage.error(message);
    }
    return Promise.reject(err);
  }
);

export const request = {
  get: <T = unknown>(url: string, params?: Record<string, unknown>, options?: RequestOptions) => {
    const ttlMs = options?.cacheTtlMs ?? defaultGetCacheTtl(url);
    const staleTtlMs = options?.cacheStaleTtlMs ?? defaultGetStaleTtl(url, ttlMs);
    const key = cacheKey(url, params);
    const requestGeneration = responseCacheGeneration;
    const requestMutationVersion = responseCacheMutationVersion;
    const cached = ttlMs > 0 ? readResponseCacheEntry(key, url) : null;
    if (cached && cached.freshUntil > Date.now()) return Promise.resolve(cached.value as T);
    const pending = getRequestsInFlight.get(key);
    if (pending) return cached ? Promise.resolve(cached.value as T) : pending as Promise<T>;
    const { cacheTtlMs: _cacheTtlMs, cacheStaleTtlMs: _cacheStaleTtlMs, ...axiosOptions } = options ?? {};
    const background = Boolean(cached && cached.staleUntil > Date.now());
    const task = instance.get<unknown, T>(url, {
      ...axiosOptions,
      ...(background ? { suppressErrorMessage: true } : {}),
      params,
    })
      .then((value) => {
        if (
          ttlMs > 0
          && requestGeneration === responseCacheGeneration
          && requestMutationVersion === responseCacheMutationVersion
        ) {
          return storeResponseCacheValue(key, url, value, ttlMs, staleTtlMs) as T;
        }
        return value;
      })
      .finally(() => {
        if (getRequestsInFlight.get(key) === task) getRequestsInFlight.delete(key);
      });
    getRequestsInFlight.set(key, task);
    if (background && cached) {
      void task.catch(() => undefined);
      return Promise.resolve(cached.value as T);
    }
    return task;
  },
  post: <T = unknown>(url: string, data?: unknown, options?: RequestOptions) => {
    const { cacheTtlMs: _cacheTtlMs, cacheStaleTtlMs: _cacheStaleTtlMs, preserveResponseCache, ...axiosOptions } = options ?? {};
    return instance.post<unknown, T>(url, data, axiosOptions).then((value) => {
      if (!preserveResponseCache) markResponseCacheStale();
      return value;
    });
  },
  patch: <T = unknown>(url: string, data?: unknown, options?: RequestOptions) =>
    instance.patch<unknown, T>(url, data, options).then((value) => { markResponseCacheStale(); return value; }),
  delete: <T = unknown>(url: string, options?: RequestOptions) =>
    instance.delete<unknown, T>(url, options).then((value) => { markResponseCacheStale(); return value; }),
};

export default instance;
