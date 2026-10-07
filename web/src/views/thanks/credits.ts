// 致谢页的全部文案和名单。页面（Index.vue）只管排版和动效，改名单只动这个文件。
// 目前是搭框架用的占位内容：带「待填」的条目上线前都要换成真实信息。

export type ThanksHue = "teal" | "blue" | "violet" | "amber" | "rose";

export interface ThanksPerson {
  name: string;
  role: string;
  note?: string;
  avatar?: string;
  hue: ThanksHue;
}

export interface ThanksGroup {
  title: string;
  note?: string;
  names: string[];
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

export interface ThanksStat {
  label: string;
  value: number;
  suffix?: string;
}

export const thanksHero = {
  eyebrow: "ACKNOWLEDGEMENTS",
  ghost: "THANKS",
  title: "致谢",
  lead: "药大拾间不是一个人写出来的。写代码的、提意见的、帮忙测试的、默默赞助的，还有每天打开它的你——这一页留给所有人。",
  // 「已同行 N 天」从这一天算起
  since: "2026-05-14",
};

// 开场的数字；「天数」和「上墙赞助」由页面实时算，这里放其余几项
export const thanksStats: ThanksStat[] = [
  { label: "次代码提交", value: 1799, suffix: "+" },
  { label: "个客户端", value: 5 },
];

export const thanksCore: ThanksPerson[] = [
  { name: "待填 · 姓名", role: "发起人 / 全栈开发", note: "一句话介绍，或者这个人最想说的一句话。", hue: "teal" },
  { name: "待填 · 姓名", role: "iOS / 鸿蒙客户端", note: "一句话介绍，或者这个人最想说的一句话。", hue: "blue" },
  { name: "待填 · 姓名", role: "安卓客户端", note: "一句话介绍，或者这个人最想说的一句话。", hue: "violet" },
  { name: "待填 · 姓名", role: "设计 / 运营", note: "一句话介绍，或者这个人最想说的一句话。", hue: "amber" },
];

// 滚动名单墙：名字越多越好看，少于一屏时页面会自动循环补齐
export const thanksContributors: string[] = [
  "MrCarbene",
  "mom0ka27",
  "frank zhang",
  "sx120609",
  "Iridium Zhang",
  "Ctrlman",
  "待填 · 贡献者",
  "待填 · 贡献者",
  "待填 · 贡献者",
  "待填 · 贡献者",
  "待填 · 贡献者",
  "待填 · 贡献者",
];

export const thanksGroups: ThanksGroup[] = [
  { title: "内测与反馈", note: "第一批踩坑的人", names: ["待填", "待填", "待填", "待填"] },
  { title: "内容与运营", note: "让社区有人说话", names: ["待填", "待填", "待填"] },
  { title: "特别感谢", note: "在关键时刻帮过忙", names: ["待填", "待填", "待填"] },
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

export const thanksMilestones: ThanksMilestone[] = [
  { date: "2026.05", title: "第一行代码", note: "待填：项目是怎么开始的。" },
  { date: "待填", title: "待填 · 里程碑", note: "例如：论坛上线、第一个客户端发布。" },
  { date: "待填", title: "待填 · 里程碑", note: "例如：用户数突破某个数字。" },
  { date: "现在", title: "故事还在继续", note: "下一个节点，也许和你有关。" },
];

export const thanksFinale = {
  lead: "最后，也是最重要的",
  fallbackName: "正在看这一页的你",
  body: "谢谢你用它查课表、发帖子、吐槽和提建议。拾间是因为有人在用，才值得继续做下去。",
  sign: "药大拾间 · 未完待续",
};
