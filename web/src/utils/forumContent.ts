const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeCodePoint(value: string, radix: number) {
  const point = Number.parseInt(value, radix);
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
}

export function forumContentExcerpt(content: unknown, maxLength = 90) {
  const source = String(content || "");
  const text = source
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:p|div|h[1-6]|blockquote|li|br)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>]*$/g, " ")
    .replace(/!\[[^\]]*\]\([^\n)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^\n)]+\)/g, "$1")
    .replace(/[`*_~#>|]/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith("#x")) return decodeCodePoint(key.slice(2), 16);
      if (key.startsWith("#")) return decodeCodePoint(key.slice(1), 10);
      return HTML_ENTITY_MAP[key] ?? " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : text;
}

export function forumInternalTitle(content: unknown, fallback = "新帖子") {
  const excerpt = forumContentExcerpt(content, 60).replace(/…$/, "").trim();
  return excerpt.length >= 2 ? excerpt : fallback;
}

function normalizeForumImageUrl(value: string) {
  const url = value.trim().replace(/&amp;/gi, "&");
  if (!url || !/^(?:https?:\/\/|\/(?!\/))/i.test(url)) return "";
  return url;
}

/** Extract a small, stable preview set without rendering the post's raw HTML. */
export function forumContentImages(content: unknown, limit = 9) {
  const source = String(content || "");
  const max = Math.min(9, Math.max(0, Math.trunc(limit)));
  if (!max) return [];

  const candidates: string[] = [];
  for (const match of source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    candidates.push(match[1] || "");
  }
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g)) {
    candidates.push(match[1] || "");
  }

  const seen = new Set<string>();
  const images: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeForumImageUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    images.push(normalized);
    if (images.length >= max) break;
  }
  return images;
}
