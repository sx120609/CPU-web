import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config, isDev } from "../config";
import { deleteEphemeralValue, getEphemeralValue, setEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";

export type BrowserSession = {
  version: 1;
  siteToken: string;
  jwxtToken?: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
};

const SESSION_PREFIX = buildRedisKey("auth", "browser-session");
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const BROWSER_SESSION_COOKIE = isDev ? "cpu-session" : "__Host-cpu-session";
export const CSRF_COOKIE = isDev ? "cpu-csrf" : "__Host-cpu-csrf";

function sessionHash(id: string) {
  return crypto.createHash("sha256").update(id).digest("hex");
}

export function browserSessionStorageKey(id: string) {
  return `${SESSION_PREFIX}:${sessionHash(id)}`;
}

function parseCookies(req: Request) {
  const result: Record<string, string> = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      result[name] = part.slice(index + 1).trim();
    }
  }
  return result;
}

export function browserSessionId(req: Request) {
  const value = parseCookies(req)[BROWSER_SESSION_COOKIE] || "";
  return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : "";
}

export function csrfCookieValue(req: Request) {
  return parseCookies(req)[CSRF_COOKIE] || "";
}

function sessionCookieOptions(maxAge: number, httpOnly: boolean) {
  return {
    httpOnly,
    secure: !isDev,
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

function setSessionCookies(res: Response, id: string, session: BrowserSession) {
  const remaining = Math.max(1, Math.min(
    config.browserSessionIdleMs,
    session.absoluteExpiresAt - Date.now(),
  ));
  res.cookie(BROWSER_SESSION_COOKIE, id, sessionCookieOptions(remaining, true));
  res.cookie(CSRF_COOKIE, session.csrfToken, sessionCookieOptions(remaining, false));
  res.setHeader("Cache-Control", "no-store");
}

function validSession(value: BrowserSession): value is BrowserSession {
  return value?.version === 1
    && typeof value.siteToken === "string"
    && value.siteToken.length > 20
    && (!value.jwxtToken || (typeof value.jwxtToken === "string" && value.jwxtToken.length <= 2048))
    && typeof value.csrfToken === "string"
    && value.csrfToken.length >= 32
    && Number.isFinite(value.createdAt)
    && Number.isFinite(value.lastSeenAt)
    && Number.isFinite(value.absoluteExpiresAt);
}

async function saveSession(id: string, session: BrowserSession) {
  const remaining = Math.min(config.browserSessionIdleMs, session.absoluteExpiresAt - Date.now());
  if (remaining <= 0) {
    await deleteEphemeralValue(browserSessionStorageKey(id));
    return false;
  }
  await setEphemeralValue(
    browserSessionStorageKey(id),
    encryptJwxtSensitiveJson("browser-session", sessionHash(id), session),
    remaining,
  );
  return true;
}

export async function loadBrowserSession(req: Request, res?: Response) {
  const id = browserSessionId(req);
  if (!id) return null;
  const raw = await getEphemeralValue(browserSessionStorageKey(id));
  if (!raw) return null;
  try {
    const session = decryptJwxtSensitiveJson<BrowserSession>(
      "browser-session",
      sessionHash(id),
      raw,
    ).value;
    if (!validSession(session) || session.absoluteExpiresAt <= Date.now()) {
      await deleteEphemeralValue(browserSessionStorageKey(id));
      return null;
    }
    if (Date.now() - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      session.lastSeenAt = Date.now();
      await saveSession(id, session);
    }
    if (res) setSessionCookies(res, id, session);
    return { id, session };
  } catch {
    await deleteEphemeralValue(browserSessionStorageKey(id));
    return null;
  }
}

export async function issueBrowserSession(
  res: Response,
  input: { siteToken: string; jwxtToken?: string },
) {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: BrowserSession = {
    version: 1,
    siteToken: input.siteToken,
    ...(input.jwxtToken ? { jwxtToken: input.jwxtToken } : {}),
    csrfToken: crypto.randomBytes(32).toString("base64url"),
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + config.browserSessionAbsoluteMs,
  };
  await saveSession(id, session);
  setSessionCookies(res, id, session);
  return session;
}

export async function updateBrowserSession(
  req: Request,
  res: Response,
  patch: Partial<Pick<BrowserSession, "siteToken" | "jwxtToken">>,
) {
  const current = req.browserSession;
  const id = req.browserSessionId;
  if (!current || !id) return false;
  const next: BrowserSession = {
    ...current,
    ...patch,
    lastSeenAt: Date.now(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "jwxtToken") && !patch.jwxtToken) {
    delete next.jwxtToken;
  }
  const saved = await saveSession(id, next);
  if (saved) {
    req.browserSession = next;
    setSessionCookies(res, id, next);
  }
  return saved;
}

export async function revokeBrowserSession(req: Request, res: Response) {
  const id = req.browserSessionId || browserSessionId(req);
  if (id) await deleteEphemeralValue(browserSessionStorageKey(id));
  const expired = { ...sessionCookieOptions(0, true), maxAge: 0 };
  res.clearCookie(BROWSER_SESSION_COOKIE, expired);
  res.clearCookie(CSRF_COOKIE, { ...sessionCookieOptions(0, false), maxAge: 0 });
  res.setHeader("Cache-Control", "no-store");
}

export function isCookieAuthRequest(req: Request) {
  return String(req.get("x-cpu-auth-mode") || "").trim().toLowerCase() === "cookie";
}
