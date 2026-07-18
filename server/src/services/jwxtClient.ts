/**
 * 教务系统（jsxsd）代登录客户端
 *
 * 流程：
 *  1) 用户只登录一次 id.cpu.edu.cn 统一认证，建立旧版 jsxsd 会话
 *  2) 服务端保留统一认证 Cookie；访问新版课表时自动请求 jwxt 的 sso.jsp
 *  3) id.cpu.edu.cn 使用既有统一认证会话向 jwxt 签发一次性 service ticket
 *  4) 同一个 CookieJar 最终持有 id、jsxsd 与 jwxt 三个域的会话
 *  5) 新版提供课表，旧版继续提供成绩、考试、培养方案等能力
 *
 * 安全约定：
 *  - 用户名密码绝不写入磁盘 / 数据库 / 日志
 *  - cookie jar 写入缓存前使用 AES-256-GCM 加密；不写入数据库或日志
 *  - 会话空闲期由 JWXT_SESSION_IDLE_MS 控制（默认 365 天）；未启用 Redis 时进程退出即清空
 */
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  countEphemeralKeys,
  deleteEphemeralValue,
  getEphemeralValue,
  jwxtPendingKey,
  jwxtPendingPrefix,
  jwxtSessionKey,
  jwxtSessionPrefix,
  runWithDistributedLock,
  setEphemeralValue,
} from "./cache";
import { buildRedisKey } from "./redis";
import { config, isDev } from "../config";
import { Errors, HttpError } from "../utils/response";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { extractModernJwxtSsoRedirect, isModernJwxtLoginPage } from "./modernJwxtSso";
import {
  buildCpuSsoSubmitBody,
  buildCpuSsoSubmitHeaders,
  parseCpuSsoPasswordForm,
} from "./cpuSsoForm";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENTRY_URL = "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp";
const JWXT_HOST = "jsxsd.cpu.edu.cn";
const CPU_ID_SSO_HOST = "id.cpu.edu.cn";
const MODERN_JWXT_HOST = "jwxt.cpu.edu.cn";
const MODERN_JWXT_ORIGIN = `https://${MODERN_JWXT_HOST}`;
const MODERN_SSO_ENTRY_URL = `${MODERN_JWXT_ORIGIN}/jsxsd/sso.jsp`;
const MODERN_SCHEDULE_ENTRY_URL = `${MODERN_JWXT_ORIGIN}/jsxsd/xskb/xskb_list.do?viweType=0`;
const JWXT_SESSION_HOSTS = new Set([JWXT_HOST, CPU_ID_SSO_HOST, MODERN_JWXT_HOST]);
const DEBUG_DIR = path.join(process.cwd(), ".debug");

export function isTrustedJwxtSessionCookieHost(host: string) {
  return JWXT_SESSION_HOSTS.has(host.toLowerCase());
}

/** 简易 cookie jar：按 host 分组存 cookie 名值对 */
export class CookieJar {
  private byHost = new Map<string, Map<string, string>>();

  static fromJson(input: Record<string, Record<string, string>> | null | undefined) {
    const jar = new CookieJar();
    for (const [host, cookies] of Object.entries(input ?? {})) {
      const map = new Map<string, string>();
      for (const [name, value] of Object.entries(cookies ?? {})) {
        const cookieName = String(name || "").trim();
        if (!cookieName) continue;
        map.set(cookieName, String(value ?? ""));
      }
      if (map.size) jar.byHost.set(host, map);
    }
    return jar;
  }

  ingest(setCookie: string[] | string | null, host: string) {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of arr) {
      // 一个 Set-Cookie 头可能逗号分隔多个 cookie（虽不规范）
      // Node fetch 的 getSetCookie() 已经分好了，这里防御性再分一次
      for (const piece of splitCookies(c)) {
        const eq = piece.indexOf("=");
        if (eq <= 0) continue;
        const name = piece.slice(0, eq).trim();
        const value = piece.slice(eq + 1).split(";")[0].trim();
        if (!name) continue;
        const map = this.byHost.get(host) ?? new Map();
        if (value === "" || /expires=.*1970/i.test(piece)) map.delete(name);
        else map.set(name, value);
        this.byHost.set(host, map);
      }
    }
  }

  serializeFor(url: URL): string {
    // 简化：同 host 全部带上（不严格按域规则）
    const map = this.byHost.get(url.host);
    if (!map || map.size === 0) return "";
    return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** 获取某个 host 的 cookie 数（调试用） */
  countFor(host: string) {
    return this.byHost.get(host)?.size ?? 0;
  }

  delete(host: string, name: string) {
    const map = this.byHost.get(host);
    if (!map) return;
    map.delete(name);
    if (map.size === 0) this.byHost.delete(host);
  }

  toJson(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [host, m] of this.byHost) out[host] = Object.fromEntries(m);
    return out;
  }
}

