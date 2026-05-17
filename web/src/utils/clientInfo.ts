export type ClientPlatform = "ios" | "android" | "web" | "unknown";

export function detectClientPlatform(ua = navigator.userAgent): ClientPlatform {
  const source = (ua || "").toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const isNativeApp = source.includes("cpuwebscheduleapp") || params.get("client") === "android-app";
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;

  if (isNativeApp) return "android";
  if (isStandalone && source.includes("android")) return "android";
  if (
    isStandalone &&
    (source.includes("iphone") || source.includes("ipad") || source.includes("ipod") || (source.includes("macintosh") && navigator.maxTouchPoints > 1))
  ) return "ios";
  if (source) return "web";
  return "unknown";
}

export function clientPlatformLabel(platform: ClientPlatform) {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "安卓";
  if (platform === "web") return "网页";
  return "未知";
}
