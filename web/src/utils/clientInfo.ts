export type ClientPlatform = "ios" | "android" | "harmony" | "web" | "unknown";

export const ANDROID_APP_LATEST_VERSION_CODE = 24;
export const ANDROID_APP_LATEST_VERSION_NAME = "3.0.3";
export const HARMONY_APP_LATEST_VERSION_CODE = 17;
export const HARMONY_APP_LATEST_VERSION_NAME = "2.0.8";
export const ANDROID_APP_DOWNLOAD_URL = "/api/site/downloads/android-app";
export const ANDROID_WIDGET_MIN_VERSION_CODE = 5;
export const ANDROID_IN_APP_UPDATE_MIN_VERSION_CODE = 14;
const CLIENT_OVERRIDE_KEY = "cpu-client-override";
const FLUTTER_SHELL_KEY = "cpu-flutter-shell";

export function detectClientPlatform(ua = navigator.userAgent): ClientPlatform {
  const source = (ua || "").toLowerCase();
  const override = resolveClientOverride();
  if (override) return override;

  if (isHarmonyNativeApp(ua)) return "harmony";
  if (isAndroidNativeApp(ua)) return "android";
  if (isFlutterNativeShell(ua)) {
    if (source.includes("android")) return "android";
    if (looksLikeIosUserAgent(source)) return "ios";
  }
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
  return isStandaloneMode() && looksLikeIosUserAgent(source);
}

export function isLikelyIosDevice(ua = navigator.userAgent) {
  return looksLikeIosUserAgent((ua || "").toLowerCase());
}

export function isLikelyAndroidDevice(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  const uaDataPlatform = String((navigator as any).userAgentData?.platform ?? "").toLowerCase();
  const platform = String((navigator as any).platform ?? "").toLowerCase();
  const hasTouch = navigator.maxTouchPoints > 0
    || window.matchMedia?.("(pointer: coarse)").matches
    || window.matchMedia?.("(hover: none)").matches;

  if (source.includes("android") || uaDataPlatform.includes("android")) return true;
  if (hasTouch && platform.includes("linux arm")) return true;
  if (hasTouch && source.includes("linux x86_64") && !isLikelyIosDevice(ua)) return true;
  return false;
}

export function isAndroidNativeApp(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  return source.includes("cpuwebscheduleapp") || resolveClientOverride() === "android";
}

export function isHarmonyNativeApp(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  return source.includes("cpuwebharmonyapp") || resolveClientOverride() === "harmony";
}

export function isFlutterNativeShell(ua = navigator.userAgent) {
  const source = (ua || "").toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const shell = params.get("shell")?.toLowerCase();
  const client = params.get("client")?.toLowerCase();
  const enabled = source.includes("cpuwebflutterapp")
    || shell === "flutter"
    || client === "flutter-app";
  if (enabled) {
    safeSessionSet(FLUTTER_SHELL_KEY, "1");
    return true;
  }
  return safeSessionGet(FLUTTER_SHELL_KEY) === "1";
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

function resolveClientOverride(): ClientPlatform | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeClientParam(params.get("client") || params.get("platform"));
  if (fromQuery) {
    safeSessionSet(CLIENT_OVERRIDE_KEY, fromQuery);
    return fromQuery;
  }
  return normalizeClientParam(safeSessionGet(CLIENT_OVERRIDE_KEY));
}

function normalizeClientParam(value?: string | null): ClientPlatform | null {
  const client = (value || "").trim().toLowerCase();
  if (!client) return null;
  if (["ios", "ios-app", "iphone", "ipad"].includes(client)) return "ios";
  if (["android", "android-app", "flutter-android"].includes(client)) return "android";
  if (["harmony", "harmony-app", "harmonyos", "ohos"].includes(client)) return "harmony";
  if (["web", "browser"].includes(client)) return "web";
  if (client === "unknown") return "unknown";
  return null;
}

function looksLikeIosUserAgent(source: string) {
  return source.includes("iphone")
    || source.includes("ipad")
    || source.includes("ipod")
    || (source.includes("macintosh") && navigator.maxTouchPoints > 1);
}

function safeSessionGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
