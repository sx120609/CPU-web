import { HISTORY_DAYS } from "./state.mjs";
import { daysUntil, recentDayKeys } from "./time.mjs";
import { buildHistory } from './history-view.mjs';

const INCIDENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS_SHOWN = 20;
// 一天里失败的探测不到这个比例算“短暂异常”，达到则算“中断”。
const OUTAGE_DAY_RATIO = 0.05;

export const STATUS_LABELS = { up: "正常", slow: "响应缓慢", down: "中断", unknown: "暂无数据" };

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function describeDay(date, bucket) {
  const total = bucket ? bucket.up + bucket.slow + bucket.down : 0;
  if (!total) return { date, level: "none", uptime: null, failed: 0, total: 0 };
  const level = bucket.down === 0 ? "up" : (bucket.down / total < OUTAGE_DAY_RATIO ? "partial" : "down");
  return { date, level, uptime: (total - bucket.down) / total, failed: bucket.down, total };
}

function describeCheck(check, entry, dayKeys, now) {
  const days = dayKeys.map((date) => describeDay(date, entry?.days[date]));
  const total = days.reduce((sum, day) => sum + day.total, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  // 监控停过一阵子时，停机前的状态不能继续当作现状展示。
  const staleAfterMs = Math.max(check.intervalSeconds * 3000, 5 * 60 * 1000);
  const fresh = entry?.lastKnownAt && now - entry.lastKnownAt <= staleAfterMs;
  const status = fresh ? entry.status : "unknown";
  return {
    status,
    days,
    id: check.id,
    name: check.name,
    description: check.description,
    critical: check.critical,
    // slow 状态带说明时是降级规则命中（如部分节点离线），否则是响应慢。
    statusLabel: (status === "slow" && entry.warning) || STATUS_LABELS[status],
    detail: fresh ? (entry.detail ?? "") : "",
    since: fresh ? entry.since : null,
    reason: status === "down" ? entry.reason : "",
    responseMs: status === "unknown" || status === "down" ? null : median(entry.recentMs),
    uptime: total ? (total - failed) / total : null,
  };
}

function describeOverall(checks) {
  const down = checks.filter((check) => check.status === "down");
  if (down.some((check) => check.critical)) return { status: "down", label: "主要服务中断" };
  if (down.length) return { status: "partial", label: "部分服务异常" };
  const slow = checks.filter((check) => check.status === "slow");
  if (slow.some((check) => check.statusLabel !== STATUS_LABELS.slow)) return { status: "partial", label: "部分服务降级" };
  if (slow.length) return { status: "partial", label: "部分服务响应缓慢" };
  if (checks.every((check) => check.status === "unknown")) return { status: "unknown", label: "暂无监测数据" };
  return { status: "up", label: "所有服务运行正常" };
}

// 状态页和 /api/status 共用的数据视图。只包含可以公开的内容，不带探测地址。
export function buildView(state, config, now) {
  const history = buildHistory(state, config, now);
  const dayKeys = recentDayKeys(now, config.timezone, HISTORY_DAYS);
  const groups = config.groups.map((group) => ({
    name: group.name,
    checks: group.checks.map((check) => ({ ...describeCheck(check, state.checks[check.id], dayKeys, now), history: history.checks[check.id] })),
  }));
  const checks = groups.flatMap((group) => group.checks);
  const sampleTimes = config.checks.map((check) => state.checks[check.id]?.lastSampleAt ?? 0);

  return {
    groups,
    overall: describeOverall(checks),
    title: config.title,
    siteName: config.siteName,
    siteUrl: config.siteUrl,
    timezone: config.timezone,
    historyDays: HISTORY_DAYS,
    historyAxis: { granularity: history.granularity, start: history.start, end: history.end },
    intervalSeconds: Math.min(...config.checks.map((check) => check.intervalSeconds)),
    updatedAt: Math.max(...sampleTimes) || null,
    release: state.release?.value ?? null,
    incidents: state.incidents
      .filter((incident) => incident.resolvedAt === null || now - incident.startedAt <= INCIDENT_WINDOW_MS)
      .slice(0, MAX_INCIDENTS_SHOWN)
      .map((incident) => ({
        name: incident.name,
        reason: incident.reason,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        durationMs: (incident.resolvedAt ?? now) - incident.startedAt,
      })),
    certificates: Object.entries(state.certificates)
      .map(([host, record]) => {
        const daysLeft = daysUntil(record.expiresAt, now);
        const level = daysLeft <= 3 ? "down" : (daysLeft <= config.certificateWarnDays ? "partial" : "up");
        return { host, daysLeft, level, expiresAt: record.expiresAt };
      })
      .sort((a, b) => a.expiresAt - b.expiresAt),
  };
}
