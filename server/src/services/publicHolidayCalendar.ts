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
