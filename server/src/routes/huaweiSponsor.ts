import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { isFeatureOn } from "../services/siteSettings";
import { amountCentsToMoney } from "../services/epay";
import { formatSponsorOrder, getSponsorCategoriesWithStats, getSponsorConfig } from "../services/sponsor";
import { calculateSponsorAssistantPoints } from "../services/campusAssistantPoints";
import { findStoreSponsorOrder, recordStoreSponsorOrder, refundStoreSponsorOrder } from "../services/storeSponsor";
import {
  HUAWEI_IAP_POINTS_RATIO,
  HUAWEI_SPONSOR_PRODUCTS,
  HuaweiIapError,
  decodeHuaweiRefundNotification,
  huaweiDeveloperPayload,
  huaweiIapPointsAmountCents,
  verifyHuaweiSponsorPurchase,
} from "../services/huaweiIap";

/**
 * 鸿蒙 App 的赞助（华为应用内支付）。网页赞助（/payments/sponsor，易支付）在鸿蒙 App 里不出现；
 * 这里只收 IAP Kit 的订单：VIP、赞助墙、赞助类别和留言与网页一致，AI 点数按华为抽成后的 70% 折算。
 *
 * 正式订单记为 payType "hwiap"、status "paid"；沙盒订单（审核、沙盒测试账号）记为 "hwiap_sandbox"、status "sandbox"：
 * 照样发 VIP 和点数，但不计入公开金额和赞助累计。
 */
export const huaweiSponsorRouter = Router();

const HWIAP_PAY_TYPES = ["hwiap", "hwiap_sandbox"];

function hwiapOutTradeNo(purchaseOrderId: string) {
  return `HWIAP${purchaseOrderId}`;
}

huaweiSponsorRouter.get("/sponsor/options", authRequired, async (req, res, next) => {
  try {
    const config = await getSponsorConfig();
    const categories = (await getSponsorCategoriesWithStats(config)).filter((category) => category.enabled);
    const pointsPerYuan = config.assistantPointsPerYuan;
    ok(res, {
      enabled: isFeatureOn("sponsor") && categories.some((category) => category.accepting),
      title: config.title,
      description: config.description,
      allowMessage: config.allowMessage,
      wallEnabled: config.wallEnabled,
      developerPayload: huaweiDeveloperPayload(req.user!.userId),
      pointsRatio: HUAWEI_IAP_POINTS_RATIO,
      products: HUAWEI_SPONSOR_PRODUCTS.map((product) => ({
        productId: product.productId,
        amount: amountCentsToMoney(product.amountCents),
        amountCents: product.amountCents,
        assistantPoints: calculateSponsorAssistantPoints(huaweiIapPointsAmountCents(product.amountCents), pointsPerYuan),
      })),
      categories,
    });
  } catch (e) { next(e); }
});

huaweiSponsorRouter.get("/sponsor/orders", authRequired, async (req, res, next) => {
  try {
    const list = await prisma.sponsorOrder.findMany({
      where: { userId: req.user!.userId, payType: { in: HWIAP_PAY_TYPES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    ok(res, { list: list.map(formatSponsorOrder) });
  } catch (e) { next(e); }
});

const purchaseSchema = z.object({
  purchaseData: z.string().trim().min(20).max(20000),
  categoryId: z.string().trim().min(1).max(40).optional(),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(["public", "anonymous", "hidden"]).optional(),
});

/**
 * App 在 IAP Kit 购买成功（或打开赞助页时发现已付款没确认发货的订单）后提交。同一笔订单重复提交返回同一张赞助订单；
 * App 收到成功后才向 IAP Kit 确认发货（finishPurchase，要用返回的 finish 参数），所以网络断了下次还会再交一次。
 */
huaweiSponsorRouter.post("/sponsor/purchases", authRequired, validate(purchaseSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    let purchase;
    try {
      purchase = verifyHuaweiSponsorPurchase(req.body.purchaseData);
    } catch (error) {
      if (error instanceof HuaweiIapError) throw Errors.badRequest(error.message);
      throw error;
    }
    if (purchase.developerPayload !== huaweiDeveloperPayload(userId)) {
      throw Errors.forbidden("这笔购买不属于当前登录的账号");
    }
    const finish = { productType: 0, purchaseToken: purchase.purchaseToken, purchaseOrderId: purchase.purchaseOrderId };
    const outTradeNo = hwiapOutTradeNo(purchase.purchaseOrderId);
    const existing = await findStoreSponsorOrder(outTradeNo, userId);
    if (existing) return ok(res, { order: formatSponsorOrder(existing), created: false, finish });
    if (purchase.revoked) throw Errors.badRequest("这笔购买已退款");

    const { order, created } = await recordStoreSponsorOrder({
      userId,
      outTradeNo,
      tradeNo: purchase.purchaseOrderId,
      payType: purchase.sandbox ? "hwiap_sandbox" : "hwiap",
      sandbox: purchase.sandbox,
      amountCents: purchase.amountCents,
      pointsAmountCents: huaweiIapPointsAmountCents(purchase.amountCents),
      paidAt: purchase.purchaseTime ? new Date(purchase.purchaseTime) : new Date(),
      categoryId: req.body.categoryId,
      message: req.body.message,
      displayMode: req.body.displayMode,
      storeName: "华为应用内支付",
    });
    ok(res, { order: formatSponsorOrder(order), created, finish });
  } catch (e) { next(e); }
});

/**
 * 华为 IAP 服务端关键事件通知 v3（在 HarmonyOS 开发者中心的应用内购买服务参数里填
 * https://cputime.cn/api/payments/huawei/notifications）。退款时把订单标成 refunded，
 * 扣回赞助累计和还没用掉的那部分点数；VIP 不收回（和网页一致）。其他事件直接回 200，免得华为重发。
 */
huaweiSponsorRouter.post("/notifications", async (req, res, next) => {
  try {
    const jwsNotification = String(req.body?.jwsNotification || "");
    if (!jwsNotification) return res.status(400).json({ code: 4000, message: "缺少 jwsNotification" });
    let notice;
    try {
      notice = decodeHuaweiRefundNotification(jwsNotification);
    } catch {
      return res.status(400).json({ code: 4000, message: "通知无法验证" });
    }
    if (!notice) return ok(res, { handled: false });
    await refundStoreSponsorOrder({ outTradeNo: hwiapOutTradeNo(notice.purchaseOrderId), livePayType: "hwiap", reason: "华为应用内支付赞助退款" });
    ok(res, { handled: true });
  } catch (e) { next(e); }
});