function splitCookies(raw: string): string[] {
  // 把多个用 ", " 拼在一起的 cookie 拆开（避免拆到 Expires=Wed, 01 Jan 2026...）
  const out: string[] = [];
  let i = 0, start = 0;
  while (i < raw.length) {
    if (raw[i] === "," ) {
      // 看后面是否跟着一个有效 cookie name（即 `, name=`）
      const after = raw.slice(i + 1).trimStart();
      if (/^[\w!#$%&'*+\-.^`|~]+\s*=/.test(after)) {
        out.push(raw.slice(start, i));
        start = i + 1;
      }
    }
    i++;
  }
  out.push(raw.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 单次带 jar 的请求（手动处理重定向） */
async function fetchWithJar(jar: CookieJar, url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url);
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  if (!headers.has("Accept")) headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  const cookie = jar.serializeFor(u);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  // 提取 Set-Cookie（Node 22+ fetch 支持 getSetCookie）
  const sc = (res.headers as any).getSetCookie?.() ?? res.headers.get("set-cookie");
  jar.ingest(sc, u.host);
  return res;
}

async function followRedirects(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  maxHops = 15,
): Promise<{ res: Response; finalUrl: string; hops: string[] }> {
  let current = url;
  let opts = init;
  const hops: string[] = [];
  for (let i = 0; i < maxHops; i++) {
    hops.push(current);
    const res = await fetchWithJar(jar, current, opts);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current, hops };
      const referer = current;
      current = new URL(loc, current).toString();
      // 重定向后默认走 GET（除非是 307/308 保留方法）
      if (res.status === 307 || res.status === 308) {
        // 保留 method 与 body
      } else {
        opts = { headers: { Referer: referer } };
      }
      continue;
    }
    return { res, finalUrl: current, hops };
  }
  throw new Error("Too many redirects");
}

/**
 * 提交 CAS 凭据后，在携带 service ticket 跳回教务系统之前停下。
 * callbackUrl 中的 ticket 是一次性的，必须由最终承载教务会话的节点消费。
 */
async function followUntilJwxtCallback(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  maxHops = 15,
): Promise<{ res: Response; finalUrl: string; callbackUrl?: string; hops: string[] }> {
  let current = url;
  let opts = init;
  const hops: string[] = [];
  for (let i = 0; i < maxHops; i++) {
    hops.push(current);
    const res = await fetchWithJar(jar, current, opts);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current, hops };
      const next = new URL(loc, current);
      if (next.hostname.toLowerCase() === JWXT_HOST) {
        return { res, finalUrl: current, callbackUrl: next.toString(), hops };
      }
      const referer = current;
      current = next.toString();
      if (res.status !== 307 && res.status !== 308) {
        opts = { headers: { Referer: referer } };
      }
      continue;
    }
    return { res, finalUrl: current, hops };
  }
  throw new Error("Too many redirects");
}

function throwForLoginUpstreamStatus(res: Response) {
  if (res.status === 429) {
    throw new HttpError(429, 5429, "统一认证请求过于频繁，请稍后重试");
  }
  if (res.status >= 400) {
    const message = res.status >= 500
      ? "统一认证暂不可用，请稍后重试"
      : `统一认证请求失败 (${res.status})`;
    throw new HttpError(res.status, 5400 + Math.min(199, res.status - 400), message);
  }
}

// ============ 公开 API ============

export interface LoginAttempt {
  ok: boolean;
  authenticatedUsername?: string;
  /** 登录成功后用于后续请求的服务端 token（前端用 X-Jwxt-Token 头传回） */
  token?: string;
  /** 失败原因 / 错误消息 */
  error?: string;
  /** 当 needCaptcha = true 时，captcha 字段给出验证码图片 base64 + pending 引用 */
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
}

/**
 * 登录节点交给教务查询节点的一次性 CAS 会话材料。
 * 只包含完成 service-ticket 回调所需的数据，绝不包含用户密码。
 */
export interface LoginSessionHandoff {
  id: string;
  callbackUrl: string;
  cookies: Record<string, Record<string, string>>;
  username: string;
  issuedAt: number;
}

export interface LoginHandoffAttempt extends Omit<LoginAttempt, "token"> {
  token?: never;
  handoff?: LoginSessionHandoff;
}

interface PendingLogin {
  jar: CookieJar;
  ssoUrl: string;       // SSO 登录页的最终 URL（Referer）
  submitUrl: string;    // 登录页密码表单的实际 POST 目标
  hidden: Record<string, string>; // lt / execution / service / _eventId 等
  createdAt: number;
}

interface ActiveSession {
  jar: CookieJar;
  username: string;     // 仅用于日志展示（不含密码）
  createdAt: number;
  lastSeenAt: number;
}

export type JwxtSessionSnapshot = {
  version: 1;
  jar: Record<string, Record<string, string>>;
  username: string;
  createdAt: number;
  lastSeenAt: number;
};

// This stores only the pre-login cookie jar and CAS form state, never a password.
// Keep it for a day so ordinary users never hit an arbitrary login
// expiry; it still bounds cleanup of abandoned server-side state.
export const PENDING_LOGIN_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_IDLE_TTL = config.jwxtSessionIdleMs;
const HANDOFF_TTL = 5 * 60 * 1000;
const HANDOFF_FUTURE_SKEW = 30 * 1000;
const HANDOFF_CONSUME_LOCK_TTL = 60 * 1000;
const HANDOFF_RESULT_PREFIX = `${buildRedisKey("jwxt", "login-handoff", "consumed")}:`;

function genId() {
  return crypto.randomBytes(24).toString("hex");
}

async function savePendingLogin(id: string, pending: PendingLogin) {
  const payload = {
    jar: pending.jar.toJson(),
    ssoUrl: pending.ssoUrl,
    submitUrl: pending.submitUrl,
    hidden: pending.hidden,
    createdAt: pending.createdAt,
  };
  await setEphemeralValue(
    jwxtPendingKey(id),
    encryptJwxtSensitiveJson("pending-login", id, payload),
    PENDING_LOGIN_TTL_MS,
  );
}

