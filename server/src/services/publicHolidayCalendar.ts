import { z } from "zod";
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

type ValidHolidayRecord = { date: string; name: string; isOffDay: boolean };

function parseHolidayRecords(raw: unknown, year: number, format: "api" | "holiday-cn"): ValidHolidayRecord[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("数据格式异常");
  let entries: [string, unknown][];
  if (format === "holiday-cn") {
    const data = raw as { year?: unknown; days?: unknown };
    if (data.year !== year || !Array.isArray(data.days)) throw new Error("年份或数据格式异常");
    entries = data.days.map((row) => [row?.date, row]);
  } else {
    entries = Object.entries(raw);
  }
  if (!entries.length) throw new Error("数据尚未发布");
  const seen = new Set<string>();
  return entries.map(([key, value]) => {
    const row = value as PublicHolidayRecord | null;
    if (!row || typeof row.date !== "string" || row.date !== key || !DATE_PATTERN.test(row.date) || !row.date.startsWith(`${year}-`) || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || typeof row.isOffDay !== "boolean" || typeof row.name !== "string" || !row.name.trim() || seen.has(row.date)) throw new Error("日期或数据格式异常");
    seen.add(row.date);
    return { date: row.date, name: row.name, isOffDay: row.isOffDay };
  });
}

async function fetchHolidayYear(year: number, fetchImpl: typeof fetch) {
  const providers = [
    { url: `${API_BASE}/${year}`, format: "api" as const },
    { url: `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, format: "holiday-cn" as const },
    { url: `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`, format: "holiday-cn" as const },
  ];
  for (const provider of providers) {
    try {
      const response = await fetchImpl(provider.url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = parseHolidayRecords(await response.json(), year, provider.format);
      return { source: provider.url, records };
    } catch (error) {
      console.warn("[public-holidays] source failed", provider.url, error instanceof Error ? error.message : "unknown error");
    }
  }
  throw new Error(`${year} 年公开节假日数据获取失败（已尝试主接口及两个备用源，数据可能尚未发布或格式异常），请稍后重试`);
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
  return previewHolidayRange(startDate, endDate, fetchImpl);
}

export async function previewAcademicYearHolidays(academicYear: number, fetchImpl: typeof fetch = fetch) {
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) throw new Error("学年起始年份必须是 2000-2100 的整数");
  return previewHolidayRange(`${academicYear}-09-01`, `${academicYear + 1}-07-31`, fetchImpl, true);
}

async function previewHolidayRange(startDate: string, endDate: string, fetchImpl: typeof fetch, allowMissingYears = false) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  const outcomes = await Promise.allSettled(years.map((year) => fetchHolidayYear(year, fetchImpl)));
  const results: Awaited<ReturnType<typeof fetchHolidayYear>>[] = [];
  const warnings: string[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else {
      if (!allowMissingYears) throw outcome.reason;
      warnings.push(`${years[index]} 年数据未获取（可能尚未发布或数据源不可用），当前预览不包含该年，请稍后重新导入补齐。`);
    }
  });
  if (!results.length) throw new Error(warnings.join(" "));
  const adjustments: ScheduleAdjustment[] = [];
  for (const { records } of results) {
    for (const row of records) {
      if (row.date < startDate || row.date > endDate) continue;
      // jiejiariapi also includes observances such as 小年, not makeup days.
      const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      if (!row.isOffDay && (!/^(元旦|春节|清明节|劳动节|端午节|中秋节|国庆节)$/u.test(row.name) || (weekday !== 0 && weekday !== 6))) continue;
      adjustments.push({ date: row.date, kind: row.isOffDay ? "off" : "swap", note: `${row.name}（公开节假日）`.slice(0, 80) });
    }
  }
  return { startDate, endDate, warnings, sources: results.map((result) => result.source), adjustments: adjustments.sort((a, b) => a.date.localeCompare(b.date)) };
}

// Cached admin clients may still send a semester range instead of an academic year.
export const holidayPreviewSchema = z.union([
  z.object({ academicYear: z.number().int().min(2000).max(2100) }).strict(),
  z.object({ semesterStartMonday: z.string().trim(), weekCount: z.number().int().min(1).max(64) }).strict(),
]);

export async function previewRequestedHolidays(input: z.infer<typeof holidayPreviewSchema>, fetchImpl: typeof fetch = fetch) {
  return "academicYear" in input
    ? previewAcademicYearHolidays(input.academicYear, fetchImpl)
    : previewPublicHolidays(input.semesterStartMonday, input.weekCount, fetchImpl);
}
