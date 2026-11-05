import crypto from "node:crypto";
import { PathCookieJar as CookieJar, type PathCookieJarJson } from "../njmu/cookies";
import {
  deleteEphemeralValue,
  getEphemeralValue,
  jwxtPendingKey,
  jwxtSessionKey,
  runWithDistributedLock,
  setEphemeralValue,
} from "../../services/cache";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "../../services/jwxtSessionCrypto";
import { Errors, HttpError } from "../../utils/response";

/**
 * 南京中医药大学：统一身份认证（ids.njucm.edu.cn，Apereo CAS）+ 树维教务（jwgl.njucm.edu.cn/student）。
 * 认证平台的密码用页面脚本里写死的 RSA 公钥加密（无填充、低位在前，见 encryptIdsPassword）；
 * 登录拿到 TGC 后打开教务的 /student/sso/login 换票，教务会话过期时用还活着的 TGC 静默再换一次。
 */

export const NJUCM_TOKEN_PREFIX = "njucm_";
const AUTH_HOST = "ids.njucm.edu.cn";
const JW_HOST = "jwgl.njucm.edu.cn";
const AUTH_ORIGIN = `https://${AUTH_HOST}`;
const JW_ORIGIN = `https://${JW_HOST}`;
const SERVICE_URL = `${JW_ORIGIN}/student/sso/login`;
const LOGIN_URL = `${AUTH_ORIGIN}/login?service=${encodeURIComponent(SERVICE_URL)}`;
/** 打开后会 302 到 /student/for-std/course-table/info/{学生内部编号}，顺便拿到这个编号。 */
const JW_COURSE_TABLE = `${JW_ORIGIN}/student/for-std/course-table`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;

const PENDING_TTL_MS = 15 * 60_000;
/** 登录时勾了「5天内自动登录」，TGC 活 5 天；教务会话过期后用它静默换票。 */
const SESSION_TTL_MS = 5 * 24 * 60 * 60_000;

export function isNjucmToken(token: string | null | undefined) {
  return typeof token === "string" && token.startsWith(NJUCM_TOKEN_PREFIX);
}

