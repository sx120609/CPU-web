/**
 * 学校公告抓取与解析核心。
 *
 * 这里不碰 Prisma，只做网络请求、列表解析、详情正文提取；因此可以在 jwxt-proxy
 * 进程中运行，让主服务只负责调度和入库。
 */
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import TurndownService from "turndown";

export interface SchoolFeedSourceInput {
  slug: string;
  listUrl: string;
  maxPages: number;
}

export interface ParsedSchoolFeedListItem {
  externalId: string;
  url: string;
  title: string;
  publishedAt: string;
}

export interface CrawledSchoolFeedItem extends ParsedSchoolFeedListItem {
  content: string;
  effectiveUrl: string;
  isExternal: boolean;
}

export interface CrawlSchoolFeedResult {
  items: CrawledSchoolFeedItem[];
  pages: { page: number; listUrl: string; count: number }[];
}

const UA = "Mozilla/5.0 (compatible; CpuForumBot/0.1; +http://localhost)";

/** 解析相对地址；协议是否升级由 fetchText 根据实际连通性决定。 */
function normalizePublicUrl(value: string, base?: string): string {
  const raw = value.trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw, base);
    return url.toString();
  } catch {
    return raw;
  }
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  linkStyle: "inlined",
});
turndown.keep(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"]);
turndown.keep(["sub", "sup"]);

async function fetchText(url: string): Promise<{ text: string; finalUrl: string }> {
  const originalUrl = normalizePublicUrl(url);
  const candidates = [originalUrl];
  try {
    const candidate = new URL(originalUrl);
    if (candidate.protocol === "http:" && (candidate.hostname === "cpu.edu.cn" || candidate.hostname.endsWith(".cpu.edu.cn"))) {
      candidate.protocol = "https:";
      candidates.unshift(candidate.toString());
    }
  } catch { /* normalizePublicUrl already preserves malformed input for the caller to report. */ }

  let res: Response | null = null;
  let selectedUrl = originalUrl;
  let lastError: unknown = null;
  for (const requestUrl of candidates) {
    try {
      const next = await fetch(requestUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (next.ok) { res = next; selectedUrl = requestUrl; break; }
      lastError = new Error(`HTTP ${next.status} on ${requestUrl}`);
    } catch (error) {
      lastError = error;
    }
  }
  if (!res) throw lastError instanceof Error ? lastError : new Error(`无法访问 ${originalUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.slice(0, 1024).toString("utf8");
  const enc = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1]?.toLowerCase()
    || /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const text = enc && enc !== "utf-8" && enc !== "utf8"
    ? iconv.decode(buf, enc)
    : buf.toString("utf-8");
  return { text, finalUrl: normalizePublicUrl(res.url || selectedUrl) };
}

function parseList(html: string, listUrlBase: string): ParsedSchoolFeedListItem[] {
  const $ = cheerio.load(html);
  const items: ParsedSchoolFeedListItem[] = [];
  $("li, tr").each((_, el) => {
    const $li = $(el);
    const $a = $li.find(".news_title a, a[href]").first();
    const $meta = $li.find(".news_meta, .date, time").first();
    if (!$a.length) return;
    const href = ($a.attr("href") ?? "").trim();
    const title = ($a.attr("title") ?? $a.text() ?? "").trim();
    const dateMatch = ($meta.text() + " " + $li.text()).match(/(20\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})\s*日?/);
    const dateStr = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : undefined;
    if (!href || !title || !dateStr) return;

    const absUrl = normalizePublicUrl(href, listUrlBase);
    const externalId = (absUrl.match(/c(\d+)a(\d+)/i) ?? [])[0] ?? absUrl;
    items.push({
      externalId,
      url: absUrl,
      title,
      publishedAt: new Date(dateStr + "T08:00:00+08:00").toISOString(),
    });
  });
  return items;
}

function isWechatUrl(url: string): boolean {
  return /^https?:\/\/mp\.weixin\.qq\.com\//i.test(url);
}

async function fetchDetail(url: string): Promise<{ content: string; effectiveUrl: string; isExternal: boolean }> {
  url = normalizePublicUrl(url);
  if (isWechatUrl(url)) {
    return {
      content: "_本通知正文为微信公众号文章。点击上方按钮前往微信阅读完整内容。_",
      effectiveUrl: url,
      isExternal: true,
    };
  }
  try {
    const response = await fetchText(url);
    const html = response.text;
    const effectiveUrl = response.finalUrl;
    if (isWechatUrl(effectiveUrl)) {
      return {
        content: "_本通知正文为微信公众号文章。点击上方按钮前往微信阅读完整内容。_",
        effectiveUrl,
        isExternal: true,
      };
    }
    const $ = cheerio.load(html);
    let $body =
      $(".wp_articlecontent").first().length ? $(".wp_articlecontent").first()
      : $("div.article div.read").first().length ? $("div.article div.read").first()
      : $("div.read").first().length ? $("div.read").first()
      : $("div.article").first();
    if (!$body.length) $body = $("body");
    $body.find("script,style,noscript,iframe,.wp_articlecontent .read_more,.wp_entry .arti_metas").remove();

    const wechatHref = $body.find('a[href*="mp.weixin.qq.com"]').first().attr("href");
    const wechatLink = wechatHref ? normalizePublicUrl(wechatHref, effectiveUrl) : "";
    if (wechatLink) {
      const plainTextLen = $body.text().replace(/\s/g, "").length;
      const linkText = $body.text().replace(/\s/g, "");
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

    const base = new URL(effectiveUrl);
    $body.find("img").each((_, el) => {
      const $i = $(el);
      const src = $i.attr("src");
      if (src && !/^(https?:)?\/\//.test(src) && !src.startsWith("data:")) {
        $i.attr("src", normalizePublicUrl(src, base.toString()));
      }
      const dataSrc = $i.attr("data-src") || $i.attr("data-original");
      if (dataSrc) $i.attr("src", normalizePublicUrl(dataSrc, base.toString()));
    });
    $body.find("a").each((_, el) => {
      const $a = $(el);
      const href = ($a.attr("href") ?? "").trim();
      if (href && !/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) {
        $a.attr("href", normalizePublicUrl(href, base.toString()));
      } else if (href && /^https?:/i.test(href)) {
        $a.attr("href", normalizePublicUrl(href));
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
    return { content: md.slice(0, 8000), effectiveUrl, isExternal: false };
  } catch {
    return { content: "", effectiveUrl: url, isExternal: false };
  }
}

export async function crawlSchoolFeedSource(
  source: SchoolFeedSourceInput,
  opts: { skipExternalIds?: string[]; dryRun?: boolean } = {},
): Promise<CrawlSchoolFeedResult> {
  const skip = new Set(opts.skipExternalIds ?? []);
  const pages: CrawlSchoolFeedResult["pages"] = [];
  const items: CrawledSchoolFeedItem[] = [];

  for (let p = 1; p <= source.maxPages; p++) {
    const listUrl = source.listUrl.replace("{page}", p === 1 ? "" : String(p));
    const response = await fetchText(listUrl);
    const list = parseList(response.text, response.finalUrl);
    pages.push({ page: p, listUrl: response.finalUrl, count: list.length });

    for (const it of list) {
      if (skip.has(it.externalId)) continue;
      if (opts.dryRun) {
        items.push({ ...it, content: "", effectiveUrl: it.url, isExternal: false });
        continue;
      }
      const detail = await fetchDetail(it.url);
      items.push({ ...it, ...detail });
    }
  }

  const unique = new Map<string, CrawledSchoolFeedItem>();
  for (const item of items) if (!unique.has(item.externalId)) unique.set(item.externalId, item);
  return { items: [...unique.values()], pages };
}
