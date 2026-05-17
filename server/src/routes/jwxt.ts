import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { ok, Errors } from "../utils/response";
import { validate } from "../middleware/validate";
import { authRequired } from "../middleware/auth";
import { prisma } from "../prisma";
import { detectLoginClient } from "../utils/loginClient";
import {
  beginLogin,
  submitLogin,
  logout,
  getStatus,
  getSchedule,
  getGrades,
  getExams,
  getCalendar,
  getProgress,
  getPyfa,
  getIApps,
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

/**
 * 教务会话 token 取自 X-Jwxt-Token 头。
 * 该 token 与站内登录 token 完全独立 —— 站内可以未登录也用教务（但通常我们要求站内登录）。
 */
function getToken(req: any): string | null {
  return (req.headers["x-jwxt-token"] as string) || null;
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
  if (client !== "android" && client !== "ios") throw Errors.forbidden("课表编辑仅客户端可用");
}

function generateWidgetToken() {
  return `cpu_sched_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashWidgetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function absoluteWidgetEndpoint(req: any, token: string) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const base = `${proto}://${host}`;
  return `${base}/api/jwxt/schedule-widget?token=${encodeURIComponent(token)}`;
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

function dayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
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
  const calendarWeek = calendar?.currentWeek ? Number(calendar.currentWeek) : 0;
  const week = Number(queryWeek || parsed?.currentWeek || calendarWeek || 0);
  const activeDay = dayOfWeek();
  const calendarDays = (calendar?.weeks ?? []).find((item: any) => Number(item.week) === week)?.days ?? [];
  const cells = (parsed?.cells ?? [])
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
    .sort((a: any, b: any) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot);

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    return {
      day,
      label: dayLabel(day),
      date: calendarDays[index] || "",
      isToday: day === activeDay && (!calendarWeek || calendarWeek === week),
      courses: cells.filter((course: any) => course.day === day),
    };
  });
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const upcoming = cells.filter((course: any) => {
    if (course.day > activeDay) return true;
    if (course.day < activeDay) return false;
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
  };
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

jwxtRouter.delete("/schedule-widget-tokens/:id", authRequired, async (req: any, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("无效的小组件 token");
    await prisma.scheduleWidgetToken.updateMany({
      where: { id, userId: req.user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!row || row.revokedAt) throw Errors.unauthorized("小组件 token 已失效");
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw Errors.unauthorized("小组件 token 已过期，请重新复制配置");
    }

    const requestedWeek = req.query.week ? String(req.query.week) : "";
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
      data: { lastUsedAt: new Date() },
    });
    res.setHeader("Cache-Control", "private, max-age=120");
    ok(res, payload);
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
    pendingId: z.string().min(8),
    username: z.string().min(1),
    password: z.string().min(1),
    captcha: z.string().optional(),
  })),
  async (req, res, next) => {
    try {
      const r = await submitLogin(req.body);
      if (r.ok) return ok(res, { token: r.token });
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
    ok(res, { ok: t ? await logout(t) : true });
  } catch (e) { next(e); }
});

/** 当前会话信息（不暴露用户名） */
jwxtRouter.get("/status", async (req, res, next) => {
  try {
    ok(res, await getStatus(getToken(req)));
  } catch (e) { next(e); }
});

/** 课表（GET） */
jwxtRouter.get("/schedule", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const week = req.query.week ? String(req.query.week) : "";
    const parsed = await getSchedule(t, { semester, week });
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 成绩（GET 接口，内部 POST 查询） */
jwxtRouter.get("/grades", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const parsed = await getGrades(t, { semester });
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
    ok(res, { parsed: await getExams(t, { semester, type }) });
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
    if (isRemoteMode) throw Errors.badRequest("远端模式不支持 probe");
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const p = String(req.query.path ?? "");
    if (!p.startsWith("/")) throw Errors.badRequest("path 必须以 / 开头");
    const { jwxtFetchHtml } = await import("../services/jwxtClient");
    const html = await jwxtFetchHtml(t, p);
    ok(res, { html });
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
    const parsed = await getCalendar(t);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** i.cpu.edu.cn 融合门户应用列表 */
jwxtRouter.get("/iapps", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const apps = await getIApps(t);
    ok(res, { apps });
  } catch (e) { next(e); }
});

/** 学业完成情况（xywcqk） */
jwxtRouter.get("/progress", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const parsed = await getProgress(t);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 培养方案（执行计划 pyfa） */
jwxtRouter.get("/pyfa", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const parsed = await getPyfa(t);
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
      ok(res, { semester, edits });
    } catch (e) { next(e); }
  }
);
