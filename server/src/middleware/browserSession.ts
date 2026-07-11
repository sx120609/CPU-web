import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { config, isDev } from "../config";
import {
  csrfCookieValue,
  isCookieAuthRequest,
  loadBrowserSession,
} from "../services/browserSession";
import { Errors } from "../utils/response";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function allowedOrigins(req: Request) {
  // Host 由浏览器的目标地址决定；不接受客户端可直接注入的 X-Forwarded-Host 作为安全边界。
  const host = String(req.get("host") || "").split(",")[0].trim();
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const values = new Set(config.corsAllowedOrigins);
  if (host) values.add(`${proto}://${host}`);
  if (isDev) {
    values.add("http://localhost:5173");
    values.add("http://127.0.0.1:5173");
  }
  return values;
}

export async function browserSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const loaded = await loadBrowserSession(req, res);
    req.browserSessionId = loaded?.id;
    req.browserSession = loaded?.session;
    next();
  } catch (error) {
    next(error);
  }
}

export function requestOriginAndCsrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  const origin = String(req.get("origin") || "").trim();
  const fetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
  if (origin && !allowedOrigins(req).has(origin)) {
    return next(Errors.forbidden("请求来源不受信任"));
  }
  if (fetchSite === "cross-site") {
    return next(Errors.forbidden("拒绝跨站请求"));
  }

  if (!req.browserSession) return next();
  if (!origin && isCookieAuthRequest(req)) {
    return next(Errors.forbidden("缺少请求来源信息"));
  }
  const headerToken = String(req.get("x-csrf-token") || "");
  const cookieToken = csrfCookieValue(req);
  if (
    !headerToken
    || !cookieToken
    || !safeEqual(headerToken, cookieToken)
    || !safeEqual(headerToken, req.browserSession.csrfToken)
  ) {
    return next(Errors.forbidden("CSRF 校验失败，请刷新页面后重试"));
  }
  next();
}
