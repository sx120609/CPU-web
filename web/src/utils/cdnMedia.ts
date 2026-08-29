const MEDIA_CDN_BASE = "https://img.cputime.cn/cpu-web-media";
const RESIZABLE_IMAGE_RE = /\.(?:avif|jpe?g|png|webp)$/i;

export function directMediaUrl(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (source.startsWith("/uploads/")) {
    if (typeof window !== "undefined" && /^(?:127\.0\.0\.1|localhost)$/u.test(window.location.hostname)) return source;
    return `${MEDIA_CDN_BASE}/${source.slice("/uploads/".length)}`;
  }
  return source;
}

export function cdnImageUrl(value: unknown, options: { width?: number; quality?: number } = {}) {
  const source = directMediaUrl(value);
  const width = Math.max(0, Math.round(Number(options.width) || 0));
  if (!source || !width || !source.startsWith(`${MEDIA_CDN_BASE}/`)) return source;
  const [pathname, query = ""] = source.split("?", 2);
  if (query || !RESIZABLE_IMAGE_RE.test(pathname)) return source;
  const quality = Math.min(92, Math.max(55, Math.round(Number(options.quality) || 80)));
  return `${source}?imageMogr2/auto-orient/thumbnail/${width}x/quality/${quality}/format/webp`;
}

export function cdnImageSrcset(value: unknown, widths: number[], quality = 80) {
  const source = directMediaUrl(value);
  if (!source) return "";
  return Array.from(new Set(widths.map((width) => Math.max(1, Math.round(width))).filter(Boolean)))
    .map((width) => `${cdnImageUrl(source, { width, quality })} ${width}w`)
    .join(", ");
}
