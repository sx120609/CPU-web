import type { Request } from "express";

export type LoginClient = "ios" | "android" | "harmony" | "web" | "desktop" | "unknown";

/** Stored analytics values for iOS; plain "ios" is the historical, unclassified bucket. */
export const IOS_ANALYTICS_CLIENTS = ["ios", "ios-native", "ios-pwa"] as const;

export interface LoginClientInfo {
  client: LoginClient;
  label: string;
  analyticsClient: LoginClient | "ios-native" | "ios-pwa";
}

function normalizeClient(value: string | undefined | null): LoginClient | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (["ios-app", "iphone", "ipad", ...IOS_ANALYTICS_CLIENTS].includes(v)) return "ios";
  if (["android", "android-app"].includes(v)) return "android";
  if (["harmony", "harmony-app", "harmonyos", "ohos"].includes(v)) return "harmony";
  if (["desktop", "electron"].includes(v)) return "desktop";
  if (v === "web" || v === "browser") return "web";
  if (v === "unknown") return "unknown";
  return null;
}

export function detectLoginClient(req: Request): LoginClientInfo {
  const ua = (req.get("user-agent") ?? "").toLowerCase();
  // Native UA tokens take priority over stale platform headers from older web bundles.
  // Harmony also uses CPUTimeNative, so it must be checked first.
  if (ua.includes("cpuwebharmonyapp")) return toInfo("harmony");
  if (ua.includes("cpuwebiosapp") || ua.includes("cputimenative/")) return toInfo("ios", "ios-native");
  const variant = req.get("x-cpu-client")?.trim().toLowerCase();
  if (variant === "ios-native" || variant === "ios-pwa") return toInfo("ios", variant);
  const explicit = normalizeClient(req.get("x-cpu-client"));
  if (explicit) return toInfo(explicit);

  if (ua.includes("cpuwebscheduleapp")) return toInfo("android");
  if (ua.includes("electron")) return toInfo("desktop");
  if (ua) return toInfo("web");
  return toInfo("unknown");
}

export function loginClientUsage(info: LoginClientInfo) {
  return {
    usedIosClient: info.client === "ios" ? true : undefined,
    usedIosNativeClient: info.analyticsClient === "ios-native" ? true : undefined,
    usedIosPwaClient: info.analyticsClient === "ios-pwa" ? true : undefined,
    usedAndroidClient: info.client === "android" ? true : undefined,
    usedHarmonyClient: info.client === "harmony" ? true : undefined,
    usedDesktopClient: info.client === "desktop" ? true : undefined,
  };
}

function toInfo(client: LoginClient, analyticsClient: LoginClientInfo["analyticsClient"] = client): LoginClientInfo {
  const labels = { ios: "iOS", android: "安卓", harmony: "鸿蒙", desktop: "桌面端", web: "网页", unknown: "未知" };
  return { client, analyticsClient, label: labels[client] };
}
