import { prisma } from "../prisma";
import { type CalendarResult } from "../services/jwxtParser";

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

  const rawPeriods = Array.isArray(value.periods) ? value.periods : [];
  if (!rawPeriods.length || rawPeriods.length > 30) throw new Error("节次数量必须是 1-30");
  const periods = rawPeriods.map((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const start = String(row.start ?? "").trim();
    const end = String(row.end ?? "").trim();
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start >= end) throw new Error(`第 ${index + 1} 节时间无效`);
    return { id: index + 1, name: String(row.name || `第${index + 1}节`).trim().slice(0, 24) || `第${index + 1}节`, start, end };
  });

  const rawAdjustments = Array.isArray(value.adjustments) ? value.adjustments : [];
  if (rawAdjustments.length > 200) throw new Error("一个学期最多配置 200 条调休");
  const seen = new Set<string>();
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
  periods: string;
  adjustments: string;
  timezone: string;
  note: string;
  version: number;
  updatedAt: Date;
}): ScheduleTermConfigValue {
  return {
    semester: row.semester,
    semesterStartMonday: row.semesterStartMonday,
    weekCount: row.weekCount,
    periods: JSON.parse(row.periods),
    adjustments: JSON.parse(row.adjustments),
    timezone: row.timezone,
    note: row.note,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getScheduleTermConfig(semester: string): Promise<ScheduleTermConfigValue | null> {
  if (!process.env.DATABASE_URL || !semester) return null;
  try {
    const row = await prisma.scheduleTermConfig.findUnique({ where: { semester } });
    return row ? scheduleTermConfigFromRow(row) : null;
  } catch {
    // A partially migrated development database should not make the upstream
    // timetable unavailable. The admin endpoint still surfaces write errors.
    return null;
  }
}

export async function listScheduleTermConfigs() {
  if (!process.env.DATABASE_URL) return [];
  const rows = await prisma.scheduleTermConfig.findMany({ orderBy: { semester: "desc" } });
  return rows.map(scheduleTermConfigFromRow);
}

export async function saveScheduleTermConfig(input: unknown) {
  const value = normalizeScheduleTermConfig(input);
  const current = await prisma.scheduleTermConfig.findUnique({ where: { semester: value.semester }, select: { version: true } });
  const row = await prisma.scheduleTermConfig.upsert({
    where: { semester: value.semester },
    create: {
      ...value,
      periods: JSON.stringify(value.periods),
      adjustments: JSON.stringify(value.adjustments),
      version: 1,
    },
    update: {
      semesterStartMonday: value.semesterStartMonday,
      weekCount: value.weekCount,
      periods: JSON.stringify(value.periods),
      adjustments: JSON.stringify(value.adjustments),
      timezone: value.timezone,
      note: value.note,
      version: (current?.version ?? 0) + 1,
    },
  });
  return scheduleTermConfigFromRow(row);
}

export function applyScheduleTermConfig(calendar: CalendarResult, config: ScheduleTermConfigValue | null, now = new Date()): CalendarResult {
  if (!config) return calendar;
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
    adjustments: config.adjustments,
    termConfig: config,
  } as CalendarResult;
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
