import { prisma } from "../prisma";
import { PLATFORM_BRAND } from "../schools/registry";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { awardSponsorAssistantPoints } from "./campusAssistantPoints";
import { buildSponsorPaidUserUpdate, getSponsorConfig, isSponsorCategoryAccepting } from "./sponsor";

/**
 * 应用商店内购（Apple、华为）的赞助记账。交易由各自的路由验签，这里只管把一笔已验证的交易记成赞助订单：
 * VIP、赞助墙、赞助类别和留言与网页一致，AI 点数按调用方给的折算金额计。
 *
 * 正式交易 status "paid"，和网页订单一起进赞助墙、类别进度和赞助榜。
 * 沙盒交易（审核、测试账号）status "sandbox"、不公开：照样发 VIP 和点数，但不计入公开金额和赞助累计。
 */
export type StoreSponsorPurchase = {
  userId: number;
  /** 订单号，同一笔交易固定：重复提交返回同一张订单。 */
  outTradeNo: string;
  tradeNo: string;
  payType: string;
  sandbox: boolean;
  amountCents: number;
  /** 算 AI 点数用的金额（商店抽成后）。 */
  pointsAmountCents: number;
  paidAt: Date;
  categoryId?: string;
  message?: string;
  displayMode?: "public" | "anonymous" | "hidden";
  /** 给管理员通知用的来源名，如“App Store”。 */
  storeName: string;
};

const NOT_YOURS = "这笔购买不属于当前登录的账号";

export async function findStoreSponsorOrder(outTradeNo: string, userId: number) {
  const existing = await prisma.sponsorOrder.findUnique({ where: { outTradeNo } });
  if (existing && existing.userId !== userId) throw Errors.forbidden(NOT_YOURS);
  return existing;
}

export async function recordStoreSponsorOrder(purchase: StoreSponsorPurchase) {
  const { userId, outTradeNo, sandbox } = purchase;
  const config = await getSponsorConfig();
  const accepting = (id: string | undefined) => config.categories.find((category) => category.id === id && isSponsorCategoryAccepting(category));
  // 钱已经付了：选的类别刚好结束时记到默认类别，不让交易卡住。
  const category = accepting(purchase.categoryId)
    ?? config.categories.find((item) => item.featured && isSponsorCategoryAccepting(item))
    ?? config.categories.find((item) => isSponsorCategoryAccepting(item))
    ?? config.categories[0];

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
        tradeNo: purchase.tradeNo,
        payType: purchase.payType,
        amountCents: purchase.amountCents,
        categoryId: category?.id ?? "general",
        categoryTitle: category?.title ?? `支持${PLATFORM_BRAND}`,
        message: config.allowMessage ? (purchase.message ?? "") : "",
        displayMode: sandbox ? "hidden" : (purchase.displayMode ?? "public"),
        status: sandbox ? "sandbox" : "paid",
        paidAt: purchase.paidAt,
      },
    });
    created = true;
    await tx.user.update({
      where: { id: userId },
      data: sandbox ? { isVip: true } : buildSponsorPaidUserUpdate(purchase.amountCents),
    });
    awardedPoints = await awardSponsorAssistantPoints(tx, {
      orderId: order.id,
      userId,
      amountCents: purchase.pointsAmountCents,
      pointsPerYuan: config.assistantPointsPerYuan,
    });
    order.assistantPointsAwarded = awardedPoints;
  }).catch(async (error: any) => {
    // 两次提交撞在一起：唯一键冲突时读回先写进去的那张。
    if (error?.code !== "P2002") throw error;
    order = await prisma.sponsorOrder.findUnique({ where: { outTradeNo } });
    created = false;
  });
  if (!order || order.userId !== userId) throw Errors.forbidden(NOT_YOURS);

  if (created) {
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
            content: `${purchase.storeName} 订单 ${order.outTradeNo} 已为“${order.categoryTitle || PLATFORM_BRAND}”支付 ¥${amountCentsToMoney(order.amountCents)}。`,
            link: "/admin",
            source: "赞助",
            payload: JSON.stringify({ type: "sponsor-admin", outTradeNo: order.outTradeNo, categoryId: order.categoryId }),
          })),
        }).catch(() => {});
      }
    }
  }
  return { order, created };
}

/**
 * 商店退款：订单标成 refunded，扣回赞助累计（只有正式订单计过）和还没用掉的那部分点数。
 * VIP 不收回（和网页一致，VIP 不随订单变动）。重复通知只处理一次。
 */
export async function refundStoreSponsorOrder(input: { outTradeNo: string; livePayType: string; reason: string }) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.sponsorOrder.findUnique({ where: { outTradeNo: input.outTradeNo } });
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
    if (order.payType === input.livePayType) data.sponsorTotalCents = Math.max(0, (user.sponsorTotalCents ?? 0) - order.amountCents);
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
          reason: input.reason,
          referenceType: "sponsor_order",
          referenceId: String(order.id),
        },
      });
    }
  });
}
