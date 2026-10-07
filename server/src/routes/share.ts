import { Router, type Request } from "express";
import QRCode from "qrcode";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../prisma";
import { getSiteOrigin, isBoardTypeEnabled } from "../services/siteSettings";
import { sanitizeLostFoundTopicFields } from "../services/lostFoundPrivacy";
import { isRetiredBoardSlug } from "../services/retiredBoards";
import { presentAnonymousAlias } from "../services/userTrust";

export const shareRouter = Router();

const SHARE_CARD_FONT_FILES = [
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/msyhbd.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/simsun.ttc",
];

shareRouter.get("/topic/:id", async (req, res, next) => {
  try {
    const topic = await loadShareTopic(req.params.id);
    if (!topic) {
      res.status(404).type("html").send(renderNotFoundPage(resolvePublicOrigin(req), "/forum"));
      return;
    }
    const origin = resolvePublicOrigin(req);
    const topicUrl = `${origin}/forum/topic/${topic.id}`;
    const shareUrl = `${origin}/share/topic/${topic.id}`;
    const imageUrl = `${origin}/share/topic/${topic.id}/card.png`;
    const description = buildTopicDescription(topic);
    res.type("html").send(renderTopicSharePage({
      shareUrl,
      topicUrl,
      imageUrl,
      title: `${topic.title} · 药大拾间`,
      description,
      topicTitle: topic.title,
      boardName: topic.board.name,
      imageHeight: layoutTopicCard(topic).height,
    }));
  } catch (error) {
    next(error);
  }
});

shareRouter.get("/topic/:id/card.png", async (req, res, next) => {
  try {
    const topic = await loadShareTopic(req.params.id);
    if (!topic) {
      const fallbackSvg = renderFallbackCardSvg("药大拾间", "分享内容不存在或暂不可用");
      const fallbackPng = renderSvgToPng(fallbackSvg);
      res.status(404).type("image/png").send(fallbackPng);
      return;
    }
    const origin = resolvePublicOrigin(req);
    const svg = await renderTopicCardSvg(topic, origin);
    const png = renderSvgToPng(svg);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(png);
  } catch (error) {
    next(error);
  }
});

async function loadShareTopic(idParam: string) {
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) return null;
  const topic = await prisma.topic.findUnique({
    where: { id },
    include: {
      board: { select: { name: true, slug: true, type: true, color: true, icon: true } },
      author: { select: { nickname: true } },
      tags: { include: { tag: true } },
    },
  });
  if (!topic || topic.hidden || !topic.board || isRetiredBoardSlug(topic.board.slug) || !isBoardTypeEnabled(topic.board.type)) return null;
  return sanitizeLostFoundTopicFields(topic);
}

function resolvePublicOrigin(req: Request) {
  const configured = getSiteOrigin();
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "https://cputime.cn";
}

function buildTopicDescription(topic: any) {
  const boardPart = topic.board?.name ? `来自 ${topic.board.name} · ` : "";
  const authorPart = topic.isAnonymous ? presentAnonymousAlias(topic.anonymousAlias) : (topic.author?.nickname || "同学");
  const content = stripText(topic.content);
  const brief = content ? truncateText(content, 72) : "点击查看完整内容";
  return `${boardPart}${authorPart}：${brief}`;
}

function stripText(input: string | null | undefined) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`~_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderTopicSharePage(input: {
  shareUrl: string;
  topicUrl: string;
  imageUrl: string;
  title: string;
  description: string;
  topicTitle: string;
  boardName: string;
  imageHeight: number;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const topicUrl = escapeHtml(input.topicUrl);
  const shareUrl = escapeHtml(input.shareUrl);
  const imageUrl = escapeHtml(input.imageUrl);
  const boardName = escapeHtml(input.boardName);
  const topicTitle = escapeHtml(input.topicTitle);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="药大拾间" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="720" />
    <meta property="og:image:height" content="${input.imageHeight}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${topicUrl}" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f2f3f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #16191d;
      }
      .card {
        box-sizing: border-box;
        width: min(92vw, 520px);
        padding: 24px;
        border-radius: 14px;
        background: #ffffff;
      }
      .badge {
        display: inline-flex;
        padding: 3px 10px;
        border-radius: 999px;
        background: #f2f3f5;
        color: #4e5661;
        font-size: 12px;
      }
      h1 {
        margin: 12px 0 8px;
        font-size: 20px;
        line-height: 1.4;
      }
      p {
        margin: 0;
        color: #4e5661;
        line-height: 1.7;
        font-size: 14px;
      }
      a {
        display: inline-flex;
        margin-top: 16px;
        color: #086f63;
        text-decoration: none;
        font-weight: 500;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="badge">${boardName}</span>
      <h1>${topicTitle}</h1>
      <p>${description}</p>
      <a href="${topicUrl}">打开原帖 →</a>
    </main>
    <script>
      setTimeout(function () {
        window.location.replace(${JSON.stringify(input.topicUrl)});
      }, 120);
    </script>
  </body>
</html>`;
}

