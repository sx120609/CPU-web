import axios, { AxiosError, type AxiosInstance } from "axios";
import { ElMessage } from "element-plus";
import { detectClientPlatform } from "@/utils/clientInfo";

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

const TOKEN_KEY = "cpu-web-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const instance: AxiosInstance = axios.create({
  baseURL: "/api",
  timeout: 15000,
});

instance.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["X-CPU-Client"] = detectClientPlatform();
  // 同时注入教务 token（如果存在），便于后端跨域请求（如 /courses/sync 需要拉教务数据）
  const jwxtToken = sessionStorage.getItem("cpu-jwxt-token");
  if (jwxtToken) {
    config.headers["X-Jwxt-Token"] = jwxtToken;
  }
  return config;
});

instance.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiResponse<unknown>;
    if (body && typeof body.code === "number") {
      if (body.code !== 0) {
        ElMessage.error(body.message || "请求失败");
        return Promise.reject(new Error(body.message || "请求失败"));
      }
      return body.data;
    }
    return resp.data;
  },
  (err: AxiosError<ApiResponse<unknown>>) => {
    if (err.response?.status === 401) {
      clearToken();
      ElMessage.warning("登录已过期，请重新登录");
      if (window.location.pathname !== "/login") {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${redirect}`;
      }
    } else {
      const message = err.response?.data?.message ?? err.message ?? "网络请求失败";
      ElMessage.error(message);
    }
    return Promise.reject(err);
  }
);

export const request = {
  get: <T = unknown>(url: string, params?: Record<string, unknown>) =>
    instance.get<unknown, T>(url, { params }),
  post: <T = unknown>(url: string, data?: unknown) =>
    instance.post<unknown, T>(url, data),
  patch: <T = unknown>(url: string, data?: unknown) =>
    instance.patch<unknown, T>(url, data),
  delete: <T = unknown>(url: string) => instance.delete<unknown, T>(url),
};

export default instance;
