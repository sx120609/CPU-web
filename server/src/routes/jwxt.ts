import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { isCookieAuthRequest, updateBrowserSession } from "../services/browserSession";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ok, Errors } from "../utils/response";
import { validate } from "../middleware/validate";
import { authRequired } from "../middleware/auth";
import { prisma } from "../prisma";
import { getCacheVersion, getCachedJson, setCachedJson, withCache } from "../services/cache";
import { detectLoginClient } from "../utils/loginClient";
import { invalidateJwxtWidgetCaches } from "../services/cacheInvalidation";
import { buildRedisKey } from "../services/redis";
import { getSiteOrigin } from "../services/siteSettings";
import {
  parseGraduateSchedule,
  parseGraduateSchedulePayload,
  type GraduateSchedulePayload,
  type GraduateTermOption,
} from "../services/graduateScheduleParser";
import { normalizeGraduateSemesterLabel, type GraduateScheduleFetchResult } from "../services/graduateScheduleService";
import { I_SERVICE_ICON_PATH_PATTERN } from "../services/jwxtClient";
import {
  beginLogin,
  submitLogin,
  logout,
  getStatus,
  getSchedule,
  getGrades,
  getMidtermGrades,
  getExams,
  getCalendar,
  getProgress,
  getPyfa,
  getIApps,
  getIAppIcon,
  getGraduateSchedule,
  debugSnapshot,
  sessionStats,
  isRemoteMode,
} from "../services/jwxtTransport";

export const jwxtRouter = Router();

const SMALL_SLOTS = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
  { no: 5, start: "13:30", end: "14:15" },
  { no: 6, start: "14:25", end: "15:10" },
  { no: 7, start: "15:25", end: "16:10" },
  { no: 8, start: "16:20", end: "17:05" },
  { no: 9, start: "18:30", end: "19:15" },
  { no: 10, start: "19:25", end: "20:10" },
  { no: 11, start: "20:20", end: "21:05" },
];
const MAX_SMALL_SLOT = SMALL_SLOTS[SMALL_SLOTS.length - 1]?.no ?? 11;
const WIDGET_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWXT_STATUS_CACHE_TTL_MS = 60_000;
const JWXT_IDENTITY_CACHE_TTL_MS = 5 * 60_000;
const JWXT_SCHEDULE_CACHE_TTL_MS = 5 * 60_000;
const JWXT_GRADES_CACHE_TTL_MS = 30 * 60_000;
const JWXT_MIDTERM_CACHE_TTL_MS = 30 * 60_000;
const JWXT_EXAMS_CACHE_TTL_MS = 30 * 60_000;
const JWXT_CALENDAR_CACHE_TTL_MS = 24 * 60 * 60_000;
const JWXT_PROGRESS_CACHE_TTL_MS = 30 * 60_000;
const JWXT_PYFA_CACHE_TTL_MS = 6 * 60 * 60_000;
const JWXT_IAPPS_CACHE_TTL_MS = 60 * 60_000;
const JWXT_IAPP_ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const GRAD_SCHEDULE_DEBUG_BINDTERM_CANDIDATES = [
  path.resolve(process.cwd(), ".debug", "grad-bindterm.json"),
  path.resolve(process.cwd(), "server", ".debug", "grad-bindterm.json"),
];
const GRAD_SCHEDULE_DEBUG_PAYLOAD_CANDIDATES = [
  path.resolve(process.cwd(), ".debug", "grad-schedule-payloads.json"),
  path.resolve(process.cwd(), "server", ".debug", "grad-schedule-payloads.json"),
];
const GRAD_SCHEDULE_DEBUG_FIXTURE_CANDIDATES = [
  path.resolve(process.cwd(), ".debug", "grad-schedule.html"),
  path.resolve(process.cwd(), "server", ".debug", "grad-schedule.html"),
];

/**
 * 教务会话 token 取自 X-Jwxt-Token 头。
 * 该 token 与站内登录 token 完全独立 —— 站内可以未登录也用教务（但通常我们要求站内登录）。
 */
function getToken(req: any): string | null {
  return req.browserSession?.jwxtToken || (req.headers["x-jwxt-token"] as string) || null;
}

function jwxtTokenCacheId(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
}

