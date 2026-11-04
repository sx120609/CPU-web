import { prisma } from "../../prisma";

/**
 * 南医的公开通知和新闻（南医助手同一批栏目）。都是博达 CMS 的 list.htm，用药大公告同一套爬虫。
 * 首次启动建好南医的公告机器人、爬虫源和只读公告板块；之后管理员在后台改的设置不覆盖。
 */
const NJMU_FEEDS = [
  { slug: "njmu-jwc-notice", name: "教务处通知", homepage: "https://jxglc.njmu.edu.cn/", listUrl: "https://jxglc.njmu.edu.cn/20004/list{page}.htm", cronMinutes: 20 },
  { slug: "njmu-school-notice", name: "学校通知", homepage: "https://www.njmu.edu.cn/", listUrl: "https://www.njmu.edu.cn/607/list{page}.htm", cronMinutes: 20 },
  { slug: "njmu-xgc-notice", name: "学工处通知", homepage: "https://pgy.njmu.edu.cn/", listUrl: "https://pgy.njmu.edu.cn/8448/list{page}.htm", cronMinutes: 30 },
  { slug: "njmu-kjc-notice", name: "科研院通知", homepage: "https://kjc.njmu.edu.cn/", listUrl: "https://kjc.njmu.edu.cn/18546/list{page}.htm", cronMinutes: 60 },
  { slug: "njmu-news", name: "南医要闻", homepage: "https://www.njmu.edu.cn/", listUrl: "https://www.njmu.edu.cn/606/list{page}.htm", cronMinutes: 60 },
] as const;

const SCHOOL_ID = "njmu";
const BOT_USERNAME = "school-bot";

async function ensureBot() {
  const existing = await prisma.user.findUnique({ where: { schoolId_username: { schoolId: SCHOOL_ID, username: BOT_USERNAME } }, select: { id: true } });
  if (existing) return existing.id;
  const bot = await prisma.user.create({
    data: {
      schoolId: SCHOOL_ID,
      username: BOT_USERNAME,
      // 机器人不能登录：这不是任何密码算法的输出。
      passwordHash: "$$bot$$",
      nickname: "学校公告 🤖",
      role: "bot",
      bio: "我会自动同步学校官方公告",
    },
    select: { id: true },
  });
  await prisma.messageSetting.create({ data: { userId: bot.id } }).catch(() => undefined);
  return bot.id;
}

export async function ensureNjmuFeeds() {
  if (!process.env.DATABASE_URL) return;
  const botUserId = await ensureBot();
  const lastBoard = await prisma.board.aggregate({ where: { schoolId: SCHOOL_ID }, _max: { order: true } });
  let order = (lastBoard._max.order ?? 0) + 1;
  for (const feed of NJMU_FEEDS) {
    const source = await prisma.schoolFeedSource.upsert({
      where: { slug: feed.slug },
      create: { ...feed, pageSize: 14, maxPages: 2, botUserId },
      update: {},
      select: { id: true },
    });
    const board = await prisma.board.findUnique({ where: { schoolId_slug: { schoolId: SCHOOL_ID, slug: feed.slug } }, select: { id: true } });
    if (board) continue;
    await prisma.board.create({
      data: {
        schoolId: SCHOOL_ID,
        slug: feed.slug,
        name: feed.name,
        description: `自动同步自 ${feed.homepage}`,
        icon: "📢",
        color: "#1d4d8a",
        order: order++,
        type: "announce",
        readOnly: true,
        feedSourceId: source.id,
      },
    });
  }
}
