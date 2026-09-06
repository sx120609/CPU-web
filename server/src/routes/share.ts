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
    <meta property="og:image:height" content="980" />
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
        background: linear-gradient(180deg, #eef6ff 0%, #ffffff 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #172033;
      }
      .card {
        width: min(92vw, 520px);
        padding: 28px 24px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 20px 48px rgba(15, 23, 42, 0.12);
      }
      .badge {
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #0f766e;
        font-size: 12px;
        font-weight: 700;
      }
      h1 {
        margin: 14px 0 10px;
        font-size: 24px;
        line-height: 1.35;
      }
      p {
        margin: 0;
        color: #667085;
        line-height: 1.7;
        font-size: 14px;
      }
      a {
        display: inline-flex;
        margin-top: 18px;
        color: #168776;
        text-decoration: none;
        font-weight: 700;
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

export async function renderTopicCardSvg(topic: any, origin: string) {
  const boardName = topic.board?.name || "药大拾间";
  const boardColor = topic.board?.color || "#168776";
  const authorName = topic.isAnonymous ? presentAnonymousAlias(topic.anonymousAlias) : (topic.author?.nickname || "同学");
  const subtitle = `${boardName} · ${authorName}`;
  const footer = `${topic.replyCount || 0} 条回复 · ${topic.viewCount || 0} 浏览`;
  const titleLines = wrapText(topic.title, 15, 3);
  const titleSvg = titleLines
    .map((line, index) => `<tspan x="360" dy="${index === 0 ? 0 : 60}">${escapeXml(line)}</tspan>`)
    .join("");
  const qrDataUrl = await QRCode.toDataURL(`${origin}/share/topic/${topic.id}`, {
    margin: 1,
    width: 220,
    color: { dark: "#111827", light: "#ffffff" },
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="980" viewBox="0 0 720 980" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(topic.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6f8fb" />
      <stop offset="100%" stop-color="#edf2f7" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#0f172a" flood-opacity="0.10" />
    </filter>
  </defs>
  <rect width="720" height="980" fill="url(#bg)" />
  <circle cx="626" cy="110" r="126" fill="${escapeXml(withOpacity(boardColor, 0.12))}" />
  <circle cx="674" cy="58" r="58" fill="${escapeXml(withOpacity(boardColor, 0.08))}" />
  <rect x="52" y="48" width="616" height="884" rx="38" fill="#ffffff" filter="url(#cardShadow)" />

  <image x="92" y="108" width="88" height="88" href="${siteLogoDataUrl()}" />

  <text x="208" y="138" font-size="19" font-weight="700" fill="#101828">${escapeXml(boardName)}</text>
  <text x="208" y="166" font-size="16" fill="#667085">${escapeXml(subtitle)}</text>
  <text x="208" y="194" font-size="16" fill="#98a2b3">${escapeXml(footer)}</text>

  <rect x="92" y="250" width="536" height="328" rx="30" fill="${escapeXml(withOpacity(boardColor, 0.06))}" />
  <circle cx="532" cy="334" r="112" fill="${escapeXml(withOpacity(boardColor, 0.12))}" />
  <circle cx="594" cy="270" r="42" fill="${escapeXml(withOpacity(boardColor, 0.10))}" />
  <rect x="132" y="302" width="140" height="16" rx="8" fill="${escapeXml(withOpacity(boardColor, 0.18))}" />
  <text x="360" y="394" text-anchor="middle" font-size="60" font-weight="820" fill="#172033">${titleSvg}</text>
  <text x="112" y="516" font-size="18" fill="#667085">${escapeXml(subtitle)}</text>

  <rect x="92" y="650" width="536" height="1" fill="#edf2f7" />

  <text x="92" y="724" font-size="40" font-weight="820" fill="#172033">药大拾间</text>
  <text x="92" y="764" font-size="19" fill="#667085">扫描二维码，直接打开原帖</text>
  <text x="92" y="816" font-size="16" font-weight="700" fill="${escapeXml(boardColor)}">${escapeXml(boardName)}</text>
  <text x="92" y="842" font-size="16" fill="#98a2b3">cputime.cn</text>

  <rect x="458" y="704" width="132" height="132" rx="20" fill="#ffffff" stroke="#dfe5ee" />
  <image x="470" y="716" width="108" height="108" href="${escapeXml(qrDataUrl)}" />
</svg>`;
}

function renderFallbackCardSvg(title: string, description: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="980" viewBox="0 0 720 980" xmlns="http://www.w3.org/2000/svg">
  <rect width="720" height="980" fill="#f8fafc" />
  <text x="56" y="180" font-size="46" font-weight="800" fill="#172033">${escapeXml(title)}</text>
  <text x="56" y="254" font-size="24" fill="#667085">${escapeXml(description)}</text>
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

function wrapText(text: string, maxUnits: number, maxLines: number) {
  const source = text.trim() || "药大拾间";
  const lines: string[] = [];
  let current = "";
  let units = 0;
  for (const ch of source) {
    const width = /[\u0000-\u00ff]/.test(ch) ? 1 : 2;
    if (units + width > maxUnits) {
      lines.push(current.trim());
      current = ch;
      units = width;
      if (lines.length >= maxLines) break;
      continue;
    }
    current += ch;
    units += width;
  }
  if (lines.length < maxLines && current.trim()) lines.push(current.trim());
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (source.length > lines.join("").length && lines.length) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], Math.max(2, lines[lines.length - 1].length - 1));
  }
  return lines.slice(0, maxLines);
}

function withOpacity(hex: string, alpha: number) {
  const normalized = normalizeHex(hex);
  if (!normalized) return `rgba(22, 135, 118, ${alpha})`;
  const value = normalized.slice(1);
  const step = value.length === 3 ? 1 : 2;
  const expand = (segment: string) => step === 1 ? segment.repeat(2) : segment;
  const r = parseInt(expand(value.slice(0, step)), 16);
  const g = parseInt(expand(value.slice(step, step * 2)), 16);
  const b = parseInt(expand(value.slice(step * 2, step * 3)), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
