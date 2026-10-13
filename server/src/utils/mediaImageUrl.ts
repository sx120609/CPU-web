const IMAGE_WIDTH_BUCKETS = [64, 96, 128, 160, 192, 256, 320, 384, 480, 640, 768, 960, 1080, 1280, 1600, 2048];

export function mediaImageDeliveryUrl(source: string, provider: "cos" | "oss", relativePath: string, query: Record<string, unknown>) {
  if (!/\.(?:avif|jpe?g|png|webp)$/i.test(relativePath)) return source;
  const rawWidth = typeof query.image_width === "string" ? Number(query.image_width) : 0;
  if (!Number.isFinite(rawWidth) || rawWidth <= 0) return source;
  // 宽度向上取到固定档位、质量取到 5 的倍数：任意参数组合会让云端按变体逐个计费处理，
  // 收敛后每张图最多约一百多个变体，CDN 命中率也更高。向上取整保证清晰度不低于请求。
  const clamped = Math.min(2048, Math.max(64, Math.round(rawWidth)));
  const width = IMAGE_WIDTH_BUCKETS.find((bucket) => bucket >= clamped) ?? 2048;
  const rawQuality = typeof query.image_quality === "string" ? Number(query.image_quality) : 80;
  const quality = Number.isFinite(rawQuality) ? Math.min(90, Math.max(55, Math.round(rawQuality / 5) * 5)) : 80;
  const url = new URL(source);
  if (provider === "oss") {
    url.searchParams.set("x-oss-process", `image/auto-orient,1/resize,w_${width}/quality,q_${quality}/format,webp`);
  } else {
    const processing = `imageMogr2/auto-orient/thumbnail/${width}x/quality/${quality}/format/webp`;
    url.search = url.search ? `${url.search}&${processing}` : processing;
  }
  return url.toString();
}
