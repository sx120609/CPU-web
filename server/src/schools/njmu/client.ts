import crypto from "node:crypto";
import { PathCookieJar as CookieJar, type PathCookieJarJson } from "./cookies";
import {
  deleteEphemeralValue,
  getEphemeralValue,
  jwxtPendingKey,
  jwxtSessionKey,
  runWithDistributedLock,
  setEphemeralValue,
} from "../../services/cache";
import { buildRedisKey } from "../../services/redis";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "../../services/jwxtSessionCrypto";
import { Errors, HttpError } from "../../utils/response";

/**
 * 南京医科大学：金智统一身份认证（authserver.njmu.edu.cn）+ 正方教务（jwpt.njmu.edu.cn/jwglxt）。
 * 教务登录页已强制跳统一认证，只能先在认证平台登录拿 CASTGC，再换票进教务。
 * 新设备首次登录会要求短信二次验证，验证后认证平台下发设备指纹，按账号保存下来，之后登录和续期都带上。
 */

export const NJMU_TOKEN_PREFIX = "njmu_";
const AUTH_HOST = "authserver.njmu.edu.cn";
const JW_HOST = "jwpt.njmu.edu.cn";
const AUTH_ORIGIN = `https://${AUTH_HOST}`;
const JW_ORIGIN = `https://${JW_HOST}`;
const SERVICE_URL = `${JW_ORIGIN}/sso/jzlogin`;
const LOGIN_URL = `${AUTH_ORIGIN}/authserver/login?service=${encodeURIComponent(SERVICE_URL)}`;
const JW_HOME_URL = `${JW_ORIGIN}/jwglxt/xtgl/index_initMenu.html`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;

