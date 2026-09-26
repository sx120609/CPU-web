import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { getChinaDayRange } from "./adminStats";
import { runWithDistributedLock } from "./cache";

const DAY_MS = 24 * 60 * 60 * 1000;

// Identifiers reported by `utsname.machine`. Unknown identifiers are shown raw,
// so a new device only needs an entry here to get a friendly name.
const DEVICE_NAMES: Record<string, string> = {
  "iPhone11,2": "iPhone XS",
  "iPhone11,4": "iPhone XS Max",
  "iPhone11,6": "iPhone XS Max",
  "iPhone11,8": "iPhone XR",
  "iPhone12,1": "iPhone 11",
  "iPhone12,3": "iPhone 11 Pro",
  "iPhone12,5": "iPhone 11 Pro Max",
  "iPhone12,8": "iPhone SE（第 2 代）",
  "iPhone13,1": "iPhone 12 mini",
  "iPhone13,2": "iPhone 12",
  "iPhone13,3": "iPhone 12 Pro",
  "iPhone13,4": "iPhone 12 Pro Max",
  "iPhone14,2": "iPhone 13 Pro",
  "iPhone14,3": "iPhone 13 Pro Max",
  "iPhone14,4": "iPhone 13 mini",
  "iPhone14,5": "iPhone 13",
  "iPhone14,6": "iPhone SE（第 3 代）",
  "iPhone14,7": "iPhone 14",
  "iPhone14,8": "iPhone 14 Plus",
  "iPhone15,2": "iPhone 14 Pro",
  "iPhone15,3": "iPhone 14 Pro Max",
  "iPhone15,4": "iPhone 15",
  "iPhone15,5": "iPhone 15 Plus",
  "iPhone16,1": "iPhone 15 Pro",
  "iPhone16,2": "iPhone 15 Pro Max",
  "iPhone17,1": "iPhone 16 Pro",
  "iPhone17,2": "iPhone 16 Pro Max",
  "iPhone17,3": "iPhone 16",
  "iPhone17,4": "iPhone 16 Plus",
  "iPhone17,5": "iPhone 16e",
  "iPhone18,1": "iPhone 17 Pro",
  "iPhone18,2": "iPhone 17 Pro Max",
  "iPhone18,3": "iPhone 17",
  "iPhone18,4": "iPhone Air",
};

export function iosDeviceName(model: string) {
  if (DEVICE_NAMES[model]) return DEVICE_NAMES[model];
  if (model === "arm64" || model === "x86_64" || model.startsWith("Simulator")) return "模拟器";
  return model;
}

const WIDGET_NAMES: Record<string, string> = {
  "cn.cputime.mobile.widget.upcoming": "临近课程",
  "cn.cputime.mobile.widget.today": "今日课表",
  "cn.cputime.mobile.widget.twoday": "两日课表",
};

const WIDGET_FAMILY_NAMES: Record<string, string> = {
  systemSmall: "小号",
  systemMedium: "中号",
  systemLarge: "大号",
  systemExtraLarge: "超大号",
  accessoryCircular: "锁屏圆形",
  accessoryRectangular: "锁屏矩形",
  accessoryInline: "锁屏单行",
};

export function iosWidgetName(kind: string) {
  return WIDGET_NAMES[kind] ?? kind;
}

export function iosWidgetFamilyName(family: string) {
  return WIDGET_FAMILY_NAMES[family] ?? family;
}

const token = (max: number) => z.string().trim().min(1).max(max).regex(/^[\w.,() -]+$/);
const optionalFlag = z.boolean().nullable().optional();

export const iosClientHeartbeatSchema = z.object({
  installId: z.string().uuid(),
  deviceModel: token(40),
  systemVersion: token(24),
  appVersion: token(24),
  appBuild: token(24),
  widgets: z.array(z.object({ kind: token(120), family: token(40) })).max(60).nullable().optional(),
  liveActivitySystemEnabled: optionalFlag,
  liveActivityAppEnabled: optionalFlag,
  notificationStatus: z.enum(["notDetermined", "denied", "authorized", "provisional", "ephemeral"]).nullable().optional(),
  watchPaired: optionalFlag,
  watchAppInstalled: optionalFlag,
});

export type IosClientHeartbeat = z.infer<typeof iosClientHeartbeatSchema>;