const CARD_WIDTH = 720;
const CARD_INK = "#16191d";
const CARD_INK_SECONDARY = "#4e5661";
const CARD_INK_MUTED = "#666e7a";
const CARD_PAGE = "#f2f3f5";
const CARD_HAIRLINE = "#e4e6ea";

// The card is as tall as its text: a one-line title without body text gives a short card, not a poster with a hole in it.
export function layoutTopicCard(topic: any) {
  const titleLines = wrapText(topic.title, 23, 3);
  const excerptSource = stripText(topic.content);
  const excerptLines = excerptSource ? wrapText(truncateText(excerptSource, 200), 42, 7 - titleLines.length) : [];
  const titleY = 198;
  const titleEnd = titleY + (titleLines.length - 1) * 64;
  const excerptY = titleEnd + 58;
  const textEnd = excerptLines.length ? excerptY + (excerptLines.length - 1) * 40 : titleEnd;
  const metaY = textEnd + 62;
  const dividerY = metaY + 34;
  const footerY = dividerY + 36;
  const height = footerY + 112 + 44 + 40;
  return { titleLines, excerptLines, titleY, excerptY, metaY, dividerY, footerY, height };
}

export async function renderTopicCardSvg(topic: any, origin: string) {
  const boardName = topic.board?.name || "药大拾间";
  const boardColor = normalizeHex(topic.board?.color) || "#086f63";
  const authorName = topic.isAnonymous ? presentAnonymousAlias(topic.anonymousAlias) : (topic.author?.nickname || "同学");
  const meta = `${authorName} · ${topic.replyCount || 0} 回复 · ${topic.viewCount || 0} 浏览`;
  const layout = layoutTopicCard(topic);
  const lines = (items: string[], x: number, gap: number) => items
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : gap}">${escapeXml(line)}</tspan>`)
    .join("");
  const chipWidth = 56 + textUnits(boardName) * 10;
  const host = origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const qrDataUrl = await QRCode.toDataURL(`${origin}/share/topic/${topic.id}`, {
    margin: 0,
    width: 224,
    color: { dark: CARD_INK, light: "#ffffff" },
  });
  const excerpt = layout.excerptLines.length
    ? `<text x="88" y="${layout.excerptY}" font-size="25" fill="${CARD_INK_SECONDARY}">${lines(layout.excerptLines, 88, 40)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CARD_WIDTH}" height="${layout.height}" viewBox="0 0 ${CARD_WIDTH} ${layout.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(topic.title)}">
  <rect width="${CARD_WIDTH}" height="${layout.height}" fill="${CARD_PAGE}" />
  <rect x="40" y="40" width="640" height="${layout.height - 80}" rx="28" fill="#ffffff" />

  <rect x="88" y="88" width="${chipWidth}" height="40" rx="20" fill="${CARD_PAGE}" />
  <circle cx="110" cy="108" r="6" fill="${escapeXml(boardColor)}" />
  <text x="126" y="115" font-size="20" fill="${CARD_INK_SECONDARY}">${escapeXml(boardName)}</text>

  <text x="88" y="${layout.titleY}" font-size="46" font-weight="700" fill="${CARD_INK}">${lines(layout.titleLines, 88, 64)}</text>
  ${excerpt}
  <text x="88" y="${layout.metaY}" font-size="21" fill="${CARD_INK_MUTED}">${escapeXml(truncateText(meta, 40))}</text>

  <rect x="88" y="${layout.dividerY}" width="544" height="1" fill="${CARD_HAIRLINE}" />

  <image x="88" y="${layout.footerY + 24}" width="64" height="64" href="${siteLogoDataUrl()}" />
  <text x="170" y="${layout.footerY + 52}" font-size="28" font-weight="700" fill="${CARD_INK}">药大拾间</text>
  <text x="170" y="${layout.footerY + 84}" font-size="19" fill="${CARD_INK_MUTED}">扫码看原帖 · ${escapeXml(host)}</text>
  <image x="520" y="${layout.footerY}" width="112" height="112" href="${escapeXml(qrDataUrl)}" />
</svg>`;
}

