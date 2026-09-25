import { Router } from "express";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { iosClientHeartbeatSchema, iosClientMetricsSchema, recordIosClientHeartbeat, recordIosClientMetrics } from "../services/iosClientStats";
import { Errors, ok } from "../utils/response";

export const appClientRouter = Router();

// Anonymous launches are counted too; a session only links the install to its account.
appClientRouter.post("/ios/heartbeat", securityRateLimit("ios-client-heartbeat", 30, 60_000), async (req, res, next) => {
  const parsed = iosClientHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("客户端信息格式不正确"));
  try {
    await recordIosClientHeartbeat(parsed.data, req.user?.userId ?? null);
    ok(res, { recorded: true });
  } catch (error) {
    next(error);
  }
});

// MetricKit performance reports and crash / hang diagnostics. Idempotent, so
// the client may retry a batch until it is acknowledged.
appClientRouter.post("/ios/metrics", securityRateLimit("ios-client-metrics", 20, 60_000), async (req, res, next) => {
  const parsed = iosClientMetricsSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("诊断数据格式不正确"));
  try {
    ok(res, await recordIosClientMetrics(parsed.data));
  } catch (error) {
    next(error);
  }
});
