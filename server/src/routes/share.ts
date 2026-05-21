import { Router, type Request } from "express";
import QRCode from "qrcode";
import { prisma } from "../prisma";
import { getSiteOrigin, isBoardTypeEnabled } from "../services/siteSettings";

export const shareRouter = Router();

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
    const imageUrl = `${origin}/share/topic/${topic.id}/card.svg`;
    const description = buildTopicDescription(topic);
    res.type("html").send(renderTopicSharePage({
      origin,
      shareUrl,
      topicUrl,
      imageUrl,
      title: `${topic.title} · 药大垎坊`,
      description,
      topicTitle: topic.title,
      boardName: topic.board.name,
    }));
  } catch (error) {
    next(error);
  }
});

shareRouter.get("/topic/:id/card.svg", async (req, res, next) => {
  try {
    const topic = await loadShareTopic(req.params.id);
    if (!topic) {
      res.status(404).type("image/svg+xml").send(renderFallbackCardSvg("药大垎坊", "分享内容不存在或暂不可用"));
      return;
    }
    const origin = resolvePublicOrigin(req);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(await renderTopicCardSvg(topic, origin));
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
  if (!topic || topic.hidden || !topic.board || !isBoardTypeEnabled(topic.board.type)) return null;
  return topic;
}

function resolvePublicOrigin(req: Request) {
  const configured = getSiteOrigin();
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "https://cpu.lizmt.cn";
}

function buildTopicDescription(topic: any) {
  const boardPart = topic.board?.name ? `来自 ${topic.board.name} · ` : "";
  const authorPart = topic.isAnonymous ? (topic.anonymousAlias || "匿名同学") : (topic.author?.nickname || "同学");
  const content = stripText(topic.content);
  const brief = content ? truncateText(content, 80) : "点击查看完整内容";
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
  origin: string;
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
    <meta property="og:site_name" content="药大垎坊" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
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

async function renderTopicCardSvg(topic: any, origin: string) {
  const boardName = topic.board?.name || "药大垎坊";
  const boardIcon = topic.board?.icon || "💬";
  const boardColor = topic.board?.color || "#168776";
  const authorName = topic.isAnonymous ? (topic.anonymousAlias || "匿名同学") : (topic.author?.nickname || "同学");
  const tags = Array.isArray(topic.tags)
    ? topic.tags.map((item: any) => item?.tag?.name).filter(Boolean).slice(0, 2)
    : [];
  const description = buildTopicDescription(topic).replace(/^来自 .*? · /, "");
  const lines = wrapText(topic.title, 17, 3);
  const descLines = wrapText(description, 20, 5);
  const footer = [authorName, `${topic.replyCount || 0} 条回复`, `${topic.viewCount || 0} 浏览`].join(" · ");
  const tagText = tags.join(" · ") || boardName;
  const qrDataUrl = await QRCode.toDataURL(`${origin}/share/topic/${topic.id}`, {
    margin: 1,
    width: 220,
    color: { dark: "#111827", light: "#ffffff" },
  });
  const titleSvg = lines.map((line, index) => `<tspan x="94" dy="${index === 0 ? 0 : 48}">${escapeXml(line)}</tspan>`).join("");
  const descSvg = descLines.map((line, index) => `<tspan x="126" dy="${index === 0 ? 0 : 28}">${escapeXml(line)}</tspan>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="1080" viewBox="0 0 720 1080" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(topic.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f7f9fc" />
      <stop offset="100%" stop-color="#eef2f7" />
    </linearGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(boardColor)}" />
      <stop offset="62%" stop-color="#167d72" />
      <stop offset="100%" stop-color="#21496f" />
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fbfaf7" />
      <stop offset="100%" stop-color="#f4efe5" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.10" />
    </filter>
  </defs>
  <rect width="720" height="1080" fill="url(#bg)" />
  <circle cx="620" cy="112" r="132" fill="${escapeXml(withOpacity(boardColor, 0.10))}" />
  <circle cx="666" cy="64" r="60" fill="${escapeXml(withOpacity(boardColor, 0.08))}" />
  <rect x="44" y="40" width="632" height="1000" rx="34" fill="#fffdfa" filter="url(#cardShadow)" />
  <rect x="68" y="64" width="584" height="250" rx="30" fill="url(#hero)" />
  <circle cx="566" cy="148" r="98" fill="${escapeXml(withOpacity("#ffffff", 0.10))}" />
  <text x="560" y="180" font-size="108" text-anchor="middle" fill="${escapeXml(withOpacity("#ffffff", 0.16))}">${escapeXml(boardIcon)}</text>
  <rect x="94" y="92" width="184" height="38" rx="19" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.16)" />
  <text x="116" y="117" font-size="21" font-weight="700" fill="#ffffff">${escapeXml(boardIcon)} ${escapeXml(boardName)}</text>
  <text x="94" y="164" font-size="18" font-weight="700" fill="${escapeXml(withOpacity("#ffffff", 0.82))}">校园社区分享</text>
  <text x="94" y="214" font-size="48" font-weight="820" fill="#ffffff">${titleSvg}</text>
  <rect x="94" y="266" width="334" height="36" rx="18" fill="rgba(255,255,255,0.16)" />
  <text x="114" y="289" font-size="18" font-weight="700" fill="#ffffff">${escapeXml(footer)}</text>
  <rect x="68" y="338" width="584" height="286" rx="28" fill="url(#paper)" stroke="${escapeXml(withOpacity(boardColor, 0.10))}" />
  <text x="92" y="404" font-size="82" font-weight="700" fill="${escapeXml(withOpacity(boardColor, 0.18))}">“</text>
  <text x="126" y="398" font-size="24" font-weight="700" fill="${escapeXml(boardColor)}">内容摘要</text>
  <text x="94" y="452" font-size="25" fill="#435365">${descSvg}</text>
  <rect x="94" y="650" width="172" height="40" rx="20" fill="#f3f6fa" />
  <text x="118" y="676" font-size="19" font-weight="700" fill="#172033">${escapeXml(authorName)}</text>
  <rect x="282" y="650" width="118" height="40" rx="20" fill="#f3f6fa" />
  <text x="306" y="676" font-size="19" font-weight="700" fill="#172033">${topic.replyCount || 0} 回复</text>
  <rect x="416" y="650" width="118" height="40" rx="20" fill="#f3f6fa" />
  <text x="440" y="676" font-size="19" font-weight="700" fill="#172033">${topic.viewCount || 0} 浏览</text>
  <text x="94" y="728" font-size="20" font-weight="700" fill="${escapeXml(boardColor)}">${escapeXml(tagText)}</text>
  <line x1="94" y1="764" x2="626" y2="764" stroke="#eceff4" stroke-dasharray="8 8" />
  <text x="94" y="828" font-size="38" font-weight="820" fill="#172033">药大垎坊</text>
  <text x="94" y="868" font-size="20" fill="#667085">保存这张卡片，扫码即可查看原帖</text>
  <text x="94" y="926" font-size="20" font-weight="700" fill="#172033">${escapeXml(footer)}</text>
  <rect x="468" y="804" width="142" height="142" rx="20" fill="#ffffff" stroke="#dfe5ee" />
  <image x="482" y="818" width="114" height="114" href="${escapeXml(qrDataUrl)}" />
  <text x="476" y="974" font-size="15" fill="#98a2b3">扫码查看原帖</text>
  <rect x="94" y="982" width="518" height="1" fill="#eef2f7" />
  <text x="94" y="1018" font-size="17" fill="#98a2b3">cpu.lizmt.cn · 校园社区分享卡片</text>
</svg>`;
}

function renderFallbackCardSvg(title: string, description: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="1100" viewBox="0 0 720 1100" xmlns="http://www.w3.org/2000/svg">
  <rect width="720" height="1100" fill="#f8fafc" />
  <text x="56" y="180" font-size="46" font-weight="800" fill="#172033">${escapeXml(title)}</text>
  <text x="56" y="254" font-size="24" fill="#667085">${escapeXml(description)}</text>
</svg>`;
}

function renderNotFoundPage(origin: string, targetPath: string) {
  const target = `${origin}${targetPath}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
    <title>药大垎坊</title>
  </head>
  <body>
    <a href="${escapeHtml(target)}">继续访问药大垎坊</a>
  </body>
</html>`;
}

function wrapText(text: string, maxUnits: number, maxLines: number) {
  const source = text.trim() || "药大垎坊";
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
