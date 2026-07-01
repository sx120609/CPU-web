/**
 * 平台 API 封装：所有请求从主进程发出，避免渲染进程跨域 & 暴露 token
 * 复用现有后端接口：/auth/sso-begin, /auth/sso-login, /course-bot/*
 */
import axios from "axios";

// 生产默认线上后端；开发通过 CPU_API_BASE=http://localhost:3000 覆盖
const API_BASE = process.env.CPU_API_BASE || "https://cpu.lizmt.cn";

// 后端所有业务路由挂在 /api 前缀下（见 server/src/app.ts: app.use("/api", router)）
const http = axios.create({ baseURL: `${API_BASE}/api`, timeout: 20_000 });

export function setAuthToken(t: string | null) {
  http.defaults.headers.common.Authorization = t ? `Bearer ${t}` : undefined;
}

export async function ssoBegin() {
  const { data } = await http.post("/auth/sso-begin");
  return data.data as { pendingId: string; needCaptcha: boolean; captchaImage?: string };
}

export async function ssoLogin(args: {
  pendingId: string;
  username: string;
  password: string;
  captcha?: string;
}) {
  const { data } = await http.post("/auth/sso-login", args);
  // sso-login 外层是 { code:0, data:{ ok, siteToken, ... } }
  return data.data as {
    ok: boolean;
    siteToken?: string;
    jwxtToken?: string;
    error?: string;
    needCaptcha?: boolean;
    captcha?: string;
    user?: { id: number; username: string; nickname: string };
    needNickname?: boolean;
  };
}

export async function getQuota() {
  const { data } = await http.get("/course-bot/quota");
  return data.data as { aiBalance: number; totalConsumed: number; totalGranted: number; videoFree: boolean };
}

export async function heartbeat() {
  const { data } = await http.post("/course-bot/heartbeat");
  return data.data as {
    alive: boolean;
    user: { id: number; username: string; nickname: string };
    quota: { aiBalance: number };
    config: Record<string, unknown>;
  };
}
