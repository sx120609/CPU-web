import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { HttpError, Errors, ok } from "../utils/response";
import {
  acceptCoupleInvite,
  cancelCoupleInvite,
  createCoupleInvite,
  getCoupleSchedules,
  getCoupleStatus,
  saveCoupleScheduleSnapshot,
  unbindCouple,
  updateCoupleSettings,
} from "../services/coupleSchedule";

// 挂载在 authRequired 之后，req.user 一定存在。
export const coupleRouter = Router();

const acceptSchema = z.object({ code: z.string().trim().min(1).max(20) }).strict();
const settingsSchema = z.object({
  anniversary: z.string().trim().max(10).nullable().optional(),
  myColor: z.string().trim().min(1).max(16).optional(),
}).strict();
const snapshotSchema = z.object({
  semester: z.string().trim().min(1).max(80),
  schedule: z.unknown(),
  calendar: z.unknown(),
}).strict();

coupleRouter.get("/", async (req: any, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, await getCoupleStatus(req.user.userId));
  } catch (error) { next(error); }
});

coupleRouter.post("/invite", securityRateLimit("couple-invite", 20, 60 * 60 * 1000), async (req: any, res, next) => {
  try { ok(res, await createCoupleInvite(req.user.userId)); } catch (error) { next(error); }
});

coupleRouter.delete("/invite", async (req: any, res, next) => {
  try { ok(res, await cancelCoupleInvite(req.user.userId)); } catch (error) { next(error); }
});

// 邀请码只有 6 位，限制尝试频率防止枚举。
coupleRouter.post("/accept", securityRateLimit("couple-accept", 15, 10 * 60 * 1000), validate(acceptSchema), async (req: any, res, next) => {
  try { ok(res, await acceptCoupleInvite(req.user.userId, req.body.code)); } catch (error) { next(error); }
});

coupleRouter.delete("/", async (req: any, res, next) => {
  try { ok(res, await unbindCouple(req.user.userId)); } catch (error) { next(error); }
});

coupleRouter.patch("/", validate(settingsSchema), async (req: any, res, next) => {
  try { ok(res, await updateCoupleSettings(req.user.userId, req.body)); } catch (error) { next(error); }
});

coupleRouter.get("/schedules", async (req: any, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, await getCoupleSchedules(req.user.userId));
  } catch (error) { next(error); }
});

coupleRouter.put("/schedule", securityRateLimit("couple-schedule-sync", 60, 60 * 60 * 1000), validate(snapshotSchema), async (req: any, res, next) => {
  try {
    ok(res, await saveCoupleScheduleSnapshot(req.user.userId, req.body));
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    next(Errors.badRequest(error instanceof Error ? error.message : "课表同步失败"));
  }
});
