export interface InAppBrowserInfo {
  isInApp: boolean;
  label: string;
}

const WECHAT_SERVICE_CLIENT_KEY = "cpu-wechat-service-client";
export const WECHAT_SERVICE_FOLLOW_URL = "https://weixin.qq.com/r/mp/FSDu9jLEjG-zrXaV93UH";

export function detectInAppBrowser(ua = navigator.userAgent): InAppBrowserInfo {
  const source = ua || "";
  if (/MicroMessenger/i.test(source)) return { isInApp: true, label: "微信" };
  if (/\bQQ\//i.test(source) || /MQQBrowser/i.test(source) || /QQTheme/i.test(source)) {
    return { isInApp: true, label: "QQ" };
  }
  return { isInApp: false, label: "" };
}

export function shouldAutoSuggestExternalBrowser(ua = navigator.userAgent) {
  const browser = detectInAppBrowser(ua);
  return browser.isInApp && browser.label !== "微信";
}

export function isWechatServiceClient(ua = navigator.userAgent, search = window.location.search) {
  if (!/MicroMessenger/i.test(ua || "")) return false;
  const marked = new URLSearchParams(search).get("client") === "wechat-service";
  try {
    if (marked) window.sessionStorage.setItem(WECHAT_SERVICE_CLIENT_KEY, "1");
    return marked || window.sessionStorage.getItem(WECHAT_SERVICE_CLIENT_KEY) === "1";
  } catch {
    return marked;
  }
}
