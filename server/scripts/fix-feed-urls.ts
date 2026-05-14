/**
 * 一次性脚本：修正心理 / 校园新闻的爬虫源 URL，并立即跑一次。
 * 运行：npx tsx scripts/fix-feed-urls.ts
 */
import { PrismaClient } from "@prisma/client";
import { runAllOnce } from "../src/services/schoolCrawler";

const prisma = new PrismaClient();

async function main() {
  // 心理动态: 14204 是空 → 改为 14182 (心理动态)
  await prisma.schoolFeedSource.updateMany({
    where: { slug: "xinli-notice" },
    data: {
      name: "心理动态",
      listUrl: "http://xinli.cpu.edu.cn/14182/list{page}.htm",
    },
  });
  // 校园新闻: 247 (观点) 是空 → 改为 244 (校园)
  await prisma.schoolFeedSource.updateMany({
    where: { slug: "news-campus" },
    data: {
      name: "校园新闻",
      listUrl: "http://news.cpu.edu.cn/244/list{page}.htm",
    },
  });
  console.log("✅ URL 已更新");
  console.log("🕷️  立即跑一次全部爬虫...");
  const r = await runAllOnce();
  for (const x of r) {
    console.log(`  [${x.slug}] ok=${x.ok} new=${x.newCount} ${x.error ? "err=" + x.error : ""}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
