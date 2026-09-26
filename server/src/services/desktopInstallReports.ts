import { z } from "zod";
import { prisma } from "../prisma";
import { getChinaDayRange } from "./adminStats";
import { runWithDistributedLock } from "./cache";
import { compareVersions, dateKeys, parseIosClientStatsRange, type IosClientStatsRange } from "./iosClientStats";

const DAY_MS = 24 * 60 * 60 * 1000;

// Reports are anonymous: no install id, account or IP is stored, only what is
// needed to see why the Windows installer fails on which machines.
const versionToken = z.string().trim().min(1).max(32).regex(/^[\w.+-]+$/);
const freeText = (max: number) => z.string().max(max).nullable().optional();

export const DESKTOP_INSTALL_STAGES = ["lock", "close-running", "stage", "swap", "rollback", "shortcuts", "registry", "elevate", "unknown"] as const;

export const desktopInstallReportSchema = z.object({
  appVersion: versionToken,
  previousVersion: versionToken.nullable().optional(),
  osRelease: z.string().trim().min(1).max(40).regex(/^[\w.() -]+$/),
  arch: z.enum(["x64", "arm64", "ia32"]),
  mode: z.enum(["install", "upgrade", "auto-update"]),
  elevated: z.boolean(),
  // retried = succeeded only after transient-error retries; elevated = succeeded via the admin retry.
  outcome: z.enum(["failed", "retried", "elevated"]),
  stage: z.enum(DESKTOP_INSTALL_STAGES),
  errorCode: z.string().trim().min(1).max(24).regex(/^[\w.+-]+$/).nullable().optional(),
  fileName: freeText(160),
  message: freeText(600),
  // Security product names are mostly Chinese, so no ASCII-only token here.
  antivirus: z.array(z.string().max(40)).max(12).default([]),
  retries: z.number().int().min(0).max(100_000),
  durationMs: z.number().int().min(0).max(3_600_000),
});

export type DesktopInstallReport = z.infer<typeof desktopInstallReportSchema>;

// The client already replaces the home directory with "~"; this catches paths
// it missed (other drives, other accounts, forward slashes, 8.3 names). The
// account segment may contain spaces, so it runs to the next separator.
const USER_PROFILE_PATH = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/'"\r\n]+/gi;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

