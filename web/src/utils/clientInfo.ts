export type ClientPlatform = "ios" | "android" | "harmony" | "web" | "unknown";

export const ANDROID_APP_LATEST_VERSION_CODE = 17;
export const ANDROID_APP_LATEST_VERSION_NAME = "2.0.8";
export const HARMONY_APP_LATEST_VERSION_CODE = 17;
export const HARMONY_APP_LATEST_VERSION_NAME = "2.0.8";
export const ANDROID_APP_DOWNLOAD_URL = "/api/site/downloads/android-app";
export const ANDROID_WIDGET_MIN_VERSION_CODE = 5;
export const ANDROID_IN_APP_UPDATE_MIN_VERSION_CODE = 14;

export function detectClientPlatform(ua = navigator.userAgent): ClientPlatform {
  const source = (ua || "").toLowerCase();
  const params = new URLSearchParams(window.location.search);

  if (isHarmonyNativeApp(ua)) return "harmony";
  if (isAndroidNativeApp(ua)) return "android";
  if (isStandaloneMode() && source.includes("android")) return "android";
  if (isIosStandalone(ua)) return "ios";
  if (source) return "web";
  return "unknown";
}

export function isStandaloneMode() {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
}

export function isIosStandalone(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  const looksLikeIos = source.includes("iphone")
    || source.includes("ipad")
    || source.includes("ipod")
    || (source.includes("macintosh") && navigator.maxTouchPoints > 1);
  return isStandaloneMode() && looksLikeIos;
}

export function isAndroidNativeApp(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return source.includes("cpuwebscheduleapp") || params.get("client") === "android-app";
}

export function isHarmonyNativeApp(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return source.includes("cpuwebharmonyapp") || params.get("client") === "harmony-app";
}

export function getHarmonyNativeVersionCode(ua = navigator.userAgent) {
  const bridge = (window as any).CPUHarmony;
  const bridgeVersion = Number(typeof bridge?.getVersionCode === "function" ? bridge.getVersionCode() : 0);
  if (Number.isFinite(bridgeVersion) && bridgeVersion > 0) return Math.floor(bridgeVersion);

  const params = new URLSearchParams(window.location.search);
  const queryVersion = Number(params.get("harmonyVersionCode") || params.get("appVersionCode") || 0);
  if (Number.isFinite(queryVersion) && queryVersion > 0) return Math.floor(queryVersion);

  const source = ua || "";
  const vcMatch = source.match(/CPUWebHarmonyApp[^;\s)]*(?:vc|versionCode)[=/](\d+)/i);
  if (vcMatch) return Number(vcMatch[1]) || 0;

  const versionMatch = source.match(/CPUWebHarmonyApp\/(\d+(?:\.\d+)?)/i);
  if (versionMatch) return Number(versionMatch[1].split(".")[0]) || 0;

  return isHarmonyNativeApp(ua) ? 1 : 0;
}

export function getHarmonyNativeVersionName(ua = navigator.userAgent) {
  const bridge = (window as any).CPUHarmony;
  const bridgeVersion = typeof bridge?.getVersionName === "function" ? String(bridge.getVersionName() || "") : "";
  if (bridgeVersion) return bridgeVersion;

  const params = new URLSearchParams(window.location.search);
  const queryVersion = params.get("harmonyVersionName") || params.get("appVersionName");
  if (queryVersion) return queryVersion;

  const source = ua || "";
  const versionNameMatch = source.match(/CPUWebHarmonyAppVersion\/([^;\s)]+)/i);
  if (versionNameMatch) return versionNameMatch[1];

  const versionMatch = source.match(/CPUWebHarmonyApp\/([^;\s)]+)/i);
  return versionMatch?.[1] ?? "";
}

export function getAndroidNativeVersionCode(ua = navigator.userAgent) {
  const bridge = (window as any).CPUAndroid;
  const bridgeVersion = Number(typeof bridge?.getVersionCode === "function" ? bridge.getVersionCode() : 0);
  if (Number.isFinite(bridgeVersion) && bridgeVersion > 0) return Math.floor(bridgeVersion);

  const params = new URLSearchParams(window.location.search);
  const queryVersion = Number(params.get("androidVersionCode") || params.get("appVersionCode") || 0);
  if (Number.isFinite(queryVersion) && queryVersion > 0) return Math.floor(queryVersion);

  const source = ua || "";
  const vcMatch = source.match(/CPUWebScheduleApp[^;\s)]*(?:vc|versionCode)[=/](\d+)/i);
  if (vcMatch) return Number(vcMatch[1]) || 0;

  const versionMatch = source.match(/CPUWebScheduleApp\/(\d+(?:\.\d+)?)/i);
  if (versionMatch) return Number(versionMatch[1].split(".")[0]) || 0;

  return isAndroidNativeApp(ua) ? 1 : 0;
}

export function getAndroidNativeVersionName(ua = navigator.userAgent) {
  const bridge = (window as any).CPUAndroid;
  const bridgeVersion = typeof bridge?.getVersionName === "function" ? String(bridge.getVersionName() || "") : "";
  if (bridgeVersion) return bridgeVersion;

  const params = new URLSearchParams(window.location.search);
  const queryVersion = params.get("androidVersionName") || params.get("appVersionName");
  if (queryVersion) return queryVersion;

  const source = ua || "";
  const versionNameMatch = source.match(/CPUWebScheduleAppVersion\/([^;\s)]+)/i);
  if (versionNameMatch) return versionNameMatch[1];

  const versionMatch = source.match(/CPUWebScheduleApp\/([^;\s)]+)/i);
  return versionMatch?.[1] ?? "";
}

export function isAndroidAppUpdateAvailable(ua = navigator.userAgent) {
  return isAndroidNativeApp(ua) && getAndroidNativeVersionCode(ua) < ANDROID_APP_LATEST_VERSION_CODE;
}

export function supportsAndroidScheduleWidget(ua = navigator.userAgent) {
  if (!isAndroidNativeApp(ua)) return false;
  const bridge = (window as any).CPUAndroid;
  return getAndroidNativeVersionCode(ua) >= ANDROID_WIDGET_MIN_VERSION_CODE
    && typeof bridge?.installScheduleWidget === "function";
}

export function supportsAndroidInAppApkDownload(ua = navigator.userAgent) {
  if (!isAndroidNativeApp(ua)) return false;
  const bridge = (window as any).CPUAndroid;
  return getAndroidNativeVersionCode(ua) >= ANDROID_IN_APP_UPDATE_MIN_VERSION_CODE
    && typeof bridge?.downloadAndInstallApk === "function";
}

export function clientPlatformLabel(platform: ClientPlatform) {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "安卓";
  if (platform === "harmony") return "鸿蒙";
  if (platform === "web") return "网页";
  return "未知";
}
