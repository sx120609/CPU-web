import { Router } from "express";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { ok } from "../utils/response";
import { applyNextSyncChanges, clearNextSync, listNextSyncChanges, nextSyncPushSchema } from "../services/nextSync";

// 挂载在 authRequired 之后，req.user 一定存在。药大拾间 NEXT 的跨设备同步，见 services/nextSync.ts。
export const nextSyncRouter = Router();

nextSyncRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

nextSyncRouter.get("/", securityRateLimit("next-sync-pull", 240, 60_000), async (req: any, res, next) => {
  try { ok(res, await listNextSyncChanges(req.user.userId, req.query.cursor)); } catch (error) { next(error); }
});

nextSyncRouter.post("/", securityRateLimit("next-sync-push", 120, 60_000), validate(nextSyncPushSchema), async (req: any, res, next) => {
  try { ok(res, await applyNextSyncChanges(req.user.userId, req.body.records)); } catch (error) { next(error); }
});

nextSyncRouter.delete("/", securityRateLimit("next-sync-clear", 10, 60 * 60 * 1000), async (req: any, res, next) => {
  try { ok(res, await clearNextSync(req.user.userId)); } catch (error) { next(error); }
});
