import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  liveActivityDeviceStatus,
  normalizeLiveActivityToken,
  registerLiveActivity,
  registerLiveActivityDevice,
  registerLiveActivityDeviceActivity,
  removeLiveActivityDevice,
  replaceLiveActivityPlan,
  unregisterLiveActivity,
  unregisterLiveActivityDeviceActivity,
} from "../services/liveActivityPush";

export const liveActivityRouter = Router();

const registerSchema = z.object({
  token: z.string().trim().min(32).max(512),
  environment: z.enum(["production", "sandbox"]).default("production"),
  bundleID: z.string().trim().min(1).max(200),
  attributes: z.record(z.unknown()),
  contentState: z.record(z.unknown()),
}).strict();

const deviceSchema = z.object({
  deviceID: z.string().trim().min(1).max(120).optional(),
  startToken: z.string().trim().max(512).optional().default(""),
  environment: z.enum(["production", "sandbox"]).default("production"),
  bundleID: z.string().trim().min(1).max(200),
  timeZone: z.string().trim().max(64).optional(),
  supportsBroadcast: z.boolean().optional().default(false),
}).strict();

const planSchema = z.object({ items: z.array(z.record(z.unknown())).max(240) }).strict();
const activitySchema = z.object({
  activityID: z.string().trim().min(1).max(200),
  updateToken: z.string().trim().min(32).max(512),
  expiresAt: z.number().finite().optional(),
}).strict();

function deviceID(req: any) { return String(req.params.deviceID || "").trim(); }

liveActivityRouter.post("/devices", authRequired, validate(deviceSchema), async (req: any, res, next) => {
  try { ok(res, await registerLiveActivityDevice({ userId: req.user.userId, ...req.body })); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 设备注册失败")); }
});

liveActivityRouter.get("/devices/:deviceID", authRequired, async (req: any, res, next) => {
  try { ok(res, await liveActivityDeviceStatus(req.user.userId, deviceID(req))); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 状态读取失败")); }
});

liveActivityRouter.put("/devices/:deviceID/plan", authRequired, validate(planSchema), async (req: any, res, next) => {
  try { ok(res, await replaceLiveActivityPlan(req.user.userId, deviceID(req), req.body.items)); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 计划无效")); }
});

liveActivityRouter.post("/devices/:deviceID/activities", authRequired, validate(activitySchema), async (req: any, res, next) => {
  try { ok(res, await registerLiveActivityDeviceActivity(req.user.userId, deviceID(req), req.body)); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 更新令牌注册失败")); }
});

liveActivityRouter.delete("/devices/:deviceID/activities/:activityID", authRequired, async (req: any, res, next) => {
  try { await unregisterLiveActivityDeviceActivity(req.user.userId, deviceID(req), String(req.params.activityID)); ok(res, { ok: true }); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 活动注销失败")); }
});

liveActivityRouter.delete("/devices/:deviceID", authRequired, async (req: any, res, next) => {
  try { await removeLiveActivityDevice(req.user.userId, deviceID(req)); ok(res, { ok: true }); }
  catch (error) { next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 设备注销失败")); }
});

liveActivityRouter.post("/register", authRequired, validate(registerSchema), async (req: any, res, next) => {
  try {
    const body = req.body as z.infer<typeof registerSchema>;
    normalizeLiveActivityToken(body.token);
    ok(res, await registerLiveActivity({ userId: req.user.userId, ...body }));
  } catch (error) {
    next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 注册失败"));
  }
});

liveActivityRouter.delete("/register", authRequired, async (req: any, res, next) => {
  try {
    const token = String(req.headers["x-live-activity-token"] || req.body?.token || "");
    normalizeLiveActivityToken(token);
    await unregisterLiveActivity(req.user.userId, token);
    ok(res, { ok: true });
  } catch (error) {
    next(Errors.badRequest(error instanceof Error ? error.message : "Live Activity 注销失败"));
  }
});