async function getPendingLogin(id: string): Promise<PendingLogin | null> {
  const raw = await getEphemeralValue(jwxtPendingKey(id));
  if (!raw) return null;
  try {
    const decrypted = decryptJwxtSensitiveJson<{
      jar?: Record<string, Record<string, string>>;
      ssoUrl?: string;
      submitUrl?: string;
      hidden?: Record<string, string>;
      createdAt?: number;
    }>("pending-login", id, raw, { allowLegacyPlaintext: true });
    const parsed = decrypted.value;
    const ssoUrl = String(parsed.ssoUrl || "");
    const hidden = parsed.hidden && typeof parsed.hidden === "object" ? parsed.hidden : {};
    const pending = {
      jar: CookieJar.fromJson(parsed.jar),
      ssoUrl,
      // 兼容升级前已经签发、尚未提交的 pending；旧结构中 ssoUrl 同时是 POST 目标。
      submitUrl: String(parsed.submitUrl || ssoUrl),
      hidden,
      createdAt: Number(parsed.createdAt || Date.now()),
    };
    if (decrypted.legacyPlaintext) await savePendingLogin(id, pending);
    return pending;
  } catch {
    await deletePendingLogin(id);
    return null;
  }
}

async function deletePendingLogin(id: string) {
  await deleteEphemeralValue(jwxtPendingKey(id));
}

async function saveActiveSession(token: string, session: ActiveSession) {
  await setEphemeralValue(jwxtSessionKey(token), encryptJwxtSensitiveJson("active-session", token, activeSessionSnapshot(session)), SESSION_IDLE_TTL);
}

function activeSessionSnapshot(session: ActiveSession): JwxtSessionSnapshot {
  return {
    version: 1,
    jar: session.jar.toJson(),
    username: session.username,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
  };
}

function activeSessionFromSnapshot(snapshot: JwxtSessionSnapshot): ActiveSession {
  if (
    snapshot?.version !== 1
    || !snapshot.jar
    || typeof snapshot.jar !== "object"
    || Array.isArray(snapshot.jar)
    || Object.keys(snapshot.jar).length > 32
    || typeof snapshot.username !== "string"
    || snapshot.username.length > 128
    || !Number.isFinite(snapshot.createdAt)
    || !Number.isFinite(snapshot.lastSeenAt)
    || snapshot.createdAt <= 0
    || snapshot.lastSeenAt < snapshot.createdAt
    || snapshot.createdAt > Date.now() + 30_000
    || snapshot.lastSeenAt > Date.now() + 30_000
  ) {
    throw new Error("JWXT session snapshot is invalid");
  }
  for (const [host, cookies] of Object.entries(snapshot.jar)) {
    if (!host || host.length > 255 || !cookies || typeof cookies !== "object" || Array.isArray(cookies) || Object.keys(cookies).length > 128) {
      throw new Error("JWXT session snapshot cookies are invalid");
    }
    for (const [name, value] of Object.entries(cookies)) {
      if (!name || name.length > 256 || typeof value !== "string" || value.length > 8192) {
        throw new Error("JWXT session snapshot cookie is invalid");
      }
    }
  }
  return {
    jar: CookieJar.fromJson(snapshot.jar),
    username: snapshot.username,
    createdAt: snapshot.createdAt,
    lastSeenAt: snapshot.lastSeenAt,
  };
}

async function deleteActiveSession(token: string) {
  await deleteEphemeralValue(jwxtSessionKey(token));
}

async function persistActiveSession(token: string, session: ActiveSession) {
  session.lastSeenAt = Date.now();
  await saveActiveSession(token, session);
}

async function getActiveSession(token: string | undefined | null): Promise<ActiveSession | null> {
  if (!token) return null;
  const raw = await getEphemeralValue(jwxtSessionKey(token));
  if (!raw) return null;
  try {
    const decrypted = decryptJwxtSensitiveJson<JwxtSessionSnapshot>("active-session", token, raw, { allowLegacyPlaintext: true });
    const legacy = decrypted.value as JwxtSessionSnapshot & { version?: number };
    if (legacy.version === undefined) legacy.version = 1;
    const session = activeSessionFromSnapshot(legacy as JwxtSessionSnapshot);
    session.lastSeenAt = Date.now();
    await saveActiveSession(token, session);
    return session;
  } catch {
    await deleteActiveSession(String(token));
    return null;
  }
}

/** 第一步：只准备学校统一认证表单。新版 jwxt 会在登录后自动继承该会话。 */
export async function beginLogin(): Promise<{
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
}> {
  const jar = new CookieJar();
  // GET 入口 → 302 链到 SSO 登录页
  const { res, finalUrl } = await followRedirects(jar, ENTRY_URL);
  throwForLoginUpstreamStatus(res);
  const html = await res.text();
  if (isDev) await saveDebug("login-page.html", html);
  const form = parseCpuSsoPasswordForm(html, finalUrl);

  const id = genId();
  await savePendingLogin(id, {
    jar,
    ssoUrl: finalUrl,
    submitUrl: form.submitUrl,
    hidden: form.hidden,
    createdAt: Date.now(),
  });

  if (form.needCaptcha) {
    return { pendingId: id, needCaptcha: true, captchaImage: await fetchCaptchaOrEmpty(jar, finalUrl) };
  }
  return { pendingId: id, needCaptcha: false };
}

/** 拉取验证码图片（用同一个 jar 保持 session） */
async function fetchCaptcha(jar: CookieJar, refer: string): Promise<string> {
  const url = `https://id.cpu.edu.cn/sso/authImg?now=${Date.now()}&refresh=1&authCodeKey=authCodeKeySSO`;
  const res = await fetchWithJar(jar, url, { headers: { Referer: refer } });
  throwForLoginUpstreamStatus(res);
  const ct = res.headers.get("content-type") || "";
  if (res.ok && ct.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  }
  throw new Error("authImg 返回非图片");
}

async function fetchCaptchaOrEmpty(jar: CookieJar, refer: string) {
  try {
    return await fetchCaptcha(jar, refer);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return "";
  }
}

