export const branding = {
  productName: "药大拾间桌面端",
  windowTitle: "药大拾间",
  learningTitle: "网课助手",
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

export const learningPlatforms = [
  { id: "chaoxing", name: "超星学习通", short: "学习通", description: "视频、章节任务、作业与考试", url: learningUrl },
  { id: "zhihuishu", name: "知到智慧树", short: "智慧树", description: "共享课、视频与作业", url: "https://www.zhihuishu.com/" },
  { id: "icve", name: "智慧职教 / MOOC", short: "智慧职教", description: "职教课程、视频与测验", url: "https://www.icve.com.cn/" },
  { id: "zjy", name: "职教云", short: "职教云", description: "职教云课程与作业", url: "https://zjy2.icve.com.cn/" },
  { id: "icourse", name: "中国大学 MOOC", short: "大学 MOOC", description: "课程视频、测验与作业", url: "https://www.icourse163.org/" },
  { id: "yuketang", name: "雨课堂", short: "雨课堂", description: "课程、视频与课堂任务", url: "https://www.yuketang.cn/" },
] as const;

export type LearningPlatformId = typeof learningPlatforms[number]["id"];

export const learningCredentialHosts: Record<LearningPlatformId, readonly string[]> = {
  chaoxing: ["chaoxing.com"],
  zhihuishu: ["zhihuishu.com", "polymas.com"],
  icve: ["icve.com.cn", "courshare.cn", "webtrn.cn"],
  zjy: ["icve.com.cn"],
  icourse: ["icourse163.org"],
  yuketang: ["yuketang.cn"],
};

export const learningPlatformUrl = (id: string): string | undefined =>
  learningPlatforms.find((platform) => platform.id === id)?.url;

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
  "zhihuishu.com",
  "polymas.com",
  "xueyinonline.com",
  "qutjxjy.cn",
  "ynny.cn",
  "hnvist.cn",
  "fjlecb.cn",
  "cugbonline.cn",
  "zjelib.cn",
  "cqrspx.cn",
  "neauce.com",
  "zhihui-yun.com",
  "cqie.cn",
  "ccqmxx.com",
  "jxgmxy.com",
  "jnzyjsxy.cn",
  "sslibrary.com",
  "xuexi365.com",
  "icve.com.cn",
  "courshare.cn",
  "webtrn.cn",
  "icourse163.org",
  "yuketang.cn",
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
  "gdhkmooc.com",
  "zhihuishu.com",
  "polymas.com",
  "xueyinonline.com",
  "qutjxjy.cn",
  "ynny.cn",
  "hnvist.cn",
  "fjlecb.cn",
  "cugbonline.cn",
  "zjelib.cn",
  "cqrspx.cn",
  "neauce.com",
  "zhihui-yun.com",
  "cqie.cn",
  "ccqmxx.com",
  "jxgmxy.com",
  "jnzyjsxy.cn",
  "sslibrary.com",
  "xuexi365.com",
  "icve.com.cn",
  "courshare.cn",
  "webtrn.cn",
  "icourse163.org",
  "yuketang.cn"
] as const;

export const limits = {
  fetchTimeoutMs: 20000,
  fetchMaxBytes: 8 * 1024 * 1024,
  redirectHops: 3,
  aiInputItems: 32,
  aiTextLength: 32000,
  // 截图使用原始 PNG 交给 OCR，不能沿用普通文字的 32KB 限制，也不能在客户端压缩。
  // capturePage 已把 PNG 二进制限制在 8MB；Base64 Data URL 预留到 12MB。
  aiImageDataUrlLength: 12 * 1024 * 1024,
  // 主站加载失败多久后落到本地启动台
  siteLoadTimeoutMs: 15000
} as const;
