/**
 * 学校 CMS 通用爬虫
 *
 * 解析规则（基于 2026-05 实测）：
 *   列表页 URL：{baseUrl}/{boardId}/list{page}.htm （page=1 时也可省略为 /list.htm）
 *   列表条目结构：
 *     <li>
 *       <span class="news_title"><a href="/a1/ef/c851a238063/page.htm" title="完整标题">截断标题</a></span>
 *       <span class="news_meta">2026-05-14</span>
 *     </li>
 *   详情页：<h1 class="arti_title">标题</h1> + <div class="article">正文</div>
 */
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import TurndownService from "turndown";
import { prisma } from "../prisma";
import { isDev } from "../config";

interface ParsedItem {
  externalId: string;
  url: string;
  title: string;
  publishedAt: Date;
}

const UA = "Mozilla/5.0 (compatible; CpuForumBot/0.1; +http://localhost)";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  linkStyle: "inlined",
});
// 表格直接保留 HTML —— turndown 的 table → markdown 转换对学校公告里
// 经常出现的合并单元格、嵌套表头无法正确处理，反而生成乱排版。
// 保留原 <table> HTML，前端 marked + DOMPurify 会原样渲染（CSS 已样式化）。
turndown.keep(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"]);
// 不要把 <sub>/<sup> 上下标也丢掉（化学式经常用到）
turndown.keep(["sub", "sup"]);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 学校 CMS 都是 UTF-8 但保险起见检测
  const head = buf.slice(0, 1024).toString("utf8");
  const enc = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  if (enc && enc !== "utf-8" && enc !== "utf8") {
    return iconv.decode(buf, enc);
  }
  return buf.toString("utf-8");
}

/** 解析列表页 */
function parseList(html: string, listUrlBase: string): ParsedItem[] {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $("li").each((_, el) => {
    const $li = $(el);
    const $a = $li.find("span.news_title a").first();
    const $meta = $li.find("span.news_meta").first();
    if (!$a.length || !$meta.length) return;
    const href = $a.attr("href") ?? "";
    const title = ($a.attr("title") ?? $a.text() ?? "").trim();
    const dateStr = $meta.text().trim().match(/20\d{2}-\d{2}-\d{2}/)?.[0];
    if (!href || !title || !dateStr) return;

    const absUrl = new URL(href, listUrlBase).toString();
    const externalId = (absUrl.match(/c(\d+)a(\d+)/) ?? [])[0] ?? absUrl;
    items.push({
      externalId,
      url: absUrl,
      title,
      publishedAt: new Date(dateStr + "T08:00:00+08:00"),
    });
  });
  return items;
}

/** 是否是微信文章 URL */
function isWechatUrl(url: string): boolean {
  return /^https?:\/\/mp\.weixin\.qq\.com\//i.test(url);
}

/** 解析详情页，返回 Markdown */
async function fetchDetail(url: string): Promise<{ content: string; effectiveUrl: string; isExternal: boolean }> {
  // 情况 A：列表 href 本身就是微信，不抓内容，直接跳转
  if (isWechatUrl(url)) {
    return {
      content: "_本通知正文为微信公众号文章。点击上方按钮前往微信阅读完整内容。_",
      effectiveUrl: url,
      isExternal: true,
    };
  }
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    // 学校 CMS 几种正文容器
    let $body =
      $(".wp_articlecontent").first().length ? $(".wp_articlecontent").first()
      : $("div.article div.read").first().length ? $("div.article div.read").first()
      : $("div.read").first().length ? $("div.read").first()
      : $("div.article").first();
    if (!$body.length) $body = $("body");
    // 去掉脚本/样式/侧栏
    $body.find("script,style,noscript,iframe,.wp_articlecontent .read_more,.wp_entry .arti_metas").remove();

    // 情况 B：学校页面是"微信跳转壳" —— 正文只有几句话 + 一个微信链接
    const wechatLink = $body.find('a[href*="mp.weixin.qq.com"]').first().attr("href");
    if (wechatLink) {
      const plainTextLen = $body.text().replace(/\s/g, "").length;
      const linkText = $body.text().replace(/\s/g, "");
      // 启发式 1：正文极短（< 150 字非空白） → 几乎只是个跳转壳
      // 启发式 2：正文是常见跳转提示（"详情请点击"、"详见微信"、"扫码查看"）
      const looksLikeShell =
        plainTextLen < 150 ||
        /详情请[点查阅]|详见微信|扫码查看|请[点击通]?击下方链接|请[点查]击下方|前往.*?(查看|阅读)/.test(linkText);
      if (looksLikeShell) {
        return {
          content: "_本通知正文为微信公众号文章。点击上方按钮前往微信阅读完整内容。_",
          effectiveUrl: wechatLink,
          isExternal: true,
        };
      }
    }

    // 修复相对路径：图片与链接
    const base = new URL(url);
    $body.find("img").each((_, el) => {
      const $i = $(el);
      const src = $i.attr("src");
      if (src && !/^(https?:)?\/\//.test(src) && !src.startsWith("data:")) {
        $i.attr("src", new URL(src, base).toString());
      }
      const dataSrc = $i.attr("data-src") || $i.attr("data-original");
      if (dataSrc) $i.attr("src", new URL(dataSrc, base).toString());
    });
    $body.find("a").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      if (href && !/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) {
        $a.attr("href", new URL(href, base).toString());
      }
    });
    $body.find("[style]").removeAttr("style");
    $body.find("font").each((_, el) => {
      const $f = $(el);
      $f.replaceWith($f.contents());
    });

    const cleanedHtml = $body.html() ?? "";
    let md = turndown.turndown(cleanedHtml);
    md = md.replace(/\n{3,}/g, "\n\n").trim();
    if (!md) md = "";
    return { content: md.slice(0, 8000), effectiveUrl: url, isExternal: false };
  } catch (e) {
    return { content: "", effectiveUrl: url, isExternal: false };
  }
}

