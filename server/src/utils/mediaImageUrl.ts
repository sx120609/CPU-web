export function mediaImageDeliveryUrl(source: string, provider: "cos" | "oss", relativePath: string, query: Record<string, unknown>) {
  if (!/\.(?:avif|jpe?g|png|webp)$/i.test(relativePath)) return source;
  const rawWidth = typeof query.image_width === "string" ? Number(query.image_width) : 0;
  if (!Number.isFinite(rawWidth) || rawWidth <= 0) return source;
  const width = Math.min(2048, Math.max(64, Math.round(rawWidth)));
  const rawQuality = typeof query.image_quality === "string" ? Number(query.image_quality) : 80;
  const quality = Number.isFinite(rawQuality) ? Math.min(92, Math.max(55, Math.round(rawQuality))) : 80;
  const url = new URL(source);
  if (provider === "oss") {
    url.searchParams.set("x-oss-process", `image/auto-orient,1/resize,w_${width}/quality,q_${quality}/format,webp`);
  } else {
    const processing = `imageMogr2/auto-orient/thumbnail/${width}x/quality/${quality}/format/webp`;
    url.search = url.search ? `${url.search}&${processing}` : processing;
  }
  return url.toString();
}
