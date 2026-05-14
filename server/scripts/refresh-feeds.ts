/**
 * 一次性脚本：清空所有学校爬虫抓的旧帖（纯文本格式），然后重抓为 Markdown 富文本。
 */
import { PrismaClient } from "@prisma/client";
import { runAllOnce } from "../src/services/schoolCrawler";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 清空旧的爬虫帖子...");
  const items = await prisma.schoolFeedItem.findMany();
  const topicIds = items.map((i) => i.topicId).filter((x): x is number => !!x);
  if (topicIds.length) {
    // 先删点赞、回复（虽然爬虫帖通常没回复），再删 topic
    await prisma.like.deleteMany({ where: { topicId: { in: topicIds } } });
    await prisma.reply.deleteMany({ where: { topicId: { in: topicIds } } });
    await prisma.topic.deleteMany({ where: { id: { in: topicIds } } });
    console.log(`   删除 ${topicIds.length} 条 Topic`);
  }
  await prisma.schoolFeedItem.deleteMany();
  console.log("   清空 SchoolFeedItem 索引");
  // 重置 board.topicCount
  const boards = await prisma.board.findMany({ where: { readOnly: true } });
  for (const b of boards) {
    await prisma.board.update({ where: { id: b.id }, data: { topicCount: 0 } });
  }

  console.log("🕷️  重新抓取（这次会是 Markdown 富文本 + 源链接）...");
  const r = await runAllOnce();
  for (const x of r) {
    console.log(`  [${x.slug}] ok=${x.ok} new=${x.newCount} ${x.error ? "err=" + x.error : ""}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
