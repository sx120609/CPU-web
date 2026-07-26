export type UserScript = {
  id: string;
  name: string;
  source: string;
  matches: string[];
  requires: string[];
  resources: Record<string, string>;
  connects: string[];
  values: Record<string, unknown>;
};

export type FetchTextResult = {
  status: number;
  statusText: string;
  text: string;
  responseHeaders: string;
  url: string;
};

export const hostMatchesRule = (hostname: string, rule: string): boolean => {
  const host = hostname.toLowerCase();
  const suffix = rule.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
};

export const isHostAllowed = (hostname: string, rules: readonly string[]): boolean =>
  rules.some((rule) => hostMatchesRule(hostname, rule));

// 全应用只接受 https。明文 HTTP 页面既不该拿到特权桥，也不该被注入脚本。
export const parseHttpsUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

// 只用于"这个跳转要不要留在学习通标签里"这一个判断。
// 超星登录链路中间会经过明文 http 的一跳，只认 https 会把整个登录踢去系统浏览器。
// 放宽的仅仅是"在标签里显示"；注入脚本与特权桥始终走 parseHttpsUrl + injectableHosts。
export const parseWebUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
};

export const isUrlMatched = (pattern: string, target: string): boolean => {
  const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern.trim());
  const url = parseHttpsUrl(target);
  // @match 的 `*` 协议通配一并降级为只匹配 https；显式声明 http 的规则直接作废。
  if (!match || !url || match[1] === "http") return false;
  const hostPattern = match[2].toLowerCase();
  // 不接受裸 `*` 主机通配：那等于把脚本放给全网。
  const hostMatches = hostPattern === url.hostname.toLowerCase()
    || (hostPattern.startsWith("*.") && hostMatchesRule(url.hostname, hostPattern.slice(2)));
  if (!hostMatches) return false;
  const pathPattern = match[3].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${pathPattern}$`).test(`${url.pathname}${url.search}`);
};
