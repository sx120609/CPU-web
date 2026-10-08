/**
 * 各学院网站“通知公告”栏目的抓取源。
 *
 * 学院通知不进融合门户的资讯聚合，只能逐个网站抓。启动时把缺的源和板块补上；
 * 已存在的源（包括管理员停用或改过周期的）一律不动。
 */
import { prisma } from "../prisma";
import { invalidateBoardCaches } from "./cacheInvalidation";

export interface CollegeFeedSource {
  slug: string;
  /** 学院全称，也是板块名和用户资料里“学院”一栏的对照值。 */
  name: string;
  homepage: string;
  /** {page} 是站群的翻页占位；没有占位的站点只抓第一页。 */
  listUrl: string;
}

export const COLLEGE_FEED_SOURCES: CollegeFeedSource[] = [
  { slug: "yxy-notice", name: "药学院", homepage: "http://yxy.cpu.edu.cn/", listUrl: "http://yxy.cpu.edu.cn/9345/list{page}.htm" },
  { slug: "zyxy-notice", name: "中药学院", homepage: "http://zyxy.cpu.edu.cn/", listUrl: "http://zyxy.cpu.edu.cn/xytz/list{page}.htm" },
  { slug: "sky-notice", name: "生命科学与技术学院", homepage: "http://sky.cpu.edu.cn/", listUrl: "http://sky.cpu.edu.cn/13324/list{page}.htm" },
  { slug: "sxy-notice", name: "国际医药商学院", homepage: "http://sxy.cpu.edu.cn/", listUrl: "http://sxy.cpu.edu.cn/8793/list{page}.htm" },
  { slug: "lxy-notice", name: "理学院", homepage: "http://lxy.cpu.edu.cn/", listUrl: "http://lxy.cpu.edu.cn/56/list{page}.htm" },
  { slug: "gxy-notice", name: "工学院", homepage: "http://gxy.cpu.edu.cn/", listUrl: "http://gxy.cpu.edu.cn/12276/list{page}.htm" },
  { slug: "bmcp-notice", name: "基础医学与临床药学学院", homepage: "http://bmcp.cpu.edu.cn/", listUrl: "http://bmcp.cpu.edu.cn/469/list{page}.htm" },
  { slug: "swywxy-notice", name: "生物药物学院", homepage: "http://swywxy.cpu.edu.cn/", listUrl: "http://swywxy.cpu.edu.cn/9879/list{page}.htm" },
  { slug: "mhc-notice", name: "孟目的学院", homepage: "http://mhc.cpu.edu.cn/", listUrl: "http://mhc.cpu.edu.cn/10113/list{page}.htm" },
  { slug: "cyxy-notice", name: "现代制药产业学院", homepage: "https://cyxy.cpu.edu.cn/", listUrl: "http://cyxy.cpu.edu.cn/12298/list{page}.htm" },
  { slug: "wywy-notice", name: "外国语学院", homepage: "http://wywy.cpu.edu.cn/", listUrl: "http://wywy.cpu.edu.cn/6016/list{page}.htm" },
  { slug: "marxism-notice", name: "马克思主义学院", homepage: "http://marxism.cpu.edu.cn/", listUrl: "http://marxism.cpu.edu.cn/index/tzgg.htm" },
  { slug: "tyb-notice", name: "体育部", homepage: "http://tyb.cpu.edu.cn/", listUrl: "http://tyb.cpu.edu.cn/tzgg_6811/list{page}.htm" },
];

const COLLEGE_NAMES = new Set(COLLEGE_FEED_SOURCES.map((source) => source.name));

/**
 * 学院板块默认不进“全部”（没人想看十几个别的学院的通知），但资料里填了学院的用户默认能看到自己学院的。
 */
export function isOwnCollegeBoard(board: { feedDepartment: string | null }, college: string | null | undefined) {
  const own = college?.trim();
  return Boolean(own && board.feedDepartment === own && COLLEGE_NAMES.has(own));
}

export async function ensureCollegeFeedSources() {
  const existing = new Set((await prisma.schoolFeedSource.findMany({
    where: { slug: { in: COLLEGE_FEED_SOURCES.map((source) => source.slug) } },
    select: { slug: true },
  })).map((source) => source.slug));
  const missing = COLLEGE_FEED_SOURCES.filter((source) => !existing.has(source.slug));
  if (!missing.length) return [];

  const botUserId = (await prisma.schoolFeedSource.findFirst({ orderBy: { id: "asc" }, select: { botUserId: true } }))?.botUserId
    ?? (await prisma.user.findFirst({ where: { role: "bot" }, orderBy: { id: "asc" }, select: { id: true } }))?.id;
  if (!botUserId) return [];

  let order = ((await prisma.board.aggregate({ where: { type: "announce" }, _max: { order: true } }))._max.order ?? 0) + 1;
  for (const college of missing) {
    // 板块 slug 或部门名被占用时（例如门户先同步出了同名部门）只建源，不动别人的板块。
    const taken = await prisma.board.findFirst({
      where: { OR: [{ slug: college.slug }, { feedDepartment: college.name }] },
      select: { id: true, feedSourceId: true },
    });
    await prisma.$transaction(async (tx) => {
      const source = await tx.schoolFeedSource.create({
        data: {
          slug: college.slug,
          name: `${college.name}通知`,
          homepage: college.homepage,
          listUrl: college.listUrl,
          pageSize: 14,
          maxPages: 1,
          cronMinutes: 30,
          botUserId,
        },
      });
      if (taken) {
        if (!taken.feedSourceId) await tx.board.update({ where: { id: taken.id }, data: { feedSourceId: source.id } });
        return;
      }
      await tx.board.create({
        data: {
          slug: college.slug,
          name: college.name,
          description: `${college.name}的通知公告`,
          icon: "📢",
          color: "#1d4d8a",
          order: order++,
          type: "announce",
          readOnly: true,
          feedSourceId: source.id,
          feedDepartment: college.name,
          announceDefault: false,
        },
      });
    });
  }
  await invalidateBoardCaches();
  return missing;
}
