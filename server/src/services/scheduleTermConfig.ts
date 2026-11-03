import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";
import { type CalendarResult } from "../services/jwxtParser";
import { DEFAULT_SCHOOL_ID } from "../schools/registry";

export type SchedulePeriod = {
  id: number;
  name: string;
  start: string;
  end: string;
};

export type ScheduleAdjustment = {
  date: string;
  kind: "off" | "swap";
  source?: string;
  note?: string;
};

export type ScheduleTermConfigValue = {
  semester: string;
  semesterStartMonday: string;
  weekCount: number;
  periods: SchedulePeriod[];
  adjustments: ScheduleAdjustment[];
  timezone: string;
  note: string;
  version: number;
  updatedAt?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function normalizeSchedulePeriods(input: unknown): SchedulePeriod[] {
  const raw = Array.isArray(input) ? input : [];
  if (!raw.length || raw.length > 30) throw new Error("节次数量必须是 1-30");
  const periods = raw.map((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const start = String(row.start ?? "").trim();
    const end = String(row.end ?? "").trim();
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start >= end) throw new Error(`第 ${index + 1} 节时间无效`);
    return { id: index + 1, name: String(row.name || `第${index + 1}节`).trim().slice(0, 24) || `第${index + 1}节`, start, end };
  });
  for (let index = 1; index < periods.length; index++) {
    if (periods[index].start < periods[index - 1].end) throw new Error("节次必须按时间有序且互不重叠");
  }
  return periods;
}

export function normalizeScheduleTermConfig(input: unknown): Omit<ScheduleTermConfigValue, "version" | "updatedAt"> {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const semester = String(value.semester ?? "").trim();
  const semesterStartMonday = String(value.semesterStartMonday ?? "").trim();
  const weekCount = Number(value.weekCount);
  const timezone = String(value.timezone ?? "Asia/Shanghai").trim();
  if (!semester || semester.length > 80) throw new Error("学期 ID 不能为空且不能超过 80 个字符");
  if (!DATE_PATTERN.test(semesterStartMonday) || dateWeekday(semesterStartMonday) !== 1) {
    throw new Error("第一周日期必须是有效的周一（YYYY-MM-DD）");
  }
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 64) throw new Error("总周数必须是 1-64 的整数");
  if (timezone !== "Asia/Shanghai") throw new Error("当前服务只支持 Asia/Shanghai");

  const periods = normalizeSchedulePeriods(value.periods);

  const rawAdjustments = Array.isArray(value.adjustments) ? value.adjustments : [];
  if (rawAdjustments.length > 200) throw new Error("一个学期最多配置 200 条调休");
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  const adjustments = rawAdjustments.map((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const date = String(row.date ?? "").trim();
    const kind = String(row.kind ?? "").trim() as ScheduleAdjustment["kind"];
    const source = String(row.source ?? "").trim();
    if (!DATE_PATTERN.test(date) || !isValidDate(date)) throw new Error(`调休日期无效：${date || "(空)"}`);
    if (seen.has(date)) throw new Error(`${date} 只能配置一次调休`);
    seen.add(date);
    if (kind !== "off" && kind !== "swap") throw new Error("调休类型只能是 off 或 swap");
    if (kind === "swap" && (!DATE_PATTERN.test(source) || !isValidDate(source))) {
      throw new Error(`${date} 是调课，必须填写上哪一天的课`);
    }
    if (kind === "swap" && source === date) throw new Error(`${date} 不能调到自己当天`);
    if (kind === "swap" && seenSources.has(source)) throw new Error(`${source} 只能被调到一个日期`);
    if (kind === "swap") seenSources.add(source);
    return {
      date,
      kind,
      ...(kind === "swap" ? { source } : {}),
      note: String(row.note ?? "").trim().slice(0, 80),
    };
  });

  return {
    semester,
    semesterStartMonday,
    weekCount,
    periods,
    adjustments,
    timezone,
    note: String(value.note ?? "").trim().slice(0, 500),
  };
}

