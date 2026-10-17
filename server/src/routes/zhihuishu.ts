import { Router } from "express";
import { z } from "zod";
import { getZhihuishuRunner, ZhsRunnerError, speedSchema, answerPolicySchema } from "../services/zhihuishuRunner";
import { ok, fail } from "../utils/response";

// Mounted under authRequired. Ownership is always taken from the verified session.
export const zhihuishuRouter = Router();
zhihuishuRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
zhihuishuRouter.get("/settings", (req, res) => ok(res, { historyScope: `user-${req.user!.userId}`, canAdmin: req.user?.role === "admin", ...getZhihuishuRunner().getAnswerPolicy() }));
zhihuishuRouter.post("/settings", (req, res, next) => {
  if (req.user?.role !== "admin") return fail(res, 403, "仅管理员可以修改作答设置", 403);
  const parsed = answerPolicySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "作答设置格式不正确", 400);
  try { ok(res, { historyScope: `user-${req.user!.userId}`, canAdmin: true, ...getZhihuishuRunner().setAnswerPolicy(parsed.data) }); } catch (e) { next(e); }
});
zhihuishuRouter.get("/session", (req, res) => ok(res, getZhihuishuRunner().snapshot(req.user!.userId)));
zhihuishuRouter.post("/session", (req, res, next) => {
  try { ok(res, getZhihuishuRunner().login(req.user!.userId)); } catch (e) { next(e); }
});
zhihuishuRouter.delete("/session", (req, res) => ok(res, getZhihuishuRunner().stop(req.user!.userId)));
zhihuishuRouter.post("/courses/refresh", (req, res, next) => {
  try { ok(res, getZhihuishuRunner().refresh(req.user!.userId)); } catch (e) { next(e); }
});
zhihuishuRouter.post("/tasks", (req, res, next) => {
  const parsed = z.object({ keys: z.array(z.string().min(1).max(500)).min(1).max(20), speed: speedSchema.default(1) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(res, 4000, "请选择 1 至 20 门课程及有效倍速", 400);
  try { ok(res, getZhihuishuRunner().start(req.user!.userId, parsed.data.keys, parsed.data.speed)); } catch (e) { next(e); }
});
zhihuishuRouter.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof ZhsRunnerError) return fail(res, error.status, error.message, error.status);
  next(error);
});