export async function exportSessionSnapshot(token: string): Promise<JwxtSessionSnapshot | null> {
  if (!token) return null;
  const raw = await getEphemeralValue(jwxtSessionKey(token));
  if (!raw) return null;
  try {
    const decrypted = decryptJwxtSensitiveJson<JwxtSessionSnapshot>("active-session", token, raw, { allowLegacyPlaintext: true });
    const legacy = decrypted.value as JwxtSessionSnapshot & { version?: number };
    if (legacy.version === undefined) legacy.version = 1;
    const session = activeSessionFromSnapshot(legacy as JwxtSessionSnapshot);
    if (decrypted.legacyPlaintext) await saveActiveSession(token, session);
    return activeSessionSnapshot(session);
  } catch {
    return null;
  }
}

export async function importSessionSnapshot(token: string, snapshot: JwxtSessionSnapshot): Promise<boolean> {
  if (!token || token.length > 512) throw Errors.badRequest("教务会话令牌无效");
  const session = activeSessionFromSnapshot(snapshot);
  await saveActiveSession(token, session);
  return true;
}

interface LoginSubmitArgs {
  pendingId: string;
  username: string;
  password: string;
  captcha?: string;
}

type LoginCredentialExchange =
  | { ok: true; jar: CookieJar; username: string; callbackUrl?: string }
  | { ok: false; attempt: LoginHandoffAttempt };

const CPU_SSO_REJECTED_MESSAGE = "统一认证未接受本次登录。请重新输入账号密码；若官网可登录，请刷新后重试。";

function scrubCpuSsoCredentialCookies(jar: CookieJar) {
  // 官方页用 JavaScript 保存的“记住账号/密码”Cookie 不属于服务端会话材料。
  jar.delete(CPU_ID_SSO_HOST, "bms_sso_username");
  jar.delete(CPU_ID_SSO_HOST, "bms_sso_password");
}

async function exchangeLoginCredentials(
  args: LoginSubmitArgs,
  stopBeforeCallback: boolean,
): Promise<LoginCredentialExchange> {
  const pending = await getPendingLogin(args.pendingId);
  if (!pending) return { ok: false, attempt: { ok: false, error: "登录会话已过期，请刷新页面重试" } };
  const { jar, ssoUrl, submitUrl, hidden } = pending;

  const body = buildCpuSsoSubmitBody(hidden, args);

  const requestInit: RequestInit = {
    method: "POST",
    body,
    headers: buildCpuSsoSubmitHeaders(ssoUrl, submitUrl),
  };
  const r: { res: Response; finalUrl: string; callbackUrl?: string; hops: string[] } = stopBeforeCallback
    ? await followUntilJwxtCallback(jar, submitUrl, requestInit)
    : await followRedirects(jar, submitUrl, requestInit);
  throwForLoginUpstreamStatus(r.res);
  scrubCpuSsoCredentialCookies(jar);

  // 用完即弃
  await deletePendingLogin(args.pendingId);

  if (stopBeforeCallback && r.callbackUrl) {
    return { ok: true, jar, username: args.username, callbackUrl: r.callbackUrl };
  }

  // 旧流程期望最终 URL 落到 jsxsd 域名，说明 ticket 已交换成 JSESSIONID。
  const finalHost = new URL(r.finalUrl).hostname.toLowerCase();
  if (!stopBeforeCallback && finalHost === JWXT_HOST) {
    return { ok: true, jar, username: args.username };
  }
  if (stopBeforeCallback && finalHost === JWXT_HOST) {
    throw Errors.server("统一认证未返回可交接的 service ticket");
  }

  // 否则：仍在 SSO 域，解析错误信息
  const html = await r.res.text();
  if (isDev) await saveDebug("login-error.html", html);
  const $ = cheerio.load(html);
  const explicitError = $(".alert-danger, .errors, #msg, .login-error, .errorTip").first().text().trim();
  const pageTitle = $("title").text().trim();
  const errText = explicitError
    || (pageTitle && !/^统一身份认证平台$/u.test(pageTitle) ? pageTitle : "")
    || CPU_SSO_REJECTED_MESSAGE;

  // 若密码登录表单仍要求验证码，使用它的新 execution 重启 pending。
  let refreshedForm: ReturnType<typeof parseCpuSsoPasswordForm> | null = null;
  try {
    refreshedForm = parseCpuSsoPasswordForm(html, r.finalUrl);
  } catch {
    // 非统一认证登录页会在下方按普通登录失败返回，不保留无效表单状态。
  }
  if (refreshedForm?.needCaptcha) {
    const newPendingId = genId();
    await savePendingLogin(newPendingId, {
      jar,
      ssoUrl: r.finalUrl,
      submitUrl: refreshedForm.submitUrl,
      hidden: refreshedForm.hidden,
      createdAt: Date.now(),
    });
    const img = await fetchCaptchaOrEmpty(jar, r.finalUrl);
    return {
      ok: false,
      attempt: {
        ok: false,
        error: errText,
        needCaptcha: true,
        captcha: { image: img, pendingId: newPendingId },
      },
    };
  }

  return { ok: false, attempt: { ok: false, error: errText } };
}

function isCpuSsoUnauthorized(error: unknown) {
  return error instanceof HttpError && error.status === 401;
}

