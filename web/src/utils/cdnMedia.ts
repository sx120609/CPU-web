const MEDIA_CDN_BASE = "https://static.cputime.cn/cpu-web-media";
const RESIZABLE_IMAGE_RE = /\.(?:avif|jpe?g|png|webp)$/i;

export function directMediaUrl(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return "";
  // Uploaded media must follow the active provider; mirror availability is independent of saving.
  return source;
}

export function withMediaRevision(value: unknown, revision: string | number) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^(?:data|blob):/i.test(source)) return source;
  const hashIndex = source.indexOf("#");
  const fragment = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const address = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const queryIndex = address.indexOf("?");
  const base = queryIndex >= 0 ? address.slice(0, queryIndex) : address;
  const query = new URLSearchParams(queryIndex >= 0 ? address.slice(queryIndex + 1) : "");
  query.set("media_rev", String(revision));
  return `${base}?${query}${fragment}`;
}

export function cdnImageUrl(value: unknown, options: { width?: number; quality?: number } = {}) {
  const source = directMediaUrl(value);
  const width = Math.max(0, Math.round(Number(options.width) || 0));
  if (source.startsWith("/uploads/") && width && RESIZABLE_IMAGE_RE.test(source.split(/[?#]/, 1)[0])) {
    const url = new URL(source, "https://media.invalid");
    url.searchParams.set("image_width", String(Math.min(2048, Math.max(64, width))));
    url.searchParams.set("image_quality", String(Math.min(92, Math.max(55, Math.round(Number(options.quality) || 80)))));
    return `${url.pathname}${url.search}${url.hash}`;
  }
  if (!source || !width || !source.startsWith(`${MEDIA_CDN_BASE}/`)) return source;
  const [pathname, query = ""] = source.split("?", 2);
  if (query || !RESIZABLE_IMAGE_RE.test(pathname)) return source;
  const quality = Math.min(92, Math.max(55, Math.round(Number(options.quality) || 80)));
  return `${source}?x-oss-process=image/auto-orient,1/resize,w_${width}/quality,q_${quality}/format,webp`;
}

export function cdnImageSrcset(value: unknown, widths: number[], quality = 80) {
  const source = directMediaUrl(value);
  if (!source) return "";
  return Array.from(new Set(widths.map((width) => Math.max(1, Math.round(width))).filter(Boolean)))
    .map((width) => `${cdnImageUrl(source, { width, quality })} ${width}w`)
    .join(", ");
}
