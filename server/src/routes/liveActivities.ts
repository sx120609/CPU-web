import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { Errors, ok } from "../utils/response";
import { liveActivityBroadcastConfig } from "../services/liveActivityPush";

import { syncRemoteStarts, revokeRemoteStarts, switchToLocal, takeOverOccurrence, remoteDeviceState } from "../services/liveActivityRemoteStart";

export const liveActivityRouter = Router();
// Opaque encrypted capability: may revoke only its original device/account.
liveActivityRouter.post("/remote-start/revoke", async (req, res, next) => {
  try { await revokeRemoteStarts(req.body?.revoke); ok(res, { revoked: true }); }
  catch { next(Errors.badRequest("撤销凭据无效")); }
});
liveActivityRouter.use(authRequired);
liveActivityRouter.post("/device-state", async (req, res, next) => {
  try { ok(res, await remoteDeviceState(req.user!.userId, req.body)); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "设备状态读取失败")); }
});
liveActivityRouter.post("/local-handoff", async (req, res, next) => {
  try { ok(res, await switchToLocal(req.user!.userId, req.body)); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "模式交接失败")); }
});
liveActivityRouter.post("/foreground-recovery", async (req, res, next) => {
  try { ok(res, await takeOverOccurrence(req.user!.userId, req.body)); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "恢复失败")); }
});
liveActivityRouter.put("/remote-start", async (req, res, next) => {
  try { ok(res, await syncRemoteStarts(req.user!.userId, req.body)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "启动计划保存失败";
    if (message.startsWith("计划版本冲突:")) { res.status(409).json({ code: "PLAN_REVISION_CONFLICT", message, planRevision: Number(message.split(":")[1]) }); return; }
    next(Errors.badRequest(message));
  }
});
liveActivityRouter.get("/broadcast-config", async (req, res, next) => {
  try {
    ok(res, await liveActivityBroadcastConfig(String(req.query.environment || "production"), String(req.query.bundleID || ""), req.query.mode === "local"));
  } catch (error) {
    next(Errors.badRequest(error instanceof Error ? error.message : "广播配置读取失败"));
  }
});
// Old builds must upgrade. Never accept or dispatch personal plans/tokens after
// switching to broadcast-only operation. Retain tables for rollback, not writes.
liveActivityRouter.use((_req, res) => {
  res.status(410).json({ code: "LIVE_ACTIVITY_BROADCAST_ONLY", message: "实时活动已改为学校广播，请更新客户端" });
});
