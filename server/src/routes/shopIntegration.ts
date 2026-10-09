import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";

export const shopIntegrationRouter = Router();

function authenticateIntegration(suppliedSecret: string, expectedSecret: string) {
  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedSecret);
  if (expected.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw Errors.unauthorized("站点集成认证失败");
  }
}

for (const service of [
  { name: "dayi-shop", header: "x-shop-integration-secret", secret: () => config.shopIntegrationSecret },
  { name: "shijian-pay", header: "x-pay-integration-secret", secret: () => config.payIntegrationSecret },
]) shopIntegrationRouter.get(`/${service.name}/users/:userId/access`, async (req, res, next) => {
  try {
    authenticateIntegration(String(req.header(service.header) || ""), service.secret());
    const userId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(req.params.userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    res.setHeader("Cache-Control", "no-store");
    ok(res, { userId, globalAdmin: user?.role === "admin" && user.status === "active" });
  } catch (error) { next(error); }
});

const eventSchema = z.object({
  userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  orderId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  orderNo: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  status: z.enum(["paid", "delivered", "completed", "refunded", "partially_refunded"]),
  refundRecordId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();
const batchSchema = z.object({ notifications: z.array(eventSchema).min(1).max(100) }).strict();

const statusText = {
  paid: "支付成功", delivered: "已发货", completed: "已完成", refunded: "已退款", partially_refunded: "已部分退款",
} as const;

shopIntegrationRouter.post("/dayi-shop/notifications", async (req, res, next) => {
  try {
    authenticateIntegration(String(req.header("x-shop-integration-secret") || ""), config.shopIntegrationSecret);
    const { notifications } = batchSchema.parse(req.body);
    let count = 0;
    let skipped = 0;
    for (const item of notifications) {
      // Stable event identity, computed here rather than accepting an arbitrary
      // retry key or arbitrary notification text/link from the caller.
      const deliveryKey = createHash("sha256")
        .update(`dayi-shop:${item.userId}:${item.orderId}:${item.status}:${item.refundRecordId}`).digest("hex");
      const delivered = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryKey}, 0))`;
        const user = await tx.user.findUnique({ where: { id: item.userId }, select: { status: true } });
        if (!user || ["banned", "deleting", "deleted"].includes(user.status)) return false;
        const exists = await tx.notification.findFirst({
          where: { userId: item.userId, source: "大义软商", payload: { contains: `"deliveryKey":"${deliveryKey}"` } },
          select: { id: true },
        });
        if (!exists) {
          await tx.notification.create({ data: {
            userId: item.userId,
            category: "service-tool",
            level: "normal",
            source: "大义软商",
            title: `大义软商 · 订单${statusText[item.status]}`,
            content: `订单 ${item.orderNo} ${statusText[item.status]}，请前往商城查看详情。`,
            link: `${config.shopOrigin}/orders/${item.orderNo}`,
            payload: JSON.stringify({ type: "shop-order-status", toolCode: "dayi-shop", orderId: item.orderId, status: item.status, deliveryKey }),
          } });
        }
        return true;
      });
      if (delivered) count++; else skipped++;
    }
    ok(res, { count, skipped });
  } catch (error) { next(error); }
});
