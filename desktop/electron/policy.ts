import { injectableHosts, navigableHosts, siteHost } from "./config";
import { hostMatchesRule, isHostAllowed, isUrlMatched, parseHttpsUrl, UserScript } from "./shared";

// 这个文件是"本应用不是通用浏览器"这条约束的唯一实现处。
// 它刻意不 import electron，好让 scripts/policy-test.cjs 能直接跑断言。

// 允许在应用窗口内打开的地址。返回 undefined 表示应该交给系统浏览器。
export const asNavigableUrl = (value: string): URL | undefined => {
  const url = parseHttpsUrl(value);
  return url && isHostAllowed(url.hostname, navigableHosts) ? url : undefined;
};

// 主站。只有主站窗口才拿得到 CPUDesktop 原生桥。
export const asSiteUrl = (value: string): URL | undefined => {
  const url = parseHttpsUrl(value);
  return url && hostMatchesRule(url.hostname, siteHost) ? url : undefined;
};

// 允许注入用户脚本、且允许持有脚本特权桥的地址。
// 比 asNavigableUrl 窄：主站与学校统一认证都不在其中。
export const asInjectableUrl = (value: string): URL | undefined => {
  const url = asNavigableUrl(value);
  return url && isHostAllowed(url.hostname, injectableHosts) ? url : undefined;
};

// 脚本自己的 @match 与上面的收口表，两者都通过才算命中。
export const scriptMatchesUrl = (script: Pick<UserScript, "matches">, value: string): boolean => {
  const url = asInjectableUrl(value);
  return url !== undefined && script.matches.some((pattern) => isUrlMatched(pattern, url.href));
};

// OAuth 授权窗口的临时放行规则：主站 + 本机回环回调。
// 回环回调是 http 且不在任何白名单里，只在这一个窗口、这一次登录期间有效。
export const createAuthNavigationRule = (callbackOrigin: string) => (value: string): boolean => {
  if (asSiteUrl(value)) return true;
  try {
    const url = new URL(value);
    return url.origin === callbackOrigin;
  } catch {
    return false;
  }
};
