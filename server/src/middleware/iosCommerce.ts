import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";
import { IOS_ANALYTICS_CLIENTS } from "../utils/loginClient";
import { authOptional } from "./auth";

export const IOS_SPONSOR_RESTRICTED_USERNAME = "2020240384";

export function isIosCommerceRequest(req: Pick<Request, "headers">) {
  const ua = String(req.headers["user-agent"] || "");
  const client = String(req.headers["x-cpu-client"] || "").trim().toLowerCase();
  return /CPUWebIOSApp/i.test(ua)
    || (/CPUTimeNative\//i.test(ua) && !/CPUWebHarmonyApp|CPUWebScheduleApp/i.test(ua))
    || (IOS_ANALYTICS_CLIENTS as readonly string[]).includes(client);
}

export function iosCommerceUnavailable(req: Request, _res: Response, next: NextFunction) {
  next(isIosCommerceRequest(req) ? Errors.forbidden("iOS 客户端不提供支付或权益兑换功能") : undefined);
}

export function isIosSponsorUnavailable(isLoggedIn: boolean, username?: string | null) {
  return !isLoggedIn || String(username || "").trim() === IOS_SPONSOR_RESTRICTED_USERNAME;
}

/** VIP stays unavailable on iOS; sponsorship is open there to signed-in users other than the restricted account. */
export function iosSponsorUnavailable(req: Request, res: Response, next: NextFunction) {
  if (!isIosCommerceRequest(req)) return next();
  void authOptional(req, res, () => {
    next(isIosSponsorUnavailable(Boolean(req.user), req.user?.studentId)
      ? Errors.forbidden("iOS 客户端不提供支付或权益兑换功能")
      : undefined);
  });
}
