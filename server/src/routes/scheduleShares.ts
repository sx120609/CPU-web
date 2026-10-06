import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { Errors, ok } from "../utils/response";
import {
  createScheduleShare,
  getScheduleShare,
  getScheduleShareMeta,
  listScheduleShares,
  revokeScheduleShare,
} from "../services/scheduleSharing";

export const scheduleShareRouter = Router();

const shareSchema = z.object({
  semester: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().max(40).optional(),
  schedule: z.unknown(),
  calendar: z.unknown(),
}).strict();

const shareCode = (req: { params: { code?: string } }) => String(req.params.code || "").trim().toUpperCase();

// 同一学期重复发布只会更新同一个码，这里限的是每个账号的写入频率。
const publishLimit = securityRateLimit("schedule-share-publish", 30, 60 * 60 * 1000, (req: any) => req.user?.userId);

scheduleShareRouter.post("/", authRequired, publishLimit, validate(shareSchema), async (req: any, res, next) => {
  try {
    ok(res, await createScheduleShare(req.user.userId, req.body));
  } catch (error) {
    next(Errors.badRequest(error instanceof Error ? error.message : "课表分享失败"));
  }
});

// 必须排在 /:code 前面。
scheduleShareRouter.get("/mine", authRequired, async (req: any, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, { shares: await listScheduleShares(req.user.userId) });
  } catch (error) { next(error); }
});

// 读取方轮询用：只有 updatedAt 变了才值得重新下载整份课表。不缓存，
// 否则对方更新或撤销之后，读取方还会在缓存有效期内看到旧答案。
scheduleShareRouter.get("/:code/meta", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const meta = await getScheduleShareMeta(shareCode(req));
    if (!meta) throw Errors.notFound("分享课表不存在或已撤销");
    ok(res, meta);
  } catch (error) { next(error); }
});

scheduleShareRouter.get("/:code", async (req, res, next) => {
  try {
    const share = await getScheduleShare(shareCode(req));
    if (!share) throw Errors.notFound("分享课表不存在或已撤销");
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    ok(res, share);
  } catch (error) { next(error); }
});

scheduleShareRouter.delete("/:code", authRequired, async (req: any, res, next) => {
  try {
    const token = String(req.headers["x-write-token"] || "");
    const revoked = await revokeScheduleShare(shareCode(req), req.user.userId, token);
    if (!revoked) throw Errors.forbidden("分享凭据无效");
    ok(res, { ok: true });
  } catch (error) { next(error); }
});
