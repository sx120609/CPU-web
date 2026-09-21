import type { ScheduleAdjustment } from "./scheduleTermConfig";

type PublicHolidayRecord = {
  date?: unknown;
  name?: unknown;
  isOffDay?: unknown;
};

const API_BASE = "https://api.jiejiariapi.com/v1/holidays";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const cache = new Map<number, { expiresAt: number; records: PublicHolidayRecord[] }>();

export async function fetchPublicHolidayAdjustments(
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduleAdjustment[]> {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) return [];
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear || endYear - startYear > 2) return [];

  const records: PublicHolidayRecord[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const cached = cache.get(year);
    if (cached && cached.expiresAt > Date.now()) {
      records.push(...cached.records);
      continue;
    }
    try {
      const response = await fetchImpl(`${API_BASE}/${year}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) continue;
      const raw = await response.json() as Record<string, PublicHolidayRecord>;
      const parsed = Object.values(raw).filter((item) => item && typeof item === "object");
      cache.set(year, { expiresAt: Date.now() + CACHE_TTL_MS, records: parsed });
      records.push(...parsed);
    } catch {
      // A public calendar outage must never make the authenticated timetable unavailable.
    }
  }

  const seen = new Set<string>();
  return records
    .filter((item) => typeof item.date === "string" && DATE_PATTERN.test(item.date) && item.date >= startDate && item.date <= endDate && item.isOffDay === true)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .filter((item) => {
      const date = String(item.date);
      if (seen.has(date)) return false;
      seen.add(date);
      return true;
    })
    .map((item) => ({
      date: String(item.date),
      kind: "off" as const,
      note: `${String(item.name || "法定节假日")}（公开节假日）`.slice(0, 80),
    }));
}

export function clearPublicHolidayCache() {
  cache.clear();
}

/** Explicit admin preview only; no writes and no partial results on upstream failure. */
export async function previewPublicHolidays(startDate: string, weekCount: number, fetchImpl: typeof fetch = fetch) {
  const start = new Date(`${startDate}T00:00:00Z`);
  if (!DATE_PATTERN.test(startDate) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startDate || start.getUTCDay() !== 1 || !Number.isInteger(weekCount) || weekCount < 1 || weekCount > 64) {
    throw new Error("请填写有效的第一周周一和总周数（1-64）");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + weekCount * 7 - 1);
  const endDate = end.toISOString().slice(0, 10);
  const adjustments: ScheduleAdjustment[] = [];
  const sources: string[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    const url = `${API_BASE}/${year}`;
    sources.push(url);
    let raw: unknown;
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error();
      raw = await response.json();
    } catch { throw new Error(`${year} 年公开节假日数据获取失败，请稍后重试`); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.keys(raw).length) throw new Error(`${year} 年公开节假日数据尚未发布或格式异常`);
    for (const [key, value] of Object.entries(raw)) {
      const row = value as PublicHolidayRecord | null;
      if (!row || typeof row.date !== "string" || row.date !== key || !DATE_PATTERN.test(row.date) || !row.date.startsWith(`${year}-`) || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || typeof row.isOffDay !== "boolean" || typeof row.name !== "string") throw new Error(`${year} 年公开节假日数据格式异常`);
      if (row.date < startDate || row.date > endDate) continue;
      // This provider also lists observances (e.g. 小年). Only statutory-holiday
      // weekend workdays represent makeup-day candidates, never every false row.
      const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      if (!row.isOffDay && (!/^(元旦|春节|清明节|劳动节|端午节|中秋节|国庆节)$/u.test(row.name) || (weekday !== 0 && weekday !== 6))) continue;
      adjustments.push({ date: row.date, kind: row.isOffDay ? "off" : "swap", note: `${row.name}（公开节假日）`.slice(0, 80) });
    }
  }
  return { startDate, endDate, sources, adjustments: adjustments.sort((a, b) => a.date.localeCompare(b.date)) };
}
