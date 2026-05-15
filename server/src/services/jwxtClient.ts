/**
 * 教务系统（jsxsd）代登录客户端
 *
 * 流程：
 *  1) GET http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp → 302 → CAS 登录页
 *  2) CAS 登录页含 lt / execution / service / useVCode 等隐藏字段
 *  3) 若 useVCode = true，需要先请求验证码图片，让用户输入
 *  4) POST 凭据 + 隐藏字段到 /sso/login
 *  5) CAS 验证通过 → 302 回 jsxsd 带 ticket → jsxsd 设置 JSESSIONID
 *
 * 安全约定：
 *  - 用户名密码绝不写入磁盘 / 数据库 / 日志
 *  - 仅在 server 进程内存的 sessionStore 里持有 cookie jar
 *  - 30 分钟无活动失效；进程退出时全部清空
 */
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDev } from "../config";
import { Errors } from "../utils/response";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENTRY_URL = "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp";
const DEBUG_DIR = path.join(process.cwd(), ".debug");

/** 简易 cookie jar：按 host 分组存 cookie 名值对 */
export class CookieJar {
  private byHost = new Map<string, Map<string, string>>();

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
      current = new URL(loc, current).toString();
      // 重定向后默认走 GET（除非是 307/308 保留方法）
      if (res.status === 307 || res.status === 308) {
        // 保留 method 与 body
      } else {
        opts = { headers: init.headers };
      }
      continue;
    }
    return { res, finalUrl: current, hops };
  }
  throw new Error("Too many redirects");
}

// ============ 公开 API ============

export interface LoginAttempt {
  ok: boolean;
  /** 登录成功后用于后续请求的服务端 token（前端用 X-Jwxt-Token 头传回） */
  token?: string;
  /** 失败原因 / 错误消息 */
  error?: string;
  /** 当 needCaptcha = true 时，captcha 字段给出验证码图片 base64 + pending 引用 */
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
}

interface PendingLogin {
  jar: CookieJar;
  ssoUrl: string;       // SSO 登录页的最终 URL（POST 目标）
  hidden: Record<string, string>; // lt / execution / service / _eventId 等
  createdAt: number;
}

interface ActiveSession {
  jar: CookieJar;
  username: string;     // 仅用于日志展示（不含密码）
  createdAt: number;
  lastSeenAt: number;
}

const pendings = new Map<string, PendingLogin>();
const sessions = new Map<string, ActiveSession>();

const PENDING_TTL = 5 * 60 * 1000;          // 5 分钟未提交则丢弃
const SESSION_IDLE_TTL = 30 * 60 * 1000;    // 30 分钟无活动失效

function genId() {
  return crypto.randomBytes(24).toString("hex");
}

// 定时清理
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendings) {
    if (now - v.createdAt > PENDING_TTL) pendings.delete(k);
  }
  for (const [k, v] of sessions) {
    if (now - v.lastSeenAt > SESSION_IDLE_TTL) sessions.delete(k);
  }
}, 60_000).unref?.();

/** 第一步：拿到登录页（lt/execution），如果需要验证码则一并返回图片 */
export async function beginLogin(): Promise<{
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
}> {
  const jar = new CookieJar();
  // GET 入口 → 302 链到 SSO 登录页
  const { res, finalUrl } = await followRedirects(jar, ENTRY_URL);
  const html = await res.text();
  if (isDev) await saveDebug("login-page.html", html);
  const $ = cheerio.load(html);
  const hidden: Record<string, string> = {};
  $("input[type='hidden']").each((_, el) => {
    const name = ($(el).attr("name") || "").trim();
    const value = ($(el).attr("value") || "").trim();
    if (name) hidden[name] = value;
  });
  if (!hidden.execution) {
    throw new Error("无法解析 CAS 登录页（缺少 execution）。学校 SSO 可能已变更，请联系管理员。");
  }

  // 注意：表单里 useVCode（动态运行时是否要验证码）与 isUseVCode（功能总开关）不同。
  // 只有 useVCode === "true" 才是"本次登录需要验证码"。
  // isUseVCode = "true" 但 useVCode = "" 时，登录不带验证码也能过；
  // 一旦密码错几次，下次刷登录页 useVCode 会变 "true"。
  const useVCode = hidden.useVCode === "true";

  const id = genId();
  pendings.set(id, { jar, ssoUrl: finalUrl, hidden, createdAt: Date.now() });

  if (useVCode) {
    const img = await fetchCaptcha(jar, finalUrl).catch(() => "");
    return { pendingId: id, needCaptcha: true, captchaImage: img };
  }
  return { pendingId: id, needCaptcha: false };
}