export async function recordIosClientHeartbeat(input: IosClientHeartbeat, userId: number | null, now = new Date()) {
  // A state the client could not read this time (null / missing) keeps the
  // last known value instead of turning back into "unknown".
  const known = <T>(value: T | null | undefined) => value ?? undefined;
  const fields = {
    deviceModel: input.deviceModel,
    systemVersion: input.systemVersion,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
    lastSeenAt: now,
    widgets: input.widgets ? JSON.stringify(input.widgets) : undefined,
    liveActivitySystemEnabled: known(input.liveActivitySystemEnabled),
    liveActivityAppEnabled: known(input.liveActivityAppEnabled),
    notificationStatus: known(input.notificationStatus),
    watchPaired: known(input.watchPaired),
    watchAppInstalled: known(input.watchAppInstalled),
  };
  const date = getChinaDayRange(now).dateKey;
  const version = { appVersion: input.appVersion, appBuild: input.appBuild };
  // A signed-out launch keeps the last known account; only a signed-in
  // heartbeat may move the install to another user.
  await prisma.$transaction([
    prisma.iosClientInstall.upsert({
      where: { installId: input.installId },
      create: { installId: input.installId, userId, firstSeenAt: now, ...fields },
      update: userId ? { ...fields, userId } : fields,
    }),
    prisma.iosClientDailyActive.upsert({
      where: { date_installId: { date, installId: input.installId } },
      create: { date, installId: input.installId, ...version },
      update: version,
    }),
  ]);
}

// ---------- MetricKit ----------

const EXIT_REASONS = [
  "normal", "abnormal", "memoryLimit", "memoryPressure", "watchdog", "badAccess", "illegalInstruction",
  "cpuResourceLimit", "suspendedWithLockedFile", "backgroundTaskAssertionTimeout",
] as const;

const exitCounts = z.object(Object.fromEntries(EXIT_REASONS.map((key) => [key, z.number().int().min(0).max(1_000_000).optional()])) as Record<(typeof EXIT_REASONS)[number], z.ZodOptional<z.ZodNumber>>);
const duration = z.number().min(0).max(3_600_000).nullable().optional();
const count = z.number().int().min(0).max(10_000_000).default(0);

export const iosClientMetricsSchema = z.object({
  installId: z.string().uuid(),
  deviceModel: token(40),
  systemVersion: token(24),
  appBinaryName: token(80).optional(),
  reports: z.array(z.object({
    appVersion: token(24),
    appBuild: token(24),
    systemVersion: token(40).optional(),
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
    launchCount: count,
    launchMsAvg: duration,
    resumeCount: count,
    resumeMsAvg: duration,
    hangCount: count,
    hangMsAvg: duration,
    exits: z.object({ foreground: exitCounts.default({}), background: exitCounts.default({}) }).default({}),
  })).max(30).default([]),
  diagnostics: z.array(z.object({
    kind: z.enum(["crash", "hang"]),
    appVersion: token(24),
    appBuild: token(24),
    systemVersion: token(40).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    exceptionType: z.number().int().nullable().optional(),
    exceptionCode: z.number().int().nullable().optional(),
    signal: z.number().int().nullable().optional(),
    terminationReason: z.string().max(1000).nullable().optional(),
    exceptionClassName: z.string().max(200).nullable().optional(),
    exceptionMessage: z.string().max(1000).nullable().optional(),
    hangDurationMs: duration,
    callStack: z.string().max(400_000),
  })).max(30).default([]),
});

export type IosClientMetrics = z.infer<typeof iosClientMetricsSchema>;

const MACH_EXCEPTIONS: Record<number, string> = {
  1: "EXC_BAD_ACCESS", 2: "EXC_BAD_INSTRUCTION", 3: "EXC_ARITHMETIC", 4: "EXC_EMULATION", 5: "EXC_SOFTWARE",
  6: "EXC_BREAKPOINT", 10: "EXC_CRASH", 11: "EXC_RESOURCE", 12: "EXC_GUARD",
};
const SIGNALS: Record<number, string> = {
  4: "SIGILL", 5: "SIGTRAP", 6: "SIGABRT", 8: "SIGFPE", 9: "SIGKILL", 10: "SIGBUS", 11: "SIGSEGV", 13: "SIGPIPE", 15: "SIGTERM",
};

