import { Router } from "express";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { requestCancellation } from "../utils/requestCancellation";
import { isNjmuToken } from "../schools/njmu/client";
import { loadLibraryHistory, loadLibraryOverview } from "../schools/njmu/library";

/** 图书馆「我的借阅」。目前只有南医接了（统一认证换票进图书馆），用的是教务登录时的那份会话。 */
export const libraryRouter = Router();

function schoolSessionToken(req: any) {
  const token = req.browserSession?.jwxtToken || (req.headers["x-jwxt-token"] as string) || "";
  if (!token && req.browserSessionUnavailable) throw Errors.unavailable("会话暂时无法读取，请稍后重试");
  if (!token) throw Errors.unauthorized("请先用学校统一认证登录");
  if (!isNjmuToken(token)) throw Errors.notFound("本校暂未接入图书馆");
  return token;
}

libraryRouter.get("/overview", authRequired, async (req, res, next) => {
  const cancellation = requestCancellation(req, res);
  try {
    const data = await loadLibraryOverview(schoolSessionToken(req), cancellation.signal);
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, data);
  } catch (e) { next(e); } finally { cancellation.dispose(); }
});

libraryRouter.get("/history", authRequired, async (req, res, next) => {
  const cancellation = requestCancellation(req, res);
  try {
    const data = await loadLibraryHistory(schoolSessionToken(req), Number(req.query.page) || 1, cancellation.signal);
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, data);
  } catch (e) { next(e); } finally { cancellation.dispose(); }
});