async function submitWithFreshPendingRetry<T extends LoginAttempt | LoginHandoffAttempt>(
  args: LoginSubmitArgs,
  submit: (nextArgs: LoginSubmitArgs) => Promise<T>,
): Promise<T> {
  try {
    return await submit(args);
  } catch (error) {
    if (!isCpuSsoUnauthorized(error)) throw error;
  }

  // 学校 SSO 偶尔会拒绝一个已经准备好的 execution。凭据保持原样，只重新拿表单重试一次。
  await deletePendingLogin(args.pendingId);
  const fresh = await beginLogin();
  if (fresh.needCaptcha) {
    return {
      ok: false,
      error: "统一认证要求补充验证码",
      needCaptcha: true,
      captcha: { image: fresh.captchaImage || "", pendingId: fresh.pendingId },
    } as T;
  }

  try {
    return await submit({ ...args, pendingId: fresh.pendingId });
  } catch (error) {
    if (isCpuSsoUnauthorized(error)) {
      return { ok: false, error: CPU_SSO_REJECTED_MESSAGE } as T;
    }
    throw error;
  }
}

/** 第二步：用 pendingId + 凭据完成登录（兼容旧的节点内建会话流程）。 */
async function submitLoginOnThisNode(args: LoginSubmitArgs): Promise<LoginAttempt> {
  const exchanged = await exchangeLoginCredentials(args, false);
  if (!exchanged.ok) return exchanged.attempt;

  // 注意：不保存 post-login.html —— 它含学生姓名/学号等个人信息。
  const token = genId();
  const now = Date.now();
  await saveActiveSession(token, {
    jar: exchanged.jar,
    username: exchanged.username,
    createdAt: now,
    lastSeenAt: now,
  });
  return { ok: true, token };
}

export async function submitLogin(args: LoginSubmitArgs): Promise<LoginAttempt> {
  return submitWithFreshPendingRetry(args, submitLoginOnThisNode);
}

/**
 * 登录池专用提交：只完成 CAS 凭据校验，不在登录节点建立最终教务 token。
 */
async function submitLoginForHandoffOnThisNode(args: LoginSubmitArgs): Promise<LoginHandoffAttempt> {
  const exchanged = await exchangeLoginCredentials(args, true);
  if (!exchanged.ok) return exchanged.attempt;
  if (!exchanged.callbackUrl) throw Errors.server("统一认证未返回可交接的 service ticket");

  return {
    ok: true,
    handoff: {
      id: genId(),
      callbackUrl: exchanged.callbackUrl,
      cookies: getJwxtCookies(exchanged.jar),
      username: exchanged.username,
      issuedAt: Date.now(),
    },
  };
}

export async function submitLoginForHandoff(args: LoginSubmitArgs): Promise<LoginHandoffAttempt> {
  return submitWithFreshPendingRetry(args, submitLoginForHandoffOnThisNode);
}

function getJwxtCookies(jar: CookieJar): Record<string, Record<string, string>> {
  const all = jar.toJson();
  const cookies: Record<string, Record<string, string>> = {};
  for (const host of JWXT_SESSION_HOSTS) {
    if (all[host]) cookies[host] = all[host];
  }
  return cookies;
}

function validateLoginHandoff(handoff: LoginSessionHandoff) {
  if (!handoff || typeof handoff !== "object") throw Errors.badRequest("登录交接数据无效");
  if (!/^[a-f0-9]{32,128}$/i.test(String(handoff.id || ""))) {
    throw Errors.badRequest("登录交接 ID 无效");
  }
  if (!handoff.username || handoff.username.length > 128) {
    throw Errors.badRequest("登录交接用户名无效");
  }

  const issuedAt = Number(handoff.issuedAt);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || age > HANDOFF_TTL || age < -HANDOFF_FUTURE_SKEW) {
    throw Errors.unauthorized("登录交接凭据已过期");
  }

  let callback: URL;
  try {
    callback = new URL(handoff.callbackUrl);
  } catch {
    throw Errors.badRequest("登录交接回调地址无效");
  }
  if (
    !["http:", "https:"].includes(callback.protocol)
    || callback.host.toLowerCase() !== JWXT_HOST
    || callback.username
    || callback.password
    || callback.hash
    || !callback.pathname.startsWith("/zgykdx/")
    || !callback.searchParams.get("ticket")
  ) {
    throw Errors.badRequest("登录交接回调地址不受信任");
  }

  const cookies = handoff.cookies;
  if (!cookies || typeof cookies !== "object" || Array.isArray(cookies) || Object.keys(cookies).length > 16) {
    throw Errors.badRequest("登录交接 Cookie 无效");
  }
  for (const [host, values] of Object.entries(cookies)) {
    if (!JWXT_SESSION_HOSTS.has(host.toLowerCase())) {
      throw Errors.badRequest("登录交接 Cookie 域名不受信任");
    }
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 64) {
      throw Errors.badRequest("登录交接 Cookie 无效");
    }
    for (const [name, value] of Object.entries(values)) {
      if (!name || name.length > 256 || typeof value !== "string" || value.length > 8192) {
        throw Errors.badRequest("登录交接 Cookie 无效");
      }
    }
  }

  return { callbackUrl: callback.toString(), jar: CookieJar.fromJson(cookies) };
}

async function consumeValidatedLoginHandoff(
  handoff: LoginSessionHandoff,
  validated: ReturnType<typeof validateLoginHandoff>,
): Promise<string> {
  const cachedTokenRaw = await getEphemeralValue(`${HANDOFF_RESULT_PREFIX}${handoff.id}`);
  if (cachedTokenRaw) {
    const cachedToken = decryptJwxtSensitiveJson<string>(
      "handoff-result",
      handoff.id,
      cachedTokenRaw,
      { allowLegacyPlaintext: true },
    ).value;
    if (cachedToken && await getActiveSession(cachedToken)) return cachedToken;
  }

  const r = await followRedirects(validated.jar, validated.callbackUrl);
  throwForLoginUpstreamStatus(r.res);
  const finalUrl = new URL(r.finalUrl);
  if (finalUrl.hostname.toLowerCase() !== JWXT_HOST || !r.res.ok) {
    throw Errors.unauthorized("登录交接凭据已失效，请重新登录");
  }

  const token = genId();
  const now = Date.now();
  await saveActiveSession(token, {
    jar: validated.jar,
    username: handoff.username,
    createdAt: now,
    lastSeenAt: now,
  });
  await setEphemeralValue(
    `${HANDOFF_RESULT_PREFIX}${handoff.id}`,
    encryptJwxtSensitiveJson("handoff-result", handoff.id, token),
    HANDOFF_TTL,
  );
  return token;
}

