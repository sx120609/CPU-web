import { z } from "zod";
import { prisma } from "../prisma";
import { getChinaDayRange } from "./adminStats";
import { cleanDeviceLabel } from "./androidClientStats";
import { runWithDistributedLock } from "./cache";
import { RANGE_DAYS, TREND_DAYS, bump, compareVersions, dateKeys, flagCounts, sortedCounts, type IosClientStatsRange } from "./iosClientStats";

const DAY_MS = 24 * 60 * 60 * 1000;

// `deviceInfo.brand`, compared in lower case. Unknown brands are shown as reported.
const BRAND_NAMES: Record<string, string> = { huawei: "华为", honor: "荣耀" };

// `deviceInfo.deviceType`.
const DEVICE_TYPE_NAMES: Record<string, string> = {
  phone: "手机", default: "手机", tablet: "平板", "2in1": "二合一", pc: "电脑", wearable: "手表", tv: "智慧屏", car: "车机",
};

const SCHEDULE_STYLE_NAMES: Record<string, string> = {
  classic: "经典", minimal: "简约", grid: "格子", table: "表格", paper: "素笺", board: "站牌",
};

export function harmonyBrandName(brand: string) {
  return BRAND_NAMES[brand.toLowerCase()] ?? brand;
}

export function harmonyDeviceTypeName(type: string) {
  return DEVICE_TYPE_NAMES[type.toLowerCase()] ?? type;
}

export function harmonyScheduleStyleName(style: string) {
  return SCHEDULE_STYLE_NAMES[style] ?? style;
}

const token = (max: number) => z.string().trim().min(1).max(max).regex(/^[\w.,() -]+$/);
const label = (max: number) => z.string().max(200).transform((value) => cleanDeviceLabel(value, max));
const optionalFlag = z.boolean().nullable().optional();

export const harmonyClientHeartbeatSchema = z.object({
  installId: z.string().uuid(),
  deviceBrand: label(40),
  deviceModel: label(60),
  deviceType: label(24),
  // "6.0.0(20)" style display version of the system.
  systemVersion: label(40),
  apiVersion: z.number().int().min(1).max(999),
  appVersion: token(24),
  appBuild: token(24),
  appearanceMode: z.enum(["system", "light", "dark"]).nullable().optional(),
  scheduleStyle: token(24).nullable().optional(),
  schedulePalette: token(24).nullable().optional(),
  customBackground: optionalFlag,
  // Whether any week-view display setting differs from its default.
  customDisplay: optionalFlag,
});

export type HarmonyClientHeartbeat = z.infer<typeof harmonyClientHeartbeatSchema>;

export async function recordHarmonyClientHeartbeat(input: HarmonyClientHeartbeat, userId: number | null, now = new Date()) {
  // A state the client could not read this time (null / missing) keeps the
  // last known value instead of turning back into "unknown".
  const known = <T>(value: T | null | undefined) => value ?? undefined;
  const fields = {
    deviceBrand: input.deviceBrand,
    deviceModel: input.deviceModel,
    deviceType: input.deviceType,
    systemVersion: input.systemVersion,
    apiVersion: input.apiVersion,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
    lastSeenAt: now,
    appearanceMode: known(input.appearanceMode),
    scheduleStyle: known(input.scheduleStyle),
    schedulePalette: known(input.schedulePalette),
    customBackground: known(input.customBackground),
    customDisplay: known(input.customDisplay),
  };
  const date = getChinaDayRange(now).dateKey;
  const version = { appVersion: input.appVersion, appBuild: input.appBuild };
  // A signed-out launch keeps the last known account; only a signed-in
  // heartbeat may move the install to another user.
  await prisma.$transaction([
    prisma.harmonyClientInstall.upsert({
      where: { installId: input.installId },
      create: { installId: input.installId, userId, firstSeenAt: now, ...fields },
      update: userId ? { ...fields, userId } : fields,
    }),
    prisma.harmonyClientDailyActive.upsert({
      where: { date_installId: { date, installId: input.installId } },
      create: { date, installId: input.installId, ...version },
      update: version,
    }),
  ]);
}

export type HarmonyClientInstallRow = {
  deviceBrand: string;
  deviceModel: string;
  deviceType: string;
  systemVersion: string;
  apiVersion: number;
  appVersion: string;
  appBuild: string;
  userId: number | null;
  appearanceMode?: string | null;
  scheduleStyle?: string | null;
  schedulePalette?: string | null;
  customBackground?: boolean | null;
  customDisplay?: boolean | null;
};

const MODEL_LIMIT = 30;

