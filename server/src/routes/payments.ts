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

export const paymentsRouter = Router();

const SPONSOR_MIN_CENTS = 100;
const SPONSOR_MAX_CENTS = 999900;

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function nextSponsorTradeNo(userId: number) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SP${Date.now()}U${userId}${random}`;
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
    const payTypes = await getEnabledEpayTypes();
    ok(res, {
      enabled: isFeatureOn("sponsor") && payTypes.length > 0,
      payTypes,
      amounts: [5, 10, 20, 50],
      minAmount: amountCentsToMoney(SPONSOR_MIN_CENTS),
      maxAmount: amountCentsToMoney(SPONSOR_MAX_CENTS),
    });
  } catch (e) { next(e); }
});

const sponsorCreateSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  payType: z.enum(["alipay", "wxpay", "qqpay", "bank", "jdpay"]),
});

paymentsRouter.post("/sponsor/orders", authRequired, validate(sponsorCreateSchema), async (req, res, next) => {
  try {
    if (!isFeatureOn("sponsor")) throw Errors.badRequest("赞助功能当前已关闭");
    const amountCents = moneyToAmountCents(req.body.amount);
    if (amountCents < SPONSOR_MIN_CENTS || amountCents > SPONSOR_MAX_CENTS) {
      throw Errors.badRequest(`赞助金额需在 ${amountCentsToMoney(SPONSOR_MIN_CENTS)} - ${amountCentsToMoney(SPONSOR_MAX_CENTS)} 元之间`);
    }
    const enabledTypes = await getEnabledEpayTypes();
    if (!enabledTypes.includes(req.body.payType as EpayPayType)) throw Errors.badRequest("该支付方式暂不可用");

    const userId = req.user!.userId;
    const outTradeNo = nextSponsorTradeNo(userId);
    const origin = resolvePaymentOrigin(requestOrigin(req));
    const callbacks = buildEpayCallbackUrls(origin);
    if (!callbacks.notifyUrl || !callbacks.returnUrl) throw Errors.badRequest("请先在后台基础配置中设置网站域名");

    const order = await prisma.sponsorOrder.create({
      data: {
        userId,
        outTradeNo,
        payType: req.body.payType,
        amountCents,
      },
    });
    const epay = await buildEpaySubmitPayload({
      outTradeNo,
      name: "赞助药大垎坊",
      money: amountCentsToMoney(amountCents),
      type: req.body.payType,
      notifyUrl: callbacks.notifyUrl,
      returnUrl: callbacks.returnUrl,
      clientIp: req.ip,
      device: "pc",
      param: `sponsor:${userId}`,
    });
    ok(res, {
      order: {
        id: order.id,
        outTradeNo: order.outTradeNo,
        amount: amountCentsToMoney(order.amountCents),
        status: order.status,
      },
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

paymentsRouter.get("/sponsor/orders/:outTradeNo", authRequired, async (req, res, next) => {
  try {
    const outTradeNo = String(req.params.outTradeNo || "").trim();
    const order = await prisma.sponsorOrder.findFirst({
      where: { outTradeNo, userId: req.user!.userId },
    });
    if (!order) throw Errors.notFound("订单不存在");
    ok(res, {
      outTradeNo: order.outTradeNo,
      status: order.status,
      amount: amountCentsToMoney(order.amountCents),
      paidAt: order.paidAt,
    });
  } catch (e) { next(e); }
});

paymentsRouter.all("/epay/notify", async (req, res, next) => {
  try {
    const params = normalizeParams({ ...req.query, ...req.body });
    const merchantKey = await getEpayMerchantKey();
    if (!merchantKey || !verifyEpayParams(params, merchantKey)) {
      res.type("text/plain").status(400).send("fail");
      return;
    }
    if (params.trade_status !== "TRADE_SUCCESS") {
      res.type("text/plain").send("success");
      return;
    }
    const outTradeNo = params.out_trade_no;
    const paidCents = moneyToAmountCents(params.money || "0");
    await prisma.$transaction(async (tx) => {
      const order = await tx.sponsorOrder.findUnique({ where: { outTradeNo } });
      if (!order || order.status === "paid") return;
      if (order.amountCents !== paidCents) throw new Error("支付金额与订单不一致");
      await tx.sponsorOrder.update({
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
    });
    res.type("text/plain").send("success");
  } catch (e: any) {
    if (e?.message === "支付金额不正确" || e?.message === "支付金额与订单不一致") {
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
