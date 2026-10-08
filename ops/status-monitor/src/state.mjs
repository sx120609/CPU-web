import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dayKey, daysUntil } from "./time.mjs";

export const HISTORY_DAYS = 90;
const MAX_INCIDENTS = 200;
const RECENT_SAMPLES = 30;
const CERTIFICATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function createState() {
  return { version: 1, checks: {}, incidents: [], certificates: {}, release: null };
}

function createEntry() {
  return {
    status: "unknown",
    since: null,
    failures: 0,
    failingSince: null,
    slowStreak: 0,
    lastSampleAt: null,
    lastKnownAt: null,
    reason: "",
    recentMs: [],
    days: {},
    incidentId: null,
  };
}

function setStatus(entry, status, since) {
  entry.status = status;
  entry.since = since;
}

/**
 * 记入一次探测结果，返回需要通知的事件。
 * 连续 failureThreshold 次失败才判定中断并开事件；第一次成功即恢复。
 * outcome 为 unknown（监控机自己断网）时不计入可用率，也不改变当前状态。
 */
export function applySample(state, check, sample, { now, timezone }) {
  const entry = state.checks[check.id] ??= createEntry();
  entry.lastSampleAt = now;
  if (sample.outcome === "unknown") return [];
  entry.lastKnownAt = now;

  const bucket = entry.days[dayKey(now, timezone)] ??= { up: 0, slow: 0, down: 0 };
  bucket[sample.outcome] += 1;
  for (const key of Object.keys(entry.days).sort().slice(0, -HISTORY_DAYS)) delete entry.days[key];

  if (sample.outcome === "down") {
    if (entry.failures === 0) entry.failingSince = now;
    entry.failures += 1;
    entry.slowStreak = 0;
    entry.reason = sample.reason || "检查失败";
    if (entry.status === "down" || entry.failures < check.failureThreshold) return [];

    const incident = {
      id: `${check.id}-${entry.failingSince}`,
      checkId: check.id,
      name: check.name,
      startedAt: entry.failingSince,
      resolvedAt: null,
      reason: entry.reason,
    };
    state.incidents.unshift(incident);
    state.incidents.length = Math.min(state.incidents.length, MAX_INCIDENTS);
    entry.incidentId = incident.id;
    setStatus(entry, "down", incident.startedAt);
    return [{ type: "down", checkId: check.id, name: check.name, critical: check.critical, reason: incident.reason, startedAt: incident.startedAt }];
  }

  const events = [];
  if (entry.status === "down") {
    const incident = state.incidents.find((candidate) => candidate.id === entry.incidentId);
    if (incident && incident.resolvedAt === null) incident.resolvedAt = now;
    events.push({ type: "recovered", checkId: check.id, name: check.name, startedAt: incident?.startedAt ?? entry.since, resolvedAt: now });
    entry.incidentId = null;
  }
  entry.failures = 0;
  entry.failingSince = null;
  entry.reason = "";
  entry.slowStreak = sample.outcome === "slow" ? entry.slowStreak + 1 : 0;
  entry.recentMs = [...entry.recentMs, sample.elapsedMs].slice(-RECENT_SAMPLES);
  const status = entry.slowStreak >= check.failureThreshold ? "slow" : "up";
  if (entry.status !== status) setStatus(entry, status, now);
  return events;
}

/**
 * 记录探测时读到的证书到期时间。剩余天数每跌破一档（warnDays、7、3、1）提醒一次；
 * 证书换新后到期时间变化，提醒档位随之重置。
 */
export function recordCertificates(state, certificates, { now, warnDays }) {
  const levels = [...new Set([warnDays, 7, 3, 1])].filter((level) => level <= warnDays).sort((a, b) => b - a);
  const events = [];
  for (const { host, expiresAt } of certificates) {
    const previous = state.certificates[host];
    const record = previous?.expiresAt === expiresAt ? previous : { expiresAt, warnedLevel: null };
    record.checkedAt = now;
    state.certificates[host] = record;

    const daysLeft = daysUntil(expiresAt, now);
    const level = levels.filter((candidate) => daysLeft <= candidate).at(-1);
    if (level !== undefined && (record.warnedLevel === null || level < record.warnedLevel)) {
      record.warnedLevel = level;
      events.push({ type: "certificate", host, expiresAt, daysLeft });
    }
  }
  return events;
}

// 配置改动后收尾：关掉已删除检查项留下的未结束事件，丢掉不再探测的域名证书。
export function reconcile(state, checks, now) {
  const known = new Set(checks.map((check) => check.id));
  for (const incident of state.incidents) {
    if (incident.resolvedAt === null && !known.has(incident.checkId)) incident.resolvedAt = now;
  }
  for (const [host, record] of Object.entries(state.certificates)) {
    if (now - record.checkedAt > CERTIFICATE_RETENTION_MS) delete state.certificates[host];
  }
}

export function createStore({ dataDir, logger }) {
  const file = path.join(dataDir, "state.json");
  return {
    file,
    async load() {
      await mkdir(dataDir, { recursive: true });
      let content;
      try {
        content = await readFile(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return createState();
        throw error;
      }
      try {
        const parsed = JSON.parse(content);
        if (parsed?.version !== 1 || typeof parsed.checks !== "object" || !Array.isArray(parsed.incidents)) throw new Error("unexpected shape");
        return { ...createState(), ...parsed };
      } catch (error) {
        // 历史数据坏了不应该让监控起不来：留一份原件供排查，从空状态继续。
        const quarantine = `${file}.corrupt-${Date.now()}`;
        await rename(file, quarantine);
        logger.error("state_unreadable", { message: error.message, movedTo: quarantine });
        return createState();
      }
    },
    async save(state) {
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(state));
      await rename(temporary, file);
    },
  };
}