/** 拉取验证码图片（用同一个 jar 保持 session） */
async function fetchCaptcha(jar: CookieJar, refer: string): Promise<string> {
  const url = `https://id.cpu.edu.cn/sso/authImg?now=${Date.now()}&refresh=1&authCodeKey=authCodeKeySSO`;
  const res = await fetchWithJar(jar, url, { headers: { Referer: refer } });
  const ct = res.headers.get("content-type") || "";
  if (res.ok && ct.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  }
  throw new Error("authImg 返回非图片");
}

/** 第二步：用 pendingId + 凭据完成登录 */
export async function submitLogin(args: {
  pendingId: string;
  username: string;
  password: string;
  captcha?: string;
}): Promise<LoginAttempt> {
  const pending = pendings.get(args.pendingId);
  if (!pending) return { ok: false, error: "登录会话已过期，请刷新页面重试" };
  const { jar, ssoUrl, hidden } = pending;

  // 组装 POST body：所有 hidden + username + password (+ captcha?)
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) body.set(k, v);
  if (!body.get("_eventId")) body.set("_eventId", "submit");
  body.set("username", args.username);
  body.set("password", args.password);
  if (args.captcha) {
    // 学校 SSO 的验证码字段在 errorCount 触发动态插入，name 实测最可能是 rcode/vCode
    body.set("rcode", args.captcha);
    body.set("vCode", args.captcha);
    body.set("captcha", args.captcha);
    body.set("authCode", args.captcha);
  }

  const r = await followRedirects(jar, ssoUrl, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: ssoUrl,
    },
  });

  // 用完即弃
  pendings.delete(args.pendingId);

  // 期望：最终 URL 落到 jsxsd 域名（说明 CAS 已颁发 ticket 并交换成 JSESSIONID）
  const finalHost = new URL(r.finalUrl).host;
  if (finalHost.includes("jsxsd.cpu.edu.cn")) {
    // 注意：不保存 post-login.html —— 它含学生姓名/学号等个人信息
    const token = genId();
    const now = Date.now();
    sessions.set(token, { jar, username: args.username, createdAt: now, lastSeenAt: now });
    return { ok: true, token };
  }

  // 否则：仍在 SSO 域，解析错误信息
  const html = await r.res.text();
  if (isDev) await saveDebug("login-error.html", html);
  const $ = cheerio.load(html);
  const errText =
    $(".alert-danger, .errors, #msg, .login-error, .errorTip").first().text().trim() ||
    $("title").text().trim() ||
    "账号或密码错误";

  // 若仍要求验证码，重启 pending
  const useVCode = $('input[name="useVCode"]').val() === "true" || $('input[name="isUseVCode"]').val() === "true";
  if (useVCode) {
    const newHidden: Record<string, string> = {};
    $("input[type='hidden']").each((_, el) => {
      const name = ($(el).attr("name") || "").trim();
      const value = ($(el).attr("value") || "").trim();
      if (name) newHidden[name] = value;
    });
    const newPendingId = genId();
    pendings.set(newPendingId, {
      jar, ssoUrl: r.finalUrl, hidden: newHidden, createdAt: Date.now(),
    });
    const img = await fetchCaptcha(jar, r.finalUrl).catch(() => "");
    return {
      ok: false,
      error: errText,
      needCaptcha: true,
      captcha: { image: img, pendingId: newPendingId },
    };
  }

  return { ok: false, error: errText };
}

/** 注销：删除 server 内存里的 cookie jar */
export function logout(token: string): boolean {
  return sessions.delete(token);
}

/** 获取 session（供 API 路由用）；同时刷新 lastSeenAt */
export function getSession(token: string | undefined | null): ActiveSession | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.lastSeenAt > SESSION_IDLE_TTL) {
    sessions.delete(token);
    return null;
  }
  s.lastSeenAt = Date.now();
  return s;
}

