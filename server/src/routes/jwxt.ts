import { Router } from "express";
import { z } from "zod";
import { ok, Errors } from "../utils/response";
import { validate } from "../middleware/validate";
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
