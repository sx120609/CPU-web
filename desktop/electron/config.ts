export const branding = {
  productName: "药大拾间桌面端",
  homeTitle: "药大拾间桌面端",
  learningTitle: "学习平台",
  storagePrefix: "cpu-desktop-userscript"
} as const;

export const oauthConfig = {
  origin: process.env.CPU_DESKTOP_ORIGIN || "https://cpu.lizmt.cn",
  clientId: process.env.CPU_DESKTOP_CLIENT_ID || "cpu-electron",
  scope: "openid profile ai",
  callbackPath: "/oauth/callback",
  // 回调服务器只 listen 在 127.0.0.1，redirect_uri 必须用同一个字面量：
  // 部分环境下 localhost 会优先解析到 ::1，浏览器就打不开回调页。
  callbackHost: "127.0.0.1",
  loginTimeoutMs: 300000
} as const;

export const learningUrl = "https://i.chaoxing.com/";

// 应用窗口内允许打开的站点。不在表内的地址一律交给系统浏览器 —— 本应用不是通用浏览器。
export const navigableHosts = [
  "chaoxing.com",
  "nbdlib.cn",
  "hnsyu.net",
  "gdhkmooc.com",
  // 超星机构账号登录会跳转到学校统一认证，不放行会导致登录中断
  "cpu.edu.cn"
] as const;

// 用户脚本的注入范围由脚本自己的 @match 决定，这张表只做额外收口：
// 即使脚本声明了更宽的 @match，也不会注入到表外的站点。
export const injectableHosts = [
  "chaoxing.com",
  "nbdlib.cn",
  "hnsyu.net",
  "gdhkmooc.com"
] as const;

export const limits = {
  fetchTimeoutMs: 20000,
  fetchMaxBytes: 8 * 1024 * 1024,
  redirectHops: 3,
  aiInputItems: 32,
  aiTextLength: 32000
} as const;
