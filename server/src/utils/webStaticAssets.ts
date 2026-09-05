export function isPublicCdnAsset(relativePath: string) {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.startsWith("assets/") || normalized.startsWith(".vite/")) return false;
  if (normalized.startsWith("splash/")) return /^splash\/ios-launch-v6-\d+x\d+\.png$/u.test(normalized);
  if (/^(?:brand|downloads)\//u.test(normalized)) return /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(normalized);
  return /^(?:apple-touch-icon-v\d+|icon-(?:192|512)-v\d+|icon-huawei-standard-\d+|image-placeholder|wechat-service-qrcode)\.(?:png|svg)$/iu.test(normalized);
}