type StackFrame = { binaryName: string; offset: number };

type RawFrame = { binaryName?: unknown; offsetIntoBinaryTextSegment?: unknown; subFrames?: unknown };

/** Frames of the attributed (crashing / main) thread, innermost first. */
export function extractTopFrames(callStack: string, limit = 30): StackFrame[] {
  let tree: { callStacks?: { threadAttributed?: boolean; callStackRootFrames?: RawFrame[] }[] };
  try { tree = JSON.parse(callStack); } catch { return []; }
  const stacks = Array.isArray(tree?.callStacks) ? tree.callStacks : [];
  const stack = stacks.find((item) => item?.threadAttributed) ?? stacks[0];
  const frames: StackFrame[] = [];
  let frame: RawFrame | undefined = Array.isArray(stack?.callStackRootFrames) ? stack.callStackRootFrames[0] : undefined;
  while (frame && frames.length < limit) {
    frames.push({ binaryName: String(frame.binaryName ?? "?"), offset: Number(frame.offsetIntoBinaryTextSegment) || 0 });
    frame = Array.isArray(frame.subFrames) ? (frame.subFrames[0] as RawFrame | undefined) : undefined;
  }
  return frames;
}

export function diagnosticSummary(item: IosClientMetrics["diagnostics"][number]) {
  if (item.kind === "hang") return `卡顿 ${Math.round((item.hangDurationMs ?? 0) / 100) / 10} 秒`;
  const exception = item.exceptionType != null ? MACH_EXCEPTIONS[item.exceptionType] ?? `EXC_${item.exceptionType}` : "";
  const signal = item.signal != null ? SIGNALS[item.signal] ?? `SIG${item.signal}` : "";
  const parts = [[exception, signal && `(${signal})`].filter(Boolean).join(" ")];
  if (item.exceptionClassName) parts.push(item.exceptionClassName);
  if (item.terminationReason) parts.push(item.terminationReason.slice(0, 160));
  return parts.filter(Boolean).join(" · ") || "崩溃";
}

/**
 * Groups identical faults. Offsets are only comparable within one build, so
 * the build is part of the signature; frames in the app binary are preferred
 * because a hang's innermost frames are usually the same system wait.
 */
export function diagnosticSignature(kind: string, appBuild: string, summary: string, frames: StackFrame[], appBinaryName?: string) {
  const own = appBinaryName ? frames.filter((frame) => frame.binaryName === appBinaryName) : [];
  const key = (own.length ? own : frames).slice(0, 3).map((frame) => `${frame.binaryName}+${frame.offset}`).join("|");
  const reason = kind === "hang" ? "hang" : summary.split(" · ")[0];
  return createHash("sha256").update(`${kind}\n${appBuild}\n${reason}\n${key}`).digest("hex").slice(0, 24);
}

function formatExitDetail(exits: IosClientMetrics["reports"][number]["exits"]) {
  const abnormal = (group: Partial<Record<(typeof EXIT_REASONS)[number], number>>) =>
    EXIT_REASONS.filter((key) => key !== "normal").reduce((sum, key) => sum + (group[key] ?? 0), 0);
  return {
    foregroundNormalExits: exits.foreground.normal ?? 0,
    foregroundAbnormalExits: abnormal(exits.foreground),
    backgroundNormalExits: exits.background.normal ?? 0,
    backgroundAbnormalExits: abnormal(exits.background),
    exitDetail: JSON.stringify(exits),
  };
}