export function scrubInstallText(value: string | null | undefined, max: number) {
  if (value == null) return null;
  const text = value.replace(USER_PROFILE_PATH, "%USERPROFILE%").replace(CONTROL_CHARS, " ").replace(/ {2,}/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeAntivirus(names: string[]) {
  const cleaned = names.map((name) => name.replace(CONTROL_CHARS, " ").trim()).filter(Boolean);
  return [...new Set(cleaned)].slice(0, 12);
}

export function desktopInstallReportData(input: DesktopInstallReport) {
  return {
    appVersion: input.appVersion,
    previousVersion: input.previousVersion ?? null,
    osRelease: input.osRelease,
    arch: input.arch,
    mode: input.mode,
    elevated: input.elevated,
    outcome: input.outcome,
    stage: input.stage,
    errorCode: input.errorCode ?? null,
    fileName: scrubInstallText(input.fileName, 160),
    message: scrubInstallText(input.message, 600),
    antivirus: JSON.stringify(normalizeAntivirus(input.antivirus)),
    retries: input.retries,
    durationMs: input.durationMs,
  };
}

export async function recordDesktopInstallReport(input: DesktopInstallReport) {
  await prisma.desktopInstallReport.create({ data: desktopInstallReportData(input) });
}

// ---------- Admin summary ----------

export type DesktopInstallReportRange = IosClientStatsRange;
export const parseDesktopInstallReportRange = parseIosClientStatsRange;

const RANGE_DAYS: Record<Exclude<DesktopInstallReportRange, "all">, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
const TREND_DAYS: Record<DesktopInstallReportRange, number> = { "1d": 14, "7d": 14, "30d": 30, "90d": 90, all: 90 };

export const NO_ANTIVIRUS_LABEL = "未检测到";
export const NO_ERROR_CODE_LABEL = "无错误码";

/** "10.0.22631" → "Windows 11"; Windows 11 still reports 10.0 and is told apart by build 22000+. */
export function windowsFamily(osRelease: string) {
  const match = /^10\.0\.(\d+)/.exec(osRelease);
  if (!match) return "其他";
  return Number(match[1]) >= 22000 ? "Windows 11" : "Windows 10";
}

export function parseAntivirus(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

export type DesktopInstallReportRow = {
  outcome: string;
  stage: string;
  errorCode: string | null;
  antivirus: string;
  appVersion: string;
  osRelease: string;
  createdAt: Date;
};

type GroupCount = { key: string; count: number; failed: number };

/** Groups count every report; `failed` is the subset the installer could not recover from. */
export function summarizeDesktopInstallReports(rows: DesktopInstallReportRow[]) {
  const outcomes = { failed: 0, retried: 0, elevated: 0 };
  const groups = { errorCode: new Map<string, GroupCount>(), stage: new Map<string, GroupCount>(), antivirus: new Map<string, GroupCount>(), appVersion: new Map<string, GroupCount>(), windows: new Map<string, GroupCount>() };
  const bump = (map: Map<string, GroupCount>, key: string, failed: boolean) => {
    const entry = map.get(key) ?? { key, count: 0, failed: 0 };
    entry.count += 1;
    if (failed) entry.failed += 1;
    map.set(key, entry);
  };
  for (const row of rows) {
    if (row.outcome === "failed" || row.outcome === "retried" || row.outcome === "elevated") outcomes[row.outcome] += 1;
    const failed = row.outcome === "failed";
    bump(groups.errorCode, row.errorCode || NO_ERROR_CODE_LABEL, failed);
    bump(groups.stage, row.stage, failed);
    bump(groups.appVersion, row.appVersion, failed);
    bump(groups.windows, windowsFamily(row.osRelease), failed);
    const products = parseAntivirus(row.antivirus);
    for (const product of products.length ? new Set(products) : [NO_ANTIVIRUS_LABEL]) bump(groups.antivirus, product, failed);
  }
  const sorted = (map: Map<string, GroupCount>) => [...map.values()].sort((a, b) => b.count - a.count || b.failed - a.failed || a.key.localeCompare(b.key));
  return {
    reports: rows.length,
    byOutcome: outcomes,
    byErrorCode: sorted(groups.errorCode),
    byStage: sorted(groups.stage),
    byAntivirus: sorted(groups.antivirus),
    byAppVersion: sorted(groups.appVersion).sort((a, b) => compareVersions(a.key, b.key)),
    byWindows: sorted(groups.windows),
  };
}

/** Failed vs recovered (retried + elevated) reports per China day. */
export function desktopInstallTrend(rows: Pick<DesktopInstallReportRow, "outcome" | "createdAt">[], dates: string[]) {
  const index = new Map(dates.map((date, position) => [date, position]));
  const failed = dates.map(() => 0);
  const recovered = dates.map(() => 0);
  for (const row of rows) {
    const position = index.get(getChinaDayRange(row.createdAt).dateKey);
    if (position === undefined) continue;
    if (row.outcome === "failed") failed[position] += 1;
    else recovered[position] += 1;
  }
  return { dates, failed, recovered };
}

export async function getDesktopInstallReports(range: DesktopInstallReportRange, now = new Date()) {
  const since = range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
  const trend = dateKeys(TREND_DAYS[range], now);
  const trendStart = getChinaDayRange(new Date(now.getTime() - (trend.length - 1) * DAY_MS)).start;
  // One query covers both the range summary and the (possibly longer) trend window.
  const fetchFrom = since && new Date(Math.min(since.getTime(), trendStart.getTime()));
  const [rows, allTime, recent] = await Promise.all([
    prisma.desktopInstallReport.findMany({
      where: fetchFrom ? { createdAt: { gte: fetchFrom } } : {},
      select: { outcome: true, stage: true, errorCode: true, antivirus: true, appVersion: true, osRelease: true, createdAt: true },
    }),
    prisma.desktopInstallReport.count(),
    prisma.desktopInstallReport.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const inRange = since ? rows.filter((row) => row.createdAt >= since) : rows;
  return {
    range,
    totals: { allTime },
    ...summarizeDesktopInstallReports(inRange),
    trend: desktopInstallTrend(rows.filter((row) => row.createdAt >= trendStart), trend),
    recent: recent.map((row) => ({ ...row, antivirus: parseAntivirus(row.antivirus), windows: windowsFamily(row.osRelease) })),
  };
}

// ---------- Retention ----------

export const DESKTOP_INSTALL_REPORT_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let prunePollerStarted = false;

export async function pruneDesktopInstallReports(now = new Date()) {
  const cutoff = new Date(now.getTime() - DESKTOP_INSTALL_REPORT_RETENTION_DAYS * DAY_MS);
  const { count } = await prisma.desktopInstallReport.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { reports: count };
}

export function startDesktopInstallReportPrunePoller() {
  if (prunePollerStarted) return;
  prunePollerStarted = true;
  const tick = () => {
    runWithDistributedLock("desktop-install-reports:prune", 10 * 60_000, async () => pruneDesktopInstallReports()).catch((error) => {
      console.warn("[desktop-install-reports] prune failed", error);
    });
  };
  setTimeout(tick, 90_000);
  setInterval(tick, PRUNE_INTERVAL_MS);
}
