import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { getChinaDayRange } from "./adminStats";
import { runWithDistributedLock } from "./cache";
import { RANGE_DAYS, TREND_DAYS, bump, compareVersions, dateKeys, flagCounts, sortedCounts, type IosClientStatsRange } from "./iosClientStats";

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_PACKAGE = "cn.lizmt.cpuweb.";

// `Build.BRAND`, compared in lower case. Unknown brands are shown as reported.
const BRAND_NAMES: Record<string, string> = {
  huawei: "华为", honor: "荣耀", xiaomi: "小米", redmi: "Redmi", poco: "POCO", oppo: "OPPO", oneplus: "一加", realme: "realme",
  vivo: "vivo", iqoo: "iQOO", samsung: "三星", meizu: "魅族", google: "Google", nubia: "努比亚", zte: "中兴", lenovo: "联想",
  motorola: "摩托罗拉", sony: "索尼", nothing: "Nothing", blackshark: "黑鲨", smartisan: "坚果", asus: "华硕", hisense: "海信",
};

export function androidBrandName(brand: string) {
  return BRAND_NAMES[brand.toLowerCase()] ?? brand;
}

// Short class names of the five widget providers in the Android manifest.
const WIDGET_NAMES: Record<string, string> = {
  ScheduleWidgetProvider: "临近课程 2×2",
  ScheduleWidgetProviderWide: "当前/接下来 4×2",
  ScheduleWidgetProviderTodayWide: "今日课程 4×2",
  ScheduleWidgetProviderTodayLarge: "今日课程 4×4",
  ScheduleWidgetProviderLarge: "两日课表 4×4",
};

const SCHEDULE_STYLE_NAMES: Record<string, string> = {
  classic: "经典", minimal: "简约", grid: "格子", table: "表格", paper: "素笺", board: "站牌",
};

export function androidWidgetName(kind: string) {
  return WIDGET_NAMES[kind] ?? kind;
}

export function androidScheduleStyleName(style: string) {
  return SCHEDULE_STYLE_NAMES[style] ?? style;
}

/**
 * Brand, model and system strings come from the vendor's `Build` fields, which
 * are not limited to a known alphabet. Odd characters are dropped rather than
 * rejecting the report, so one unusual device never goes uncounted.
 */