/** 单次抓取某个源 */
async function runOnce(sourceId: number, opts: { dryRun?: boolean } = {}) {
  const source = await prisma.schoolFeedSource.findUnique({ where: { id: sourceId }, include: { board: true } });
  if (!source) return { ok: false, error: "source not found" };
  if (!source.enabled) return { ok: false, error: "disabled" };

  const board = source.board;
  if (!board) return { ok: false, error: "board not bound" };

  let totalNew = 0;
  let totalError: string | null = null;

  try {
    for (let p = 1; p <= source.maxPages; p++) {
      const listUrl = source.listUrl.replace("{page}", p === 1 ? "" : String(p));
      if (isDev) console.log(`  [${source.slug}] fetching ${listUrl}`);
      const html = await fetchText(listUrl);
      const items = parseList(html, listUrl);
      if (isDev) console.log(`  [${source.slug}] page ${p}: ${items.length} items`);

      for (const it of items) {
        const exists = await prisma.schoolFeedItem.findUnique({
          where: { sourceId_externalId: { sourceId: source.id, externalId: it.externalId } },
        });
        if (exists) continue;
        if (opts.dryRun) { totalNew++; continue; }

        // 抓详情页（可能是微信跳转壳）
        const detail = await fetchDetail(it.url);
        const realUrl = detail.effectiveUrl;
        const isExt = detail.isExternal;
        const srcLabel = isExt ? "微信公众号文章" : source.name;
        const linkLabel = isExt ? "👉 前往微信公众号阅读全文" : "👉 点击查看学校原文";
        const header = `> 📢 **${srcLabel}** · 发布于 ${it.publishedAt.toISOString().slice(0, 10)}\n>\n> 🔗 [${linkLabel}](${realUrl})\n\n---\n\n`;
        const fullContent = header + (detail.content || "_未能提取正文，请点击上方链接查看_");

        // 创建 Topic（机器人发帖）
        const topic = await prisma.topic.create({
          data: {
            boardId: board.id,
            authorId: source.botUserId,
            title: it.title.slice(0, 120),
            content: fullContent,
            metadata: JSON.stringify({
              sourceUrl: realUrl,
              listUrl: it.url,
              external: isExt,
              externalType: isExt ? "wechat" : null,
              publishedAt: it.publishedAt.toISOString(),
              sourceName: source.name,
            }),
            createdAt: it.publishedAt,
            updatedAt: it.publishedAt,
            lastReplyAt: it.publishedAt,
            lastReplyById: source.botUserId,
          },
        });
        await prisma.schoolFeedItem.create({
          data: {
            sourceId: source.id,
            externalId: it.externalId,
            url: it.url,
            title: it.title,
            publishedAt: it.publishedAt,
            topicId: topic.id,
          },
        });
        totalNew++;
      }
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

/** 启动定时任务（每分钟检查一次，按 cronMinutes 决定是否运行） */
export function startScheduler() {
  let started = false;
  const TICK = 60_000;
  const lastRun = new Map<number, number>();
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
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
