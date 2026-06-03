/**
 * 学校公告爬虫调度与入库。
 *
 * 网络抓取和 HTML 解析在 schoolCrawlerCore 中；当 JWXT_PROXY_URL 配置后，
 * 这部分会通过代理机执行，主服务只负责去重和 Prisma 入库。
 */
import { prisma } from "../prisma";
import { isDev } from "../config";
import { runWithDistributedLock } from "./cache";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import { crawlSchoolFeedSource } from "./schoolCrawlerTransport";

/** 单次抓取某个源 */
export async function runOnce(sourceId: number, opts: { dryRun?: boolean } = {}) {
  const source = await prisma.schoolFeedSource.findUnique({ where: { id: sourceId }, include: { board: true } });
  if (!source) return { ok: false, error: "source not found" };
  if (!source.enabled) return { ok: false, error: "disabled" };

  const board = source.board;
  if (!board) return { ok: false, error: "board not bound" };

  let totalNew = 0;
  let totalError: string | null = null;

  try {
    const existing = await prisma.schoolFeedItem.findMany({
      where: { sourceId: source.id },
      select: { externalId: true },
    });
    const r = await crawlSchoolFeedSource({
      slug: source.slug,
      listUrl: source.listUrl,
      maxPages: source.maxPages,
    }, {
      skipExternalIds: existing.map((x) => x.externalId),
      dryRun: opts.dryRun,
    });
    if (isDev) {
      for (const p of r.pages) console.log(`  [${source.slug}] page ${p.page}: ${p.count} items`);
    }

    for (const it of r.items) {
      const exists = await prisma.schoolFeedItem.findUnique({
        where: { sourceId_externalId: { sourceId: source.id, externalId: it.externalId } },
      });
      if (exists) continue;
      if (opts.dryRun) { totalNew++; continue; }

      const publishedAt = new Date(it.publishedAt);
      const fullContent = it.content || "_未能提取正文，请点击帖子顶部原文入口查看_";
      const topic = await prisma.topic.create({
        data: {
          boardId: board.id,
          authorId: source.botUserId,
          title: it.title.slice(0, 120),
          content: fullContent,
          metadata: JSON.stringify({
            sourceUrl: it.effectiveUrl,
            listUrl: it.url,
            external: it.isExternal,
            externalType: it.isExternal ? "wechat" : null,
            publishedAt: publishedAt.toISOString(),
            sourceName: source.name,
          }),
          createdAt: publishedAt,
          updatedAt: publishedAt,
          lastReplyAt: publishedAt,
          lastReplyById: source.botUserId,
        },
      });
      await prisma.schoolFeedItem.create({
        data: {
          sourceId: source.id,
          externalId: it.externalId,
          url: it.url,
          title: it.title,
          publishedAt,
          topicId: topic.id,
        },
      });
      totalNew++;
    }

    await prisma.board.update({
      where: { id: board.id },
      data: { topicCount: { increment: totalNew } },
    });
  } catch (e: any) {
    totalError = e?.message ?? String(e);
    if (isDev) console.warn(`[crawler] ${source.slug} failed:`, totalError);
  }

  await prisma.schoolFeedSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastRunOk: !totalError, lastError: totalError },
  });
  if (totalNew > 0 && !opts.dryRun) {
    await invalidateBoardCaches();
    await invalidateForumCaches();
  }

  return { ok: !totalError, newCount: totalNew, error: totalError };
}

/** 全部源轮转 */
export async function runAllOnce(opts: { dryRun?: boolean } = {}) {
  const sources = await prisma.schoolFeedSource.findMany({ where: { enabled: true } });
  const results: any[] = [];
  for (const s of sources) {
    const r = await runOnce(s.id, opts);
    results.push({ slug: s.slug, ...r });
  }
  return results;
}

export async function resetSourceAndRun(sourceId: number) {
  const source = await prisma.schoolFeedSource.findUnique({ where: { id: sourceId }, include: { board: true } });
  if (!source) return { ok: false, error: "source not found" };
  const board = source.board;
  if (!board) return { ok: false, error: "board not bound" };

  const items = await prisma.schoolFeedItem.findMany({
    where: { sourceId: source.id },
    select: { topicId: true },
  });
  const topicIds = items.map((x) => x.topicId).filter((x): x is number => typeof x === "number");

  await prisma.$transaction(async (tx) => {
    await tx.schoolFeedItem.deleteMany({ where: { sourceId: source.id } });
    if (topicIds.length) {
      await tx.topic.deleteMany({ where: { id: { in: topicIds }, boardId: board.id } });
    }
    const count = await tx.topic.count({ where: { boardId: board.id, hidden: false } });
    await tx.board.update({ where: { id: board.id }, data: { topicCount: count } });
  });
  await invalidateBoardCaches();
  await invalidateForumCaches();

  return runOnce(source.id);
}

/** 启动定时任务（每分钟检查一次，按 cronMinutes 决定是否运行） */
export function startScheduler() {
  let started = false;
  const TICK = 60_000;
  const lastRun = new Map<number, number>();
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    await runWithDistributedLock("school-crawler:tick", 55_000, async () => {
      const sources = await prisma.schoolFeedSource.findMany({ where: { enabled: true } });
      const now = Date.now();
      for (const s of sources) {
        const last = lastRun.get(s.id) ?? 0;
        if (now - last < s.cronMinutes * 60_000) continue;
        lastRun.set(s.id, now);
        runOnce(s.id).then((r) => {
          if (r.newCount && r.newCount > 0) console.log(`  [crawler:${s.slug}] +${r.newCount} new`);
        });
      }
    });
  };

  if (started) return;
  started = true;

  // 启动 5 秒后跑首次，避开启动密集 IO
  setTimeout(() => {
    tick().catch((e) => console.warn("[crawler] tick error:", e));
    timer = setInterval(() => {
      tick().catch((e) => console.warn("[crawler] tick error:", e));
    }, TICK);
  }, 5_000);

  console.log("🕷️  学校公告爬虫调度器已挂载（按各源 cronMinutes 调度）");
}