export function cleanDeviceLabel(value: string, max: number) {
  return value.replace(/[^\w.,()+/ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() || "unknown";
}

const token = (max: number) => z.string().trim().min(1).max(max).regex(/^[\w.,() -]+$/);
const label = (max: number) => z.string().max(200).transform((value) => cleanDeviceLabel(value, max));
const optionalLabel = (max: number) => z.string().max(200).nullable().optional()
  .transform((value) => (value == null ? value : cleanDeviceLabel(value, max)));
const optionalFlag = z.boolean().nullable().optional();

export const androidClientHeartbeatSchema = z.object({
  installId: z.string().uuid(),
  deviceBrand: label(40),
  deviceModel: label(60),
  systemVersion: label(24),
  sdkInt: z.number().int().min(1).max(999),
  appVersion: token(24),
  appBuild: token(24),
  webViewVersion: optionalLabel(40),
  webViewPackage: optionalLabel(80),
  widgets: z.array(z.object({ kind: token(80) })).max(60).nullable().optional(),
  appearanceMode: z.enum(["system", "light", "dark"]).nullable().optional(),
  scheduleStyle: token(24).nullable().optional(),
  customBackground: optionalFlag,
  installPermission: optionalFlag,
});

export type AndroidClientHeartbeat = z.infer<typeof androidClientHeartbeatSchema>;

export async function recordAndroidClientHeartbeat(input: AndroidClientHeartbeat, userId: number | null, now = new Date()) {
  // A state the client could not read this time (null / missing) keeps the
  // last known value instead of turning back into "unknown".
  const known = <T>(value: T | null | undefined) => value ?? undefined;
  const fields = {
    deviceBrand: input.deviceBrand,
    deviceModel: input.deviceModel,
    systemVersion: input.systemVersion,
    sdkInt: input.sdkInt,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
    lastSeenAt: now,
    webViewVersion: known(input.webViewVersion),
    webViewPackage: known(input.webViewPackage),
    widgets: input.widgets ? JSON.stringify(input.widgets) : undefined,
    appearanceMode: known(input.appearanceMode),
    scheduleStyle: known(input.scheduleStyle),
    customBackground: known(input.customBackground),
    installPermission: known(input.installPermission),
  };
  const date = getChinaDayRange(now).dateKey;
  const version = { appVersion: input.appVersion, appBuild: input.appBuild };
  // A signed-out launch keeps the last known account; only a signed-in
  // heartbeat may move the install to another user.
  await prisma.$transaction([
    prisma.androidClientInstall.upsert({
      where: { installId: input.installId },
      create: { installId: input.installId, userId, firstSeenAt: now, ...fields },
      update: userId ? { ...fields, userId } : fields,
    }),
    prisma.androidClientDailyActive.upsert({
      where: { date_installId: { date, installId: input.installId } },
      create: { date, installId: input.installId, ...version },
      update: version,
    }),
  ]);
}

// ---------- Launch / exit metrics and diagnostics ----------

// Names the client gives to `ApplicationExitInfo.getReason()` values.
export const ANDROID_EXIT_REASONS = [
  "unknown", "exitSelf", "signaled", "lowMemory", "crash", "crashNative", "anr", "initFailure", "permissionChange",
  "excessiveResource", "userRequested", "userStopped", "dependencyDied", "other", "freezer", "packageStateChange", "packageUpdated",
] as const;

type ExitReason = (typeof ANDROID_EXIT_REASONS)[number];

const exitCounts = z.object(Object.fromEntries(ANDROID_EXIT_REASONS.map((key) => [key, z.number().int().min(0).max(1_000_000).optional()])) as Record<ExitReason, z.ZodOptional<z.ZodNumber>>);
const count = z.number().int().min(0).max(10_000_000).default(0);

export const androidClientMetricsSchema = z.object({
  installId: z.string().uuid(),
  deviceBrand: label(40),
  deviceModel: label(60),
  systemVersion: label(24),
  reports: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    appVersion: token(24),
    appBuild: token(24),
    launchCount: count,
    launchMsAvg: z.number().min(0).max(600_000).nullable().optional(),
    rendererCrashes: count,
    rendererKills: count,
    exits: z.object({ foreground: exitCounts.default({}), background: exitCounts.default({}) }).default({}),
  })).max(40).default([]),
  diagnostics: z.array(z.object({
    kind: z.enum(["crash", "anr"]),
    appVersion: token(24),
    appBuild: token(24),
    occurredAt: z.string().datetime({ offset: true }),
    threadName: z.string().max(120).nullable().optional(),
    // The system's description of an ANR, e.g. "Input dispatching timed out".
    message: z.string().max(1000).nullable().optional(),
    stackTrace: z.string().max(200_000),
  })).max(20).default([]),
});

export type AndroidClientMetrics = z.infer<typeof androidClientMetricsSchema>;

/**
 * Frames of a Java stack trace or an ANR thread dump, innermost first. For a
 * chained exception the last "Caused by" block is the root cause, so its frames
 * are the ones that identify the fault.
 */
export function extractJavaFrames(stackTrace: string, limit = 30): string[] {
  const lines = stackTrace.split(/\r?\n/);
  let start = 0;
  lines.forEach((line, index) => { if (/^\s*Caused by: /.test(line)) start = index; });
  const frames: string[] = [];
  for (const line of lines.slice(start)) {
    const match = /^\s*at\s+(\S.*)$/.exec(line);
    if (match) frames.push(match[1].trim());
    if (frames.length >= limit) break;
  }
  return frames;
}

/** "java.lang.IllegalStateException: message" of the root cause. */
export function rootCauseLine(stackTrace: string) {
  const lines = stackTrace.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const causes = lines.filter((line) => line.startsWith("Caused by: "));
  const line = causes.length ? causes[causes.length - 1].slice("Caused by: ".length) : lines.find((item) => !item.startsWith("at ")) ?? "";
  return line.replace(/^Exception in thread "[^"]*"\s*/, "");
}