export function summarizeHarmonyClientInstalls(rows: HarmonyClientInstallRow[]) {
  const models = new Map<string, number>();
  const modelBrands = new Map<string, string>();
  const types = new Map<string, number>();
  const versions = new Map<string, number>();
  const systems = new Map<string, number>();
  const apis = new Map<string, number>();
  const appearance = new Map<string, number>();
  const styles = new Map<string, number>();
  const palettes = new Map<string, number>();
  const users = new Set<number>();
  for (const row of rows) {
    bump(models, row.deviceModel);
    modelBrands.set(row.deviceModel, row.deviceBrand);
    bump(types, row.deviceType.toLowerCase());
    bump(versions, `${row.appVersion} (${row.appBuild})`);
    // "6.0.0(20)", "HarmonyOS 6.0.0.115" and "HarmonyOS NEXT 5.0.1" count by major.minor.
    bump(systems, /(\d+)\.(\d+)/.exec(row.systemVersion)?.slice(1, 3).join(".") ?? row.systemVersion);
    bump(apis, String(row.apiVersion));
    bump(appearance, row.appearanceMode ?? "unknown");
    bump(styles, row.scheduleStyle ?? "unknown");
    bump(palettes, row.schedulePalette ?? "unknown");
    if (row.userId) users.add(row.userId);
  }
  const modelRows = sortedCounts(models);
  const byVersionDesc = (map: Map<string, number>) => sortedCounts(map)
    .sort((a, b) => Number(a.key === "unknown") - Number(b.key === "unknown") || compareVersions(a.key, b.key))
    .map(({ key, count }) => ({ version: key, count }));
  return {
    installs: rows.length,
    signedInUsers: users.size,
    byDeviceType: sortedCounts(types).map(({ key, count }) => ({ type: key, name: harmonyDeviceTypeName(key), count })),
    byDeviceModel: modelRows.slice(0, MODEL_LIMIT).map(({ key, count }) => ({ deviceModel: key, brand: harmonyBrandName(modelBrands.get(key) ?? ""), count })),
    otherDeviceModels: {
      models: Math.max(0, modelRows.length - MODEL_LIMIT),
      count: modelRows.slice(MODEL_LIMIT).reduce((sum, row) => sum + row.count, 0),
    },
    byAppVersion: sortedCounts(versions).sort((a, b) => compareVersions(a.key, b.key)).map(({ key, count }) => ({ version: key, count })),
    bySystemVersion: byVersionDesc(systems),
    byApiVersion: byVersionDesc(apis),
    features: {
      appearanceMode: sortedCounts(appearance).map(({ key, count }) => ({ mode: key, count })),
      scheduleStyle: sortedCounts(styles).map(({ key, count }) => ({ style: key, name: harmonyScheduleStyleName(key), count })),
      schedulePalette: sortedCounts(palettes).map(({ key, count }) => ({ palette: key, count })),
      customBackground: flagCounts(rows.map((row) => row.customBackground ?? null)),
      customDisplay: flagCounts(rows.map((row) => row.customDisplay ?? null)),
    },
  };
}

export async function getHarmonyClientStats(range: IosClientStatsRange, now = new Date()) {
  const since = range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
  const where = since ? { lastSeenAt: { gte: since } } : {};
  const trend = dateKeys(TREND_DAYS[range], now);
  const trendStart = getChinaDayRange(new Date(now.getTime() - (trend.length - 1) * DAY_MS)).start;
  const [rows, total, active1d, active7d, active30d, recent, activeByDate, versionByDate, newInstalls] = await Promise.all([
    prisma.harmonyClientInstall.findMany({
      where,
      select: {
        deviceBrand: true, deviceModel: true, deviceType: true, systemVersion: true, apiVersion: true, appVersion: true, appBuild: true,
        userId: true, appearanceMode: true, scheduleStyle: true, schedulePalette: true, customBackground: true, customDisplay: true,
      },
    }),
    prisma.harmonyClientInstall.count(),
    prisma.harmonyClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    prisma.harmonyClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.harmonyClientInstall.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.harmonyClientInstall.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: {
        deviceBrand: true, deviceModel: true, deviceType: true, systemVersion: true, appVersion: true, appBuild: true,
        firstSeenAt: true, lastSeenAt: true,
        user: { select: { id: true, nickname: true, username: true } },
      },
    }),
    prisma.harmonyClientDailyActive.groupBy({ by: ["date"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.harmonyClientDailyActive.groupBy({ by: ["date", "appVersion"], where: { date: { in: trend } }, _count: { _all: true } }),
    prisma.harmonyClientInstall.findMany({ where: { firstSeenAt: { gte: trendStart } }, select: { firstSeenAt: true } }),
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

  return {
    range,
    totals: { allTime: total, active1d, active7d, active30d },
    ...summarizeHarmonyClientInstalls(rows),
    trend: {
      dates: trend,
      active: trend.map((date) => activeMap.get(date) ?? 0),
      newInstalls: trend.map((date) => newByDate.get(date) ?? 0),
      versions: versionSeries,
    },
    recent: recent.map((row) => ({ ...row, brandName: harmonyBrandName(row.deviceBrand), typeName: harmonyDeviceTypeName(row.deviceType) })),
  };
}

// ---------- Retention ----------

export const HARMONY_CLIENT_STATS_RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let prunePollerStarted = false;

/**
 * Drops daily activity older than the retention window. One row per install
 * stays, so the device distribution and cumulative install count are unaffected.
 */
export async function pruneHarmonyClientStats(now = new Date()) {
  const cutoffDate = getChinaDayRange(new Date(now.getTime() - HARMONY_CLIENT_STATS_RETENTION_DAYS * DAY_MS)).dateKey;
  const dailyActive = await prisma.harmonyClientDailyActive.deleteMany({ where: { date: { lt: cutoffDate } } });
  return { dailyActive: dailyActive.count };
}

export function startHarmonyClientStatsPrunePoller() {
  if (prunePollerStarted) return;
  prunePollerStarted = true;
  const tick = () => {
    runWithDistributedLock("harmony-client-stats:prune", 10 * 60_000, async () => pruneHarmonyClientStats()).catch((error) => {
      console.warn("[harmony-client-stats] prune failed", error);
    });
  };
  setTimeout(tick, 100_000);
  setInterval(tick, PRUNE_INTERVAL_MS);
}