/** 用一个 session 访问任意 jsxsd 路径，返回 HTML 文本 */
export async function jwxtFetchHtml(token: string, path: string): Promise<string> {
  const sess = getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");
  const url = new URL(path, "http://jsxsd.cpu.edu.cn").toString();
  const { res, finalUrl } = await followRedirects(sess.jar, url);
  if (new URL(finalUrl).host !== "jsxsd.cpu.edu.cn") {
    sessions.delete(token);
    throw Errors.unauthorized("教务会话已失效（被学校 SSO 踢出），请重新登录");
  }
  return res.text();
}

/**
 * 通用：访问任意 cpu.edu.cn 子域。
 * 因为 SSO session 已建立，CAS 会自动透传 ticket 到目标 service。
 */
export async function fetchAnyCpu(token: string, url: string, opts?: { allowSso?: boolean }): Promise<string> {
  const sess = getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");
  const { res, finalUrl } = await followRedirects(sess.jar, url);
  const finalHost = new URL(finalUrl).host;
  if (finalHost === "id.cpu.edu.cn" && !opts?.allowSso) {
    sessions.delete(token);
    throw Errors.unauthorized("学校 SSO 会话已失效，请重新登录");
  }
  if (!finalHost.endsWith("cpu.edu.cn")) {
    throw Errors.badRequest(`意外的最终域名: ${finalHost}`);
  }
  return res.text();
}

function isCpuHost(host: string) {
  const lower = host.toLowerCase();
  return lower === "cpu.edu.cn" || lower.endsWith(".cpu.edu.cn");
}

/**
 * 为浏览器生成一次性的学校 SSO 跳转地址。
 * 后端只使用内存中的 CAS cookie 向 id.cpu.edu.cn 申请 ticket，不访问最终 service，
 * 避免把 ticket 在服务端消费掉，浏览器打开后由学校系统写入自己的登录态。
 */
export async function createIServiceLaunchUrl(token: string, targetUrl: string): Promise<string> {
  const sess = getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效，请重新登录");

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw Errors.badRequest("服务地址无效");
  }
  if (!["http:", "https:"].includes(target.protocol) || !isCpuHost(target.host) || target.host === "id.cpu.edu.cn") {
    throw Errors.badRequest("仅支持跳转到学校官方服务");
  }

  const ssoUrl = new URL("https://id.cpu.edu.cn/sso/login");
  ssoUrl.searchParams.set("service", target.toString());

  let current = ssoUrl.toString();
  for (let i = 0; i < 8; i++) {
    const res = await fetchWithJar(sess.jar, current, {
      headers: { Referer: "https://id.cpu.edu.cn/" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, current);
      if (!isCpuHost(next.host)) throw Errors.badRequest("学校 SSO 返回了非官方服务地址");
      if (next.host !== "id.cpu.edu.cn") return next.toString();
      current = next.toString();
      continue;
    }
    break;
  }

  throw Errors.unauthorized("学校统一认证会话已失效，请重新授权后再打开服务");
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
    "http://i.cpu.edu.cn/sopplus/mobile/getPortalIndexAppList.rst" +
    "?_p=YXM9MiZ0PTUmZD0xMzMmcD0xJmY9NDQmbT1OJg__&pageSize=200";
  const text = await fetchAnyCpu(token, url);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw Errors.badRequest("i 服务接口返回非 JSON");
  }
  if (json.result !== "1") {
    throw Errors.badRequest("i 服务接口异常: " + (json.reason || "result≠1"));
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
  const sess = getSession(token);
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
    sessions.delete(token);
    throw Errors.unauthorized("教务会话已失效，请重新登录");
  }
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
  const sess = getSession(token);
  if (!sess) throw Errors.unauthorized("教务会话已失效");
  const base = "http://jsxsd.cpu.edu.cn";
  // GET 类型的探针
  const getProbes = [
    { name: "main-frame", url: `${base}/zgykdx/framework/xsMain.jsp` },
    { name: "schedule", url: `${base}/zgykdx/xskb/xskb_list.do` },
    { name: "grades-query", url: `${base}/zgykdx/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_CJGL` },
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
  return { sessions: sessions.size, pendings: pendings.size };
}
