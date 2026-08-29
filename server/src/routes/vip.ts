import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { isVipActive } from "../services/vip";
import { redeemVipGiftCode } from "../services/vipGiftCodes";

export const vipRouter = Router();

const VIP_BENEFITS = [
  { key: "forum-ad-free", title: "论坛免广告", description: "VIP 用户可隐藏标记为 VIP 免广告的推广内容。" },
  { key: "profile-decoration", title: "个性化资料装扮", description: "使用个人主页主题和头像框，在论坛里展示专属身份。" },
] as const;

vipRouter.get("/", authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { isVip: true, sponsorTotalCents: true },
    });
    if (!user) throw Errors.notFound("用户不存在");
    ok(res, {
      vipActive: isVipActive(user),
      sponsorTotalCents: user.sponsorTotalCents,
      benefits: VIP_BENEFITS,
    });
  } catch (error) { next(error); }
});

vipRouter.post("/redeem", authRequired, validate(z.object({ code: z.string().trim().min(4).max(80) })), async (req, res, next) => {
  try {
    ok(res, await redeemVipGiftCode(req.user!.userId, req.body.code));
  } catch (error) { next(error); }
});

vipRouter.get("/history", authRequired, async (req, res, next) => {
  try {
    const list = await prisma.vipGiftCodeRedemption.findMany({
      where: { userId: req.user!.userId },
      orderBy: { redeemedAt: "desc" },
      take: 20,
      select: {
        id: true,
        redeemedAt: true,
        giftCode: { select: { codePreview: true } },
      },
    });
    ok(res, list);
  } catch (error) { next(error); }
});
