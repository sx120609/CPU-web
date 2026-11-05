import { ensureSchoolFeeds } from "../feeds";

/** 南医的公开通知和新闻（南医助手同一批栏目）。 */
const NJMU_FEEDS = [
  { slug: "njmu-jwc-notice", name: "教务处通知", homepage: "https://jxglc.njmu.edu.cn/", listUrl: "https://jxglc.njmu.edu.cn/20004/list{page}.htm", cronMinutes: 20 },
  { slug: "njmu-school-notice", name: "学校通知", homepage: "https://www.njmu.edu.cn/", listUrl: "https://www.njmu.edu.cn/607/list{page}.htm", cronMinutes: 20 },
  { slug: "njmu-xgc-notice", name: "学工处通知", homepage: "https://pgy.njmu.edu.cn/", listUrl: "https://pgy.njmu.edu.cn/8448/list{page}.htm", cronMinutes: 30 },
  { slug: "njmu-kjc-notice", name: "科研院通知", homepage: "https://kjc.njmu.edu.cn/", listUrl: "https://kjc.njmu.edu.cn/18546/list{page}.htm", cronMinutes: 60 },
  { slug: "njmu-lib-notice", name: "图书馆通知", homepage: "https://lib.njmu.edu.cn/", listUrl: "https://lib.njmu.edu.cn/tzgg.htm", cronMinutes: 60, maxPages: 1 },
  { slug: "njmu-news", name: "南医要闻", homepage: "https://www.njmu.edu.cn/", listUrl: "https://www.njmu.edu.cn/606/list{page}.htm", cronMinutes: 60 },
] as const;

export async function ensureNjmuFeeds() {
  await ensureSchoolFeeds("njmu", NJMU_FEEDS);
}