const PENDING_TTL_MS = 15 * 60_000;
/** 登录时勾了「7天免登录」，CASTGC 活 7 天；教务会话过期后用它静默换票。 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const DEVICE_TTL_MS = 300 * 24 * 60 * 60_000;

export function isNjmuToken(token: string | null | undefined) {
  return typeof token === "string" && token.startsWith(NJMU_TOKEN_PREFIX);
}

function newId() {
  return `${NJMU_TOKEN_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

function isSchoolHost(host: string) {
  return host === AUTH_HOST || host === JW_HOST;
}

// ============ 带 cookie 的请求，重定向手动跟、只跟学校自己的域名 ============

type Hop = { status: number; url: URL; location: string; body: string };

async function request(jar: CookieJar, url: string, init: { method?: "GET" | "POST"; form?: Record<string, string>; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Hop> {
  const target = new URL(url);
  if (!isSchoolHost(target.host)) throw Errors.badGateway("南医统一认证跳到了未知地址");
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
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      method: init.method ?? (init.form ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw Errors.badGateway("南医教务暂时连不上，请稍后重试");
  }
  jar.ingest(res.headers.getSetCookie?.() ?? res.headers.get("set-cookie"), target.host, target.pathname);
  const location = res.headers.get("location") || "";
  const text = await res.text();
  if (res.status >= 500) throw Errors.badGateway("南医教务暂时不可用，请稍后重试");
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

function isAuthLoginPage(hop: Hop) {
  return hop.url.host === AUTH_HOST && /pwdEncryptSalt|name="execution"/u.test(hop.body);
}

function isJwLoggedIn(hop: Hop) {
  return hop.url.host === JW_HOST && hop.status === 200 && !/login_slogin|统一身份认证平台/u.test(hop.body);
}

// ============ 金智的密码加密：AES-128-CBC，密钥是页面给的盐，明文前面拼 64 位随机串 ============

const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

function randomAesString(length: number) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => AES_CHARS[byte % AES_CHARS.length]).join("");
}

export function encryptCasPassword(password: string, salt: string, random: (length: number) => string = randomAesString) {
  const key = Buffer.from(salt.trim(), "utf8");
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) return password;
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, Buffer.from(random(16), "utf8"));
  return Buffer.concat([cipher.update(random(64) + password, "utf8"), cipher.final()]).toString("base64");
}

export type CasLoginForm = { salt: string; execution: string; lt: string; captchaSwitch: boolean };

/** 登录页里有扫码、手机号、账号三张表单，账号密码那张是 pwdFromId。 */
export function parseCasLoginForm(html: string): CasLoginForm | null {
  const start = html.indexOf('id="pwdFromId"');
  const section = start >= 0 ? html.slice(start, html.indexOf("</form>", start) + 7 || undefined) : html;
  const salt = pick(section, /id="pwdEncryptSalt"[^>]*value="([^"]*)"/u) || pick(html, /id="pwdEncryptSalt"[^>]*value="([^"]*)"/u)
    || pick(html, /value="([^"]*)"[^>]*id="pwdEncryptSalt"/u);
  const execution = pick(section, /name="execution"[^>]*value="([^"]*)"/u) || pick(section, /value="([^"]*)"[^>]*name="execution"/u);
  if (!salt || !execution) return null;
  return {
    salt,
    execution: decodeHtml(execution),
    lt: decodeHtml(pick(section, /name="lt"[^>]*value="([^"]*)"/u)),
    captchaSwitch: pick(html, /captchaSwitch\s*=\s*"?(\d)/u) !== "0",
  };
}

/** 登录失败时页面上的提示。 */
export function parseCasError(html: string) {
  const raw = pick(html, /id="showErrorTip"[^>]*>([\s\S]*?)<\/span>/u)
    || pick(html, /id="formErrorTip"[^>]*>([\s\S]*?)<\/span>/u)
    || pick(html, /class="[^"]*form-error[^"]*"[^>]*>([\s\S]*?)<\//u);
  return decodeHtml(raw.replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim();
}

// ============ 待完成的登录、已登录的会话、设备指纹 ============

type JarJson = PathCookieJarJson;

type PendingLogin = {
  jar: JarJson;
  form: CasLoginForm;
  stage: "password" | "mfa";
  username?: string;
  /** 二次验证二维码的 uuid（reAuthCheck/getToken 给的）。 */
  qrUuid?: string;
};

type Session = {
  username: string;
  jar: JarJson;
  createdAt: number;
};

async function savePending(id: string, pending: PendingLogin) {
  await setEphemeralValue(jwxtPendingKey(id), encryptJwxtSensitiveJson("njmu-pending", id, pending), PENDING_TTL_MS);
}

async function loadPending(id: string): Promise<PendingLogin | null> {
  if (!isNjmuToken(id)) return null;
  const raw = await getEphemeralValue(jwxtPendingKey(id));
  if (!raw) return null;
  try {
    return decryptJwxtSensitiveJson<PendingLogin>("njmu-pending", id, raw).value;
  } catch {
    return null;
  }
}

async function saveSession(token: string, session: Session) {
  await setEphemeralValue(jwxtSessionKey(token), encryptJwxtSensitiveJson("njmu-session", token, session), SESSION_TTL_MS);
}

export async function loadSession(token: string | null | undefined): Promise<Session | null> {
  if (!token || !isNjmuToken(token)) return null;
  const raw = await getEphemeralValue(jwxtSessionKey(token));
  if (!raw) return null;
  try {
    return decryptJwxtSensitiveJson<Session>("njmu-session", token, raw).value;
  } catch {
    return null;
  }
}

const deviceKey = (username: string) => buildRedisKey("njmu", "cas-device", crypto.createHash("sha256").update(username).digest("hex"));

/**
 * 认证平台按「浏览器指纹」记住可信设备：网页在每个页面算一个 32 位大写 MD5，调 /authserver/bfp/info 交给平台，
 * 平台写下 MULTIFACTOR_BROWSER_FINGERPRINT。扫码通过、「信任此设备」都记在这个指纹上，没交指纹就既记不住、也过不了验证。
 * 服务端没有浏览器可算，就给每个账号生成一个固定的随机指纹，连同平台写下的长期 cookie 一起按账号保存。
 */
type DeviceRecord = { fingerprint: string; cookies: Record<string, string> };
const PER_LOGIN_COOKIE = /^(JSESSIONID|CASTGC|route|SERVERID|_?csrf.*|org\.springframework\..*)$/iu;

async function loadDevice(username: string): Promise<DeviceRecord> {
  const raw = await getEphemeralValue(deviceKey(username)).catch(() => null);
  if (raw) {
    try {
      const value = decryptJwxtSensitiveJson<Partial<DeviceRecord>>("njmu-device", username, raw).value;
      if (typeof value.fingerprint === "string" && /^[0-9A-F]{32}$/u.test(value.fingerprint)) {
        return { fingerprint: value.fingerprint, cookies: value.cookies ?? {} };
      }
    } catch {
      // 记录坏了就当新设备
    }
  }
  return { fingerprint: crypto.randomBytes(16).toString("hex").toUpperCase(), cookies: {} };
}

/** 把这个账号的设备指纹和长期 cookie 放进 jar，并像网页那样把指纹交给认证平台。 */
async function presentDevice(username: string, jar: CookieJar, signal?: AbortSignal) {
  const device = await loadDevice(username);
  jar.ingest(Object.entries(device.cookies).map(([name, value]) => `${name}=${value}; Path=/authserver`), AUTH_HOST);
  await request(jar, `${AUTH_ORIGIN}/authserver/bfp/info?bfp=${device.fingerprint}&_=${Date.now()}`, {
    headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", Referer: LOGIN_URL },
    signal,
  }).catch(() => undefined);
  if (!jar.value(AUTH_HOST, "MULTIFACTOR_BROWSER_FINGERPRINT")) {
    jar.ingest(`MULTIFACTOR_BROWSER_FINGERPRINT=${device.fingerprint}; Path=/authserver`, AUTH_HOST);
  }
  // 指纹一生成就存下来，扫码验证时和之后登录用的必须是同一个。
  await saveDevice(username, device.fingerprint, jar);
}

async function saveDevice(username: string, fingerprint: string, jar: CookieJar) {
  const cookies = Object.fromEntries(jar.cookies(AUTH_HOST).filter((item) => !PER_LOGIN_COOKIE.test(item.name)).map((item) => [item.name, item.value]));
  const record: DeviceRecord = { fingerprint, cookies };
  await setEphemeralValue(deviceKey(username), encryptJwxtSensitiveJson("njmu-device", username, record), DEVICE_TTL_MS).catch(() => undefined);
}

async function rememberDevice(username: string, jar: CookieJar) {
  const device = await loadDevice(username);
  await saveDevice(username, jar.value(AUTH_HOST, "MULTIFACTOR_BROWSER_FINGERPRINT") || device.fingerprint, jar);
}

// ============ 登录 ============

export type NjmuLoginAttempt = {
  ok: boolean;
  token?: string;
  authenticatedUsername?: string;
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
  needMfa?: boolean;
  mfa?: { pendingId: string; qrImage: string };
};

async function fetchCaptcha(jar: CookieJar, signal?: AbortSignal) {
  const target = new URL(`${AUTH_ORIGIN}/authserver/getCaptcha.htl?${Date.now()}`);
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
  const form = parseCasLoginForm(page.body);
  if (!form) throw Errors.badGateway("南医统一认证登录页无法识别，请稍后重试");
  return form;
}

export async function beginLogin(signal?: AbortSignal) {
  const jar = new CookieJar();
  const form = await openLoginPage(jar, signal);
  const pendingId = newId();
  await savePending(pendingId, { jar: jar.toJson(), form, stage: "password" });
  // 要不要验证码取决于账号，提交时才知道。
  return { pendingId, needCaptcha: false };
}

async function needsCaptcha(jar: CookieJar, username: string, signal?: AbortSignal) {
  const hop = await request(jar, `${AUTH_ORIGIN}/authserver/checkNeedCaptcha.htl?username=${encodeURIComponent(username)}&_=${Date.now()}`, {
    headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: LOGIN_URL },
    signal,
  });
  return /"isNeed"\s*:\s*true/u.test(hop.body);
}

/** 统一认证已登录（jar 里有 CASTGC）之后：换票进教务，确认教务首页能打开。 */
async function enterJwxt(jar: CookieJar, signal?: AbortSignal): Promise<boolean> {
  const hop = await getPage(jar, LOGIN_URL, signal);
  if (isAuthLoginPage(hop) || /reAuthCheck/u.test(hop.url.pathname)) {
    console.warn(`[njmu] 换票被统一认证挡回：${hop.url.pathname}（${/reAuthCheck/u.test(hop.url.pathname) ? "二次验证" : "登录页"}）`);
    return false;
  }
  const home = hop.url.host === JW_HOST && hop.url.pathname.startsWith("/jwglxt/") && isJwLoggedIn(hop)
    ? hop
    : await getPage(jar, JW_HOME_URL, signal);
  if (!isJwLoggedIn(home)) {
    console.warn(`[njmu] 换票进教务失败：停在 ${hop.url.host}${hop.url.pathname}（${hop.status}），教务首页 ${home.url.host}${home.url.pathname}（${home.status}）`);
    return false;
  }
  return true;
}

/** 跳转链已经落在教务里时直接确认教务首页能打开，不再多换一次票（多换的那次可能被要求二次验证）。 */
async function alreadyInJwxt(jar: CookieJar, landed: Hop | undefined, signal?: AbortSignal) {
  if (!landed || landed.url.host !== JW_HOST) return false;
  if (landed.url.pathname.startsWith("/jwglxt/") && isJwLoggedIn(landed)) return true;
  return isJwLoggedIn(await getPage(jar, JW_HOME_URL, signal));
}

async function finishLogin(jar: CookieJar, username: string, signal?: AbortSignal, landed?: Hop): Promise<NjmuLoginAttempt> {
  if (!jar.value(AUTH_HOST, "CASTGC")) return { ok: false, error: "统一认证没有完成登录，请重试" };
  await rememberDevice(username, jar);
  if (!await alreadyInJwxt(jar, landed, signal) && !await enterJwxt(jar, signal)) return { ok: false, error: "已通过统一认证，但进入南医教务失败，请稍后重试" };
  const token = newId();
  await saveSession(token, { username, jar: jar.toJson(), createdAt: Date.now() });
  return { ok: true, token, authenticatedUsername: username };
}

export async function submitLogin(args: { pendingId: string; username: string; password: string; captcha?: string }, signal?: AbortSignal): Promise<NjmuLoginAttempt> {
  const pending = await loadPending(args.pendingId);
  if (!pending) return { ok: false, error: "登录会话已过期，请刷新页面重试" };
  const username = String(args.username || "").trim();
  const jar = CookieJar.fromJson(pending.jar);
  await presentDevice(username, jar, signal);
  const captcha = String(args.captcha || "").trim();
  if (!captcha && pending.form.captchaSwitch && await needsCaptcha(jar, username, signal)) {
    await savePending(args.pendingId, { ...pending, jar: jar.toJson() });
    return { ok: false, needCaptcha: true, error: "请输入验证码", captcha: { image: await fetchCaptcha(jar, signal), pendingId: args.pendingId } };
  }
  const posted = await request(jar, LOGIN_URL, {
    form: {
      username,
      password: encryptCasPassword(args.password, pending.form.salt),
      captcha,
      rememberMe: "true",
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      lt: pending.form.lt,
      execution: pending.form.execution,
    },
    headers: { Referer: LOGIN_URL, Origin: AUTH_ORIGIN },
    signal,
  });
  if (posted.status >= 300 && posted.status < 400) {
    if (/reAuthCheck/u.test(posted.location)) return startMfa(args.pendingId, pending, jar, posted, username, signal);
    const landed = await follow(jar, posted, signal);
    if (/reAuthCheck/u.test(landed.url.pathname)) return startMfa(args.pendingId, pending, jar, landed, username, signal);
    await deleteEphemeralValue(jwxtPendingKey(args.pendingId)).catch(() => undefined);
    return finishLogin(jar, username, signal, landed);
  }
  if (/reAuthCheck|isMultifactor/u.test(posted.body) && !isAuthLoginPage(posted)) {
    return startMfa(args.pendingId, pending, jar, posted, username, signal);
  }
  // 失败时认证平台回到登录页，表单参数（execution）会换新的。
  const message = parseCasError(posted.body) || "学号或密码错误";
  const form = parseCasLoginForm(posted.body) ?? pending.form;
  const pendingNext = { ...pending, jar: jar.toJson(), form };
  if (/验证码/u.test(message)) {
    await savePending(args.pendingId, pendingNext);
    return { ok: false, needCaptcha: true, error: message, captcha: { image: await fetchCaptcha(jar, signal), pendingId: args.pendingId } };
  }
  await savePending(args.pendingId, pendingNext);
  return { ok: false, error: message };
}

// ============ 二次验证：扫码（南医配置的是 reAuthType 14，手机扫码确认） ============

const REAUTH_VIEW_URL = `${AUTH_ORIGIN}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodeURIComponent(SERVICE_URL)}`;
const REAUTH_XHR = { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", Referer: REAUTH_VIEW_URL };

/** 申请一张二维码：先拿 uuid，再取图片（data URL，前端直接显示）。 */
async function issueQr(jar: CookieJar, previousUuid = "", signal?: AbortSignal) {
  const token = await request(jar, `${AUTH_ORIGIN}/authserver/reAuthCheck/getToken?ts=${Date.now()}&uuid=${encodeURIComponent(previousUuid)}`, { headers: REAUTH_XHR, signal });
  let payload: { errCode?: string | number; uuid?: string; errMsg?: string } = {};
  try { payload = JSON.parse(token.body); } catch { /* 下面按失败处理 */ }
  if (String(payload.errCode) !== "1" || !payload.uuid) throw Errors.badGateway(payload.errMsg || "学校认证平台没有给出二维码，请稍后重试");
  const target = new URL(`${AUTH_ORIGIN}/authserver/reAuthCheck/getCode?uuid=${encodeURIComponent(payload.uuid)}`);
  const res = await fetch(target, {
    headers: { "User-Agent": UA, Cookie: jar.serializeFor(target), Referer: REAUTH_VIEW_URL },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) throw Errors.badGateway("二维码图片获取失败，请稍后重试");
  jar.ingest(res.headers.getSetCookie?.() ?? res.headers.get("set-cookie"), AUTH_HOST, target.pathname);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
  return { uuid: payload.uuid, image: `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` };
}

async function startMfa(pendingId: string, pending: PendingLogin, jar: CookieJar, hop: Hop, username: string, signal?: AbortSignal): Promise<NjmuLoginAttempt> {
  if (hop.status >= 300) await follow(jar, hop, signal);
  const qr = await issueQr(jar, "", signal);
  await savePending(pendingId, { ...pending, jar: jar.toJson(), stage: "mfa", username, qrUuid: qr.uuid });
  return {
    ok: false,
    needMfa: true,
    error: "这台设备第一次登录，需要扫码验证",
    mfa: { pendingId, qrImage: qr.image },
  };
}

async function loadMfaPending(pendingId: string) {
  const pending = await loadPending(pendingId);
  if (!pending || pending.stage !== "mfa" || !pending.username || !pending.qrUuid) throw Errors.badRequest("验证已过期，请重新登录");
  return pending as PendingLogin & { username: string; qrUuid: string };
}

/** 换一张二维码（过期或用户点了刷新）。 */
export async function refreshMfaQr(pendingId: string, signal?: AbortSignal) {
  const pending = await loadMfaPending(pendingId);
  const jar = CookieJar.fromJson(pending.jar);
  const qr = await issueQr(jar, pending.qrUuid, signal);
  await savePending(pendingId, { ...pending, jar: jar.toJson(), qrUuid: qr.uuid });
  return { qrImage: qr.image };
}

export type MfaPollResult =
  | { status: "waiting" | "scanned" | "expired" }
  | { status: "done"; attempt: NjmuLoginAttempt };

/**
 * 查一次扫码状态：1 已确认、2 已扫描待确认、3 已失效。
 * 确认后提交二次验证并勾上「信任此设备」（认证平台据此下发设备指纹），然后换票进教务。
 */
export async function pollMfa(pendingId: string, signal?: AbortSignal): Promise<MfaPollResult> {
  const pending = await loadMfaPending(pendingId);
  const jar = CookieJar.fromJson(pending.jar);
  const state = await request(jar, `${AUTH_ORIGIN}/authserver/reAuthCheck/getStatus.htl?ts=${Date.now()}&uuid=${encodeURIComponent(pending.qrUuid)}`, {
    headers: { ...REAUTH_XHR, Accept: "text/plain, */*; q=0.01" },
    signal,
  });
  const code = state.body.trim();
  if (code === "2") return { status: "scanned" };
  if (code === "3") return { status: "expired" };
  if (code !== "1") return { status: "waiting" };
  const submitted = await request(jar, `${AUTH_ORIGIN}/authserver/reAuthCheck/reAuthSubmit.do`, {
    form: {
      service: SERVICE_URL,
      reAuthType: "14",
      isMultifactor: "true",
      password: "",
      dynamicCode: "",
      uuid: pending.qrUuid,
      answer1: "",
      answer2: "",
      otpCode: "",
      skipTmpReAuth: "true",
    },
    headers: REAUTH_XHR,
    signal,
  });
  let payload: { code?: string; msg?: string } = {};
  try { payload = JSON.parse(submitted.body); } catch { /* 下面按失败处理 */ }
  if (payload.code !== "reAuth_success") {
    await savePending(pendingId, { ...pending, jar: jar.toJson() });
    return { status: "done", attempt: { ok: false, error: payload.msg || "扫码验证没有通过，请重新登录" } };
  }
  await deleteEphemeralValue(jwxtPendingKey(pendingId)).catch(() => undefined);
  const landed = await getPage(jar, LOGIN_URL, signal);
  return { status: "done", attempt: await finishLogin(jar, pending.username, signal, landed) };
}

export async function logout(token: string) {
  if (!isNjmuToken(token)) return false;
  await deleteEphemeralValue(jwxtSessionKey(token));
  return true;
}

// ============ 已登录后访问教务 ============

function expired(): HttpError {
  return Errors.unauthorized("南医教务登录已过期，请重新登录");
}

/** 教务会话过期（被踢回认证平台）时，用还活着的 CASTGC 静默换一次票。 */
async function renew(token: string, signal?: AbortSignal) {
  const lockId = crypto.createHash("sha256").update(token).digest("hex");
  const locked = await runWithDistributedLock(`njmu-session:${lockId}`, 30_000, async () => {
    const session = await loadSession(token);
    if (!session) return false;
    const jar = CookieJar.fromJson(session.jar);
    jar.clearHost(JW_HOST);
    await presentDevice(session.username, jar, signal);
    const ok = await enterJwxt(jar, signal);
    if (ok) await saveSession(token, { ...session, jar: jar.toJson() });
    return ok;
  });
  return locked.acquired ? Boolean(locked.result) : true;
}

function needsLogin(hop: Hop) {
  return hop.url.host !== JW_HOST || (hop.status >= 300 && /authserver|login_slogin/u.test(hop.location)) || /login_slogin|统一身份认证平台/u.test(hop.body);
}

/** 以已登录身份请求教务接口（表单 POST 或 GET），返回响应文本。 */
export async function jwRequest(token: string, path: string, form?: Record<string, string>, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await loadSession(token);
    if (!session) throw expired();
    const jar = CookieJar.fromJson(session.jar);
    const hop = await request(jar, `${JW_ORIGIN}${path}`, {
      form,
      method: form ? "POST" : "GET",
      headers: form ? { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", Referer: JW_HOME_URL } : { Referer: JW_HOME_URL },
      signal,
    });
    if (!needsLogin(hop) && hop.status === 200) {
      await saveSession(token, { ...session, jar: jar.toJson() });
      return hop.body;
    }
    if (attempt === 0 && await renew(token, signal)) continue;
    throw expired();
  }
  throw expired();
}

export async function jwJson<T>(token: string, path: string, form?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const body = await jwRequest(token, path, form, signal);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw Errors.badGateway("南医教务返回了无法识别的数据");
  }
}