async function readGraduateDebugFixture() {
  for (const filePath of GRAD_SCHEDULE_DEBUG_FIXTURE_CANDIDATES) {
    try {
      const [html, stat] = await Promise.all([
        fs.readFile(filePath, "utf8"),
        fs.stat(filePath),
      ]);
      if (html.trim()) {
        return {
          html,
          path: filePath,
          savedAt: stat.mtime.toISOString(),
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  throw Errors.badRequest("未找到研究生课表调试样例，请先抓取并保存 grad-schedule.html");
}

async function readGraduateDebugJson<T>(candidates: string[], missingMessage: string) {
  for (const filePath of candidates) {
    try {
      const [raw, stat] = await Promise.all([
        fs.readFile(filePath, "utf8"),
        fs.stat(filePath),
      ]);
      if (!raw.trim()) continue;
      return {
        data: JSON.parse(raw) as T,
        path: filePath,
        savedAt: stat.mtime.toISOString(),
      };
    } catch {
      /* try next candidate */
    }
  }
  throw Errors.badRequest(missingMessage);
}

async function readGraduateDebugBindterm() {
  return readGraduateDebugJson<{ terms?: GraduateTermOption[] }>(
    GRAD_SCHEDULE_DEBUG_BINDTERM_CANDIDATES,
    "未找到研究生学期列表调试样例，请先重新抓取 bindterm",
  );
}

async function readGraduateDebugPayloadBundle() {
  return readGraduateDebugJson<{
    items?: Array<{
      termcode?: string;
      termname?: string;
      selected?: boolean;
      payload?: GraduateSchedulePayload;
    }>;
  }>(
    GRAD_SCHEDULE_DEBUG_PAYLOAD_CANDIDATES,
    "未找到研究生课表 JSON 调试样例，请先重新抓取课表接口",
  );
}

function graduateParsedCourseEntryCount(parsed: any) {
  return (parsed?.cells ?? []).reduce(
    (sum: number, cell: any) => sum + (cell?.courses?.length ?? 0),
    0,
  );
}

async function buildGraduateDebugScheduleResponse(requestedSemester: string, requestedTermcode = "") {
  const [bindterm, payloadBundle] = await Promise.all([
    readGraduateDebugBindterm().catch(() => null),
    readGraduateDebugPayloadBundle().catch(() => null),
  ]);

  if (bindterm?.data?.terms?.length && payloadBundle?.data?.items?.length) {
    const terms: GraduateTermOption[] = bindterm.data.terms
      .map((item) => ({
        termcode: String(item?.termcode ?? "").trim(),
        termname: String(item?.termname ?? "").trim(),
        selected: Boolean(item?.selected),
      }))
      .filter((item) => item.termcode && item.termname);
    const normalizedRequestedSemester = normalizeGraduateSemesterLabel(requestedSemester);
    const initialTargetTerm = requestedTermcode
      ? terms.find((item) => item.termcode === requestedTermcode)
      : requestedSemester
        ? terms.find((item) => normalizeGraduateSemesterLabel(item.termname) === normalizedRequestedSemester)
        : terms.find((item) => item.selected) ?? terms[0];
    if (!initialTargetTerm) throw Errors.badRequest("未找到可用的研究生学期数据");
    let targetTerm: GraduateTermOption = initialTargetTerm;

    let payloadItem = payloadBundle.data.items.find((item) => String(item?.termcode ?? "").trim() === targetTerm.termcode);
    let parsed = payloadItem?.payload
      ? parseGraduateSchedulePayload(payloadItem.payload, terms, targetTerm.termcode)
      : null;

    if (!requestedSemester && !requestedTermcode && graduateParsedCourseEntryCount(parsed) <= 0) {
      let bestFallback: {
        term: GraduateTermOption;
        payloadItem: NonNullable<typeof payloadItem>;
        parsed: ReturnType<typeof parseGraduateSchedulePayload>;
        score: number;
      } | null = null;

      for (const candidate of payloadBundle.data.items) {
        const candidateTermcode = String(candidate?.termcode ?? "").trim();
        const candidateTerm = terms.find((item) => item.termcode === candidateTermcode);
        if (!candidateTerm || !candidate?.payload) continue;
        const nextParsed = parseGraduateSchedulePayload(candidate.payload, terms, candidateTerm.termcode);
        const nextScore = graduateParsedCourseEntryCount(nextParsed);
        if (nextScore <= 0) continue;
        if (!bestFallback || nextScore > bestFallback.score) {
          bestFallback = {
            term: candidateTerm,
            payloadItem: candidate,
            parsed: nextParsed,
            score: nextScore,
          };
        }
      }

      if (bestFallback) {
        targetTerm = bestFallback.term;
        payloadItem = bestFallback.payloadItem;
        parsed = bestFallback.parsed;
      }
    }

    if (!payloadItem?.payload) {
      throw Errors.badRequest(`当前本地还没有抓到「${targetTerm.termname}」的研究生课表数据，请先在研究生系统切到该学期后重新抓取。`);
    }

    return {
      parsed: parsed ?? parseGraduateSchedulePayload(payloadItem.payload, terms, targetTerm.termcode),
      source: {
        mode: "debug-fallback" as const,
        path: payloadBundle.path,
        savedAt: payloadBundle.savedAt,
        bindtermPath: bindterm.path,
        semester: targetTerm.termname,
        termcode: targetTerm.termcode,
      },
    };
  }

  const fixture = await readGraduateDebugFixture();
  const parsed = parseGraduateSchedule(fixture.html);
  if (requestedSemester && requestedSemester !== parsed.currentSemester) {
    throw Errors.badRequest(`当前本地只保存了「${parsed.currentSemester}」课表样例；请先去研究生系统切到「${requestedSemester}」后再重新抓取。`);
  }
  return {
    parsed,
    source: {
      mode: "debug-fallback" as const,
      path: fixture.path,
      savedAt: fixture.savedAt,
      semester: parsed.currentSemester,
    },
  };
}

async function loadGraduateScheduleResponse(
  token: string,
  requestedSemester: string,
  requestedTermcode: string,
) {
  try {
    return await getGraduateSchedule(token, {
      semester: requestedSemester || undefined,
      termcode: requestedTermcode || undefined,
    }) as GraduateScheduleFetchResult | Awaited<ReturnType<typeof buildGraduateDebugScheduleResponse>>;
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    return buildGraduateDebugScheduleResponse(requestedSemester, requestedTermcode);
  }
}

function hasUsableUndergraduateSchedule(parsed: any) {
  return Boolean(
    parsed?.currentSemester
    || (Array.isArray(parsed?.semesters) && parsed.semesters.length)
    || (Array.isArray(parsed?.cells) && parsed.cells.length)
  );
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function staleJwxtSessionError() {
  return Errors.unauthorized("教务会话已失效，请重新授权");
}

function isUnauthorizedReason(reason: any) {
  return Number(reason?.status || 0) === 401 || Number(reason?.code || 0) === 4001;
}

function assertUsableUndergraduateSchedule<T>(parsed: T): T {
  if (!hasUsableUndergraduateSchedule(parsed)) throw staleJwxtSessionError();
  return parsed;
}

function assertUsableGrades<T extends { semesters?: unknown[]; list?: unknown[] }>(parsed: T): T {
  if (!hasItems(parsed?.semesters) && !hasItems(parsed?.list)) throw staleJwxtSessionError();
  return parsed;
}

function assertUsableProgress<T extends { summary?: unknown[]; completed?: unknown[]; uncompleted?: unknown[]; totals?: Record<string, unknown> }>(parsed: T): T {
  const totals = parsed?.totals ?? {};
  const hasTotals = Object.values(totals).some((value) => Number(value) > 0);
  if (!hasItems(parsed?.summary) && !hasItems(parsed?.completed) && !hasItems(parsed?.uncompleted) && !hasTotals) {
    throw staleJwxtSessionError();
  }
  return parsed;
}

function assertUsablePyfa<T extends { list?: unknown[]; bySemester?: unknown[] }>(parsed: T): T {
  if (!hasItems(parsed?.list) && !hasItems(parsed?.bySemester)) throw staleJwxtSessionError();
  return parsed;
}

function assertUsableIdentity<T extends { capabilities?: { undergraduate?: boolean; graduate?: boolean } }>(payload: T): T {
  if (!payload?.capabilities?.undergraduate && !payload?.capabilities?.graduate) throw staleJwxtSessionError();
  return payload;
}

function graduateScheduleCourseCount(result: any) {
  return (result?.parsed?.cells ?? []).reduce(
    (sum: number, cell: any) => sum + (cell?.courses?.length ?? 0),
    0,
  );
}

function hasUsableGraduateSchedule(result: any) {
  return Boolean(
    graduateScheduleCourseCount(result)
    || (
      result?.parsed?.currentSemester
      && Array.isArray(result?.parsed?.semesters)
      && result.parsed.semesters.length
    )
  );
}

async function detectAcademicIdentity(token: string) {
  // 两个入口共享同一份 CookieJar。串行探测可避免并发请求各自写回旧 Cookie
  // 快照，同时确保可选的研究生入口失败不会破坏本科教务会话。
  const undergraduate = await getSchedule(token, {})
    .then((value) => assertUsableUndergraduateSchedule(value))
    .then((value) => ({ status: "fulfilled" as const, value }))
    .catch((reason) => ({ status: "rejected" as const, reason }));
  const graduate = await getGraduateSchedule(token, {})
    .then((value) => ({ status: "fulfilled" as const, value }))
    .catch((reason) => ({ status: "rejected" as const, reason }));

  const undergraduateAvailable = undergraduate.status === "fulfilled"
    && hasUsableUndergraduateSchedule(undergraduate.value);
  const graduateAvailable = graduate.status === "fulfilled"
    && hasUsableGraduateSchedule(graduate.value);
  const graduateReachable = graduate.status === "fulfilled";

  if (!undergraduateAvailable && !graduateAvailable && undergraduate.status === "rejected" && isUnauthorizedReason(undergraduate.reason)) {
    throw undergraduate.reason;
  }

  const identity = undergraduateAvailable
    ? "undergraduate"
    : graduateReachable
      ? "graduate"
      : "undergraduate";

  return {
    identity,
    source: undergraduateAvailable || graduateAvailable ? "detected" as const : "fallback" as const,
    capabilities: {
      undergraduate: undergraduateAvailable,
      graduate: graduateAvailable,
    },
  };
}

const scheduleEditCourseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  teacher: z.string().trim().max(80).optional(),
  weeks: z.string().trim().max(120),
  weekList: z.array(z.number().int().min(1).max(64)).max(64),
  location: z.string().trim().max(80).optional(),
  slotNote: z.string().trim().max(120).optional(),
  startSlot: z.number().int().min(1).max(20).optional(),
  endSlot: z.number().int().min(1).max(20).optional(),
});

const scheduleEditItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  sourceKey: z.string().trim().max(180).optional(),
  day: z.number().int().min(1).max(7),
  bigSlot: z.number().int().min(1).max(20),
  course: scheduleEditCourseSchema,
});

const scheduleEditStateSchema = z.object({
  hidden: z.array(z.string().trim().min(1).max(180)).max(1200),
  custom: z.array(scheduleEditItemSchema).max(1200),
});

const scheduleWidgetTokenSchema = z.object({
  name: z.string().trim().max(40).optional(),
});
const WIDGET_PAYLOAD_VERSION = 3;

function emptyScheduleEdits() {
  return { hidden: [] as string[], custom: [] as Array<z.infer<typeof scheduleEditItemSchema>> };
}

function normalizeScheduleEdits(input: unknown) {
  const parsed = scheduleEditStateSchema.parse(input);
  const hidden = Array.from(new Set(parsed.hidden.map((item) => item.trim()).filter(Boolean)));
  const custom = parsed.custom.map((item) => ({
    ...item,
    sourceKey: item.sourceKey?.trim() || undefined,
    course: {
      ...item.course,
      weekList: Array.from(new Set(item.course.weekList)).sort((a, b) => a - b),
      teacher: item.course.teacher?.trim() || undefined,
      location: item.course.location?.trim() || undefined,
      slotNote: item.course.slotNote?.trim() || undefined,
    },
  }));
  return { hidden, custom };
}

function ensureEditClient(req: any) {
  const client = detectLoginClient(req).client;
  if (client !== "android" && client !== "ios" && client !== "harmony") throw Errors.forbidden("课表编辑仅客户端可用");
}

function generateWidgetToken() {
  return `cpu_sched_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashWidgetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function absoluteWidgetEndpoint(req: any, token: string) {
  const configuredOrigin = getSiteOrigin();
  if (configuredOrigin) {
    return `${configuredOrigin}/api/jwxt/schedule-widget?token=${encodeURIComponent(token)}`;
  }
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const base = `${proto}://${host}`;
  return `${base}/api/jwxt/schedule-widget?token=${encodeURIComponent(token)}`;
}

function parseWidgetCache(payload?: string | null) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as any).strictDate !== true) return null;
    if ((parsed as any).payloadVersion !== WIDGET_PAYLOAD_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeSlotRange(bigSlot: number, course: any) {
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const start = Number.isFinite(course?.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course?.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(MAX_SMALL_SLOT, start));
  const safeEnd = Math.max(safeStart, Math.min(MAX_SMALL_SLOT, end));
  return { start: safeStart, end: safeEnd };
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function courseEditKey(day: number, bigSlot: number, course: any) {
  if (course?.customId) return `custom:${course.customId}`;
  return [
    "jwxt",
    day,
    bigSlot,
    course?.startSlot ?? "",
    course?.endSlot ?? "",
    normalizeKeyPart(course?.name),
    normalizeKeyPart(course?.teacher),
    normalizeKeyPart(course?.location),
    normalizeKeyPart(course?.weeks),
  ].join("|");
}

function applyScheduleEditsToCells(cells: any[], edits: z.infer<typeof scheduleEditStateSchema>) {
  const hidden = new Set(edits.hidden);
  const byCell = new Map<string, any[]>();
  for (const item of edits.custom) {
    const key = `${item.day}:${item.bigSlot}`;
    const list = byCell.get(key) ?? [];
    list.push({
      ...item.course,
      sourceKey: item.sourceKey,
      custom: true,
      customId: item.id,
    });
    byCell.set(key, list);
  }

  const merged = (cells ?? []).map((cell) => {
    const courses = (cell.courses ?? []).filter((course: any) => !hidden.has(courseEditKey(cell.day, cell.bigSlot, course)));
    const custom = byCell.get(`${cell.day}:${cell.bigSlot}`) ?? [];
    return { ...cell, courses: [...courses, ...custom] };
  });

  for (const [key, courses] of byCell.entries()) {
    const exists = merged.some((cell) => `${cell.day}:${cell.bigSlot}` === key);
    if (exists) continue;
    const [day, bigSlot] = key.split(":").map(Number);
    merged.push({ day, bigSlot, courses });
  }

  return merged.filter((cell) => cell.courses.length);
}

function normalizeWeekText(text?: string | null) {
  return String(text ?? "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－–—~～]/g, "-")
    .replace(/第/g, "")
    .replace(/\s+/g, "");
}

function parseWeekKind(text: string): "all" | "odd" | "even" {
  if (/单双周/.test(text)) return "all";
  if (/单周|\(单\)|[^双]单/.test(text)) return "odd";
  if (/双周|\(双\)|双/.test(text)) return "even";
  return "all";
}

function parseWeekText(text?: string | null) {
  const source = normalizeWeekText(text);
  if (!source) return [] as number[];
  const out = new Set<number>();
  const clauses = source.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);

  for (const clause of clauses.length ? clauses : [source]) {
    const kind = parseWeekKind(clause);
    const matches = [...clause.matchAll(/(\d{1,2})\s*(?:[-~至到]\s*(\d{1,2}))?/g)];
    for (const match of matches) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(64, Math.max(start, end));
      for (let i = min; i <= max; i += 1) {
        if (kind === "odd" && i % 2 === 0) continue;
        if (kind === "even" && i % 2 === 1) continue;
        out.add(i);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

function normalizedCourseWeekList(course: any) {
  const parsed = parseWeekText(course?.weeks);
  if (parsed.length) return parsed;
  return Array.isArray(course?.weekList)
    ? [...new Set<number>(course.weekList.map(Number).filter((week: number) => Number.isFinite(week) && week > 0))]
      .sort((a, b) => a - b)
    : [];
}

function courseMatchesWeek(course: any, week: number) {
  if (!week) return true;
  const list = normalizedCourseWeekList(course);
  return list.length ? list.includes(week) : true;
}

function chinaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return { year, month, day, ymd: `${value("year")}-${value("month")}-${value("day")}` };
}

function chinaDayOfWeek(parts = chinaDateParts()) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return d === 0 ? 7 : d;
}

function dayOfWeekForYmd(ymd: string) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

function addDaysToYmd(ymd: string, days: number) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function calendarWeekForDate(calendar: any | null, ymd: string) {
  for (const item of calendar?.weeks ?? []) {
    const days = normalizeCalendarDays(Array.isArray(item?.days) ? item.days : []);
    const index = days.indexOf(ymd);
    if (index >= 0) return { week: Number(item.week) || 0, day: index + 1 };
  }
  return { week: 0, day: 0 };
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function normalizeCalendarDays(calendarDays: string[]) {
  const raw = (calendarDays ?? []).map((item) => String(item || "").trim());
  if (raw.length >= 7 && dayOfWeekForYmd(raw[0]) === 7 && dayOfWeekForYmd(raw[1]) === 1) {
    return [...raw.slice(1, 7), addDaysToYmd(raw[6], 1)];
  }

  const normalized = Array.from({ length: 7 }, () => "");
  for (const date of raw) {
    const day = dayOfWeekForYmd(date);
    if (day >= 1 && day <= 7) normalized[day - 1] = date;
  }
  return normalized.some(Boolean) ? normalized : raw;
}

async function readScheduleEditsForWidget(userId: number, semester: string) {
  const row = await prisma.userScheduleEdit.findUnique({
    where: { userId_semester: { userId, semester: semester || "current" } },
    select: { payload: true },
  });
  if (!row?.payload && semester !== "current") {
    return readScheduleEditsForWidget(userId, "current");
  }
  if (!row?.payload) return emptyScheduleEdits();
  try {
    return normalizeScheduleEdits(JSON.parse(row.payload));
  } catch {
    return emptyScheduleEdits();
  }
}

function buildWidgetPayload(parsed: any, calendar: any | null, queryWeek?: string) {
  const today = chinaDateParts();
  const calendarToday = calendarWeekForDate(calendar, today.ymd);
  const calendarWeek = calendarToday.week || (calendar?.currentWeek ? Number(calendar.currentWeek) : 0);
  const week = Number(queryWeek || calendarToday.week || parsed?.currentWeek || calendarWeek || 0);
  const activeDay = queryWeek && Number(queryWeek) !== calendarToday.week
    ? 1
    : (calendarToday.day || chinaDayOfWeek(today));
  const rawCalendarDays = (calendar?.weeks ?? []).find((item: any) => Number(item.week) === week)?.days ?? [];
  const calendarDays = normalizeCalendarDays(rawCalendarDays);
  const cells = dedupeWidgetCourses((parsed?.cells ?? [])
    .flatMap((cell: any) => (cell.courses ?? [])
      .filter((course: any) => courseMatchesWeek(course, week))
      .map((course: any) => {
        const range = normalizeSlotRange(cell.bigSlot, course);
        return {
          day: Number(cell.day),
          dayLabel: dayLabel(Number(cell.day)),
          date: calendarDays[Number(cell.day) - 1] || "",
          startSlot: range.start,
          endSlot: range.end,
          startTime: SMALL_SLOTS[range.start - 1]?.start ?? "",
          endTime: SMALL_SLOTS[range.end - 1]?.end ?? "",
          name: String(course.name || ""),
          teacher: course.teacher || "",
          location: course.location || "",
          note: course.slotNote || course.weeks || "",
          custom: Boolean(course.custom),
        };
      }))
    .sort((a: any, b: any) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot));

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    return {
      day,
      label: dayLabel(day),
      date: calendarDays[index] || "",
      isToday: day === activeDay && (!calendarWeek || calendarWeek === week) && (!calendarDays[index] || calendarDays[index] === today.ymd),
      courses: cells.filter((course: any) => course.day === day),
    };
  });
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(nowParts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(nowParts.find((part) => part.type === "minute")?.value ?? 0);
  const nowMinutes = hour * 60 + minute;
  const upcoming = cells.filter((course: any) => {
    if (course.day !== activeDay) return false;
    const [h, m] = String(course.endTime || "00:00").split(":").map(Number);
    return h * 60 + m >= nowMinutes;
  });

  return {
    title: "药大课表",
    generatedAt: new Date().toISOString(),
    semester: parsed?.currentSemester || "",
    week,
    currentWeek: calendarWeek || parsed?.currentWeek || "",
    today: days[activeDay - 1],
    days,
    upcoming: upcoming.slice(0, 6),
    strictDate: true,
    payloadVersion: WIDGET_PAYLOAD_VERSION,
  };
}

function dedupeWidgetCourses(courses: Array<{
  day: number;
  dayLabel: string;
  date: string;
  startSlot: number;
  endSlot: number;
  startTime: string;
  endTime: string;
  name: string;
  teacher: string;
  location: string;
  note: string;
  custom: boolean;
}>) {
  const seen = new Map<string, typeof courses[number]>();
  for (const course of courses) {
    const key = [
      course.day,
      course.startSlot,
      course.endSlot,
      normalizeKeyPart(course.name),
      normalizeKeyPart(course.teacher),
      normalizeKeyPart(course.location),
    ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, course);
      continue;
    }
    if (!existing.note && course.note) existing.note = course.note;
  }
  return [...seen.values()];
}

jwxtRouter.get("/schedule-widget-tokens", authRequired, async (req: any, res, next) => {
  try {
    const rows = await prisma.scheduleWidgetToken.findMany({
      where: { userId: req.user.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        tokenSuffix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    ok(res, rows);
  } catch (e) { next(e); }
});

jwxtRouter.post(
  "/schedule-widget-tokens",
  authRequired,
  validate(scheduleWidgetTokenSchema),
  async (req: any, res, next) => {
    try {
      const jwxtToken = getToken(req);
      if (!jwxtToken) throw Errors.unauthorized("请先登录教务系统");
      const status = await getStatus(jwxtToken);
      if (!status?.active) throw Errors.unauthorized("教务会话已失效，请重新授权");

      const token = generateWidgetToken();
      const expiresAt = new Date(Date.now() + WIDGET_TOKEN_TTL_MS);
      const row = await prisma.scheduleWidgetToken.create({
        data: {
          userId: req.user.userId,
          name: req.body.name || "iOS 小组件",
          tokenHash: hashWidgetToken(token),
          tokenSuffix: token.slice(-6),
          jwxtToken,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          tokenSuffix: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      ok(res, {
        ...row,
        token,
        endpoint: absoluteWidgetEndpoint(req, token),
      });
    } catch (e) { next(e); }
  }
);

jwxtRouter.post("/schedule-widget-tokens/refresh", authRequired, async (req: any, res, next) => {
  try {
    const jwxtToken = getToken(req);
    if (!jwxtToken) throw Errors.unauthorized("请先登录教务系统");
    const status = await getStatus(jwxtToken);
    if (!status?.active) throw Errors.unauthorized("教务会话已失效，请重新授权");
    const result = await prisma.scheduleWidgetToken.updateMany({
      where: { userId: req.user.userId, revokedAt: null },
      data: {
        jwxtToken,
        expiresAt: new Date(Date.now() + WIDGET_TOKEN_TTL_MS),
      },
    });
    await invalidateJwxtWidgetCaches();
    ok(res, { updated: result.count });
  } catch (e) { next(e); }
});

jwxtRouter.delete("/schedule-widget-tokens/:id", authRequired, async (req: any, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("无效的小组件 token");
    await prisma.scheduleWidgetToken.updateMany({
      where: { id, userId: req.user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await invalidateJwxtWidgetCaches();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

jwxtRouter.get("/schedule-widget", async (req, res, next) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) throw Errors.unauthorized("缺少小组件 token");
    const row = await prisma.scheduleWidgetToken.findUnique({
      where: { tokenHash: hashWidgetToken(token) },
      select: {
        id: true,
        userId: true,
        jwxtToken: true,
        cachedPayload: true,
        cachedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!row || row.revokedAt) throw Errors.unauthorized("小组件 token 已失效");
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw Errors.unauthorized("小组件 token 已过期，请重新复制配置");
    }

    const requestedWeek = req.query.week ? String(req.query.week) : "";
    const widgetCacheVersion = await getCacheVersion("jwxt-widget");
    const widgetCacheKey = buildRedisKey("jwxt-widget", "payload", `v${widgetCacheVersion}`, hashWidgetToken(token), requestedWeek || "current");
    const sharedCachedPayload = await getCachedJson<any>(widgetCacheKey);
    if (sharedCachedPayload) {
      await prisma.scheduleWidgetToken.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => undefined);
      res.setHeader("Cache-Control", "private, max-age=120");
      ok(res, sharedCachedPayload);
      return;
    }
    try {
      const [calendar, parsed] = await Promise.all([
        getCalendar(row.jwxtToken).catch(() => null),
        getSchedule(row.jwxtToken, { week: requestedWeek }),
      ]);
      const semester = parsed.currentSemester || "current";
      const edits = await readScheduleEditsForWidget(row.userId, semester);
      const payload = buildWidgetPayload(
        { ...parsed, cells: applyScheduleEditsToCells(parsed.cells ?? [], edits) },
        calendar,
        requestedWeek,
      );
      await prisma.scheduleWidgetToken.update({
        where: { id: row.id },
        data: {
          lastUsedAt: new Date(),
          cachedPayload: JSON.stringify(payload),
          cachedAt: new Date(),
        },
      });
      await setCachedJson(widgetCacheKey, payload, 120_000);
      res.setHeader("Cache-Control", "private, max-age=120");
      ok(res, payload);
    } catch (e: any) {
      const cached = parseWidgetCache(row.cachedPayload);
      if (!cached) throw e;
      await prisma.scheduleWidgetToken.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => undefined);
      res.setHeader("Cache-Control", "private, max-age=60");
      ok(res, {
        ...cached,
        stale: true,
        cachedAt: row.cachedAt?.toISOString() ?? cached.generatedAt,
        errorMessage: "教务会话暂时失效，已显示上次成功缓存。回到本站完成授权后会自动恢复更新。",
      });
    }
  } catch (e) { next(e); }
});

/** 第一步：获取登录页（拿 lt/execution + 可能的验证码） */
jwxtRouter.post("/begin-login", async (_req, res, next) => {
  try {
    const r = await beginLogin();
    ok(res, r);
  } catch (e) { next(e); }
});

/** 第二步：提交账号密码（凭据**仅这一刻**经过后端，不写盘） */
jwxtRouter.post(
  "/login",
  validate(z.object({
    pendingId: z.string().max(2048).optional().default(""),
    username: z.string().min(1),
    password: z.string().min(1),
    captcha: z.string().optional(),
  })),
  async (req, res, next) => {
    try {
      let pendingId = String(req.body.pendingId || "");
      if (pendingId.length < 8) {
        const fresh = await beginLogin();
        if (fresh.needCaptcha) {
          return ok(res, {
            ok: false,
            error: "登录会话已刷新，请输入验证码",
            needCaptcha: true,
            captcha: { image: fresh.captchaImage || "", pendingId: fresh.pendingId },
          });
        }
        pendingId = fresh.pendingId;
      }
      const r = await submitLogin({ ...req.body, pendingId });
      if (r.ok) {
        if (req.browserSession && isCookieAuthRequest(req)) {
          await updateBrowserSession(req, res, { jwxtToken: r.token });
          return ok(res, { ok: true, sessionAuthenticated: true });
        }
        return ok(res, { token: r.token });
      }
      // 失败：可能是要重新输验证码
      return ok(res, {
        ok: false,
        error: r.error,
        needCaptcha: r.needCaptcha ?? false,
        captcha: r.captcha,
      });
    } catch (e) { next(e); }
  }
);

/** 立即清除会话 */
jwxtRouter.post("/logout", async (req, res, next) => {
  try {
    const t = getToken(req);
    const loggedOut = t ? await logout(t) : true;
    if (req.browserSession) await updateBrowserSession(req, res, { jwxtToken: undefined });
    ok(res, { ok: loggedOut });
  } catch (e) { next(e); }
});

/** 当前会话信息（不暴露用户名） */
jwxtRouter.get("/status", async (req, res, next) => {
  try {
    const token = getToken(req);
    if (!token) {
      ok(res, { active: false });
      return;
    }
    const cacheId = jwxtTokenCacheId(token);
    const payload = await withCache("jwxt-status", [cacheId], JWXT_STATUS_CACHE_TTL_MS, async () => getStatus(token));
    res.setHeader("Cache-Control", "private, max-age=60");
    ok(res, payload);
  } catch (e) { next(e); }
});

jwxtRouter.get("/identity", async (req, res, next) => {
  try {
    const token = getToken(req);
    if (!token) throw Errors.unauthorized("请先登录教务系统");
    const cacheId = jwxtTokenCacheId(token);
    const payload = assertUsableIdentity(await withCache(
      "jwxt-identity",
      [cacheId],
      JWXT_IDENTITY_CACHE_TTL_MS,
      async () => assertUsableIdentity(await detectAcademicIdentity(token)),
    ));
    res.setHeader("Cache-Control", "private, max-age=300");
    ok(res, payload);
  } catch (e) { next(e); }
});

/** 课表（GET） */
jwxtRouter.get("/schedule", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const week = req.query.week ? String(req.query.week) : "";
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheId = jwxtTokenCacheId(t);
    const parsed = refresh
      ? assertUsableUndergraduateSchedule(await getSchedule(t, { semester, week }))
      : assertUsableUndergraduateSchedule(await withCache(
        "jwxt-schedule",
        [cacheId, semester || "_", week || "_"],
        JWXT_SCHEDULE_CACHE_TTL_MS,
        async () => assertUsableUndergraduateSchedule(await getSchedule(t, { semester, week })),
      ));
    res.setHeader("Cache-Control", refresh ? "private, no-store" : "private, max-age=300, stale-while-revalidate=86400");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

jwxtRouter.get("/graduate-schedule", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester).trim() : "";
    const termcode = req.query.termcode ? String(req.query.termcode).trim() : "";
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheId = jwxtTokenCacheId(t);
    const result = refresh
      ? await loadGraduateScheduleResponse(t, semester, termcode)
      : await withCache(
        "jwxt-graduate-schedule",
        [cacheId, semester || "_", termcode || "_"],
        JWXT_SCHEDULE_CACHE_TTL_MS,
        async () => loadGraduateScheduleResponse(t, semester, termcode),
      );
    res.setHeader("Cache-Control", refresh ? "private, no-store" : "private, max-age=300, stale-while-revalidate=86400");
    ok(res, result);
  } catch (e) { next(e); }
});

/** 成绩（GET 接口，内部 POST 查询） */
jwxtRouter.get("/grades", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const cacheId = jwxtTokenCacheId(t);
    const parsed = assertUsableGrades(await withCache(
      "jwxt-grades",
      [cacheId, semester || "_"],
      JWXT_GRADES_CACHE_TTL_MS,
      async () => assertUsableGrades(await getGrades(t, { semester })),
    ));
    res.setHeader("Cache-Control", "private, max-age=1800, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 期中成绩（GET 接口，内部 POST 查询） */
jwxtRouter.get("/midterm-grades", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const cacheId = jwxtTokenCacheId(t);
    const parsed = assertUsableGrades(await withCache(
      "jwxt-midterm-grades",
      [cacheId, semester || "_"],
      JWXT_MIDTERM_CACHE_TTL_MS,
      async () => assertUsableGrades(await getMidtermGrades(t, { semester })),
    ));
    res.setHeader("Cache-Control", "private, max-age=1800, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 考试（GET 接口，内部 POST 查询） */
jwxtRouter.get("/exams", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const type = req.query.type ? String(req.query.type) : "";
    const cacheId = jwxtTokenCacheId(t);
    const parsed = await withCache("jwxt-exams", [cacheId, semester || "_", type || "_"], JWXT_EXAMS_CACHE_TTL_MS, async () => getExams(t, { semester, type }));
    res.setHeader("Cache-Control", "private, max-age=1800, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** Phase 2 用：登录后批量抓取若干预设页面，全部落盘 .debug/。
 *  开发期供本人手动跑，用于摸清页面结构。
 */
jwxtRouter.post("/debug/snapshot", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const r = await debugSnapshot(t);
    ok(res, r);
  } catch (e) { next(e); }
});

/** 任意自定义路径（仅 dev 用，用于摸索新页面） */
jwxtRouter.get("/probe", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") throw Errors.forbidden();
    if (isRemoteMode()) throw Errors.badRequest("远端模式不支持 probe");
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const p = String(req.query.path ?? "");
    if (!p.startsWith("/")) throw Errors.badRequest("path 必须以 / 开头");
    const { jwxtFetchHtml } = await import("../services/jwxtClient");
    const html = await jwxtFetchHtml(t, p);
    ok(res, { html });
  } catch (e) { next(e); }
});

jwxtRouter.get("/graduate-debug/schedule", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") throw Errors.forbidden();
    const requestedSemester = String(req.query.semester ?? "").trim();
    const requestedTermcode = String(req.query.termcode ?? "").trim();
    ok(res, await buildGraduateDebugScheduleResponse(requestedSemester, requestedTermcode));
  } catch (e) { next(e); }
});

jwxtRouter.get("/stats", async (_req, res, next) => {
  try {
    ok(res, await sessionStats());
  } catch (e) { next(e); }
});

/** 教学周历 — 用于推算当前是第几周、学期始末 */
jwxtRouter.get("/calendar", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const cacheId = jwxtTokenCacheId(t);
    const semester = String(req.query.semester ?? "").trim();
    const parsed = await withCache(
      "jwxt-calendar",
      [cacheId, semester || "_"],
      JWXT_CALENDAR_CACHE_TTL_MS,
      async () => getCalendar(t, { semester }),
    );
    res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** i.cpu.edu.cn 融合门户应用列表 */
jwxtRouter.get("/iapps/icon", async (req, res, next) => {
  try {
    if (!getToken(req)) throw Errors.unauthorized("请先登录教务系统");
    const iconPath = String(req.query.path ?? "").trim();
    if (!I_SERVICE_ICON_PATH_PATTERN.test(iconPath)) throw Errors.badRequest("无效的应用图标路径");
    const icon = await withCache(
      "jwxt-iapp-icon",
      [iconPath],
      JWXT_IAPP_ICON_CACHE_TTL_MS,
      async () => getIAppIcon(iconPath),
    );
    const body = Buffer.from(icon.dataBase64, "base64");
    if (body.length !== icon.byteLength) throw Errors.server("应用图标传输不完整");

    res.setHeader("Content-Type", icon.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.send(body);
  } catch (e) { next(e); }
});

jwxtRouter.get("/iapps", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const cacheId = jwxtTokenCacheId(t);
    const apps = await withCache("jwxt-iapps", [cacheId], JWXT_IAPPS_CACHE_TTL_MS, async () => getIApps(t));
    res.setHeader("Cache-Control", "private, max-age=3600, stale-while-revalidate=86400");
    ok(res, { apps });
  } catch (e) { next(e); }
});

/** 学业完成情况（xywcqk） */
jwxtRouter.get("/progress", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const cacheId = jwxtTokenCacheId(t);
    const parsed = assertUsableProgress(await withCache(
      "jwxt-progress",
      [cacheId],
      JWXT_PROGRESS_CACHE_TTL_MS,
      async () => assertUsableProgress(await getProgress(t)),
    ));
    res.setHeader("Cache-Control", "private, max-age=1800, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 培养方案（执行计划 pyfa） */
jwxtRouter.get("/pyfa", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const cacheId = jwxtTokenCacheId(t);
    const parsed = assertUsablePyfa(await withCache(
      "jwxt-pyfa",
      [cacheId],
      JWXT_PYFA_CACHE_TTL_MS,
      async () => assertUsablePyfa(await getPyfa(t)),
    ));
    res.setHeader("Cache-Control", "private, max-age=21600, stale-while-revalidate=604800");
    ok(res, { parsed });
  } catch (e) { next(e); }
});

jwxtRouter.get("/schedule-edits", authRequired, async (req: any, res, next) => {
  try {
    const semester = String(req.query.semester || "").trim() || "current";
    const row = await prisma.userScheduleEdit.findUnique({
      where: { userId_semester: { userId: req.user.userId, semester } },
      select: { payload: true },
    });
    if (!row?.payload) {
      ok(res, { semester, edits: emptyScheduleEdits() });
      return;
    }
    try {
      ok(res, { semester, edits: normalizeScheduleEdits(JSON.parse(row.payload)) });
    } catch {
      ok(res, { semester, edits: emptyScheduleEdits() });
    }
  } catch (e) { next(e); }
});

jwxtRouter.put(
  "/schedule-edits",
  authRequired,
  validate(z.object({
    semester: z.string().trim().min(1).max(64),
    edits: scheduleEditStateSchema,
  })),
  async (req: any, res, next) => {
    try {
      ensureEditClient(req);
      const semester = String(req.body.semester || "").trim() || "current";
      const edits = normalizeScheduleEdits(req.body.edits);
      await prisma.userScheduleEdit.upsert({
        where: { userId_semester: { userId: req.user.userId, semester } },
        create: {
          userId: req.user.userId,
          semester,
          payload: JSON.stringify(edits),
        },
        update: {
          payload: JSON.stringify(edits),
        },
      });
      await prisma.scheduleWidgetToken.updateMany({
        where: { userId: req.user.userId, revokedAt: null },
        data: { cachedPayload: null, cachedAt: null },
      });
      await invalidateJwxtWidgetCaches();
      ok(res, { semester, edits });
    } catch (e) { next(e); }
  }
);
