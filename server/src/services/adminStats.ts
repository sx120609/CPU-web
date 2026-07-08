import { prisma } from "../prisma";
import { getCachedJson, getEphemeralValue, runWithDistributedLock, setCachedJson, setEphemeralValue } from "./cache";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LOGIN_TTL_MS = 45 * DAY_MS;
const DAILY_LOGIN_LOCK_MS = 4_000;
const DAILY_LOGIN_BACKFILL_TTL_MS = 6 * 60 * 60 * 1000;
const DAILY_LOGIN_BACKFILL_LOCK_MS = 60_000;
const CHINA_TIME_ZONE = "Asia/Shanghai";
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

type AdminDailyLoginBucket = {
  date: string;
  count: number;
  userIds: number[];
  updatedAt: string;
};

export type AdminDailyLoginPoint = {
  date: string;
  count: number;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatChinaDateParts(input: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(input);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    ymd: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

function addDaysToDateKey(dateKey: string, delta: number) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + delta));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function recentDateKeys(days: number, now = new Date()) {
  const safeDays = Math.max(1, Math.min(90, Math.round(days)));
  const today = formatChinaDateParts(now).ymd;
  return Array.from({ length: safeDays }, (_, index) => addDaysToDateKey(today, index - (safeDays - 1)));
}

function getChinaDayRangeForDateKey(dateKey: string) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getChinaDayRange();
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - CHINA_UTC_OFFSET_MS);
  return {
    dateKey,
    start,
    end: new Date(start.getTime() + DAY_MS),
  };
}

export function getChinaDayRange(input = new Date()) {
  const parts = formatChinaDateParts(input);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - CHINA_UTC_OFFSET_MS);
  return {
    dateKey: parts.ymd,
    start,
    end: new Date(start.getTime() + DAY_MS),
  };
}

function dailyLoginCacheKey(dateKey: string) {
  return `admin:daily-login:${dateKey}`;
}

function normalizeBucket(raw: AdminDailyLoginBucket | null | undefined, dateKey: string) {
  const userIds = Array.isArray(raw?.userIds)
    ? raw!.userIds
        .map((item) => Number(item))
        .filter((item, index, list) => Number.isInteger(item) && item > 0 && list.indexOf(item) === index)
    : [];
  return {
    date: dateKey,
    count: userIds.length,
    userIds,
    updatedAt: String(raw?.updatedAt || "").trim() || new Date().toISOString(),
  } satisfies AdminDailyLoginBucket;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLoginAt(input: Date) {
  return input instanceof Date && !Number.isNaN(input.getTime()) ? input : new Date();
}

function normalizeClient(input: string | null | undefined) {
  const value = String(input ?? "").trim();
  return value || null;
}

async function writeAdminDailyLoginRow(userId: number, dateKey: string, at: Date, client?: string | null) {
  const clientValue = normalizeClient(client);
  await prisma.adminDailyLogin.upsert({
    where: {
      userId_dateKey: {
        userId,
        dateKey,
      },
    },
    create: {
      userId,
      dateKey,
      client: clientValue,
      firstLoginAt: at,
      lastLoginAt: at,
    },
    update: {
      lastLoginAt: at,
      ...(clientValue ? { client: clientValue } : {}),
    },
  });
}

async function writeAdminDailyLoginCache(userId: number, dateKey: string) {
  const cacheKey = dailyLoginCacheKey(dateKey);

  for (let attempt = 0; attempt < 4; attempt++) {
    const locked = await runWithDistributedLock(`admin-daily-login:${dateKey}`, DAILY_LOGIN_LOCK_MS, async () => {
      const current = normalizeBucket(await getCachedJson<AdminDailyLoginBucket>(cacheKey), dateKey);
      if (current.userIds.includes(userId)) return current;
      const next = normalizeBucket({
        ...current,
        userIds: [...current.userIds, userId],
        updatedAt: new Date().toISOString(),
      }, dateKey);
      await setCachedJson(cacheKey, next, DAILY_LOGIN_TTL_MS);
      return next;
    });
    if (locked.acquired) return locked.result;
    await delay(50 * (attempt + 1));
  }
}

export async function recordAdminDailyLogin(userId: number, at = new Date(), client?: string | null) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const loginAt = normalizeLoginAt(at);
  const dateKey = formatChinaDateParts(loginAt).ymd;

  await Promise.all([
    writeAdminDailyLoginRow(userId, dateKey, loginAt, client).catch((error) => {
      console.warn("[admin-stats] failed to write daily login row", error);
    }),
    writeAdminDailyLoginCache(userId, dateKey).catch((error) => {
      console.warn("[admin-stats] failed to write daily login cache", error);
    }),
  ]);
}

export async function backfillAdminDailyLoginsFromLastLogin(days = 30, now = new Date()) {
  const dateKeys = recentDateKeys(days, now);
  const today = dateKeys[dateKeys.length - 1] ?? formatChinaDateParts(now).ymd;
  const markerKey = `admin:daily-login-backfill:${today}:${dateKeys.length}`;
  if (await getEphemeralValue(markerKey)) return { skipped: true, count: 0 };

  const locked = await runWithDistributedLock(`admin-daily-login-backfill:${today}:${dateKeys.length}`, DAILY_LOGIN_BACKFILL_LOCK_MS, async () => {
    if (await getEphemeralValue(markerKey)) return { skipped: true, count: 0 };

    const firstRange = getChinaDayRangeForDateKey(dateKeys[0]);
    const lastRange = getChinaDayRangeForDateKey(today);
    const allowedDates = new Set(dateKeys);
    const rows = await prisma.user.findMany({
      where: {
        lastLoginAt: {
          gte: firstRange.start,
          lt: lastRange.end,
        },
      },
      select: {
        id: true,
        lastLoginAt: true,
        lastLoginClient: true,
      },
    });

    let count = 0;
    for (const row of rows) {
      if (!row.lastLoginAt) continue;
      const dateKey = formatChinaDateParts(row.lastLoginAt).ymd;
      if (!allowedDates.has(dateKey)) continue;
      await writeAdminDailyLoginRow(row.id, dateKey, row.lastLoginAt, row.lastLoginClient);
      count += 1;
    }

    await setEphemeralValue(markerKey, String(Date.now()), DAILY_LOGIN_BACKFILL_TTL_MS);
    return { skipped: false, count };
  });

  return locked.acquired ? locked.result ?? { skipped: true, count: 0 } : { skipped: true, count: 0 };
}

export async function listAdminDailyLoginSeries(days = 30, now = new Date()): Promise<AdminDailyLoginPoint[]> {
  const dateKeys = recentDateKeys(days, now);
  const dbCounts = new Map<string, number>();
  try {
    const rows = await prisma.adminDailyLogin.groupBy({
      by: ["dateKey"],
      where: { dateKey: { in: dateKeys } },
      _count: { _all: true },
    });
    rows.forEach((row) => {
      dbCounts.set(row.dateKey, row._count._all);
    });
  } catch (error) {
    console.warn("[admin-stats] failed to read daily login rows", error);
  }

  const buckets = await Promise.all(dateKeys.map((dateKey) => getCachedJson<AdminDailyLoginBucket>(dailyLoginCacheKey(dateKey))));
  return dateKeys.map((dateKey, index) => {
    const bucket = normalizeBucket(buckets[index], dateKey);
    return { date: dateKey, count: Math.max(dbCounts.get(dateKey) ?? 0, bucket.count) };
  });
}