export async function recordIosClientMetrics(input: IosClientMetrics) {
  const base = { installId: input.installId, deviceModel: input.deviceModel };
  const reports = input.reports.map((report) => ({
    ...base,
    appVersion: report.appVersion,
    appBuild: report.appBuild,
    systemVersion: report.systemVersion ?? input.systemVersion,
    periodStart: new Date(report.periodStart),
    periodEnd: new Date(report.periodEnd),
    launchCount: report.launchCount,
    launchMsAvg: report.launchMsAvg ?? null,
    resumeCount: report.resumeCount,
    resumeMsAvg: report.resumeMsAvg ?? null,
    hangCount: report.hangCount,
    hangMsAvg: report.hangMsAvg ?? null,
    ...formatExitDetail(report.exits),
  }));
  const diagnostics = input.diagnostics.map((item) => {
    const summary = diagnosticSummary(item);
    const frames = extractTopFrames(item.callStack);
    const message = item.exceptionMessage ? `\n${item.exceptionMessage}` : "";
    return {
      ...base,
      fingerprint: createHash("sha256").update(`${input.installId}\n${item.kind}\n${item.occurredAt}\n${item.callStack}`).digest("hex"),
      kind: item.kind,
      appVersion: item.appVersion,
      appBuild: item.appBuild,
      systemVersion: item.systemVersion ?? input.systemVersion,
      signature: diagnosticSignature(item.kind, item.appBuild, summary, frames, input.appBinaryName),
      summary: (summary + message).slice(0, 1200),
      topFrames: JSON.stringify(frames.slice(0, 12)),
      callStack: item.callStack,
      hangDurationMs: item.hangDurationMs == null ? null : Math.round(item.hangDurationMs),
      occurredAt: new Date(item.occurredAt),
    };
  });
  // Uploads are retried until acknowledged, so both writes must be idempotent.
  const [savedReports, savedDiagnostics] = await Promise.all([
    reports.length ? prisma.iosClientMetricReport.createMany({ data: reports, skipDuplicates: true }) : { count: 0 },
    diagnostics.length ? prisma.iosClientDiagnostic.createMany({ data: diagnostics, skipDuplicates: true }) : { count: 0 },
  ]);
  return { reports: savedReports.count, diagnostics: savedDiagnostics.count };
}

// ---------- Admin summary ----------

export type IosClientStatsRange = "1d" | "7d" | "30d" | "90d" | "all";

export function parseIosClientStatsRange(value: unknown): IosClientStatsRange {
  return value === "1d" || value === "7d" || value === "90d" || value === "all" ? value : "30d";
}

const RANGE_DAYS: Record<Exclude<IosClientStatsRange, "all">, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
const TREND_DAYS: Record<IosClientStatsRange, number> = { "1d": 14, "7d": 14, "30d": 30, "90d": 90, all: 90 };

type CountRow = { key: string; count: number };

function sortedCounts(rows: Map<string, number>): CountRow[] {
  return [...rows].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.\s()]+/).filter(Boolean).map((part) => Number(part) || 0);
  const pb = b.split(/[.\s()]+/).filter(Boolean).map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function flagCounts(values: (boolean | null)[]) {
  return {
    yes: values.filter((value) => value === true).length,
    no: values.filter((value) => value === false).length,
    unknown: values.filter((value) => value == null).length,
  };
}

export type IosClientInstallRow = {
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  appBuild: string;
  userId: number | null;
  widgets?: string | null;
  liveActivitySystemEnabled?: boolean | null;
  liveActivityAppEnabled?: boolean | null;
  notificationStatus?: string | null;
  watchPaired?: boolean | null;
  watchAppInstalled?: boolean | null;
};

function parseWidgets(value: string | null | undefined): { kind: string; family: string }[] | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.kind === "string" && typeof item.family === "string") : null;
  } catch {
    return null;
  }
}

