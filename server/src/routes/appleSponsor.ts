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
  APPLE_IAP_POINTS_RATIO,
  APPLE_SPONSOR_PRODUCTS,
  AppleIapError,
  appleAppAccountToken,
  appleIapPointsAmountCents,
  decodeAppleRefundNotification,
  verifyAppleSponsorTransaction,
} from "../services/appleIap";

/**
 * iOS 原生赞助（Apple 内购）。网页赞助（/payments/sponsor，易支付）在 iOS 客户端里仍然关着；
 * 这里只收 App Store 交易：VIP、赞助墙、赞助类别和留言与网页一致，AI 点数按苹果抽成后的 70% 折算。
 *
 * 正式交易记为 payType "iap"、status "paid"，和网页订单一起进赞助墙、类别进度和赞助榜。
 * 沙盒交易（审核、TestFlight）记为 payType "iap_sandbox"、status "sandbox"：照样发 VIP 和点数，
 * 但不计入公开金额和赞助累计。
 */
export const appleSponsorRouter = Router();

const IAP_PAY_TYPES = ["iap", "iap_sandbox"];

function iapOutTradeNo(transactionId: string) {
  return `IAP${transactionId}`;
}

appleSponsorRouter.get("/sponsor/options", authRequired, async (req, res, next) => {
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
      appAccountToken: appleAppAccountToken(req.user!.userId),
      pointsRatio: APPLE_IAP_POINTS_RATIO,
      products: APPLE_SPONSOR_PRODUCTS.map((product) => ({
        productId: product.productId,
        amount: amountCentsToMoney(product.amountCents),
        amountCents: product.amountCents,
        assistantPoints: calculateSponsorAssistantPoints(appleIapPointsAmountCents(product.amountCents), pointsPerYuan),
      })),
      categories,
    });
  } catch (e) { next(e); }
});

appleSponsorRouter.get("/sponsor/orders", authRequired, async (req, res, next) => {
  try {
    const list = await prisma.sponsorOrder.findMany({
      where: { userId: req.user!.userId, payType: { in: IAP_PAY_TYPES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    ok(res, { list: list.map(formatSponsorOrder) });
  } catch (e) { next(e); }
});

const transactionSchema = z.object({
  signedTransaction: z.string().trim().min(20).max(20000),
  categoryId: z.string().trim().min(1).max(40).optional(),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(["public", "anonymous", "hidden"]).optional(),
});

/**
 * App 在 StoreKit 购买成功（或启动时发现没处理完的交易）后提交。同一笔交易重复提交返回同一张订单，
 * App 收到成功后才 finish 交易，所以网络断了下次启动会再交一次。
 */
appleSponsorRouter.post("/sponsor/transactions", authRequired, validate(transactionSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    let verified;
    try {
      verified = await verifyAppleSponsorTransaction(req.body.signedTransaction);
    } catch (error) {
      if (error instanceof AppleIapError) throw Errors.badRequest(error.message);
      throw error;
    }
    const { transaction, product, sandbox } = verified;
    const transactionId = String(transaction.transactionId);
    if (String(transaction.appAccountToken || "").toLowerCase() !== appleAppAccountToken(userId)) {
      throw Errors.forbidden("这笔购买不属于当前登录的账号");
    }
    const outTradeNo = iapOutTradeNo(transactionId);
    const existing = await findStoreSponsorOrder(outTradeNo, userId);
    if (existing) return ok(res, { order: formatSponsorOrder(existing), created: false });
    if (transaction.revocationDate) throw Errors.badRequest("这笔购买已退款");

    const { order, created } = await recordStoreSponsorOrder({
      userId,
      outTradeNo,
      tradeNo: transactionId,
      payType: sandbox ? "iap_sandbox" : "iap",
      sandbox,
      amountCents: product.amountCents,
      pointsAmountCents: appleIapPointsAmountCents(product.amountCents),
      paidAt: transaction.purchaseDate ? new Date(transaction.purchaseDate) : new Date(),
      categoryId: req.body.categoryId,
      message: req.body.message,
      displayMode: req.body.displayMode,
      storeName: "App Store",
    });
    ok(res, { order: formatSponsorOrder(order), created });
  } catch (e) { next(e); }
});

/**
 * App Store 服务器通知 V2（在 App Store Connect「App 信息」里填 https://cputime.cn/api/payments/apple/notifications）。
 * 退款或撤销时把订单标成 refunded，扣回赞助累计和还没用掉的那部分点数；VIP 不收回（和网页一致，VIP 不随订单变动）。
 */
appleSponsorRouter.post("/notifications", async (req, res, next) => {
  try {
    const signedPayload = String(req.body?.signedPayload || "");
    if (!signedPayload) return res.status(400).json({ code: 4000, message: "缺少 signedPayload" });
    let notice;
    try {
      notice = await decodeAppleRefundNotification(signedPayload);
    } catch {
      return res.status(400).json({ code: 4000, message: "通知无法验证" });
    }
    if (!notice) return ok(res, { handled: false });
    await refundStoreSponsorOrder({ outTradeNo: iapOutTradeNo(notice.transactionId), livePayType: "iap", reason: "App Store 赞助退款" });
    ok(res, { handled: true });
  } catch (e) { next(e); }
});
