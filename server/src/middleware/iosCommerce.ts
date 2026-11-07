import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";
import { IOS_ANALYTICS_CLIENTS } from "../utils/loginClient";

export function isIosCommerceRequest(req: Pick<Request, "headers">) {
  const ua = String(req.headers["user-agent"] || "");
  const client = String(req.headers["x-cpu-client"] || "").trim().toLowerCase();
  return /CPUWebIOSApp/i.test(ua)
    || (/CPUTimeNative\//i.test(ua) && !/CPUWebHarmonyApp|CPUWebScheduleApp/i.test(ua))
    || (IOS_ANALYTICS_CLIENTS as readonly string[]).includes(client);
}

/** 只读的公开列表（赞助墙、赞助榜）不涉及付款，iOS 原生赞助页也要显示。 */
const IOS_READABLE_SPONSOR_PATHS = new Set(["/wall", "/ranking"]);

export function iosCommerceUnavailable(req: Request, _res: Response, next: NextFunction) {
  if (req.method === "GET" && IOS_READABLE_SPONSOR_PATHS.has(req.path)) return next();
  next(isIosCommerceRequest(req) ? Errors.forbidden("iOS 客户端不提供支付或权益兑换功能") : undefined);
}
