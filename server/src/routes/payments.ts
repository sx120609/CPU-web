import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { isFeatureOn } from "../services/siteSettings";
import {
  amountCentsToMoney,
  buildEpayCallbackUrls,
  buildEpaySubmitPayload,
  getEnabledEpayTypes,
  getEpayMerchantKey,
  moneyToAmountCents,
  resolvePaymentOrigin,
  verifyEpayParams,
  type EpayPayType,
} from "../services/epay";
import {
  calcSponsorOrderExpiresAt,
  closeExpiredSponsorOrderIfNeeded,
  closeExpiredSponsorOrders,
  formatSponsorOrder,
  formatSponsorWallOrder,
  getSponsorConfig,
  sponsorConfigToCents,
} from "../services/sponsor";

export const paymentsRouter = Router();

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function nextSponsorTradeNo(userId: number) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SP${Date.now()}U${userId}${random}`;
}

async function buildSponsorPayment(order: any, req: any) {
  const origin = resolvePaymentOrigin(requestOrigin(req));
  const callbacks = buildEpayCallbackUrls(origin);
  if (!callbacks.notifyUrl || !callbacks.returnUrl) throw Errors.badRequest("请先在后台基础配置中设置网站域名");
  return buildEpaySubmitPayload({
    outTradeNo: order.outTradeNo,
    name: "赞助药大拾间",
    money: amountCentsToMoney(order.amountCents),
    type: order.payType,
    notifyUrl: callbacks.notifyUrl,
    returnUrl: callbacks.returnUrl,
    clientIp: req.ip,
    device: "pc",
    param: `sponsor:${order.userId}`,
  });
}

function normalizeParams(input: Record<string, unknown>) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) params[key] = String(value[0] ?? "");
    else if (value !== undefined && value !== null) params[key] = String(value);
  }
  return params;
}

paymentsRouter.get("/sponsor/options", authRequired, async (_req, res, next) => {
  try {
    const config = await getSponsorConfig();
    const payTypes = await getEnabledEpayTypes();
    ok(res, {
      enabled: isFeatureOn("sponsor") && payTypes.length > 0,
      payTypes,
      amounts: config.presetAmounts,
      minAmount: config.minAmount,
      maxAmount: config.maxAmount,
      title: config.title,
      description: config.description,
      wallEnabled: config.wallEnabled,
      allowMessage: config.allowMessage,
    });
  } catch (e) { next(e); }
});

const sponsorCreateSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  payType: z.enum(["alipay", "wxpay", "qqpay", "bank", "jdpay"]),
  message: z.string().trim().max(80).optional(),
  displayMode: z.enum(["public", "anonymous", "hidden"]).optional(),
});

paymentsRouter.post("/sponsor/orders", authRequired, validate(sponsorCreateSchema), async (req, res, next) => {
  try {
    if (!isFeatureOn("sponsor")) throw Errors.badRequest("赞助功能当前已关闭");
    const config = await getSponsorConfig();
    const { minAmountCents, maxAmountCents } = sponsorConfigToCents(config);
    const amountCents = moneyToAmountCents(req.body.amount);
    if (amountCents < minAmountCents || amountCents > maxAmountCents) {
      throw Errors.badRequest(`赞助金额需在 ${amountCentsToMoney(minAmountCents)} - ${amountCentsToMoney(maxAmountCents)} 元之间`);
    }
    const enabledTypes = await getEnabledEpayTypes();
    if (!enabledTypes.includes(req.body.payType as EpayPayType)) throw Errors.badRequest("该支付方式暂不可用");

    const userId = req.user!.userId;
    const outTradeNo = nextSponsorTradeNo(userId);
    const order = await prisma.sponsorOrder.create({
      data: {
        userId,
        outTradeNo,
        payType: req.body.payType,
        amountCents,
        message: config.allowMessage ? (req.body.message ?? "") : "",
        displayMode: req.body.displayMode ?? "public",
        expiresAt: calcSponsorOrderExpiresAt(),
      },
    });
    const epay = await buildSponsorPayment(order, req);
    ok(res, {
      order: formatSponsorOrder(order),
      epay,
    });
  } catch (e: any) {
    if (
      e?.message === "支付金额不正确" ||
      e?.message === "该支付方式未启用" ||
      e?.message === "易支付尚未启用" ||
      e?.message === "易支付网关地址未配置" ||
      e?.message === "易支付商户 ID 未配置" ||
      e?.message === "易支付商户密钥未配置"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

paymentsRouter.get("/sponsor/orders", authRequired, async (req, res, next) => {
  try {
    await closeExpiredSponsorOrders();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(5, Number(req.query.size ?? 20)));
    const status = String(req.query.status ?? "").trim();
    const where: { userId: number; status?: string } = { userId: req.user!.userId };
    if (["pending", "paid", "closed"].includes(status)) where.status = status;
    const [list, total] = await Promise.all([
      prisma.sponsorOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.sponsorOrder.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map(formatSponsorOrder) });
  } catch (e) { next(e); }
});

paymentsRouter.get("/sponsor/orders/:outTradeNo", authRequired, async (req, res, next) => {
  try {
    const outTradeNo = String(req.params.outTradeNo || "").trim();
    const current = await prisma.sponsorOrder.findFirst({
      where: { outTradeNo, userId: req.user!.userId },
    });
    if (!current) throw Errors.notFound("订单不存在");
    const order = await closeExpiredSponsorOrderIfNeeded(current);
    ok(res, formatSponsorOrder(order));
  } catch (e) { next(e); }
});

paymentsRouter.post("/sponsor/orders/:outTradeNo/pay", authRequired, async (req, res, next) => {
  try {
    const outTradeNo = String(req.params.outTradeNo || "").trim();
    const current = await prisma.sponsorOrder.findFirst({
      where: { outTradeNo, userId: req.user!.userId },
    });
    if (!current) throw Errors.notFound("订单不存在");
    const order = await closeExpiredSponsorOrderIfNeeded(current);
    if (!order) throw Errors.notFound("订单不存在");
    if (order.status !== "pending") {
      if (order.status === "closed") throw Errors.badRequest("订单已超时关闭，请重新发起赞助");
      throw Errors.badRequest("该订单不可继续支付");
    }
    const epay = await buildSponsorPayment(order, req);
    ok(res, { order: formatSponsorOrder(order), epay });
  } catch (e: any) {
    if (
      e?.message === "该支付方式未启用" ||
      e?.message === "易支付尚未启用" ||
      e?.message === "易支付网关地址未配置" ||
      e?.message === "易支付商户 ID 未配置" ||
      e?.message === "易支付商户密钥未配置"
    ) {
      next(Errors.badRequest(e.message));
      return;
    }
    next(e);
  }
});

paymentsRouter.post("/sponsor/orders/:outTradeNo/close", authRequired, async (req, res, next) => {
  try {
    const outTradeNo = String(req.params.outTradeNo || "").trim();
    const current = await prisma.sponsorOrder.findFirst({
      where: { outTradeNo, userId: req.user!.userId },
    });
    if (!current) throw Errors.notFound("订单不存在");
    const order = await closeExpiredSponsorOrderIfNeeded(current);
    if (!order) throw Errors.notFound("订单不存在");
    if (order.status !== "pending") throw Errors.badRequest("只有待支付订单可以关闭");
    const updated = await prisma.sponsorOrder.update({
      where: { id: order.id },
      data: { status: "closed", closedAt: new Date() },
    });
    ok(res, formatSponsorOrder(updated));
  } catch (e) { next(e); }
});

paymentsRouter.get("/sponsor/wall", async (_req, res, next) => {
  try {
    const config = await getSponsorConfig();
    if (!config.wallEnabled) return ok(res, { enabled: false, total: 0, list: [] });
    const where = { status: "paid" as const, displayMode: { not: "hidden" } };
    const [list, totalAmount] = await Promise.all([
      prisma.sponsorOrder.findMany({
        where,
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        take: 30,
        include: { user: { select: { id: true, nickname: true, avatar: true } } },
      }),
      prisma.sponsorOrder.aggregate({ where: { status: "paid" }, _sum: { amountCents: true }, _count: true }),
    ]);
    ok(res, {
      enabled: true,
      total: totalAmount._count,
      totalAmount: amountCentsToMoney(totalAmount._sum.amountCents ?? 0),
      list: list.map(formatSponsorWallOrder),
    });
  } catch (e) { next(e); }
});

paymentsRouter.all("/epay/notify", async (req, res, next) => {
  let logId: number | null = null;
  try {
    const params = normalizeParams({ ...req.query, ...req.body });
    const outTradeNo = params.out_trade_no || "";
    const existingOrder = outTradeNo
      ? await prisma.sponsorOrder.findUnique({ where: { outTradeNo }, select: { id: true } })
      : null;
    const merchantKey = await getEpayMerchantKey();
    const signOk = Boolean(merchantKey && verifyEpayParams(params, merchantKey));
    const log = await prisma.sponsorPaymentLog.create({
      data: {
        orderId: existingOrder?.id ?? null,
        outTradeNo: outTradeNo || null,
        rawPayload: JSON.stringify(params),
        signOk,
        result: signOk ? "received" : "bad-sign",
      },
    });
    logId = log.id;
    if (!signOk) {
      res.type("text/plain").status(400).send("fail");
      return;
    }
    if (params.trade_status !== "TRADE_SUCCESS") {
      await prisma.sponsorPaymentLog.update({ where: { id: logId }, data: { handled: true, result: "ignored-status" } });
      res.type("text/plain").send("success");
      return;
    }
    const paidCents = moneyToAmountCents(params.money || "0");
    let paidOrder: any = null;
    let newlyPaid = false;
    await prisma.$transaction(async (tx) => {
      const order = await tx.sponsorOrder.findUnique({ where: { outTradeNo } });
      if (!order) throw new Error("订单不存在");
      if (order.status === "paid") {
        paidOrder = order;
        return;
      }
      if (order.amountCents !== paidCents) throw new Error("支付金额与订单不一致");
      paidOrder = await tx.sponsorOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: order.userId },
        data: { sponsorTotalCents: { increment: order.amountCents } },
      });
      newlyPaid = true;
    });
    if (newlyPaid && paidOrder && paidOrder.status === "paid") {
      await prisma.notification.create({
        data: {
          userId: paidOrder.userId,
          category: "system",
          level: "normal",
          title: "赞助已到账",
          content: `感谢赞助 ¥${amountCentsToMoney(paidOrder.amountCents)}，你的支持已经记录在个人资料中。`,
          link: "/profile",
          source: "赞助",
          payload: JSON.stringify({ type: "sponsor-paid", outTradeNo: paidOrder.outTradeNo, amount: amountCentsToMoney(paidOrder.amountCents) }),
        },
      }).catch(() => {});
      const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            category: "system",
            level: "weak",
            title: "收到一笔赞助",
            content: `订单 ${paidOrder.outTradeNo} 已支付 ¥${amountCentsToMoney(paidOrder.amountCents)}。`,
            link: "/admin",
            source: "赞助",
            payload: JSON.stringify({ type: "sponsor-admin", outTradeNo: paidOrder.outTradeNo }),
          })),
        }).catch(() => {});
      }
    }
    if (logId) await prisma.sponsorPaymentLog.update({ where: { id: logId }, data: { handled: true, result: "success", orderId: paidOrder?.id ?? existingOrder?.id ?? null } });
    res.type("text/plain").send("success");
  } catch (e: any) {
    if (logId) {
      await prisma.sponsorPaymentLog.update({ where: { id: logId }, data: { handled: false, result: e?.message || "error" } }).catch(() => {});
    }
    if (e?.message === "支付金额不正确" || e?.message === "支付金额与订单不一致" || e?.message === "订单不存在") {
      res.type("text/plain").status(400).send("fail");
      return;
    }
    next(e);
  }
});

paymentsRouter.get("/epay/return", async (req, res) => {
  const origin = resolvePaymentOrigin(requestOrigin(req));
  const status = String(req.query.trade_status ?? "") === "TRADE_SUCCESS" ? "success" : "pending";
  const outTradeNo = encodeURIComponent(String(req.query.out_trade_no ?? ""));
  const target = origin
    ? `${origin}/profile?sponsor=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`
    : `/profile?sponsor=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`;
  res.redirect(302, target);
});
