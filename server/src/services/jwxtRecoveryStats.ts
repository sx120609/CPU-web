import type { Request } from "express";
import { verifySessionTokenSignature } from "../utils/jwt";

/**
 * 教务授权失效之后到底恢复了没有。
 *
 * 错误统计里的 4011 只说明“学校登录过期了”，客户端随后会用本机保存的账号在后台重新登录，
 * 那一步走的是 /auth/sso-login，不在 /api/jwxt 的统计里。这里按人把两头接起来：
 * 某人第一次拿到 4011 开始一段“失效”，期间他的学校登录成功就算恢复；
 * 过了 RECOVERY_WINDOW_MS 还没成功就算没恢复，并按最后一次登录尝试的结果说明原因。
 * 只在服务进程内存里统计，部署或重启后重新计数，和错误统计一致。
 */

const HOUR_MS = 60 * 60 * 1000;
const KEEP_HOURS = 24;
export const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const MAX_OPEN = 20_000;
const MAX_PEOPLE = 50_000;

export type JwxtLoginOutcome = "ok" | "captcha" | "mfa" | "failed" | "error";
/** 没恢复的原因：没有任何登录尝试（多半没保存账号或用户离开了）、学校要验证码、要扫码、密码被拒、登录请求出错。 */
export type JwxtUnrecoveredReason = "noAttempt" | Exclude<JwxtLoginOutcome, "ok">;

const DELAY_BUCKETS = [
  { key: "under10s", maxMs: 10_000 },
  { key: "under1m", maxMs: 60_000 },
  { key: "under5m", maxMs: 5 * 60_000 },
  { key: "under15m", maxMs: Number.POSITIVE_INFINITY },
] as const;
type DelayBucket = (typeof DELAY_BUCKETS)[number]["key"];

interface OpenEpisode {
  startedAt: number;
  attempts: number;
  lastOutcome?: Exclude<JwxtLoginOutcome, "ok">;
}

interface HourBucket {
  started: number;
  recovered: number;
  unrecovered: Record<JwxtUnrecoveredReason, number>;
  delays: Record<DelayBucket, number>;
  attempts: number;
}

const open = new Map<string, OpenEpisode>();
const hours = new Map<number, HourBucket>();
const people = new Map<string, number>();

function emptyBucket(): HourBucket {
  return {
    started: 0,
    recovered: 0,
    unrecovered: { noAttempt: 0, captcha: 0, mfa: 0, failed: 0, error: 0 },
    delays: { under10s: 0, under1m: 0, under5m: 0, under15m: 0 },
    attempts: 0,
  };
}

function bucketAt(at: number) {
  const hour = Math.floor(at / HOUR_MS);
  let bucket = hours.get(hour);
  if (!bucket) {
    bucket = emptyBucket();
    hours.set(hour, bucket);
  }
  return bucket;
}

/** 超过恢复时限还没成功的，按开始的那个小时记成没恢复。 */
function settle(now: number) {
  for (const [key, episode] of open) {
    if (now - episode.startedAt < RECOVERY_WINDOW_MS) continue;
    open.delete(key);
    bucketAt(episode.startedAt).unrecovered[episode.lastOutcome ?? "noAttempt"] += 1;
  }
}

function prune(now: number) {
  settle(now);
  const oldest = Math.floor(now / HOUR_MS) - KEEP_HOURS + 1;
  for (const hour of hours.keys()) if (hour < oldest) hours.delete(hour);
  for (const [key, at] of people) if (at < now - KEEP_HOURS * HOUR_MS) people.delete(key);
}

/** 用站内登录态认人：重新登录会换教务会话，但站内账号不变。认不出来就不统计。 */
export function jwxtRecoveryPersonKey(req: Pick<Request, "headers"> & { browserSession?: { siteToken?: string } }) {
  let token = req.browserSession?.siteToken || "";
  if (!token) {
    const header = String(req.headers?.authorization || "");
    if (header.startsWith("Bearer ")) token = header.slice(7).trim();
  }
  if (!token || token.length < 20) return "";
  try {
    const payload = verifySessionTokenSignature(token);
    return Number.isInteger(payload.userId) && payload.userId > 0 ? `u:${payload.userId}` : "";
  } catch {
    return "";
  }
}

export function jwxtRecoveryKeyForUser(userId: number) {
  return `u:${userId}`;
}

/** 某人的教务请求拿到了 4011。已经在失效中的不重复计。 */
export function noteJwxtAuthExpired(key: string, now = Date.now()) {
  if (!key) return;
  const existing = open.get(key);
  if (existing && now - existing.startedAt < RECOVERY_WINDOW_MS) return;
  if (existing) settle(now);
  if (open.size >= MAX_OPEN) settle(now);
  if (open.size >= MAX_OPEN) return;
  open.set(key, { startedAt: now, attempts: 0 });
  bucketAt(now).started += 1;
  if (people.size >= MAX_PEOPLE && !people.has(key)) prune(now);
  if (people.size < MAX_PEOPLE || people.has(key)) people.set(key, now);
}

/** 某人的学校登录有了结果。只有正处在失效中的才算进恢复统计，平常的登录不管。 */
export function noteJwxtLoginOutcome(key: string, outcome: JwxtLoginOutcome, now = Date.now()) {
  if (!key) return;
  const episode = open.get(key);
  if (!episode) return;
  if (now - episode.startedAt >= RECOVERY_WINDOW_MS) {
    settle(now);
    return;
  }
  episode.attempts += 1;
  bucketAt(episode.startedAt).attempts += 1;
  if (outcome !== "ok") {
    episode.lastOutcome = outcome;
    return;
  }
  open.delete(key);
  const bucket = bucketAt(episode.startedAt);
  bucket.recovered += 1;
  const delay = now - episode.startedAt;
  bucket.delays[DELAY_BUCKETS.find((item) => delay <= item.maxMs)!.key] += 1;
}

/** 学校登录没成时属于哪一类，用来说明“为什么没恢复”。 */
export function schoolLoginFailureOutcome(r: { needMfa?: boolean; needCaptcha?: boolean }): Exclude<JwxtLoginOutcome, "ok"> {
  if (r.needMfa) return "mfa";
  if (r.needCaptcha) return "captcha";
  return "failed";
}

export function jwxtRecoveryStats(now = Date.now()) {
  prune(now);
  const total = emptyBucket();
  for (const bucket of hours.values()) {
    total.started += bucket.started;
    total.recovered += bucket.recovered;
    total.attempts += bucket.attempts;
    for (const key of Object.keys(total.unrecovered) as JwxtUnrecoveredReason[]) total.unrecovered[key] += bucket.unrecovered[key];
    for (const key of Object.keys(total.delays) as DelayBucket[]) total.delays[key] += bucket.delays[key];
  }
  return {
    windowMinutes: RECOVERY_WINDOW_MS / 60_000,
    people: people.size,
    episodes: total.started,
    recovered: total.recovered,
    unrecovered: Object.values(total.unrecovered).reduce((sum, value) => sum + value, 0),
    pending: open.size,
    loginAttempts: total.attempts,
    unrecoveredReasons: total.unrecovered,
    recoveryDelays: total.delays,
  };
}

export function resetJwxtRecoveryStats() {
  open.clear();
  hours.clear();
  people.clear();
}
