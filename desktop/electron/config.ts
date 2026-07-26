export const branding = {
  productName: "药大拾间桌面端",
  windowTitle: "药大拾间",
  learningTitle: "学习通",
  storagePrefix: "cpu-desktop-userscript",
  // 与 web/src/utils/clientInfo.ts 的识别约定对齐（CPUWebScheduleApp / CPUWebHarmonyApp）
  userAgentTag: "CPUWebDesktopApp"
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

export const siteHost = new URL(oauthConfig.origin).hostname;

export const learningUrl = "https://i.chaoxing.com/";

// 超星账号密码登录页。「记住密码」的自动填充与捕获只认这个域 ——
// learning-preload.ts 里有同一个字面量（sandbox preload 不能 require 本地模块）。
export const chaoxingLoginHost = "passport2.chaoxing.com";

// 应用窗口内允许打开的站点。不在表内的地址一律交给系统浏览器 —— 本应用不是通用浏览器。
export const navigableHosts = [
  // 主站本身：主窗口就是它
  siteHost,
  "chaoxing.com",
  "nbdlib.cn",
  "hnsyu.net",
  "gdhkmooc.com",
  // 超星机构账号登录会跳转到学校统一认证，不放行会导致登录中断
  "cpu.edu.cn"
] as const;

// 用户脚本的注入范围由脚本自己的 @match 决定，这张表只做额外收口：
// 即使脚本声明了更宽的 @match，也不会注入到表外的站点。
// 主站不在表内 —— 刷课脚本没有任何理由跑在自己的站点上。
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
  aiTextLength: 32000,
  // 主站加载失败多久后落到本地启动台
  siteLoadTimeoutMs: 15000
} as const;
