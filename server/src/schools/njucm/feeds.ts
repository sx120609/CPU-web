import { ensureSchoolFeeds } from "../feeds";

/** 南中医的公开通知和新闻：教务处、学校通知、学术预告在主站，要闻在新闻网。 */
const NJUCM_FEEDS = [
  { slug: "njucm-jwc-notice", name: "教务处通知", homepage: "https://jwc.njucm.edu.cn/", listUrl: "https://jwc.njucm.edu.cn/tzgg/list{page}.htm", cronMinutes: 20 },
  { slug: "njucm-jwc-student", name: "教务处学生通知", homepage: "https://jwc.njucm.edu.cn/", listUrl: "https://jwc.njucm.edu.cn/xstz/list{page}.htm", cronMinutes: 20 },
  { slug: "njucm-school-notice", name: "学校通知", homepage: "https://www.njucm.edu.cn/", listUrl: "https://www.njucm.edu.cn/6752/list.htm", cronMinutes: 30, maxPages: 1 },
  { slug: "njucm-lecture", name: "学术预告", homepage: "https://www.njucm.edu.cn/", listUrl: "https://www.njucm.edu.cn/6753/list.htm", cronMinutes: 60, maxPages: 1 },
  { slug: "njucm-news", name: "南中医要闻", homepage: "https://xyw.njucm.edu.cn/", listUrl: "https://xyw.njucm.edu.cn/7112/list{page}.htm", cronMinutes: 60 },
] as const;

export async function ensureNjucmFeeds() {
  await ensureSchoolFeeds("njucm", NJUCM_FEEDS);
}