/** 在最终执行教务查询的节点消费一次性 callback，并建立本节点 ActiveSession。 */
export async function consumeLoginHandoff(handoff: LoginSessionHandoff): Promise<string> {
  const validated = validateLoginHandoff(handoff);
  const lockId = crypto.createHash("sha256").update(handoff.id).digest("hex");
  const locked = await runWithDistributedLock(
    `jwxt-login-handoff:${lockId}`,
    HANDOFF_CONSUME_LOCK_TTL,
    () => consumeValidatedLoginHandoff(handoff, validated),
  );
  if (locked.acquired) return locked.result as string;

  // 另一个查询实例正在消费同一张一次性 ticket；等待它写入幂等结果，
  // 避免第二个实例再次请求学校并把已消费 ticket 误报为失效。
  for (let attempt = 0; attempt < 100; attempt++) {
    const tokenRaw = await getEphemeralValue(`${HANDOFF_RESULT_PREFIX}${handoff.id}`);
    const token = tokenRaw
      ? decryptJwxtSensitiveJson<string>("handoff-result", handoff.id, tokenRaw, { allowLegacyPlaintext: true }).value
      : "";
    if (token && await getActiveSession(token)) return token;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw Errors.conflict("登录会话正在交接，请稍后重试");
}

/** 注销：删除服务端持有的教务 cookie jar */
export async function logout(token: string): Promise<boolean> {
  const existed = Boolean(await getEphemeralValue(jwxtSessionKey(token)));
  await deleteActiveSession(token);
  return existed;
}

/** 获取 session（供 API 路由用）；同时刷新 lastSeenAt */
export async function getSession(token: string | undefined | null): Promise<ActiveSession | null> {
  return getActiveSession(token);
}

/** 用一个 session 访问任意 jsxsd 路径，返回 HTML 文本 */
export async function jwxtFetchHtml(token: string, path: string): Promise<string> {
  const sess = await getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");
  const url = new URL(path, "http://jsxsd.cpu.edu.cn").toString();
  const { res, finalUrl } = await followRedirects(sess.jar, url);
  if (new URL(finalUrl).host !== "jsxsd.cpu.edu.cn") {
    await deleteActiveSession(token);
    throw Errors.unauthorized("教务会话已失效（被学校 SSO 踢出），请重新登录");
  }
  await persistActiveSession(token, sess);
  return res.text();
}

function assertTrustedModernSsoHop(rawUrl: string) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const trustedPath = host === CPU_ID_SSO_HOST
    ? url.pathname.startsWith("/sso/")
    : host === MODERN_JWXT_HOST && url.pathname.startsWith("/jsxsd/");
  if (
    !["http:", "https:"].includes(url.protocol)
    || !trustedPath
    || url.username
    || url.password
    || url.hash
  ) throw Errors.badRequest("新版教务统一认证跳转地址不受信任");
  return url;
}

async function followModernSsoRedirects(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  maxHops = 15,
) {
  let current = assertTrustedModernSsoHop(url).toString();
  let opts = init;
  const hops: string[] = [];
  for (let index = 0; index < maxHops; index++) {
    hops.push(current);
    const res = await fetchWithJar(jar, current, opts);
    if (res.status < 300 || res.status >= 400) return { res, finalUrl: current, hops };
    const location = res.headers.get("location");
    if (!location) return { res, finalUrl: current, hops };
    current = assertTrustedModernSsoHop(new URL(location, current).toString()).toString();
    if (res.status !== 307 && res.status !== 308) opts = { headers: init.headers };
  }
  throw new Error("Too many modern JWXT SSO redirects");
}

/**
 * 复现旧教务“进入选课系统”的真实流程：jwxt/sso.jsp 通过脚本跳到
 * id.cpu.edu.cn，后者复用已登录的统一认证会话并向 jwxt 回传一次性 ticket。
 */
async function establishModernJwxtSession(jar: CookieJar) {
  const entry = await followModernSsoRedirects(jar, MODERN_SSO_ENTRY_URL);
  throwForLoginUpstreamStatus(entry.res);
  let finalUrl = new URL(entry.finalUrl);
  const html = await entry.res.text();

  if (finalUrl.hostname.toLowerCase() === MODERN_JWXT_HOST && finalUrl.pathname === "/jsxsd/sso.jsp") {
    const ssoUrl = extractModernJwxtSsoRedirect(html, entry.finalUrl);
    const handoff = await followModernSsoRedirects(jar, ssoUrl);
    throwForLoginUpstreamStatus(handoff.res);
    finalUrl = new URL(handoff.finalUrl);
    await handoff.res.arrayBuffer();
  }

  // 停在 id 登录页说明统一认证自身已过期；不能退回新版独立账号密码登录。
  if (finalUrl.hostname.toLowerCase() === CPU_ID_SSO_HOST) return false;

  // ticket 回调通常返回脚本页面；直接请求真实课表来确认 jwxt 会话是否建立。
  const probe = await followModernSsoRedirects(jar, MODERN_SCHEDULE_ENTRY_URL);
  throwForLoginUpstreamStatus(probe.res);
  const probeHtml = await probe.res.text();
  return probe.res.ok
    && new URL(probe.finalUrl).hostname.toLowerCase() === MODERN_JWXT_HOST
    && !isModernJwxtLoginPage(probeHtml);
}

