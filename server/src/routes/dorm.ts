import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { HttpError, Errors, ok } from "../utils/response";
import {
  cancelDormInvite,
  createDormInvite,
  getDormSchedules,
  getDormStatus,
  joinDorm,
  leaveDorm,
  removeDormMember,
  saveDormScheduleSnapshot,
  updateDormSettings,
} from "../services/dormSchedule";

// 挂载在 authRequired 之后，req.user 一定存在。
export const dormRouter = Router();

const joinSchema = z.object({ code: z.string().trim().min(1).max(20) }).strict();
const settingsSchema = z.object({
  name: z.string().trim().max(24).nullable().optional(),
  myColor: z.string().trim().min(1).max(16).optional(),
}).strict();
const snapshotSchema = z.object({
  semester: z.string().trim().min(1).max(80),
  schedule: z.unknown(),
  calendar: z.unknown(),
}).strict();

dormRouter.get("/", async (req: any, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, await getDormStatus(req.user.userId));
  } catch (error) { next(error); }
});

dormRouter.post("/invite", securityRateLimit("dorm-invite", 20, 60 * 60 * 1000), async (req: any, res, next) => {
  try { ok(res, await createDormInvite(req.user.userId)); } catch (error) { next(error); }
});

dormRouter.delete("/invite", async (req: any, res, next) => {
  try { ok(res, await cancelDormInvite(req.user.userId)); } catch (error) { next(error); }
});

// 宿舍码只有 6 位，限制尝试频率防止枚举。
dormRouter.post("/join", securityRateLimit("dorm-join", 15, 10 * 60 * 1000), validate(joinSchema), async (req: any, res, next) => {
  try { ok(res, await joinDorm(req.user.userId, req.body.code)); } catch (error) { next(error); }
});

dormRouter.patch("/", validate(settingsSchema), async (req: any, res, next) => {
  try { ok(res, await updateDormSettings(req.user.userId, req.body)); } catch (error) { next(error); }
});

dormRouter.delete("/", async (req: any, res, next) => {
  try { ok(res, await leaveDorm(req.user.userId)); } catch (error) { next(error); }
});

dormRouter.delete("/members/:userId", async (req: any, res, next) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw Errors.badRequest("成员 ID 无效");
    ok(res, await removeDormMember(req.user.userId, targetUserId));
  } catch (error) { next(error); }
});

dormRouter.get("/schedules", async (req: any, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, await getDormSchedules(req.user.userId));
  } catch (error) { next(error); }
});

dormRouter.put("/schedule", securityRateLimit("dorm-schedule-sync", 60, 60 * 60 * 1000), validate(snapshotSchema), async (req: any, res, next) => {
  try {
    ok(res, await saveDormScheduleSnapshot(req.user.userId, req.body));
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    next(Errors.badRequest(error instanceof Error ? error.message : "课表同步失败"));
  }
});
