export type ClientPlatform = "ios" | "android" | "web" | "unknown";

export function detectClientPlatform(ua = navigator.userAgent): ClientPlatform {
  const source = (ua || "").toLowerCase();
  if (source.includes("cpuwebscheduleapp") || source.includes("android")) return "android";
  if (source.includes("iphone") || source.includes("ipad") || source.includes("ipod")) return "ios";
  if (source.includes("macintosh") && navigator.maxTouchPoints > 1) return "ios";
  if (source) return "web";
  return "unknown";
}

export function clientPlatformLabel(platform: ClientPlatform) {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "安卓";
  if (platform === "web") return "网页";
  return "未知";
}