function newId() {
  return `${NJUCM_TOKEN_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

function isSchoolHost(host: string) {
  return host === AUTH_HOST || host === JW_HOST;
}

// ============ 带 cookie 的请求，重定向手动跟、只跟学校自己的域名 ============

type Hop = { status: number; url: URL; location: string; body: string };

type RequestInit = {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  json?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function request(jar: CookieJar, url: string, init: RequestInit = {}): Promise<Hop> {
  const target = new URL(url);
  if (!isSchoolHost(target.host)) throw Errors.badGateway("南中医统一认证跳到了未知地址");
  if (target.protocol === "http:") target.protocol = "https:";
  const headers = new Headers(init.headers);
  headers.set("User-Agent", UA);
  if (!headers.has("Accept")) headers.set("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
  headers.set("Accept-Language", "zh-CN,zh;q=0.9");
  const cookie = jar.serializeFor(target);
  if (cookie) headers.set("Cookie", cookie);
  let body: string | undefined;
  if (init.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    body = new URLSearchParams(init.form).toString();
  } else if (init.json !== undefined) {
    headers.set("Content-Type", "application/json;charset=UTF-8");
    body = JSON.stringify(init.json);
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      method: init.method ?? (body !== undefined ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw Errors.badGateway("南中医教务暂时连不上，请稍后重试");
  }
  jar.ingest(res.headers.getSetCookie?.() ?? res.headers.get("set-cookie"), target.host, target.pathname);
  const location = res.headers.get("location") || "";
  const text = await res.text();
  if (res.status >= 502) throw Errors.badGateway("南中医教务暂时不可用，请稍后重试");
  return { status: res.status, url: target, location: location ? new URL(location, target).toString() : "", body: text };
}

/** 跟随重定向，直到落在非跳转的页面上。 */
async function follow(jar: CookieJar, first: Hop, signal?: AbortSignal, max = 12): Promise<Hop> {
  let hop = first;
  for (let i = 0; i < max && hop.status >= 300 && hop.status < 400 && hop.location; i++) {
    hop = await request(jar, hop.location, { signal });
  }
  return hop;
}

async function getPage(jar: CookieJar, url: string, signal?: AbortSignal) {
  return follow(jar, await request(jar, url, { signal }), signal);
}

function pick(html: string, pattern: RegExp) {
  return html.match(pattern)?.[1] ?? "";
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/gu, "&").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">");
}

// ============ 认证平台的密码加密 ============

/** 认证平台 login.js 里写死的公钥（RSAUtils.getKeyPair("010001", "", modulus)），登录页取不到时用它。 */
const IDS_RSA_MODULUS = "008aed7e057fe8f14c73550b0e6467b023616ddc8fa91846d2613cdb7f7621e3cada4cd5d812d627af6b87727ade4e26d26208b7326815941492b2204c3167ab2d53df1e3a2c9153bdb7c8c2e968df97a5e7e01cc410f92c4c2c2fba529b3ee988ebc1fca99ff5119e036d732c368acf8beba01aa2fdafa45b21e4de4928d0d403";
const IDS_RSA_EXPONENT = "010001";

function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * 按页面上 RSAUtils.encryptedString 的做法加密：明文每个字符取 charCode（按字节），补零到分块长度
 * （2 × (模数的 16 位数字个数 − 1)），低字节在前拼成大整数，直接做模幂（没有填充），输出十六进制。
 */
export function encryptIdsPassword(password: string, modulusHex = IDS_RSA_MODULUS, exponentHex = IDS_RSA_EXPONENT) {
  const modulus = BigInt(`0x${modulusHex}`);
  const exponent = BigInt(`0x${exponentHex}`);
  const digits = Math.ceil(modulus.toString(16).length / 4);
  const chunkSize = 2 * (digits - 1);
  const bytes = Array.from(password, (char) => char.charCodeAt(0) & 0xffff);
  while (bytes.length % chunkSize !== 0) bytes.push(0);
  const blocks: string[] = [];
  for (let start = 0; start < bytes.length; start += chunkSize) {
    let value = 0n;
    for (let i = start + chunkSize - 1; i >= start; i--) value = (value << 8n) | BigInt(bytes[i] & 0xff);
    // biToHex 按 16 位一组输出，每组补足 4 位。
    const hex = modPow(value, exponent, modulus).toString(16);
    blocks.push(hex.padStart(Math.ceil(hex.length / 4) * 4, "0"));
  }
  return blocks.join(" ");
}

export type IdsLoginForm = { execution: string; captcha: boolean; modulus: string };

/** 登录页上有账号密码（fm1）和短信验证码（fm2）两张表单，取账号密码那张。 */
export function parseIdsLoginForm(html: string): IdsLoginForm | null {
  const start = html.indexOf('id="fm1"');
  const end = start >= 0 ? html.indexOf("</form>", start) : -1;
  const section = start >= 0 ? html.slice(start, end > start ? end : undefined) : html;
  const execution = pick(section, /name="execution"\s+value="([^"]*)"/u) || pick(section, /value="([^"]*)"\s+name="execution"/u);
  if (!execution) return null;
  return {
    execution: decodeHtml(execution),
    captcha: /id="authcode"/u.test(section),
    modulus: pick(html, /getKeyPair\(\s*"010001"\s*,\s*['"]['"]\s*,\s*"([0-9a-f]+)"/iu),
  };
}

/** 登录失败时页面上的提示（span#msg1）。 */
export function parseIdsError(html: string) {
  const raw = pick(html, /id="msg1"[^>]*>([\s\S]*?)<\/span>/u) || pick(html, /id="swiSpan1"[^>]*>([\s\S]*?)<\/span>/u);
  return decodeHtml(raw.replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim();
}

function isIdsLoginPage(hop: Hop) {
  return hop.url.host === AUTH_HOST && /name="execution"/u.test(hop.body);
}

// ============ 待完成的登录、已登录的会话 ============

type PendingLogin = { jar: PathCookieJarJson; form: IdsLoginForm };

type Session = {
  username: string;
  /** 教务里的学生内部编号（课表、成绩、考试接口都按它查），换票后从课表页的跳转地址里取。 */
  studentId: string;
  jar: PathCookieJarJson;
  createdAt: number;
};

async function savePending(id: string, pending: PendingLogin) {
  await setEphemeralValue(jwxtPendingKey(id), encryptJwxtSensitiveJson("njucm-pending", id, pending), PENDING_TTL_MS);
}

async function loadPending(id: string): Promise<PendingLogin | null> {
  if (!isNjucmToken(id)) return null;
  const raw = await getEphemeralValue(jwxtPendingKey(id));
  if (!raw) return null;
  try {
    return decryptJwxtSensitiveJson<PendingLogin>("njucm-pending", id, raw).value;
  } catch {
    return null;
  }
}

async function saveSession(token: string, session: Session) {
  await setEphemeralValue(jwxtSessionKey(token), encryptJwxtSensitiveJson("njucm-session", token, session), SESSION_TTL_MS);
}

export async function loadSession(token: string | null | undefined): Promise<Session | null> {
  if (!token || !isNjucmToken(token)) return null;
  const raw = await getEphemeralValue(jwxtSessionKey(token));
  if (!raw) return null;
  try {
    return decryptJwxtSensitiveJson<Session>("njucm-session", token, raw).value;
  } catch {
    return null;
  }
}

// ============ 登录 ============

export type NjucmLoginAttempt = {
  ok: boolean;
  token?: string;
  authenticatedUsername?: string;
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
};

async function fetchCaptcha(jar: CookieJar, signal?: AbortSignal) {
  const target = new URL(`${AUTH_ORIGIN}/captcha.jpg?tt=${Math.random()}`);
  const res = await fetch(target, {
    headers: { "User-Agent": UA, Cookie: jar.serializeFor(target), Referer: LOGIN_URL },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return "";
  jar.ingest(res.headers.getSetCookie?.() ?? res.headers.get("set-cookie"), AUTH_HOST, target.pathname);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function openLoginPage(jar: CookieJar, signal?: AbortSignal) {
  const page = await getPage(jar, LOGIN_URL, signal);
  const form = parseIdsLoginForm(page.body);
  if (!form) throw Errors.badGateway("南中医统一认证登录页无法识别，请稍后重试");
  return form;
}

export async function beginLogin(signal?: AbortSignal) {
  const jar = new CookieJar();
  const form = await openLoginPage(jar, signal);
  const pendingId = newId();
  await savePending(pendingId, { jar: jar.toJson(), form });
  if (!form.captcha) return { pendingId, needCaptcha: false };
  return { pendingId, needCaptcha: true, captchaImage: await fetchCaptcha(jar, signal) };
}

/** 教务里已登录：课表入口跳到 /info/{学生内部编号}；没登录则被送回 /student/login。 */
async function resolveStudentId(jar: CookieJar, signal?: AbortSignal) {
  const first = await request(jar, JW_COURSE_TABLE, { signal });
  const target = first.status >= 300 && first.status < 400 ? first.location : first.url.toString();
  return target.match(/\/course-table\/info\/(\d+)/u)?.[1] ?? "";
}

/** 统一认证已登录（jar 里有 TGC）之后：换票进教务，确认能拿到学生编号。 */
async function enterJwxt(jar: CookieJar, signal?: AbortSignal): Promise<string> {
  const landed = await getPage(jar, LOGIN_URL, signal);
  if (isIdsLoginPage(landed)) {
    console.warn(`[njucm] 换票被统一认证挡回登录页：${landed.url.pathname}`);
    return "";
  }
  const studentId = await resolveStudentId(jar, signal);
  if (!studentId) console.warn(`[njucm] 换票进教务失败：停在 ${landed.url.host}${landed.url.pathname}（${landed.status}）`);
  return studentId;
}

export async function submitLogin(args: { pendingId: string; username: string; password: string; captcha?: string }, signal?: AbortSignal): Promise<NjucmLoginAttempt> {
  const pending = await loadPending(args.pendingId);
  if (!pending) return { ok: false, error: "登录会话已过期，请刷新页面重试" };
  const username = String(args.username || "").trim();
  const jar = CookieJar.fromJson(pending.jar);
  const captcha = String(args.captcha || "").trim();
  if (pending.form.captcha && !captcha) {
    return { ok: false, needCaptcha: true, error: "请输入验证码", captcha: { image: await fetchCaptcha(jar, signal), pendingId: args.pendingId } };
  }
  const form: Record<string, string> = {
    username,
    password: encryptIdsPassword(args.password, pending.form.modulus || undefined),
    rememberMe: "true",
    execution: pending.form.execution,
    encrypted: "true",
    _eventId: "submit",
    loginType: "1",
    submit: "登 录",
  };
  if (pending.form.captcha) form.authcode = captcha;
  const posted = await request(jar, LOGIN_URL, { form, headers: { Referer: LOGIN_URL, Origin: AUTH_ORIGIN }, signal });
  if (posted.status >= 300 && posted.status < 400 && posted.location) {
    await deleteEphemeralValue(jwxtPendingKey(args.pendingId)).catch(() => undefined);
    await follow(jar, posted, signal);
    const studentId = await resolveStudentId(jar, signal) || await enterJwxt(jar, signal);
    if (!studentId) return { ok: false, error: "已通过统一认证，但进入南中医教务失败，请稍后重试" };
    const token = newId();
    await saveSession(token, { username, studentId, jar: jar.toJson(), createdAt: Date.now() });
    return { ok: true, token, authenticatedUsername: username };
  }
  // 失败时认证平台回到登录页，execution 会换新的；验证码也可能在这时才出现。
  const message = parseIdsError(posted.body) || "学号或密码错误";
  const next = parseIdsLoginForm(posted.body) ?? pending.form;
  await savePending(args.pendingId, { jar: jar.toJson(), form: next });
  if (next.captcha || /验证码/u.test(message)) {
    return { ok: false, needCaptcha: true, error: message, captcha: { image: await fetchCaptcha(jar, signal), pendingId: args.pendingId } };
  }
  return { ok: false, error: message };
}

export async function logout(token: string) {
  if (!isNjucmToken(token)) return false;
  await deleteEphemeralValue(jwxtSessionKey(token));
  return true;
}

// ============ 已登录后访问教务 ============

function expired(): HttpError {
  return Errors.unauthorized("南中医教务登录已过期，请重新登录");
}

/** 教务会话过期（被送回 /student/login）时，用还活着的 TGC 静默换一次票。 */
async function renew(token: string, signal?: AbortSignal) {
  const lockId = crypto.createHash("sha256").update(token).digest("hex");
  const locked = await runWithDistributedLock(`njucm-session:${lockId}`, 30_000, async () => {
    const session = await loadSession(token);
    if (!session) return false;
    const jar = CookieJar.fromJson(session.jar);
    jar.clearHost(JW_HOST);
    const studentId = await enterJwxt(jar, signal);
    if (studentId) await saveSession(token, { ...session, studentId, jar: jar.toJson() });
    return Boolean(studentId);
  });
  return locked.acquired ? Boolean(locked.result) : true;
}

function needsLogin(hop: Hop) {
  return hop.url.host !== JW_HOST
    || (hop.status >= 300 && hop.status < 400 && /\/student\/login|ids\.njucm/u.test(hop.location))
    || hop.status === 401;
}

export type JwSession = { studentId: string; username: string };

/**
 * 以已登录身份请求教务（GET、表单或 JSON POST），返回响应文本和学生编号。
 * path 里的 {studentId} 换成会话里的学生内部编号。
 */
export async function jwRequest(
  token: string,
  path: string,
  init: { form?: Record<string, string>; json?: unknown; ajax?: boolean } = {},
  signal?: AbortSignal,
): Promise<{ body: string; session: JwSession }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await loadSession(token);
    if (!session) throw expired();
    const jar = CookieJar.fromJson(session.jar);
    const resolved = path.replaceAll("{studentId}", encodeURIComponent(session.studentId));
    const hop = await request(jar, `${JW_ORIGIN}${resolved}`, {
      form: init.form,
      json: init.json,
      headers: init.ajax || init.json !== undefined || init.form
        ? { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", Referer: `${JW_ORIGIN}/student/home` }
        : { Referer: `${JW_ORIGIN}/student/home` },
      signal,
    });
    if (!needsLogin(hop) && hop.status === 200) {
      await saveSession(token, { ...session, jar: jar.toJson() });
      return { body: hop.body, session: { studentId: session.studentId, username: session.username } };
    }
    if (hop.status >= 400 && hop.status !== 401) throw Errors.badGateway("南中医教务暂时不可用，请稍后重试");
    if (attempt === 0 && await renew(token, signal)) continue;
    throw expired();
  }
  throw expired();
}

export async function jwJson<T>(token: string, path: string, init: { form?: Record<string, string>; json?: unknown } = {}, signal?: AbortSignal): Promise<T> {
  const { body } = await jwRequest(token, path, { ...init, ajax: true }, signal);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw Errors.badGateway("南中医教务返回了无法识别的数据");
  }
}
