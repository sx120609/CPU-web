/**
 * 一次性脚本：删除 news-campus 爬虫源与对应板块
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const board = await prisma.board.findUnique({ where: { slug: "news-campus" } });
  if (board) {
    await prisma.like.deleteMany({ where: { topic: { boardId: board.id } } });
    await prisma.reply.deleteMany({ where: { topic: { boardId: board.id } } });
    const ts = await prisma.topic.findMany({ where: { boardId: board.id }, select: { id: true } });
    if (ts.length) await prisma.schoolFeedItem.deleteMany({ where: { topicId: { in: ts.map(t => t.id) } } });
    await prisma.topic.deleteMany({ where: { boardId: board.id } });
    await prisma.board.update({ where: { id: board.id }, data: { feedSourceId: null } });
    await prisma.board.delete({ where: { id: board.id } });
    console.log(`✅ 已删除板块 news-campus`);
  }
  const src = await prisma.schoolFeedSource.findUnique({ where: { slug: "news-campus" } });
  if (src) {
    await prisma.schoolFeedItem.deleteMany({ where: { sourceId: src.id } });
    await prisma.schoolFeedSource.delete({ where: { id: src.id } });
    console.log(`✅ 已删除爬虫源 news-campus`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