export function androidDiagnosticSummary(item: AndroidClientMetrics["diagnostics"][number]) {
  if (item.kind === "anr") return ["ANR", item.message?.trim()].filter(Boolean).join(" · ").slice(0, 600);
  const thread = item.threadName && item.threadName !== "main" ? `（线程 ${item.threadName}）` : "";
  return ((rootCauseLine(item.stackTrace) || "未捕获异常") + thread).slice(0, 600);
}

/**
 * Groups identical faults. Class and method names stay comparable across
 * builds while line numbers move, so the source position is left out; frames
 * of the app itself are preferred over the framework frames around them.
 */
export function androidDiagnosticSignature(kind: string, summary: string, frames: string[]) {
  const position = (frame: string) => frame.replace(/\(.*$/, "");
  const own = frames.filter((frame) => frame.startsWith(APP_PACKAGE));
  const key = (own.length ? own : frames).slice(0, 3).map(position).join("|");
  const reason = kind === "anr" ? "anr" : summary.split(/[:（]/)[0].trim();
  return createHash("sha256").update(`${kind}\n${reason}\n${key}`).digest("hex").slice(0, 24);
}

function formatExitDetail(exits: AndroidClientMetrics["reports"][number]["exits"]) {
  const both = (key: ExitReason) => (exits.foreground[key] ?? 0) + (exits.background[key] ?? 0);
  return {
    crashExits: both("crash"),
    nativeCrashExits: both("crashNative"),
    anrExits: both("anr"),
    // A visible process the system killed. Devices that do not report low
    // memory separately record the same kill as a plain signal.
    foregroundKills: (exits.foreground.lowMemory ?? 0) + (exits.foreground.signaled ?? 0) + (exits.foreground.excessiveResource ?? 0),
    exitDetail: JSON.stringify(exits),
  };
}

export async function recordAndroidClientMetrics(input: AndroidClientMetrics, now = new Date()) {
  const base = { installId: input.installId, deviceBrand: input.deviceBrand, deviceModel: input.deviceModel, systemVersion: input.systemVersion };
  // A device clock set ahead must not put rows into days that have not happened.
  const latestDate = getChinaDayRange(new Date(now.getTime() + DAY_MS)).dateKey;
  const reports = input.reports.filter((report) => report.date <= latestDate).map((report) => ({
    ...base,
    date: report.date,
    appVersion: report.appVersion,
    appBuild: report.appBuild,
    launchCount: report.launchCount,
    launchMsAvg: report.launchMsAvg ?? null,
    rendererCrashes: report.rendererCrashes,
    rendererKills: report.rendererKills,
    ...formatExitDetail(report.exits),
  }));
  const diagnostics = input.diagnostics.filter((item) => Date.parse(item.occurredAt) <= now.getTime() + DAY_MS).map((item) => {
    const summary = androidDiagnosticSummary(item);
    const frames = extractJavaFrames(item.stackTrace);
    return {
      ...base,
      fingerprint: createHash("sha256").update(`${input.installId}\n${item.kind}\n${item.occurredAt}\n${item.stackTrace}`).digest("hex"),
      kind: item.kind,
      appVersion: item.appVersion,
      appBuild: item.appBuild,
      signature: androidDiagnosticSignature(item.kind, summary, frames),
      summary,
      topFrames: JSON.stringify(frames.slice(0, 12)),
      stackTrace: item.stackTrace,
      occurredAt: new Date(item.occurredAt),
    };
  });
  // Uploads are retried until acknowledged, so both writes must be idempotent.
  const [savedReports, savedDiagnostics] = await Promise.all([
    reports.length ? prisma.androidClientMetricReport.createMany({ data: reports, skipDuplicates: true }) : { count: 0 },
    diagnostics.length ? prisma.androidClientDiagnostic.createMany({ data: diagnostics, skipDuplicates: true }) : { count: 0 },
  ]);
  return { reports: savedReports.count, diagnostics: savedDiagnostics.count };
}

// ---------- Admin summary ----------

export type AndroidClientInstallRow = {
  deviceBrand: string;
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  appBuild: string;
  userId: number | null;
  webViewVersion?: string | null;
  widgets?: string | null;
  appearanceMode?: string | null;
  scheduleStyle?: string | null;
  customBackground?: boolean | null;
  installPermission?: boolean | null;
};

const MODEL_LIMIT = 30;

function parseWidgets(value: string | null | undefined): { kind: string }[] | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.kind === "string") : null;
  } catch {
    return null;
  }
}