/** 使用同一个统一认证会话自动换票后访问新版 /jsxsd/ 教务页面。 */
export async function jwxtFetchModernHtml(token: string, path: string): Promise<string> {
  const sess = await getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");
  const target = new URL(path, MODERN_JWXT_ORIGIN);
  if (
    target.protocol !== "https:"
    || target.hostname.toLowerCase() !== MODERN_JWXT_HOST
    || target.username
    || target.password
    || target.hash
    || !target.pathname.startsWith("/jsxsd/")
  ) throw Errors.badRequest("新版教务请求地址不受信任");
  let result = await followRedirects(sess.jar, target.toString());
  let finalHost = new URL(result.finalUrl).hostname.toLowerCase();
  let html = await result.res.text();
  if (finalHost !== MODERN_JWXT_HOST || isModernJwxtLoginPage(html)) {
    const established = await establishModernJwxtSession(sess.jar);
    if (established) {
      result = await followRedirects(sess.jar, target.toString());
      finalHost = new URL(result.finalUrl).hostname.toLowerCase();
      html = await result.res.text();
    }
  }
  if (finalHost !== MODERN_JWXT_HOST || isModernJwxtLoginPage(html)) {
    await deleteActiveSession(token);
    throw Errors.unauthorized("统一认证会话已失效，请重新登录");
  }
  if (!result.res.ok) {
    throw new HttpError(result.res.status, 5400 + Math.min(199, Math.max(0, result.res.status - 400)), `新版教务请求失败 (${result.res.status})`);
  }
  await persistActiveSession(token, sess);
  return html;
}

export interface CpuFetchTextResult {
  text: string;
  finalUrl: string;
  status: number;
  contentType: string;
}

export async function fetchAnyCpuText(
  token: string,
  url: string,
  opts: (RequestInit & { allowSso?: boolean; expectedHost?: string }) = {},
): Promise<CpuFetchTextResult> {
  const sess = await getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");

  const { allowSso, expectedHost, ...requestInit } = opts;
  const { res, finalUrl } = await followRedirects(sess.jar, url, requestInit);
  const finalHost = new URL(finalUrl).host;
  if (finalHost === "id.cpu.edu.cn" && !allowSso) {
    // 这里只能说明当前可选子系统（例如研究生入口）未完成 SSO，不能据此
    // 删除仍然有效的本科教务会话。基础教务会话是否失效由 jwxtFetchHtml 判定。
    throw Errors.unauthorized("目标校园服务尚未完成统一认证");
  }
  if (!finalHost.endsWith("cpu.edu.cn")) {
    throw Errors.badRequest(`意外的最终域名: ${finalHost}`);
  }
  if (expectedHost && finalHost !== expectedHost) {
    throw Errors.badRequest(`意外的最终域名: ${finalHost}`);
  }
  await persistActiveSession(token, sess);

  return {
    text: await res.text(),
    finalUrl,
    status: res.status,
    contentType: res.headers.get("content-type") || "",
  };
}

/**
 * 通用：访问任意 cpu.edu.cn 子域。
 * 因为 SSO session 已建立，CAS 会自动透传 ticket 到目标 service。
 */
export async function fetchAnyCpu(
  token: string,
  url: string,
  opts?: (RequestInit & { allowSso?: boolean; expectedHost?: string }),
): Promise<string> {
  const result = await fetchAnyCpuText(token, url, opts);
  return result.text;
}

// ============ i.cpu.edu.cn 融合门户（sudy/sopplus 平台）============

export interface IServiceApp {
  id: number;
  name: string;
  url: string;
  icon: string;
  types: string[];
  clickNum: number;
  favorite: boolean;
  favCount: number;
  dept: string;
  scope: string[];
  detail: string;
}

/** 拉取融合门户的所有应用列表 */
export async function fetchIServiceApps(token: string): Promise<IServiceApp[]> {
  // _p 参数是 base64(as=2&t=5&d=133&p=1&f=44&m=N&) —— 来自首页布局 ID，固定即可
  const url =
    "https://i.cpu.edu.cn/sopplus/mobile/getPortalIndexAppList.rst" +
    "?_p=YXM9MiZ0PTUmZD0xMzMmcD0xJmY9NDQmbT1OJg__&pageSize=200";
  const result = await fetchAnyCpuText(token, url, {
    allowSso: true,
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const finalHost = new URL(result.finalUrl).hostname.toLowerCase();
  if (finalHost !== "i.cpu.edu.cn") {
    throw Errors.badRequest("i 服务暂时需要单独认证");
  }
  if (result.status < 200 || result.status >= 300) {
    throw Errors.badRequest(`i 服务暂时不可用（HTTP ${result.status}）`);
  }
  const text = result.text.replace(/^\uFEFF/, "").trim();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // 学校端偶尔返回统一认证/维护 HTML；这是可选上游异常，不代表教务会话失效。
    throw Errors.badRequest("i 服务暂时未返回应用数据");
  }
  if (json.result !== "1") {
    throw Errors.badRequest("i 服务暂时不可用: " + (json.reason || "未返回成功状态"));
  }
  const raw = (json.data || []) as any[];
  return raw
    .filter((a) => a.isOpen !== false && a.isAllow !== false)
    .map((a): IServiceApp => ({
      id: a.id ?? a.appId ?? 0,
      name: a.name ?? "",
      detail: a.appDetail ?? "",
      url: a.entranceUrl || a.appUrl || "",
      icon: a.iconUrl
        ? (a.iconUrl.startsWith("http") ? a.iconUrl : `https://i.cpu.edu.cn${a.iconUrl}`)
        : "",
      types: String(a.appType || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      clickNum: a.clickNum ?? 0,
      favorite: !!a.isfavorite,
      favCount: a.favoritesCount ?? 0,
      dept: a.responsibleDept ?? "",
      scope: String(a.applyUserScope || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    }));
}

/** POST form 到 jsxsd 路径，返回 HTML */
export async function jwxtPostForm(token: string, path: string, fields: Record<string, string>): Promise<string> {
  const sess = await getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");
  const url = new URL(path, "http://jsxsd.cpu.edu.cn").toString();
  const body = new URLSearchParams(fields);
  const { res, finalUrl } = await followRedirects(sess.jar, url, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: url,
    },
  });
  if (new URL(finalUrl).host !== "jsxsd.cpu.edu.cn") {
    await deleteActiveSession(token);
    throw Errors.unauthorized("教务会话已失效，请重新登录");
  }
  await persistActiveSession(token, sess);
  return res.text();
}

/** 调试：把响应 HTML 落盘 */
async function saveDebug(name: string, content: string) {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `${Date.now()}-${name}`);
    await fs.writeFile(file, content, "utf8");
  } catch { /* ignore */ }
}

