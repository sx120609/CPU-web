import { Router } from "express";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { requestCancellation } from "../utils/requestCancellation";
import { schoolDriverFor, schoolDriverForToken } from "../schools/drivers";
import { requestSchoolId } from "../schools/modules";

/** 图书馆「我的借阅」：学校驱动里接了 library 的学校才有（统一认证换票进图书馆），用的是教务登录时的那份会话。 */
export const libraryRouter = Router();

function schoolLibrary(req: any) {
  const token = req.browserSession?.jwxtToken || (req.headers["x-jwxt-token"] as string) || "";
  if (!token && req.browserSessionUnavailable) throw Errors.unavailable("会话暂时无法读取，请稍后重试");
  if (!token) throw Errors.unauthorized("请先用学校统一认证登录");
  const library = schoolDriverForToken(token)?.library;
  if (!library) throw Errors.notFound("本校暂未接入图书馆");
  return { token, library };
}

libraryRouter.get("/overview", authRequired, async (req, res, next) => {
  const cancellation = requestCancellation(req, res);
  try {
    const { token, library } = schoolLibrary(req);
    const data = await library.overview(token, cancellation.signal);
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, data);
  } catch (e) { next(e); } finally { cancellation.dispose(); }
});

/** 图书馆官网公开的开放时间，不用登录。 */
libraryRouter.get("/open-hours", async (req, res, next) => {
  try {
    const library = schoolDriverFor(requestSchoolId(req))?.library;
    if (!library) throw Errors.notFound("本校暂未接入图书馆");
    res.setHeader("Cache-Control", "public, max-age=3600");
    ok(res, await library.openHours());
  } catch (e) { next(e); }
});

libraryRouter.get("/history", authRequired, async (req, res, next) => {
  const cancellation = requestCancellation(req, res);
  try {
    const { token, library } = schoolLibrary(req);
    const data = await library.history(token, Number(req.query.page) || 1, cancellation.signal);
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, data);
  } catch (e) { next(e); } finally { cancellation.dispose(); }
});
