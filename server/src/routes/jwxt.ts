import { Router } from "express";
import { z } from "zod";
import { ok, Errors } from "../utils/response";
import { validate } from "../middleware/validate";
import {
  beginLogin,
  submitLogin,
  logout,
  getSession,
  jwxtFetchHtml,
  jwxtPostForm,
  jwxtDebugSnapshot,
  sessionStats,
  fetchIServiceApps,
} from "../services/jwxtClient";
import { parseSchedule, parseGrades, parseExams, parseProgress, parsePyfa, parseCalendar } from "../services/jwxtParser";

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
jwxtRouter.post("/logout", (req, res) => {
  const t = getToken(req);
  ok(res, { ok: t ? logout(t) : true });
});

/** 当前会话信息（不暴露用户名） */
jwxtRouter.get("/status", (req, res) => {
  const t = getToken(req);
  const s = getSession(t);
  ok(res, s ? { active: true, since: s.createdAt } : { active: false });
});

/** 课表（GET） */
jwxtRouter.get("/schedule", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const week = req.query.week ? String(req.query.week) : "";
    let path = "/zgykdx/xskb/xskb_list.do";
    if (semester || week) {
      const qs = new URLSearchParams();
      if (semester) qs.set("xnxq01id", semester);
      if (week) qs.set("zc", week);
      path += "?" + qs.toString();
    }
    const html = await jwxtFetchHtml(t, path);
    const parsed = parseSchedule(html);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 成绩（GET 接口，内部 POST 查询） */
jwxtRouter.get("/grades", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const semester = req.query.semester ? String(req.query.semester) : "";
    const html = await jwxtPostForm(t, "/zgykdx/kscj/cjcx_list", {
      kksj: semester,
      kcxz: "",
      kcmc: "",
    });
    const parsed = parseGrades(html);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 考试（GET 接口，内部 POST 查询） */
jwxtRouter.get("/exams", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    let semester = req.query.semester ? String(req.query.semester) : "";
    const type = req.query.type ? String(req.query.type) : "";
    // 学校 POST cjcx_list 学期可为空（返回全部成绩），但 xsksap_list 学期必填
    // —— 否则后端返回 "非法访问！" 错误页。
    // 如果用户没传，先去 query 页拿到学期下拉，取最新的（第一个非空 option）兜底
    if (!semester) {
      try {
        const queryHtml = await jwxtFetchHtml(t, "/zgykdx/xsks/xsksap_query?Ves632DSdyV=NEW_XSD_KSBM");
        const m = queryHtml.match(/<select[^>]*id="xnxqid"[^>]*>([\s\S]*?)<\/select>/);
        if (m) {
          const opts = Array.from(m[1].matchAll(/<option[^>]*value="([^"]+)"/g)).map((x) => x[1]).filter(Boolean);
          // 取最新（按学期字符串排序，202x-202x-N 越大越新）
          opts.sort().reverse();
          semester = opts[0] ?? "";
        }
      } catch { /* ignore */ }
    }
    if (!semester) {
      return ok(res, { parsed: { semesters: [], list: [], needSemester: true } });
    }
    const html = await jwxtPostForm(t, "/zgykdx/xsks/xsksap_list", {
      xnxqid: semester,
      xqlb: type,
    });
    const parsed = parseExams(html);
    ok(res, { parsed: { ...parsed, currentSemester: semester } });
  } catch (e) { next(e); }
});

/** Phase 2 用：登录后批量抓取若干预设页面，全部落盘 .debug/。
 *  开发期供本人手动跑，用于摸清页面结构。
 */
jwxtRouter.post("/debug/snapshot", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const r = await jwxtDebugSnapshot(t);
    ok(res, r);
  } catch (e) { next(e); }
});

/** 任意自定义路径（仅 dev 用，用于摸索新页面） */
jwxtRouter.get("/probe", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") throw Errors.forbidden();
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const p = String(req.query.path ?? "");
    if (!p.startsWith("/")) throw Errors.badRequest("path 必须以 / 开头");
    const html = await jwxtFetchHtml(t, p);
    ok(res, { html });
  } catch (e) { next(e); }
});

jwxtRouter.get("/stats", (_req, res) => ok(res, sessionStats()));

/** 教学周历 — 用于推算当前是第几周、学期始末 */
jwxtRouter.get("/calendar", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const html = await jwxtFetchHtml(t, "/zgykdx/jxzl/jxzl_query?Ves632DSdyV=NEW_XSD_WDZM");
    const parsed = parseCalendar(html);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** i.cpu.edu.cn 融合门户应用列表 */
jwxtRouter.get("/iapps", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const apps = await fetchIServiceApps(t);
    ok(res, { apps });
  } catch (e) { next(e); }
});

/** 学业完成情况（xywcqk） */
jwxtRouter.get("/progress", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const html = await jwxtFetchHtml(t, "/zgykdx/xywcqk/cxxywcqk?Ves632DSdyV=NEW-XSD-XYWCQK");
    const parsed = parseProgress(html);
    ok(res, { parsed });
  } catch (e) { next(e); }
});

/** 培养方案（执行计划 pyfa） */
jwxtRouter.get("/pyfa", async (req, res, next) => {
  try {
    const t = getToken(req);
    if (!t) throw Errors.unauthorized("请先登录教务系统");
    const html = await jwxtFetchHtml(t, "/zgykdx/pyfa/pyfa_query?Ves632DSdyV=NEW_XSD_PYGL");
    const parsed = parsePyfa(html);
    ok(res, { parsed });
  } catch (e) { next(e); }
});
