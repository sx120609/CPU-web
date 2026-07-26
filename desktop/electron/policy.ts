import { injectableHosts, navigableHosts } from "./config";
import { isHostAllowed, isUrlMatched, parseHttpsUrl, UserScript } from "./shared";

// 这个文件是"本应用不是通用浏览器"这条约束的唯一实现处。
// 它刻意不 import electron，好让 scripts/policy-test.cjs 能直接跑断言。

// 允许在应用窗口内打开的地址。返回 undefined 表示应该交给系统浏览器。
export const asNavigableUrl = (value: string): URL | undefined => {
  const url = parseHttpsUrl(value);
  return url && isHostAllowed(url.hostname, navigableHosts) ? url : undefined;
};

// 允许注入用户脚本、且允许持有特权桥的地址。
// 比 asNavigableUrl 更窄：学校统一认证只用于登录跳转，不该被注入脚本。
export const asInjectableUrl = (value: string): URL | undefined => {
  const url = asNavigableUrl(value);
  return url && isHostAllowed(url.hostname, injectableHosts) ? url : undefined;
};

// 脚本自己的 @match 与上面的收口表，两者都通过才算命中。
export const scriptMatchesUrl = (script: Pick<UserScript, "matches">, value: string): boolean => {
  const url = asInjectableUrl(value);
  return url !== undefined && script.matches.some((pattern) => isUrlMatched(pattern, url.href));
};