/** 调试模式：登录后批量抓取若干预设页面用于解析器开发 */
export async function jwxtDebugSnapshot(token: string): Promise<{ saved: string[]; errors: string[] }> {
  const sess = await getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效");
  const base = "http://jsxsd.cpu.edu.cn";
  // GET 类型的探针
  const getProbes = [
    { name: "main-frame", url: `${base}/zgykdx/framework/xsMain.jsp` },
    { name: "schedule", url: `${base}/zgykdx/xskb/xskb_list.do` },
    { name: "grades-query", url: `${base}/zgykdx/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_CJGL` },
    { name: "midterm-grades-query", url: `${base}/zgykdx/kscj/qzcjcx_query?Ves632DSdyV=NEW_XSD_CJGL` },
    { name: "exam-query", url: `${base}/zgykdx/xsks/xsksap_query?Ves632DSdyV=NEW_XSD_KSBM` },
    { name: "pyfa", url: `${base}/zgykdx/pyfa/pyfa_query?Ves632DSdyV=NEW_XSD_PYGL` },
    { name: "xywcqk", url: `${base}/zgykdx/xywcqk/cxxywcqk?Ves632DSdyV=NEW-XSD-XYWCQK` },
    // i.cpu.edu.cn —— 实测的真实 API（sudy/sopplus）
    { name: "i-apps", url: "http://i.cpu.edu.cn/sopplus/mobile/getPortalIndexAppList.rst?_p=YXM9MiZ0PTUmZD0xMzMmcD0xJmY9NDQmbT1OJg__&pageSize=50" },
    { name: "i-userinfo", url: "http://i.cpu.edu.cn/ywtbapi/public/v1/getHumPhoto" },
    { name: "i-calendar-cats", url: "http://i.cpu.edu.cn/calendar/mgr/api/category/list.rst?queryType=2" },
  ];
  // POST 类型的探针（成绩/考试需要提交查询表单才有列表）
  const postProbes = [
    { name: "grades-list", url: `${base}/zgykdx/kscj/cjcx_list`, body: { kksj: "", kcxz: "", kcmc: "" } },
    { name: "midterm-grades-list", url: `${base}/zgykdx/kscj/qzcjcx_list`, body: { kksj: "", kcxz: "", kcmc: "", xsfs: "all" } },
    { name: "exam-list", url: `${base}/zgykdx/xsks/xsksap_list`, body: { xnxqid: "", xqlb: "" } },
  ];
  const saved: string[] = []; const errors: string[] = [];
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const stamp = Date.now();
  for (const p of getProbes) {
    try {
      const { res, finalUrl } = await followRedirects(sess.jar, p.url);
      let html = await res.text();
      html = sanitizeDebugHtml(html);
      const file = path.join(DEBUG_DIR, `${stamp}-${p.name}.html`);
      await fs.writeFile(file, `<!-- finalUrl=${finalUrl} status=${res.status} -->\n${html}`, "utf8");
      saved.push(file);
    } catch (e: any) { errors.push(`${p.name}: ${e.message ?? e}`); }
  }
  for (const p of postProbes) {
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(p.body)) {
        if (v !== undefined) body.set(k, String(v));
      }
      const { res, finalUrl } = await followRedirects(sess.jar, p.url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: p.url },
      });
      let html = await res.text();
      html = sanitizeDebugHtml(html);
      const file = path.join(DEBUG_DIR, `${stamp}-${p.name}.html`);
      await fs.writeFile(file, `<!-- finalUrl=${finalUrl} status=${res.status} method=POST -->\n${html}`, "utf8");
      saved.push(file);
    } catch (e: any) { errors.push(`${p.name}: ${e.message ?? e}`); }
  }
  await persistActiveSession(token, sess);
  return { saved, errors };
}

/** 简易脱敏：把 DEBUG 文件里可能的个人信息抹掉 */
function sanitizeDebugHtml(html: string): string {
  return html
    // 身份证 18 位
    .replace(/[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, "[REDACTED-ID]")
    // 邮箱
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED-EMAIL]")
    // 11 位手机号（连续 11 个数字且 1 开头）
    .replace(/\b1[3-9]\d{9}\b/g, "[REDACTED-PHONE]");
}

/** 暴露给路由层用的"当前活跃会话数"，仅调试 */
export function sessionStats() {
  return Promise.all([
    countEphemeralKeys(jwxtSessionPrefix()),
    countEphemeralKeys(jwxtPendingPrefix()),
  ]).then(([sessions, pendings]) => ({ sessions, pendings }));
}
