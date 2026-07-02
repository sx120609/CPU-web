export type ParsedShareCard = {
  source?: string;
  title?: string;
  summary?: string;
  url?: string;
};

export function parseCqParams(raw: string) {
  const out: Record<string, string> = {};
  const parts = String(raw || "").split(",");
  for (const item of parts) {
    const [key, ...rest] = item.split("=");
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = rest.join("=").trim();
  }
  return out;
}

export function parseShareSegmentCard(data: any): ParsedShareCard | null {
  return finalizeShareCard({
    source: undefined,
    title: data?.title,
    summary: data?.content,
    url: pickShareCardUrl(data),
  });
}

export function parseMusicSegmentCard(data: any): ParsedShareCard | null {
  const sourceMap: Record<string, string> = {
    qq: "QQ音乐",
    "163": "网易云音乐",
    kugou: "酷狗音乐",
    kuwo: "酷我音乐",
    migu: "咪咕音乐",
    xm: "虾米音乐",
    custom: "音乐分享",
  };
  return finalizeShareCard({
    source: sourceMap[String(data?.type || "").trim().toLowerCase()] || "音乐分享",
    title: data?.title,
    summary: data?.content || data?.singer,
    url: pickShareCardUrl(data),
  });
}

export function parseJsonShareCard(raw: unknown): ParsedShareCard | null {
  const root = normalizeJsonCardValue(raw);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const metaCandidates = Object.values((root as any).meta || {}).filter((item) => item && typeof item === "object");
  const candidates = [
    ...metaCandidates.map((item) => extractShareCardFromObject(item, root)),
    extractShareCardFromObject(root, root),
  ].filter(Boolean) as ParsedShareCard[];
  return finalizeShareCard(pickBestShareCard(candidates));
}

export function parseXmlShareCard(raw: unknown): ParsedShareCard | null {
  const xml = decodeCqEntities(String(raw || "").trim());
  if (!xml) return null;
  return finalizeShareCard({
    source: extractXmlAttr(xml, "source", "name") || extractXmlAttr(xml, "msg", "brief"),
    title: extractXmlTagText(xml, "title"),
    summary: extractXmlTagText(xml, "summary"),
    url: firstNonEmpty([
      extractXmlAttr(xml, "msg", "url"),
      extractXmlAttr(xml, "item", "url"),
      extractXmlShareCardUrl(xml),
    ]),
  });
}

export function renderShareCardBlock(card: ParsedShareCard | null) {
  const normalized = finalizeShareCard(card);
  if (!normalized) return "\n[分享卡片]\n";
  const title = escapeShareCardHtml(normalized.title || normalized.source || extractUrlHostLabel(normalized.url) || "分享卡片");
  const summary = normalized.summary ? escapeShareCardHtml(normalized.summary) : "";
  const source = normalized.source ? escapeShareCardHtml(normalized.source) : "";
  const host = extractUrlHostLabel(normalized.url);
  const hostLabel = host && host !== normalized.source ? escapeShareCardHtml(host) : "";
  const hasLink = Boolean(normalized.url);
  const linkAttrs = hasLink
    ? ` href="${escapeShareCardHtml(normalized.url!)}" target="_blank" rel="noopener noreferrer nofollow"`
    : "";
  const wrapperTag = hasLink ? "a" : "div";
  const metaBits = [
    source ? `<span class="qq-share-card__source">${source}</span>` : "",
    hostLabel ? `<span class="qq-share-card__host">${hostLabel}</span>` : "",
  ].filter(Boolean).join("");
  return [
    "",
    `<${wrapperTag} class="qq-share-card${hasLink ? " qq-share-card--linked" : ""}"${linkAttrs}>`,
    `<div class="qq-share-card__eyebrow">分享卡片</div>`,
    `<div class="qq-share-card__title">${title}</div>`,
    summary ? `<div class="qq-share-card__summary">${summary}</div>` : "",
    metaBits ? `<div class="qq-share-card__meta">${metaBits}</div>` : "",
    hasLink ? `<div class="qq-share-card__action"><span class="qq-share-card__action-link">打开链接</span></div>` : "",
    `</${wrapperTag}>`,
    "",
  ].filter(Boolean).join("\n");
}

