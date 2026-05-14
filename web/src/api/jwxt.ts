/**
 * 教务（jsxsd）代登录 API 封装
 *
 * 重要：教务 token 与站内登录 token 是分开的两条线。
 *  - 站内 token：localStorage / Authorization 头
 *  - 教务 token：sessionStorage / X-Jwxt-Token 头（关闭浏览器即清空）
 */
import axios from "axios";
import { ElMessage } from "element-plus";

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

inst.interceptors.request.use((cfg) => {
  const tk = getJwxtToken();
  if (tk) cfg.headers["X-Jwxt-Token"] = tk;
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
        ElMessage.error(body.message || "请求失败");
        return Promise.reject(new Error(body.message));
      }
      return body.data;
    }
    return resp.data;
  },
  (err) => {
    const msg = err.response?.data?.message ?? err.message ?? "教务请求失败";
    ElMessage.error(msg);
    return Promise.reject(err);
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

export const jwxtApi = {
  beginLogin: () => inst.post<unknown, BeginLoginResult>("/begin-login"),
  login: (p: { pendingId: string; username: string; password: string; captcha?: string }) =>
    inst.post<unknown, LoginResult>("/login", p),
  logout: () => inst.post<unknown, { ok: boolean }>("/logout"),
  status: () => inst.get<unknown, { active: boolean; since?: number }>("/status"),
  schedule: () => inst.get<unknown, { html: string; parsed: any }>("/schedule"),
  grades: () => inst.get<unknown, { html: string; parsed: any }>("/grades"),
  exams: () => inst.get<unknown, { html: string; parsed: any }>("/exams"),
  progress: () => inst.get<unknown, { parsed: any }>("/progress"),
  pyfa: () => inst.get<unknown, { parsed: any }>("/pyfa"),
  calendar: () => inst.get<unknown, { parsed: any }>("/calendar"),
  iapps: () => inst.get<unknown, { apps: any[] }>("/iapps"),
  textbook: () => inst.get<unknown, { parsed: any }>("/textbook"),
  debugSnapshot: () => inst.post<unknown, { saved: string[]; errors: string[] }>("/debug/snapshot"),
  probe: (path: string) => inst.get<unknown, { html: string }>("/probe", { params: { path } }),
};
