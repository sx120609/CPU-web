import { Router } from "express";
import { authOptional } from "../middleware/auth";
import { withCache } from "../services/cache";
import { isUserVip } from "../services/vip";
import { FORUM_AD_PLACEMENTS, isForumAdPlacement, listActiveForumAds } from "../services/forumAds";
import { Errors, ok } from "../utils/response";

export const forumAdsRouter = Router();

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
