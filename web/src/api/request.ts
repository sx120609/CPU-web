import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { ElMessage } from "element-plus";
import { detectClientPlatform } from "@/utils/clientInfo";

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

const TOKEN_KEY = "cpu-web-token";
const AUTH_PRESENCE_KEY = "cpu-authenticated";
export const COOKIE_SESSION_MARKER = "__cpu_cookie_session__";
export const AUTH_EXPIRED_EVENT = "cpu-auth-expired";

let memoryToken = (() => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
})();

export type RequestOptions = AxiosRequestConfig & {
  suppressAuthRedirect?: boolean;
  suppressAuthMessage?: boolean;
  suppressErrorMessage?: boolean;
};

export function getToken() {
  return memoryToken;
}

export function hasAuthPresence() {
  try { return localStorage.getItem(AUTH_PRESENCE_KEY) === "1"; } catch { return false; }
}

export function setToken(token: string) {
  memoryToken = token;
  try {
    localStorage.removeItem(TOKEN_KEY);
    if (token) localStorage.setItem(AUTH_PRESENCE_KEY, "1");
    else localStorage.removeItem(AUTH_PRESENCE_KEY);
  } catch { /* ignore */ }
}

export function clearToken() {
  memoryToken = "";
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_PRESENCE_KEY);
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
  get: <T = unknown>(url: string, params?: Record<string, unknown>, options?: RequestOptions) =>
    instance.get<unknown, T>(url, { ...options, params }),
  post: <T = unknown>(url: string, data?: unknown, options?: RequestOptions) =>
    instance.post<unknown, T>(url, data, options),
  patch: <T = unknown>(url: string, data?: unknown, options?: RequestOptions) =>
    instance.patch<unknown, T>(url, data, options),
  delete: <T = unknown>(url: string, options?: RequestOptions) => instance.delete<unknown, T>(url, options),
};

export default instance;
