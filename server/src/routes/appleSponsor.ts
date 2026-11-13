import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { PLATFORM_BRAND } from "../schools/registry";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { isFeatureOn } from "../services/siteSettings";
import { amountCentsToMoney } from "../services/epay";
import {
  buildSponsorPaidUserUpdate,
  formatSponsorOrder,
  getSponsorCategoriesWithStats,
  getSponsorConfig,
  isSponsorCategoryAccepting,
} from "../services/sponsor";
import { awardSponsorAssistantPoints, calculateSponsorAssistantPoints } from "../services/campusAssistantPoints";
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
    const existing = await prisma.sponsorOrder.findUnique({ where: { outTradeNo } });
    if (existing) {
      if (existing.userId !== userId) throw Errors.forbidden("这笔购买不属于当前登录的账号");
      return ok(res, { order: formatSponsorOrder(existing), created: false });
    }
    if (transaction.revocationDate) throw Errors.badRequest("这笔购买已退款");

    const config = await getSponsorConfig();
    const accepting = (id: string | undefined) => config.categories.find((category) => category.id === id && isSponsorCategoryAccepting(category));
    // 钱已经付了：选的类别刚好结束时记到默认类别，不让交易卡住。
    const category = accepting(req.body.categoryId)
      ?? config.categories.find((item) => item.featured && isSponsorCategoryAccepting(item))
      ?? config.categories.find((item) => isSponsorCategoryAccepting(item))
      ?? config.categories[0];
    const paidAt = transaction.purchaseDate ? new Date(transaction.purchaseDate) : new Date();

    let order: any = null;
    let created = false;
    let awardedPoints = 0;
    await prisma.$transaction(async (tx) => {
      const already = await tx.sponsorOrder.findUnique({ where: { outTradeNo } });
      if (already) {
        order = already;
        return;
      }
      order = await tx.sponsorOrder.create({
        data: {
          userId,
          outTradeNo,
          tradeNo: transactionId,
          payType: sandbox ? "iap_sandbox" : "iap",
          amountCents: product.amountCents,
          categoryId: category?.id ?? "general",
          categoryTitle: category?.title ?? `支持${PLATFORM_BRAND}`,
          message: config.allowMessage ? (req.body.message ?? "") : "",
          displayMode: sandbox ? "hidden" : (req.body.displayMode ?? "public"),
          status: sandbox ? "sandbox" : "paid",
          paidAt,
        },
      });
      created = true;
      await tx.user.update({
        where: { id: userId },
        data: sandbox ? { isVip: true } : buildSponsorPaidUserUpdate(product.amountCents),
      });
      awardedPoints = await awardSponsorAssistantPoints(tx, {
        orderId: order.id,
        userId,
        amountCents: appleIapPointsAmountCents(product.amountCents),
        pointsPerYuan: config.assistantPointsPerYuan,
      });
      order.assistantPointsAwarded = awardedPoints;
    }).catch(async (error: any) => {
      // 两次提交撞在一起：唯一键冲突时读回先写进去的那张。
      if (error?.code !== "P2002") throw error;
      order = await prisma.sponsorOrder.findUnique({ where: { outTradeNo } });
      if (!order || order.userId !== userId) throw Errors.forbidden("这笔购买不属于当前登录的账号");
      created = false;
    });

    if (created && order) {
      await prisma.notification.create({
        data: {
          userId,
          category: "system",
          level: "normal",
          title: "赞助已到账",
          content: `感谢为“${order.categoryTitle || PLATFORM_BRAND}”赞助 ¥${amountCentsToMoney(order.amountCents)}，你的支持已经记录在个人资料中${awardedPoints > 0 ? `，并获得 ${awardedPoints} 个 AI 点数` : ""}。`,
          link: "/profile",
          source: "赞助",
          payload: JSON.stringify({
            type: "sponsor-paid",
            outTradeNo: order.outTradeNo,
            amount: amountCentsToMoney(order.amountCents),
            categoryId: order.categoryId,
            categoryTitle: order.categoryTitle,
            assistantPoints: awardedPoints,
          }),
        },
      }).catch(() => {});
      if (!sandbox) {
        const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
        if (admins.length) {
          await prisma.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              category: "system",
              level: "weak",
              title: "收到一笔赞助",
              content: `App Store 订单 ${order.outTradeNo} 已为“${order.categoryTitle || PLATFORM_BRAND}”支付 ¥${amountCentsToMoney(order.amountCents)}。`,
              link: "/admin",
              source: "赞助",
              payload: JSON.stringify({ type: "sponsor-admin", outTradeNo: order.outTradeNo, categoryId: order.categoryId }),
            })),
          }).catch(() => {});
        }
      }
    }
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
    const outTradeNo = iapOutTradeNo(notice.transactionId);
    await prisma.$transaction(async (tx) => {
      const order = await tx.sponsorOrder.findUnique({ where: { outTradeNo } });
      if (!order || order.status === "refunded") return;
      const claimed = await tx.sponsorOrder.updateMany({
        where: { id: order.id, status: { not: "refunded" } },
        data: { status: "refunded", closedAt: new Date() },
      });
      if (claimed.count !== 1) return;
      const user = await tx.user.findUnique({ where: { id: order.userId }, select: { assistantPoints: true, sponsorTotalCents: true } });
      if (!user) return;
      const revoke = Math.max(0, Math.min(order.assistantPointsAwarded, Math.floor(Number(user.assistantPoints) || 0)));
      const data: any = {};
      if (order.payType === "iap") data.sponsorTotalCents = Math.max(0, (user.sponsorTotalCents ?? 0) - order.amountCents);
      if (revoke > 0) data.assistantPoints = { decrement: revoke };
      if (!Object.keys(data).length) return;
      const updated = await tx.user.update({ where: { id: order.userId }, data, select: { assistantPoints: true } });
      if (revoke > 0) {
        await tx.campusAssistantPointLedger.create({
          data: {
            userId: order.userId,
            delta: -revoke,
            balanceAfter: updated.assistantPoints,
            source: "sponsor_refund",
            reason: "App Store 赞助退款",
            referenceType: "sponsor_order",
            referenceId: String(order.id),
          },
        });
      }
    });
    ok(res, { handled: true });
  } catch (e) { next(e); }
});
