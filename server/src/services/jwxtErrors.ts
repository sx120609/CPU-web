import { HttpError } from "../utils/response";

/**
 * 教务接口的错误出口。客户端以前靠匹配报错文字判断“教务授权失效”，
 * 站内登录过期、节点故障、学校拒绝访问都可能被当成要重新授权。
 * 现在所有 /api/jwxt 的错误都在这里归类，授权失效统一带 JWXT_AUTH_EXPIRED_CODE。
 */

/** 教务授权失效：客户端据此恢复授权或请用户重新授权。 */
export const JWXT_AUTH_EXPIRED_CODE = 4011;
/** 学校教务系统返回 401/403（防火墙、限流等），不是登录过期。 */
export const JWXT_UPSTREAM_REFUSED_CODE = 5021;

// 站内登录中间件的 401：站内账号的事，不能让客户端去清教务授权。
const SITE_AUTH_MESSAGES = new Set([
  "请先登录",
  "登录已过期，请重新登录",
  "账号不存在或已失效，请重新登录",
  "账户已申请删除，原有登录凭据已失效",
]);
const UPSTREAM_STATUS = /^教务请求失败 \((401|403)\)$/u;

/** 连不上学校：Node fetch 的网络错误。 */
export const JWXT_UPSTREAM_UNREACHABLE_CODE = 5022;
/** 学校回了认不出来的东西：维护页、拦截页当成 JSON 解析，或换票页里没有跳转地址。 */
export const JWXT_UPSTREAM_UNREADABLE_CODE = 5023;
const UPSTREAM_UNREACHABLE = /^fetch failed$|^socket hang up$|^other side closed$|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_/u;
const UPSTREAM_UNREADABLE = /is not valid JSON|^Unexpected (token|end of JSON)|^教务未返回统一认证跳转地址$/u;

/**
 * 学校那头的临时故障原样抛上来就成了 500，客户端当成我们自己的错误。
 * 本机抛的原始错误和 Agent 转回来的 500 都在这里改成 502。
 */
function classifyUpstreamFailure(error: unknown) {
  const raw = error instanceof HttpError
    ? (error.status === 500 ? error.message : "")
    : (error instanceof Error ? error.message : "");
  if (!raw) return null;
  if (UPSTREAM_UNREACHABLE.test(raw)) {
    return new HttpError(502, JWXT_UPSTREAM_UNREACHABLE_CODE, "暂时连不上学校教务系统，请稍后重试");
  }
  if (UPSTREAM_UNREADABLE.test(raw)) {
    return new HttpError(502, JWXT_UPSTREAM_UNREADABLE_CODE, "学校教务系统暂时返回了无法识别的页面，请稍后重试");
  }
  return null;
}

export function classifyJwxtError(error: unknown): unknown {
  const upstream = classifyUpstreamFailure(error);
  if (upstream) return upstream;
  if (!(error instanceof HttpError) || error.status !== 401) return error;
  if (SITE_AUTH_MESSAGES.has(error.message)) return error;
  if (UPSTREAM_STATUS.test(error.message)) {
    return new HttpError(502, JWXT_UPSTREAM_REFUSED_CODE, "学校教务系统暂时拒绝了请求，请稍后重试");
  }
  if (error.code === JWXT_AUTH_EXPIRED_CODE) return error;
  return new HttpError(401, JWXT_AUTH_EXPIRED_CODE, error.message);
}

/* ---------- 错误统计：后台「教务节点」页看最近 24 小时出了哪些错 ---------- */

const HOUR_MS = 60 * 60 * 1000;
const KEEP_HOURS = 24;
const MAX_KINDS = 200;

interface ErrorKind {
  status: number;
  code: number;
  message: string;
  paths: Map<string, number>;
  hours: Map<number, number>;
  lastAt: number;
}

const kinds = new Map<string, ErrorKind>();
const requestHours = new Map<number, number>();

/** 节点名、数字、长 ID 各不相同，归成一类才能看出规律。 */
export function normalizeJwxtErrorMessage(message: string) {
  return String(message || "")
    .replace(/教务 Agent \S+/gu, "教务 Agent *")
    .replace(/\b[0-9a-f]{12,}\b/giu, "*")
    .replace(/\d+/gu, "N")
    .slice(0, 120);
}

function prune(now: number) {
  const oldest = Math.floor(now / HOUR_MS) - KEEP_HOURS + 1;
  for (const hour of requestHours.keys()) if (hour < oldest) requestHours.delete(hour);
  for (const [key, kind] of kinds) {
    for (const hour of kind.hours.keys()) if (hour < oldest) kind.hours.delete(hour);
    if (!kind.hours.size) kinds.delete(key);
  }
}

export function recordJwxtOutcome(input: { path: string; status: number; code?: number; message?: string; now?: number }) {
  const now = input.now ?? Date.now();
  const hour = Math.floor(now / HOUR_MS);
  requestHours.set(hour, (requestHours.get(hour) ?? 0) + 1);
  if (input.status < 400) return;
  const message = normalizeJwxtErrorMessage(input.message || "");
  const code = Number(input.code) || 0;
  const key = `${input.status}|${code}|${message}`;
  let kind = kinds.get(key);
  if (!kind) {
    if (kinds.size >= MAX_KINDS) prune(now);
    if (kinds.size >= MAX_KINDS) return;
    kind = { status: input.status, code, message, paths: new Map(), hours: new Map(), lastAt: now };
    kinds.set(key, kind);
  }
  kind.hours.set(hour, (kind.hours.get(hour) ?? 0) + 1);
  kind.paths.set(input.path, (kind.paths.get(input.path) ?? 0) + 1);
  kind.lastAt = now;
}

export function jwxtErrorStats(now = Date.now()) {
  prune(now);
  const sum = (hours: Map<number, number>) => [...hours.values()].reduce((total, value) => total + value, 0);
  const list = [...kinds.values()].map((kind) => ({
    status: kind.status,
    code: kind.code,
    message: kind.message,
    count: sum(kind.hours),
    lastAt: new Date(kind.lastAt).toISOString(),
    paths: [...kind.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, count]) => ({ path, count })),
  })).sort((a, b) => b.count - a.count);
  return { windowHours: KEEP_HOURS, requests: sum(requestHours), errors: list.reduce((total, item) => total + item.count, 0), kinds: list };
}

export function resetJwxtErrorStats() {
  kinds.clear();
  requestHours.clear();
}