export function summarizeIosClientInstalls(rows: IosClientInstallRow[]) {
  const models = new Map<string, number>();
  const versions = new Map<string, number>();
  const systems = new Map<string, number>();
  const users = new Set<number>();
  const widgetKinds = new Map<string, { installs: number; count: number }>();
  const widgetFamilies = new Map<string, number>();
  const notifications = new Map<string, number>();
  let widgetReported = 0;
  let widgetInstalls = 0;
  for (const row of rows) {
    bump(models, row.deviceModel);
    bump(versions, `${row.appVersion} (${row.appBuild})`);
    bump(systems, row.systemVersion.split(".").slice(0, 2).join("."));
    if (row.userId) users.add(row.userId);
    bump(notifications, row.notificationStatus ?? "unknown");
    const widgets = parseWidgets(row.widgets);
    if (widgets) {
      widgetReported += 1;
      if (widgets.length) widgetInstalls += 1;
      const seen = new Set<string>();
      for (const widget of widgets) {
        const entry = widgetKinds.get(widget.kind) ?? { installs: 0, count: 0 };
        entry.count += 1;
        if (!seen.has(widget.kind)) entry.installs += 1;
        seen.add(widget.kind);
        widgetKinds.set(widget.kind, entry);
        bump(widgetFamilies, widget.family);
      }
    }
  }
  return {
    installs: rows.length,
    signedInUsers: users.size,
    byDeviceModel: sortedCounts(models).map(({ key, count }) => ({ deviceModel: key, name: iosDeviceName(key), count })),
    byAppVersion: sortedCounts(versions).sort((a, b) => compareVersions(a.key, b.key)).map(({ key, count }) => ({ version: key, count })),
    bySystemVersion: sortedCounts(systems).sort((a, b) => compareVersions(a.key, b.key)).map(({ key, count }) => ({ version: key, count })),
    features: {
      widgets: {
        reported: widgetReported,
        installsWithWidget: widgetInstalls,
        byKind: [...widgetKinds].map(([kind, value]) => ({ kind, name: iosWidgetName(kind), ...value })).sort((a, b) => b.installs - a.installs),
        byFamily: sortedCounts(widgetFamilies).map(({ key, count }) => ({ family: key, name: iosWidgetFamilyName(key), count })),
      },
      liveActivitySystemEnabled: flagCounts(rows.map((row) => row.liveActivitySystemEnabled ?? null)),
      liveActivityAppEnabled: flagCounts(rows.map((row) => row.liveActivityAppEnabled ?? null)),
      notificationStatus: sortedCounts(notifications).map(({ key, count }) => ({ status: key, count })),
      watchPaired: flagCounts(rows.map((row) => row.watchPaired ?? null)),
      watchAppInstalled: flagCounts(rows.map((row) => row.watchAppInstalled ?? null)),
    },
  };
}

export function dateKeys(days: number, now: Date) {
  return Array.from({ length: days }, (_, index) => getChinaDayRange(new Date(now.getTime() - (days - 1 - index) * DAY_MS)).dateKey);
}

export type IosClientMetricRow = {
  appVersion: string;
  appBuild: string;
  launchCount: number;
  launchMsAvg: number | null;
  resumeCount: number;
  resumeMsAvg: number | null;
  hangCount: number;
  foregroundNormalExits: number;
  foregroundAbnormalExits: number;
  backgroundAbnormalExits: number;
};

export type IosClientDiagnosticRow = { kind: string; appVersion: string; appBuild: string; installId: string };

