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

export interface SchoolFeedDetail {
  url: string;
  content: string;
  effectiveUrl: string;
  isExternal: boolean;
}

/** 一次请求最多取多少篇正文；远端节点的单次请求有超时，不能一口气取太多。 */
export const SCHOOL_FEED_DETAIL_BATCH = 5;

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

const ARTICLE_HREF = /\/c\d+a\d+\/page\.htm|\/info\/\d+\/\d+\.htm/i;

function parseList(html: string, listUrlBase: string): ParsedSchoolFeedListItem[] {
  const $ = cheerio.load(html);
  const items: ParsedSchoolFeedListItem[] = [];
  const readRow = ($li: ReturnType<typeof $>) => {
    // 带缩略图的列表里第一个链接是图片，标题链接在 .news_title 里。
    const $title = $li.find(".news_title a").first();
    const $a = $title.length ? $title : $li.find("a[href]").first();
    const $meta = $li.find(".news_meta, .date, time").first();
    if (!$a.length) return;
    const href = ($a.attr("href") ?? "").trim();
    const title = ($a.attr("title") ?? $a.text() ?? "").trim();
    let dateMatch = ($meta.text() + " " + $li.text()).match(/(20\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})\s*日?/);
    if (!dateMatch) {
      // 有的模板把日期拆成“日”和“年-月”两块。
      const yearMonth = $li.find(".news_year").first().text().match(/(20\d{2})\D+(\d{1,2})/);
      const day = $li.find(".news_day").first().text().match(/\d{1,2}/);
      if (yearMonth && day) dateMatch = ["", yearMonth[1], yearMonth[2], day[0]] as RegExpMatchArray;
    }
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
  };
  $("li, tr").each((_, el) => readRow($(el)));
  if (!items.length) {
    // 不用 li/tr 排版的站点：从文章链接往上找到带日期的那一层，当作一行。
    $("a[href]").each((_, el) => {
      if (!ARTICLE_HREF.test($(el).attr("href") ?? "")) return;
      let $row = $(el).parent();
      for (let depth = 0; depth < 3 && $row.length && !/20\d{2}\s*[年.\/-]\s*\d{1,2}/.test($row.text()); depth += 1) $row = $row.parent();
      if ($row.length && $row.find("a[href]").filter((__, a) => ARTICLE_HREF.test($(a).attr("href") ?? "")).length === 1) readRow($row);
    });
  }
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
    // 站群（wp_articlecontent）和科研院等博达站点（v_news_content）的正文容器不同。
    let $body =
      $(".wp_articlecontent").first().length ? $(".wp_articlecontent").first()
      : $(".v_news_content").first().length ? $(".v_news_content").first()
      : $("#vsb_content").first().length ? $("#vsb_content").first()
      : $("div.article div.read").first().length ? $("div.article div.read").first()
      : $("div.read").first().length ? $("div.read").first()
      : $("div.article").first();
    if (!$body.length) $body = $("body");
    // 博达站点常把整篇通知做成内嵌 PDF，地址只出现在脚本里；换成普通链接，否则正文是空的。
    $body.find("script").each((_, el) => {
      const pdf = /showVsbpdfIframe\(\s*["']([^"']+\.pdf)["']/i.exec($(el).html() ?? "")?.[1];
      if (pdf) $(el).replaceWith(`<p><a href="${normalizePublicUrl(pdf, effectiveUrl)}">查看通知原文（PDF）</a></p>`);
    });
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

function isSchoolHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "cpu.edu.cn" || host.endsWith(".cpu.edu.cn");
  } catch {
    return false;
  }
}

/** 按地址取一批公告正文。地址来自门户列表，只抓学校域名；其余当外链处理，不发请求。 */
export async function fetchSchoolFeedDetails(urls: string[]): Promise<SchoolFeedDetail[]> {
  const details: SchoolFeedDetail[] = [];
  for (const url of urls.slice(0, SCHOOL_FEED_DETAIL_BATCH)) {
    if (!isSchoolHost(url) && !isWechatUrl(url)) {
      details.push({ url, content: "", effectiveUrl: url, isExternal: true });
      continue;
    }
    details.push({ url, ...(await fetchDetail(url)) });
  }
  return details;
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