export function summarizeAndroidClientInstalls(rows: AndroidClientInstallRow[]) {
  const brands = new Map<string, number>();
  const brandLabels = new Map<string, string>();
  const models = new Map<string, number>();
  const modelBrands = new Map<string, string>();
  const versions = new Map<string, number>();
  const systems = new Map<string, number>();
  const webViews = new Map<string, number>();
  const appearance = new Map<string, number>();
  const styles = new Map<string, number>();
  const users = new Set<number>();
  const widgetKinds = new Map<string, { installs: number; count: number }>();
  let widgetReported = 0;
  let widgetInstalls = 0;
  for (const row of rows) {
    const brand = row.deviceBrand.toLowerCase();
    bump(brands, brand);
    if (!brandLabels.has(brand)) brandLabels.set(brand, row.deviceBrand);
    bump(models, row.deviceModel);
    modelBrands.set(row.deviceModel, row.deviceBrand);
    bump(versions, `${row.appVersion} (${row.appBuild})`);
    bump(systems, row.systemVersion.split(".")[0]);
    bump(webViews, row.webViewVersion ? row.webViewVersion.split(".")[0] : "unknown");
    bump(appearance, row.appearanceMode ?? "unknown");
    bump(styles, row.scheduleStyle ?? "unknown");
    if (row.userId) users.add(row.userId);
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
      }
    }
  }
  const modelRows = sortedCounts(models);
  const byVersionDesc = (map: Map<string, number>) => sortedCounts(map)
    .sort((a, b) => Number(a.key === "unknown") - Number(b.key === "unknown") || compareVersions(a.key, b.key))
    .map(({ key, count }) => ({ version: key, count }));
  return {
    installs: rows.length,
    signedInUsers: users.size,
    byBrand: sortedCounts(brands).map(({ key, count }) => ({ brand: key, name: androidBrandName(brandLabels.get(key) ?? key), count })),
    byDeviceModel: modelRows.slice(0, MODEL_LIMIT).map(({ key, count }) => ({ deviceModel: key, brand: androidBrandName(modelBrands.get(key) ?? ""), count })),
    // Android has thousands of model codes; the tail is one number, not a list.
    otherDeviceModels: {
      models: Math.max(0, modelRows.length - MODEL_LIMIT),
      count: modelRows.slice(MODEL_LIMIT).reduce((sum, row) => sum + row.count, 0),
    },
    byAppVersion: sortedCounts(versions).sort((a, b) => compareVersions(a.key, b.key)).map(({ key, count }) => ({ version: key, count })),
    bySystemVersion: byVersionDesc(systems),
    byWebView: byVersionDesc(webViews),
    features: {
      widgets: {
        reported: widgetReported,
        installsWithWidget: widgetInstalls,
        byKind: [...widgetKinds].map(([kind, value]) => ({ kind, name: androidWidgetName(kind), ...value })).sort((a, b) => b.installs - a.installs),
      },
      appearanceMode: sortedCounts(appearance).map(({ key, count }) => ({ mode: key, count })),
      scheduleStyle: sortedCounts(styles).map(({ key, count }) => ({ style: key, name: androidScheduleStyleName(key), count })),
      customBackground: flagCounts(rows.map((row) => row.customBackground ?? null)),
      installPermission: flagCounts(rows.map((row) => row.installPermission ?? null)),
    },
  };
}

export type AndroidClientMetricRow = {
  appVersion: string;
  appBuild: string;
  launchCount: number;
  launchMsAvg: number | null;
  rendererCrashes: number;
  rendererKills: number;
  crashExits: number;
  nativeCrashExits: number;
  anrExits: number;
  foregroundKills: number;
};

export type AndroidClientDiagnosticRow = { kind: string; appVersion: string; appBuild: string; installId: string };

