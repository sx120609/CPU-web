import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";
import { IOS_ANALYTICS_CLIENTS } from "../utils/loginClient";

export function isIosCommerceRequest(req: Pick<Request, "headers">) {
  const ua = String(req.headers["user-agent"] || "");
  const client = String(req.headers["x-cpu-client"] || "").trim().toLowerCase();
  return /CPUWebIOSApp/i.test(ua)
    || (/CPUTimeNative\//i.test(ua) && !/CPUWebHarmonyApp/i.test(ua))
    || (IOS_ANALYTICS_CLIENTS as readonly string[]).includes(client);
}

export function iosCommerceUnavailable(req: Request, _res: Response, next: NextFunction) {
  next(isIosCommerceRequest(req) ? Errors.forbidden("iOS 客户端不提供支付或权益兑换功能") : undefined);
}
