// 致谢页的全部文案和名单。页面（Index.vue）只管排版和动效，改内容只动这个文件。
// 开场的数字和赞助榜是接口实时给的，不在这里。

export type ThanksTint = "blue" | "orange" | "green" | "purple" | "pink" | "teal";
export type ThanksIcon = "calendar" | "watch" | "coin" | "school" | "briefcase" | "idea";

export interface ThanksPerson {
  /** 卡片上方的小字：做了什么 */
  role: string;
  name: string;
  /** 名字后面的别名 */
  alias?: string;
  note: string;
  icon: ThanksIcon;
  tint: ThanksTint;
  /** 桌面端卡片占 12 栏里的几栏 */
  span: 5 | 6 | 7;
}

export interface ThanksProject {
  name: string;
  note: string;
  url?: string;
}

export interface ThanksMilestone {
  date: string;
  title: string;
  note?: string;
}

export const thanksHero = {
  eyebrow: "药大拾间",
  title: "致谢",
  lead: "感谢每一位让拾间走到今天的人。",
  // 「天的陪伴」从这一天算起：仓库的第一次提交
  since: "2026-05-14",
};

export const thanksLead = {
  role: "全栈开发",
  name: "沈礼",
  aliases: ["Carbene", "sx120609"],
  note: "开发、部署、营销、运营——拾间几乎所有的事，都由他一个人负责。",
};

export const thanksPeople: ThanksPerson[] = [
  { role: "iOS 课表", name: "Mom0ka27", note: "参与了 iOS 课表的部分开发工作。", icon: "calendar", tint: "blue", span: 6 },
  { role: "Apple Watch", name: "SorriCant", note: "承担了 Apple Watch 的大部分开发工作。", icon: "watch", tint: "orange", span: 6 },
  { role: "资金与设备", name: "坤哥 · 琨哥", alias: "frank zhang", note: "提供了重要的资金和设备支持。", icon: "coin", tint: "green", span: 7 },
  { role: "公司建立", name: "Weicheng.Wang", note: "在公司建立的过程中给予了关键而重要的支持与帮助。", icon: "briefcase", tint: "purple", span: 5 },
  { role: "学校支持", name: "信息处", note: "感谢信息处提供的相关协助。", icon: "school", tint: "teal", span: 5 },
  { role: "扩展意见", name: "Mushroom", note: "提供了相关的扩展意见。", icon: "idea", tint: "pink", span: 7 },
];

export const thanksTools: ThanksProject[] = [
  { name: "Codex", note: "开发工具" },
  { name: "Claude Code", note: "开发工具" },
];

export const thanksOpenSource: ThanksProject[] = [
  { name: "Vue", note: "界面框架", url: "https://vuejs.org" },
  { name: "Vite", note: "构建工具", url: "https://vite.dev" },
  { name: "Element Plus", note: "组件库", url: "https://element-plus.org" },
  { name: "Pinia", note: "状态管理", url: "https://pinia.vuejs.org" },
  { name: "ECharts", note: "图表", url: "https://echarts.apache.org" },
  { name: "Express", note: "服务端框架", url: "https://expressjs.com" },
  { name: "Prisma", note: "数据库访问", url: "https://www.prisma.io" },
  { name: "PostgreSQL", note: "数据库", url: "https://www.postgresql.org" },
  { name: "PDF.js", note: "PDF 渲染", url: "https://mozilla.github.io/pdf.js" },
  { name: "KaTeX", note: "公式排版", url: "https://katex.org" },
  { name: "Marked", note: "Markdown 解析", url: "https://marked.js.org" },
  { name: "Electron", note: "桌面客户端", url: "https://www.electronjs.org" },
];

// 以下节点整理自仓库的提交记录和各端的发布记录（日期是对应提交的日期）。
export const thanksMilestones: ThanksMilestone[] = [
  { date: "2026.05.14", title: "第一次提交", note: "仓库建立。第二天有了课表页，第三天安卓工程开工。" },
  { date: "2026.05.29", title: "鸿蒙版开工" },
  { date: "2026.07", title: "桌面客户端", note: "7 月 2 日开工，27 日发布 0.1.0。同月“药苑之声”并入。" },
  { date: "2026.07.25", title: "拾间AI", note: "校园问答助手加入。" },
  { date: "2026.08", title: "论坛长出新东西", note: "VIP 身份加入，二手交流并入论坛。" },
  { date: "2026.09", title: "iOS 原生客户端", note: "8 月 31 日开工。9 月 12 日接入 Apple Watch 课表，15 日有了实时活动。" },
  { date: "2026.09.30", title: "情侣课表" },
  { date: "2026.10", title: "网页端整体换新" },
  { date: "现在", title: "故事还在继续", note: "下一个节点，也许和你有关。" },
];

export const thanksFinale = {
  fallbackName: "正在看这一页的你",
  body: "谢谢你用它查课表、发帖子、吐槽和提建议。拾间是因为有人在用，才值得继续做下去。",
  sign: "药大拾间 · 未完待续",
};

// 「帮我们分享」发出去的内容；链接是站点首页
export const thanksShare = {
  title: "药大拾间",
  text: "我在用药大拾间：课表、论坛、校园小工具都在这儿，推荐给你。",
  path: "/",
};
