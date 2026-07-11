import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import {
  csrfCookieValue,
  loadBrowserSession,
} from "../services/browserSession";
import { Errors } from "../utils/response";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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

  const fetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
  if (fetchSite === "cross-site") {
    return next(Errors.forbidden("拒绝跨站请求"));
  }

  if (!req.browserSession) return next();
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
