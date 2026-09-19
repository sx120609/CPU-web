import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { createScheduleShare, getScheduleShare, revokeScheduleShare } from "../services/scheduleSharing";

export const scheduleShareRouter = Router();

const shareSchema = z.object({
  semester: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().max(40).optional(),
  schedule: z.unknown(),
  calendar: z.unknown(),
}).strict();

scheduleShareRouter.post("/", authRequired, validate(shareSchema), async (req: any, res, next) => {
  try {
    ok(res, await createScheduleShare(req.user.userId, req.body));
  } catch (error) {
    next(Errors.badRequest(error instanceof Error ? error.message : "课表分享失败"));
  }
});

scheduleShareRouter.get("/:code", async (req, res, next) => {
  try {
    const share = await getScheduleShare(String(req.params.code || "").trim().toUpperCase());
    if (!share) throw Errors.notFound("分享课表不存在或已撤销");
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    ok(res, share);
  } catch (error) { next(error); }
});

scheduleShareRouter.delete("/:code", authRequired, async (req: any, res, next) => {
  try {
    const token = String(req.headers["x-write-token"] || "");
    const revoked = await revokeScheduleShare(String(req.params.code || "").trim().toUpperCase(), req.user.userId, token);
    if (!revoked) throw Errors.forbidden("分享凭据无效");
    ok(res, { ok: true });
  } catch (error) { next(error); }
});
