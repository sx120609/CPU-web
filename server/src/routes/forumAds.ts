import { Router } from "express";
import { z } from "zod";
import { authOptional } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { withCache } from "../services/cache";
import { isUserVip } from "../services/vip";
import {
  FORUM_AD_PLACEMENTS,
  isForumAdPlacement,
  listActiveForumAds,
  recordForumAdEvent,
} from "../services/forumAds";
import { Errors, ok } from "../utils/response";

export const forumAdsRouter = Router();

const eventSchema = z.object({
  type: z.enum(["impression", "click"]),
  placement: z.enum(FORUM_AD_PLACEMENTS),
  device: z.enum(["mobile", "desktop"]),
});

forumAdsRouter.get("/", authOptional, async (req, res, next) => {
  try {
    const rawPlacement = String(req.query.placement || "forum-index-top").trim();
    if (!isForumAdPlacement(rawPlacement)) {
      throw Errors.badRequest(`广告位无效，可选值：${FORUM_AD_PLACEMENTS.join("、")}`);
    }
    const vip = req.user ? await isUserVip(req.user.userId) : false;
    const ads = await withCache("forum-ads", [rawPlacement, vip], 60_000, () => listActiveForumAds(rawPlacement, vip));
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    ok(res, ads);
  } catch (error) {
    next(error);
  }
});

forumAdsRouter.post("/:id/events", validate(eventSchema), async (req, res, next) => {
  try {
    const adId = Number(req.params.id);
    if (!Number.isInteger(adId) || adId <= 0) throw Errors.badRequest("广告 ID 无效");
    const recorded = await recordForumAdEvent({ adId, ...req.body });
    ok(res, { recorded });
  } catch (error) {
    next(error);
  }
});
