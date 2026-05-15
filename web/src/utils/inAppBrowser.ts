export interface InAppBrowserInfo {
  isInApp: boolean;
  label: string;
}

export function detectInAppBrowser(ua = navigator.userAgent): InAppBrowserInfo {
  const source = ua || "";
  if (/MicroMessenger/i.test(source)) return { isInApp: true, label: "微信" };
  if (/\bQQ\//i.test(source) || /MQQBrowser/i.test(source) || /QQTheme/i.test(source)) {
    return { isInApp: true, label: "QQ" };
  }
  return { isInApp: false, label: "" };
}