export function scheduleTermConfigFromRow(row: {
  semester: string;
  semesterStartMonday: string;
  weekCount: number;
  adjustments: string;
  timezone: string;
  note: string;
  version: number;
  updatedAt: Date;
}, periods: SchedulePeriod[]): ScheduleTermConfigValue {
  return {
    semester: row.semester,
    semesterStartMonday: row.semesterStartMonday,
    weekCount: row.weekCount,
    periods,
    adjustments: JSON.parse(row.adjustments),
    timezone: row.timezone,
    note: row.note,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getScheduleTermConfig(semester: string, schoolId = DEFAULT_SCHOOL_ID): Promise<ScheduleTermConfigValue | null> {
  if (!process.env.DATABASE_URL || !semester) return null;
  try {
    const [row, periods] = await Promise.all([
      prisma.scheduleTermConfig.findUnique({ where: { schoolId_semester: { schoolId, semester } } }),
      getSchedulePeriods(prisma, schoolId),
    ]);
    return row ? scheduleTermConfigFromRow(row, periods) : null;
  } catch {
    // A partially migrated development database should not make the upstream
    // timetable unavailable. The admin endpoint still surfaces write errors.
    return null;
  }
}

export async function listScheduleTermConfigs(schoolId = DEFAULT_SCHOOL_ID) {
  if (!process.env.DATABASE_URL) return [];
  const [rows, periods] = await Promise.all([
    prisma.scheduleTermConfig.findMany({ where: { schoolId }, orderBy: { semester: "desc" } }),
    getSchedulePeriods(prisma, schoolId),
  ]);
  return rows.map((row) => scheduleTermConfigFromRow(row, periods));
}

/// 节次时间每所学校一套，各存在 SchedulePeriodConfig 的一行里。
export async function getSchedulePeriods(db: Prisma.TransactionClient = prisma, schoolId = DEFAULT_SCHOOL_ID): Promise<SchedulePeriod[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const row = await db.schedulePeriodConfig.findUnique({ where: { schoolId }, select: { periods: true } });
    return row ? (JSON.parse(row.periods) as SchedulePeriod[]) : [];
  } catch {
    return [];
  }
}

/// 只写节次时间，不碰任何学期。
export async function saveSchedulePeriods(input: unknown, schoolId = DEFAULT_SCHOOL_ID): Promise<SchedulePeriod[]> {
  const periods = normalizeSchedulePeriods(input);
  const encoded = JSON.stringify(periods);
  const current = await prisma.schedulePeriodConfig.findUnique({ where: { schoolId }, select: { version: true } });
  // 主键沿用旧的整数 id（药大那行是 1），新学校的行接在最大 id 后面。
  const nextId = current ? 0 : ((await prisma.schedulePeriodConfig.aggregate({ _max: { id: true } }))._max.id ?? 0) + 1;
  const row = await prisma.schedulePeriodConfig.upsert({
    where: { schoolId },
    create: { id: nextId, schoolId, periods: encoded, version: 1 },
    update: { periods: encoded, version: (current?.version ?? 0) + 1 },
  });
  return JSON.parse(row.periods) as SchedulePeriod[];
}

export async function saveScheduleTermConfig(input: unknown, schoolId = DEFAULT_SCHOOL_ID) {
  const value = normalizeScheduleTermConfig(input);
  const where = { schoolId_semester: { schoolId, semester: value.semester } };
  const current = await prisma.scheduleTermConfig.findUnique({ where, select: { version: true } });
  // 节次时间跟着这次保存一起更新，但落在这所学校那一行上，而不是这个学期里。
  const periods = await saveSchedulePeriods(value.periods, schoolId);
  const row = await prisma.scheduleTermConfig.upsert({
    where,
    create: {
      schoolId,
      semester: value.semester,
      semesterStartMonday: value.semesterStartMonday,
      weekCount: value.weekCount,
      adjustments: JSON.stringify(value.adjustments),
      timezone: value.timezone,
      note: value.note,
      version: 1,
    },
    update: {
      semesterStartMonday: value.semesterStartMonday,
      weekCount: value.weekCount,
      adjustments: JSON.stringify(value.adjustments),
      timezone: value.timezone,
      note: value.note,
      version: (current?.version ?? 0) + 1,
    },
  });
  return scheduleTermConfigFromRow(row, periods);
}

export function applyScheduleTermConfig(
  calendar: CalendarResult,
  config: ScheduleTermConfigValue | null,
  now = new Date(),
  publicAdjustments: readonly ScheduleAdjustment[] = [],
): CalendarResult {
  if (!config) {
    if (!publicAdjustments.length) return calendar;
    return { ...calendar, adjustments: mergeScheduleAdjustments(publicAdjustments, calendar.adjustments ?? []) } as CalendarResult;
  }
  const weeks = Array.from({ length: config.weekCount }, (_, index) => {
    const monday = addDays(config.semesterStartMonday, index * 7);
    const days = Array.from({ length: 7 }, (_, day) => addDays(monday, day));
    return { week: index + 1, days, monday, sunday: days[6] };
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return {
    ...calendar,
    semesterStart: config.semesterStartMonday,
    semesterEnd: weeks.at(-1)?.sunday ?? calendar.semesterEnd,
    weeks,
    currentWeek: weeks.find((item) => item.days.includes(today))?.week ?? 0,
    periods: config.periods,
    adjustments: mergeScheduleAdjustments(publicAdjustments, config.adjustments),
    termConfig: config,
  } as CalendarResult;
}

export function mergeScheduleAdjustments(
  publicAdjustments: readonly ScheduleAdjustment[],
  manualAdjustments: readonly ScheduleAdjustment[],
) {
  const manualDates = new Set(manualAdjustments.map((item) => item.date));
  return [
    ...publicAdjustments.filter((item) => !manualDates.has(item.date)),
    ...manualAdjustments,
  ].sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(value: string, count: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function isValidDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateWeekday(value: string) {
  if (!isValidDate(value)) return 0;
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
