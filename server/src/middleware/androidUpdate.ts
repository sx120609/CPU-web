import type { RequestHandler } from "express";
import { publishedAndroidRelease } from "../services/androidRelease";
import { getAndroidUpdateRequirement } from "../services/androidUpdateRequirement";

// Paths are relative to /api. Keep bootstrap metadata and the update escape
// route available, including for old cached web bundles and legacy shells.
const EXEMPT_PATHS = new Set([
  "/health", "/ready", "/site/features", "/site/config",
  "/site/downloads/android", "/site/downloads/android-app", "/site/downloads/android-patch",
  "/auth/logout", "/security/csp-report",
]);

export function androidVersionFromUserAgent(ua: string): number | null {
  if (!/\bCPUWebScheduleApp\b/i.test(ua)) return null;
  const match = /\bCPUWebScheduleApp\/(\d+)(?=\s|[;)]|$)/i.exec(ua);
  const version = Number(match?.[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

export function createAndroidUpdateGate(dependencies = {
  readRequirement: getAndroidUpdateRequirement,
  now: Date.now,
}): RequestHandler {
  return async (req, res, next) => {
    const version = androidVersionFromUserAgent(req.get("user-agent") || "");
    const pathname = req.path.replace(/\/+$/, "") || "/";
    if (version === null || req.method === "OPTIONS" || EXEMPT_PATHS.has(pathname)
      || pathname === "/privacy" || pathname.startsWith("/privacy/")) return next();
    try {
      const requirement = await dependencies.readRequirement();
      const now = dependencies.now();
      if (version >= requirement.minimumVersionCode || now < Date.parse(requirement.deadlineAt)) return next();
      res.setHeader("Cache-Control", "no-store");
      res.status(426).json({
        code: 4260,
        data: {
          reason: "ANDROID_UPDATE_REQUIRED",
          updateRequirement: requirement,
          serverTime: new Date(now).toISOString(),
          release: publishedAndroidRelease,
          downloadUrl: "/api/site/downloads/android-app",
        },
        message: "旧版 Android 客户端的更新期限已到，请更新至最新版后继续使用。",
      });
    } catch (error) { next(error); }
  };
}

export const androidUpdateGate = createAndroidUpdateGate();
