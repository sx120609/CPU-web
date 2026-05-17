import { Router } from "express";
import { z } from "zod";
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
