import { prisma } from "../prisma";

/** 外校的公开通知和新闻栏目：博达 CMS 的 list.htm，用药大公告同一套爬虫（{page} 换成页码，第一页为空）。 */
export type SchoolFeed = {
  slug: string;
  name: string;
  homepage: string;
  listUrl: string;
  cronMinutes: number;
  maxPages?: number;
};

const BOT_USERNAME = "school-bot";

async function ensureBot(schoolId: string) {
  const existing = await prisma.user.findUnique({ where: { schoolId_username: { schoolId, username: BOT_USERNAME } }, select: { id: true } });
  if (existing) return existing.id;
  const bot = await prisma.user.create({
    data: {
      schoolId,
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

/** 首次启动建好这所学校的公告机器人、爬虫源和只读公告板块；之后管理员在后台改的设置不覆盖。 */
export async function ensureSchoolFeeds(schoolId: string, feeds: readonly SchoolFeed[]) {
  if (!process.env.DATABASE_URL) return;
  const botUserId = await ensureBot(schoolId);
  const lastBoard = await prisma.board.aggregate({ where: { schoolId }, _max: { order: true } });
  let order = (lastBoard._max.order ?? 0) + 1;
  for (const feed of feeds) {
    const source = await prisma.schoolFeedSource.upsert({
      where: { slug: feed.slug },
      create: { pageSize: 14, maxPages: 2, ...feed, botUserId },
      update: {},
      select: { id: true },
    });
    const board = await prisma.board.findUnique({ where: { schoolId_slug: { schoolId, slug: feed.slug } }, select: { id: true } });
    if (board) continue;
    await prisma.board.create({
      data: {
        schoolId,
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