export function summarizeStability(metrics: IosClientMetricRow[], diagnostics: IosClientDiagnosticRow[]) {
  type Bucket = {
    version: string; launches: number; launchMsTotal: number; launchSamples: number; resumes: number; resumeMsTotal: number; resumeSamples: number;
    hangEvents: number; foregroundExits: number; foregroundAbnormalExits: number; backgroundAbnormalExits: number;
    crashes: number; hangReports: number; crashInstalls: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (version: string) => {
    let entry = buckets.get(version);
    if (!entry) {
      entry = { version, launches: 0, launchMsTotal: 0, launchSamples: 0, resumes: 0, resumeMsTotal: 0, resumeSamples: 0, hangEvents: 0,
        foregroundExits: 0, foregroundAbnormalExits: 0, backgroundAbnormalExits: 0, crashes: 0, hangReports: 0, crashInstalls: new Set() };
      buckets.set(version, entry);
    }
    return entry;
  };
  for (const row of metrics) {
    const entry = bucket(`${row.appVersion} (${row.appBuild})`);
    entry.launches += row.launchCount;
    if (row.launchMsAvg != null && row.launchCount > 0) { entry.launchMsTotal += row.launchMsAvg * row.launchCount; entry.launchSamples += row.launchCount; }
    entry.resumes += row.resumeCount;
    if (row.resumeMsAvg != null && row.resumeCount > 0) { entry.resumeMsTotal += row.resumeMsAvg * row.resumeCount; entry.resumeSamples += row.resumeCount; }
    entry.hangEvents += row.hangCount;
    entry.foregroundExits += row.foregroundNormalExits + row.foregroundAbnormalExits;
    entry.foregroundAbnormalExits += row.foregroundAbnormalExits;
    entry.backgroundAbnormalExits += row.backgroundAbnormalExits;
  }
  for (const row of diagnostics) {
    const entry = bucket(`${row.appVersion} (${row.appBuild})`);
    if (row.kind === "crash") { entry.crashes += 1; entry.crashInstalls.add(row.installId); } else entry.hangReports += 1;
  }
  return [...buckets.values()].sort((a, b) => compareVersions(a.version, b.version)).map((entry) => ({
    version: entry.version,
    launches: entry.launches,
    launchMsAvg: entry.launchSamples ? Math.round(entry.launchMsTotal / entry.launchSamples) : null,
    resumeMsAvg: entry.resumeSamples ? Math.round(entry.resumeMsTotal / entry.resumeSamples) : null,
    hangEvents: entry.hangEvents,
    foregroundExits: entry.foregroundExits,
    foregroundAbnormalExits: entry.foregroundAbnormalExits,
    foregroundAbnormalRate: entry.foregroundExits ? Math.round((entry.foregroundAbnormalExits / entry.foregroundExits) * 10000) / 100 : null,
    backgroundAbnormalExits: entry.backgroundAbnormalExits,
    crashes: entry.crashes,
    crashInstalls: entry.crashInstalls.size,
    hangReports: entry.hangReports,
  }));
}

export async function getIosClientStats(range: IosClientStatsRange, now = new Date()) {
  const since = range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
  const where = since ? { lastSeenAt: { gte: since } } : {};
  const trend = dateKeys(TREND_DAYS[range], now);
  const trendStart = getChinaDayRange(new Date(now.getTime() - (trend.length - 1) * DAY_MS)).start;
  const [rows, total, active1d, active7d, active30d, recent, activeByDate, versionByDate, newInstalls, metrics, diagnostics, groups] = await Promise.all([
    prisma.iosClientInstall.findMany({
      where,
      select: {
        deviceModel: true, systemVersion: true, appVersion: true, appBuild: true, userId: true, widgets: true,
        liveActivitySystemEnabled: true, liveActivityAppEnabled: true, notificationStatus: true, watchPaired: true, watchAppInstalled: true,
      },
    }),
    prisma.iosClientInstall.count(),
    prisma.iosClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    prisma.iosClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.iosClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.iosClientInstall.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: {
        deviceModel: true, systemVersion: true, appVersion: true, appBuild: true, firstSeenAt: true, lastSeenAt: true,
        user: { select: { id: true, nickname: true, username: true } },
      },
    }),
    prisma.iosClientDailyActive.groupBy({ by: ["date"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.iosClientDailyActive.groupBy({ by: ["date", "appVersion"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.iosClientInstall.findMany({ where: { firstSeenAt: { gte: trendStart } }, select: { firstSeenAt: true } }),
    prisma.iosClientMetricReport.findMany({
      where: since ? { periodEnd: { gte: since } } : {},
      select: {
        appVersion: true, appBuild: true, launchCount: true, launchMsAvg: true, resumeCount: true, resumeMsAvg: true, hangCount: true,
        foregroundNormalExits: true, foregroundAbnormalExits: true, backgroundAbnormalExits: true,
      },
    }),
    prisma.iosClientDiagnostic.findMany({
      where: since ? { occurredAt: { gte: since } } : {},
      select: { kind: true, appVersion: true, appBuild: true, installId: true },
    }),
    prisma.iosClientDiagnostic.groupBy({
      by: ["signature", "kind"],
      where: since ? { occurredAt: { gte: since } } : {},
      _count: { _all: true },
      _max: { occurredAt: true },
      orderBy: { _count: { signature: "desc" } },
      take: 30,
    }),
  ]);

  const newByDate = new Map<string, number>();
  for (const row of newInstalls) bump(newByDate, getChinaDayRange(row.firstSeenAt).dateKey);
  const activeMap = new Map(activeByDate.map((row) => [row.date, row._count._all]));

  // The four most used versions in the trend window get their own series.
  const versionTotals = new Map<string, number>();
  for (const row of versionByDate) bump(versionTotals, row.appVersion, row._count._all);
  const topVersions = sortedCounts(versionTotals).slice(0, 4).map((row) => row.key).sort((a, b) => compareVersions(a, b));
  const versionSeries = [...topVersions, ...(versionTotals.size > topVersions.length ? ["其他"] : [])].map((version) => ({
    version,
    counts: trend.map((date) => versionByDate
      .filter((row) => row.date === date && (version === "其他" ? !topVersions.includes(row.appVersion) : row.appVersion === version))
      .reduce((sum, row) => sum + row._count._all, 0)),
  }));

  const samples = groups.length
    ? await prisma.iosClientDiagnostic.findMany({
      where: { signature: { in: groups.map((group) => group.signature) } },
      orderBy: { occurredAt: "desc" },
      distinct: ["signature"],
      select: { id: true, signature: true, summary: true, topFrames: true, appVersion: true, appBuild: true },
    })
    : [];
  const installsBySignature = new Map<string, Set<string>>();
  const versionsBySignature = new Map<string, Set<string>>();
  if (groups.length) {
    const members = await prisma.iosClientDiagnostic.findMany({
      where: { signature: { in: groups.map((group) => group.signature) }, ...(since ? { occurredAt: { gte: since } } : {}) },
      select: { signature: true, installId: true, appVersion: true, appBuild: true },
    });
    for (const row of members) {
      installsBySignature.set(row.signature, (installsBySignature.get(row.signature) ?? new Set()).add(row.installId));
      versionsBySignature.set(row.signature, (versionsBySignature.get(row.signature) ?? new Set()).add(`${row.appVersion} (${row.appBuild})`));
    }
  }

  return {
    range,
    totals: { allTime: total, active1d, active7d, active30d },
    ...summarizeIosClientInstalls(rows),
    trend: {
      dates: trend,
      active: trend.map((date) => activeMap.get(date) ?? 0),
      newInstalls: trend.map((date) => newByDate.get(date) ?? 0),
      versions: versionSeries,
    },
    stability: {
      byVersion: summarizeStability(metrics, diagnostics),
      groups: groups.map((group) => {
        const sample = samples.find((row) => row.signature === group.signature);
        let topFrames: StackFrame[] = [];
        try { topFrames = JSON.parse(sample?.topFrames ?? "[]"); } catch { topFrames = []; }
        return {
          signature: group.signature,
          kind: group.kind,
          count: group._count._all,
          installs: installsBySignature.get(group.signature)?.size ?? 0,
          versions: [...(versionsBySignature.get(group.signature) ?? [])].sort(compareVersions),
          lastSeenAt: group._max.occurredAt,
          summary: sample?.summary ?? "",
          topFrames: topFrames.slice(0, 6),
          sampleId: sample?.id ?? null,
        };
      }),
    },
    recent: recent.map((row) => ({ ...row, deviceName: iosDeviceName(row.deviceModel) })),
  };
}

export async function getIosClientDiagnostic(id: string) {
  const row = await prisma.iosClientDiagnostic.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, deviceName: iosDeviceName(row.deviceModel), topFrames: extractTopFrames(row.callStack) };
}

// ---------- Retention ----------

export const IOS_CLIENT_STATS_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let prunePollerStarted = false;

/**
 * Drops daily activity, MetricKit reports and crash / hang diagnostics older
 * than the retention window. One row per install stays, so the device
 * distribution and cumulative install count are unaffected.
 */
export async function pruneIosClientStats(now = new Date()) {
  const cutoff = new Date(now.getTime() - IOS_CLIENT_STATS_RETENTION_DAYS * DAY_MS);
  const cutoffDate = getChinaDayRange(cutoff).dateKey;
  const [dailyActive, metricReports, diagnostics] = await prisma.$transaction([
    prisma.iosClientDailyActive.deleteMany({ where: { date: { lt: cutoffDate } } }),
    prisma.iosClientMetricReport.deleteMany({ where: { periodEnd: { lt: cutoff } } }),
    prisma.iosClientDiagnostic.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
  ]);
  return { dailyActive: dailyActive.count, metricReports: metricReports.count, diagnostics: diagnostics.count };
}

export function startIosClientStatsPrunePoller() {
  if (prunePollerStarted) return;
  prunePollerStarted = true;
  const tick = () => {
    runWithDistributedLock("ios-client-stats:prune", 10 * 60_000, async () => pruneIosClientStats()).catch((error) => {
      console.warn("[ios-client-stats] prune failed", error);
    });
  };
  setTimeout(tick, 60_000);
  setInterval(tick, PRUNE_INTERVAL_MS);
}
