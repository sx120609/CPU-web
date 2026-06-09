import { getCachedJson, runWithDistributedLock, setCachedJson } from "./cache";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LOGIN_TTL_MS = 45 * DAY_MS;
const DAILY_LOGIN_LOCK_MS = 4_000;

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

function toLocalDateKey(input: Date) {
  return `${input.getFullYear()}-${pad2(input.getMonth() + 1)}-${pad2(input.getDate())}`;
}

function startOfLocalDay(input = new Date()) {
  const next = new Date(input);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(input: Date, delta: number) {
  const next = new Date(input);
  next.setDate(next.getDate() + delta);
  return next;
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

export async function recordAdminDailyLogin(userId: number, at = new Date()) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const dateKey = toLocalDateKey(at);
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

export async function listAdminDailyLoginSeries(days = 30, now = new Date()): Promise<AdminDailyLoginPoint[]> {
  const safeDays = Math.max(1, Math.min(90, Math.round(days)));
  const today = startOfLocalDay(now);
  const dateKeys = Array.from({ length: safeDays }, (_, index) => toLocalDateKey(addDays(today, index - (safeDays - 1))));
  const buckets = await Promise.all(dateKeys.map((dateKey) => getCachedJson<AdminDailyLoginBucket>(dailyLoginCacheKey(dateKey))));
  return dateKeys.map((dateKey, index) => {
    const bucket = normalizeBucket(buckets[index], dateKey);
    return { date: dateKey, count: bucket.count };
  });
}