export function escapeShareCardHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickBestShareCard(cards: ParsedShareCard[]) {
  let best: ParsedShareCard | null = null;
  let bestScore = -1;
  for (const card of cards) {
    const score = Number(Boolean(card.url)) * 3
      + Number(Boolean(card.title)) * 2
      + Number(Boolean(card.summary))
      + Number(Boolean(card.source)) * 0.5;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

function extractShareCardFromObject(candidate: any, fallbackRoot?: any): ParsedShareCard | null {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    source: firstNonEmpty([
      candidate.tag,
      candidate.source,
      candidate.sourceName,
      fallbackRoot?.prompt,
      fallbackRoot?.desc,
      fallbackRoot?.app,
    ]),
    title: firstNonEmpty([
      candidate.title,
      candidate.name,
      candidate.headline,
      fallbackRoot?.title,
    ]),
    summary: firstNonEmpty([
      candidate.desc,
      candidate.description,
      candidate.summary,
      candidate.content,
      candidate.text,
      candidate.brief,
      candidate.subtitle,
      fallbackRoot?.summary,
    ]),
    url: firstNonEmpty([
      pickShareCardUrl(candidate),
      pickShareCardUrl(fallbackRoot),
      candidate.url,
      fallbackRoot?.url,
    ]),
  };
}

function normalizeJsonCardValue(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  const text = decodeCqEntities(String(raw || "").trim());
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function finalizeShareCard(card: ParsedShareCard | null | undefined): ParsedShareCard | null {
  if (!card) return null;
  const source = normalizeShareCardText(card.source, { allowGenericShareText: false, allowPackageName: false });
  const title = normalizeShareCardText(card.title, { allowGenericShareText: false });
  const summary = normalizeShareCardText(card.summary, { allowGenericShareText: false });
  const url = normalizeShareCardUrl(card.url);
  const resolvedSource = source && source !== title ? source : "";
  const resolvedSummary = summary && summary !== title ? summary : "";
  if (!resolvedSource && !title && !resolvedSummary && !url) return null;
  return {
    source: resolvedSource || undefined,
    title: title || undefined,
    summary: resolvedSummary || undefined,
    url: url || undefined,
  };
}

function normalizeShareCardText(
  value: unknown,
  options: { allowGenericShareText?: boolean; allowPackageName?: boolean } = {},
) {
  let text = decodeCqEntities(String(value || "").trim());
  if (!text) return "";
  text = text
    .replace(/\r/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\[(?:分享|链接分享)\]\s*/u, "")
    .trim();
  if (!text) return "";
  if (!options.allowPackageName && looksLikePackageName(text)) return "";
  if (!options.allowGenericShareText && /^(分享|链接分享|QQ分享)$/iu.test(text)) return "";
  return text.slice(0, 300);
}

function normalizeShareCardUrl(value: unknown): string {
  const raw = decodeCqEntities(String(value || "").trim());
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 1000);
  const extracted = extractEmbeddedShareCardUrl(raw);
  if (extracted) return extracted;
  const decodedOnce = safeDecodeUriComponent(raw);
  if (decodedOnce && decodedOnce !== raw) {
    const decodedUrl = normalizeShareCardUrl(decodedOnce);
    if (decodedUrl) return decodedUrl;
  }
  try {
    const parsed = new URL(raw);
    for (const [key, valueText] of parsed.searchParams.entries()) {
      if (!looksLikeShareCardUrlKey(key)) continue;
      const nestedUrl = normalizeShareCardUrl(valueText);
      if (nestedUrl) return nestedUrl;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function pickShareCardUrl(value: unknown): string {
  return findShareCardUrl(value, 0, new Set<object>());
}

function findShareCardUrl(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return normalizeShareCardUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedUrl = findShareCardUrl(item, depth + 1, seen);
      if (nestedUrl) return nestedUrl;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value as object)) return "";
  seen.add(value as object);
  const entries = Object.entries(value as Record<string, unknown>);
  const prioritized = entries.filter(([key]) => looksLikeShareCardUrlKey(key));
  for (const [, nested] of prioritized) {
    const nestedUrl = findShareCardUrl(nested, depth + 1, seen);
    if (nestedUrl) return nestedUrl;
  }
  for (const [, nested] of entries) {
    if (!nested || typeof nested !== "object") continue;
    const nestedUrl = findShareCardUrl(nested, depth + 1, seen);
    if (nestedUrl) return nestedUrl;
  }
  return "";
}

function looksLikeShareCardUrlKey(value: string): boolean {
  const normalized = String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "url"
    || normalized.endsWith("url")
    || normalized.endsWith("href")
    || normalized.endsWith("link");
}

function firstNonEmpty(values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function looksLikePackageName(value: string) {
  return /^[a-z0-9_.-]+\.[a-z0-9_.-]+$/i.test(value.trim());
}

function decodeCqEntities(value: string) {
  let out = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    out = out
      .replace(/&amp;/g, "&")
      .replace(/&#91;/g, "[")
      .replace(/&#93;/g, "]")
      .replace(/&#44;/g, ",")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return out;
}

function extractUrlHostLabel(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function extractXmlTagText(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? decodeCqEntities(match[1]).replace(/<!\\[CDATA\\[|\\]\\]>/g, "").trim() : "";
}

function extractXmlAttr(xml: string, tagName: string, attrName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=(["'])([\\s\\S]*?)\\1`, "i");
  const match = xml.match(pattern);
  return match ? decodeCqEntities(match[2]).trim() : "";
}

function extractXmlShareCardUrl(xml: string): string {
  const attrRe = /\b([a-zA-Z0-9_:-]*(?:url|link|href)[a-zA-Z0-9_:-]*)=(["'])([\s\S]*?)\2/gi;
  for (const match of xml.matchAll(attrRe)) {
    const resolved = normalizeShareCardUrl(match[3]);
    if (resolved) return resolved;
  }
  return "";
}

function extractEmbeddedShareCardUrl(value: string): string {
  const candidates = [String(value || "").trim()];
  const decodedOnce = safeDecodeUriComponent(candidates[0]);
  if (decodedOnce && decodedOnce !== candidates[0]) candidates.push(decodedOnce);
  const decodedTwice = safeDecodeUriComponent(decodedOnce);
  if (decodedTwice && decodedTwice !== decodedOnce) candidates.push(decodedTwice);
  for (const candidate of candidates) {
    const match = candidate.match(/https?:\/\/[^\s"'<>`]+/i);
    if (!match) continue;
    return match[0].slice(0, 1000);
  }
  return "";
}

function safeDecodeUriComponent(value: string): string {
  const raw = String(value || "").trim();
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