function renderFallbackCardSvg(title: string, description: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CARD_WIDTH}" height="400" viewBox="0 0 ${CARD_WIDTH} 400" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD_WIDTH}" height="400" fill="${CARD_PAGE}" />
  <rect x="40" y="40" width="640" height="320" rx="28" fill="#ffffff" />
  <text x="88" y="190" font-size="46" font-weight="700" fill="${CARD_INK}">${escapeXml(title)}</text>
  <text x="88" y="250" font-size="25" fill="${CARD_INK_SECONDARY}">${escapeXml(description)}</text>
</svg>`;
}

export function renderSvgToPng(svg: string) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 720,
    },
    font: {
      loadSystemFonts: true,
      fontFiles: SHARE_CARD_FONT_FILES,
      defaultFontFamily: "Microsoft YaHei",
    },
  });
  return resvg.render().asPng();
}

let cachedSiteLogoDataUrl = "";

function siteLogoDataUrl() {
  if (!cachedSiteLogoDataUrl) {
    // Embed the same vector logo used by the site header, independent of fonts and network access.
    const bundledLogo = path.resolve(__dirname, "../assets/site/favicon.svg");
    const logo = readFileSync(existsSync(bundledLogo) ? bundledLogo : path.resolve(__dirname, "../../../web/public/favicon.svg"));
    cachedSiteLogoDataUrl = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  }
  return cachedSiteLogoDataUrl;
}

function renderNotFoundPage(origin: string, targetPath: string) {
  const target = `${origin}${targetPath}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
    <title>药大拾间</title>
  </head>
  <body>
    <a href="${escapeHtml(target)}">继续访问药大拾间</a>
  </body>
</html>`;
}

// Estimated width in half-em units. The renderer cannot measure text, so Latin characters are counted by class:
// a bold capital is much wider than a comma, and counting both as half a CJK character let English titles run
// past the edge of the card.
function charUnits(ch: string) {
  if (!/[\u0000-ÿ]/.test(ch)) return 2;
  if (/[A-Z@%&mw]/.test(ch)) return 1.45;
  if (/[\s.,:;!|'"()\[\]\-ijlt]/.test(ch)) return 0.7;
  return 1.15;
}

function textUnits(text: string) {
  let units = 0;
  for (const ch of text) units += charUnits(ch);
  return units;
}

// Break into at most maxLines lines of maxUnits each. Latin words move to the next line whole when they can, and
// only text that really did not fit ends in an ellipsis.
function wrapText(text: string, maxUnits: number, maxLines: number) {
  const source = text.trim() || "药大拾间";
  const isWordChar = (ch: string) => /[A-Za-z0-9]/.test(ch);
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (const ch of source) {
    if (textUnits(current) + charUnits(ch) > maxUnits && current) {
      if (lines.length === maxLines - 1) {
        truncated = true;
        break;
      }
      let carry = "";
      const lastSpace = current.lastIndexOf(" ");
      if (isWordChar(ch) && isWordChar(current[current.length - 1]) && lastSpace > 0) {
        carry = current.slice(lastSpace + 1);
        current = current.slice(0, lastSpace);
      }
      lines.push(current.trim());
      current = carry;
      if (ch === " " && !current) continue;
    }
    current += ch;
  }
  if (truncated) {
    const chars = Array.from(current.trimEnd());
    while (chars.length > 1 && textUnits(chars.join("")) > maxUnits - 2) chars.pop();
    current = `${chars.join("").trimEnd()}…`;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function normalizeHex(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) return input;
  return "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value: string) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}