export function summarizeAndroidStability(metrics: AndroidClientMetricRow[], diagnostics: AndroidClientDiagnosticRow[]) {
  type Bucket = {
    version: string; launches: number; launchMsTotal: number; launchSamples: number; rendererCrashes: number; rendererKills: number;
    crashExits: number; nativeCrashExits: number; anrExits: number; foregroundKills: number;
    crashReports: number; anrReports: number; crashInstalls: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (version: string) => {
    let entry = buckets.get(version);
    if (!entry) {
      entry = { version, launches: 0, launchMsTotal: 0, launchSamples: 0, rendererCrashes: 0, rendererKills: 0,
        crashExits: 0, nativeCrashExits: 0, anrExits: 0, foregroundKills: 0, crashReports: 0, anrReports: 0, crashInstalls: new Set() };
      buckets.set(version, entry);
    }
    return entry;
  };
  for (const row of metrics) {
    const entry = bucket(`${row.appVersion} (${row.appBuild})`);
    entry.launches += row.launchCount;
    if (row.launchMsAvg != null && row.launchCount > 0) { entry.launchMsTotal += row.launchMsAvg * row.launchCount; entry.launchSamples += row.launchCount; }
    entry.rendererCrashes += row.rendererCrashes;
    entry.rendererKills += row.rendererKills;
    entry.crashExits += row.crashExits;
    entry.nativeCrashExits += row.nativeCrashExits;
    entry.anrExits += row.anrExits;
    entry.foregroundKills += row.foregroundKills;
  }
  for (const row of diagnostics) {
    const entry = bucket(`${row.appVersion} (${row.appBuild})`);
    if (row.kind === "crash") { entry.crashReports += 1; entry.crashInstalls.add(row.installId); } else entry.anrReports += 1;
  }
  return [...buckets.values()].sort((a, b) => compareVersions(a.version, b.version)).map((entry) => ({
    version: entry.version,
    launches: entry.launches,
    launchMsAvg: entry.launchSamples ? Math.round(entry.launchMsTotal / entry.launchSamples) : null,
    crashExits: entry.crashExits,
    nativeCrashExits: entry.nativeCrashExits,
    // Crashes per hundred cold starts. Exit reasons only exist on Android 11+, so this is a lower bound.
    crashRate: entry.launches ? Math.round(((entry.crashExits + entry.nativeCrashExits) / entry.launches) * 10000) / 100 : null,
    anrExits: entry.anrExits,
    foregroundKills: entry.foregroundKills,
    rendererCrashes: entry.rendererCrashes,
    rendererKills: entry.rendererKills,
    crashReports: entry.crashReports,
    crashInstalls: entry.crashInstalls.size,
    anrReports: entry.anrReports,
  }));
}

function parseFrames(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getAndroidClientStats(range: IosClientStatsRange, now = new Date()) {
  const since = range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
  const where = since ? { lastSeenAt: { gte: since } } : {};
  const trend = dateKeys(TREND_DAYS[range], now);
  const trendStart = getChinaDayRange(new Date(now.getTime() - (trend.length - 1) * DAY_MS)).start;
  const sinceDate = since ? getChinaDayRange(since).dateKey : null;
  const [rows, total, active1d, active7d, active30d, recent, activeByDate, versionByDate, newInstalls, metrics, diagnostics, groups] = await Promise.all([
    prisma.androidClientInstall.findMany({
      where,
      select: {
        deviceBrand: true, deviceModel: true, systemVersion: true, appVersion: true, appBuild: true, userId: true, webViewVersion: true,
        widgets: true, appearanceMode: true, scheduleStyle: true, customBackground: true, installPermission: true,
      },
    }),
    prisma.androidClientInstall.count(),
    prisma.androidClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    prisma.androidClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.androidClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.androidClientInstall.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: {
        deviceBrand: true, deviceModel: true, systemVersion: true, appVersion: true, appBuild: true, webViewVersion: true,
        firstSeenAt: true, lastSeenAt: true,
        user: { select: { id: true, nickname: true, username: true } },
      },
    }),
    prisma.androidClientDailyActive.groupBy({ by: ["date"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.androidClientDailyActive.groupBy({ by: ["date", "appVersion"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.androidClientInstall.findMany({ where: { firstSeenAt: { gte: trendStart } }, select: { firstSeenAt: true } }),
    prisma.androidClientMetricReport.findMany({
      where: sinceDate ? { date: { gte: sinceDate } } : {},
      select: {
        appVersion: true, appBuild: true, launchCount: true, launchMsAvg: true, rendererCrashes: true, rendererKills: true,
        crashExits: true, nativeCrashExits: true, anrExits: true, foregroundKills: true,
      },
    }),
    prisma.androidClientDiagnostic.findMany({
      where: since ? { occurredAt: { gte: since } } : {},
      select: { kind: true, appVersion: true, appBuild: true, installId: true },
    }),
    prisma.androidClientDiagnostic.groupBy({
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

  const signatures = groups.map((group) => group.signature);
  const samples = signatures.length
    ? await prisma.androidClientDiagnostic.findMany({
      where: { signature: { in: signatures } },
      orderBy: { occurredAt: "desc" },
      distinct: ["signature"],
      select: { id: true, signature: true, summary: true, topFrames: true },
    })
    : [];
  const installsBySignature = new Map<string, Set<string>>();
  const versionsBySignature = new Map<string, Set<string>>();
  if (signatures.length) {
    const members = await prisma.androidClientDiagnostic.findMany({
      where: { signature: { in: signatures }, ...(since ? { occurredAt: { gte: since } } : {}) },
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
    ...summarizeAndroidClientInstalls(rows),
    trend: {
      dates: trend,
      active: trend.map((date) => activeMap.get(date) ?? 0),
      newInstalls: trend.map((date) => newByDate.get(date) ?? 0),
      versions: versionSeries,
    },
    stability: {
      byVersion: summarizeAndroidStability(metrics, diagnostics),
      groups: groups.map((group) => {
        const sample = samples.find((row) => row.signature === group.signature);
        return {
          signature: group.signature,
          kind: group.kind,
          count: group._count._all,
          installs: installsBySignature.get(group.signature)?.size ?? 0,
          versions: [...(versionsBySignature.get(group.signature) ?? [])].sort(compareVersions),
          lastSeenAt: group._max.occurredAt,
          summary: sample?.summary ?? "",
          topFrames: parseFrames(sample?.topFrames).slice(0, 6),
          sampleId: sample?.id ?? null,
        };
      }),
    },
    recent: recent.map((row) => ({ ...row, brandName: androidBrandName(row.deviceBrand) })),
  };
}

export async function getAndroidClientDiagnostic(id: string) {
  const row = await prisma.androidClientDiagnostic.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, brandName: androidBrandName(row.deviceBrand), topFrames: extractJavaFrames(row.stackTrace) };
}

// ---------- Retention ----------

export const ANDROID_CLIENT_STATS_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let prunePollerStarted = false;

/**
 * Drops daily activity, launch / exit reports and crash / ANR diagnostics older
 * than the retention window. One row per install stays, so the device
 * distribution and cumulative install count are unaffected.
 */
export async function pruneAndroidClientStats(now = new Date()) {
  const cutoff = new Date(now.getTime() - ANDROID_CLIENT_STATS_RETENTION_DAYS * DAY_MS);
  const cutoffDate = getChinaDayRange(cutoff).dateKey;
  const [dailyActive, metricReports, diagnostics] = await prisma.$transaction([
    prisma.androidClientDailyActive.deleteMany({ where: { date: { lt: cutoffDate } } }),
    prisma.androidClientMetricReport.deleteMany({ where: { date: { lt: cutoffDate } } }),
    prisma.androidClientDiagnostic.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
  ]);
  return { dailyActive: dailyActive.count, metricReports: metricReports.count, diagnostics: diagnostics.count };
}

export function startAndroidClientStatsPrunePoller() {
  if (prunePollerStarted) return;
  prunePollerStarted = true;
  const tick = () => {
    runWithDistributedLock("android-client-stats:prune", 10 * 60_000, async () => pruneAndroidClientStats()).catch((error) => {
      console.warn("[android-client-stats] prune failed", error);
    });
  };
  setTimeout(tick, 90_000);
  setInterval(tick, PRUNE_INTERVAL_MS);
}
