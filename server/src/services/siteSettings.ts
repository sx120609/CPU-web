/**
 * 站点功能开关
 *
 * KV 持久化 + 内存缓存。修改后立即更新缓存，公开 API 直接读缓存（高频）。
 *
 * 用途："言论敏感时一键关闭论坛 / 二手 / 课评"。
 * 默认值：全部为 on（即不破坏现有上线体验）。
 */
import { prisma } from "../prisma";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric";
export type SiteConfig = {
  siteOrigin: string;
};

export const ALL_FEATURES: FeatureKey[] = ["forum", "market", "coursereview", "electric"];
const SITE_ORIGIN_KEY = "site.origin";

const cache: Record<FeatureKey, boolean> = {
  forum: true,
  market: true,
  coursereview: true,
  electric: true,
};

const configCache: SiteConfig = {
  siteOrigin: "",
};

function keyOf(f: FeatureKey) {
  return `feature.${f}`;
}

export function normalizeSiteOrigin(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("网站域名格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("网站域名仅支持 http 或 https");
  }
  return url.origin.replace(/\/+$/, "");
}

/** 服务启动时加载一次；之后每次写入会同步更新缓存 */
export async function loadFeatures(): Promise<void> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: [...ALL_FEATURES.map(keyOf), SITE_ORIGIN_KEY] } },
  });
  for (const r of rows) {
    if (r.key === SITE_ORIGIN_KEY) {
      try {
        configCache.siteOrigin = normalizeSiteOrigin(r.value);
      } catch {
        configCache.siteOrigin = "";
      }
      continue;
    }
    const f = r.key.replace(/^feature\./, "") as FeatureKey;
    if (ALL_FEATURES.includes(f)) cache[f] = r.value === "on";
  }
}

export function getFeatures(): Record<FeatureKey, boolean> {
  return { ...cache };
}

export function isFeatureOn(f: FeatureKey): boolean {
  return cache[f];
}

export function getSiteConfig(): SiteConfig {
  return { ...configCache };
}

export function getSiteOrigin(): string {
  return configCache.siteOrigin;
}

export function featureForBoardType(type: string | null | undefined): FeatureKey | null {
  if (type === "announce") return null;
  if (type === "market") return "market";
  if (type === "coursereview") return "coursereview";
  return "forum";
}

export function isBoardTypeEnabled(type: string | null | undefined): boolean {
  const feature = featureForBoardType(type);
  return !feature || isFeatureOn(feature);
}

export function enabledBoardTypes(): string[] {
  const types = ["announce"];
  if (isFeatureOn("forum")) types.push("normal", "question");
  if (isFeatureOn("market")) types.push("market");
  if (isFeatureOn("coursereview")) types.push("coursereview");
  return types;
}

export function featureClosedMessage(type: string | null | undefined): string {
  const feature = featureForBoardType(type);
  if (feature === "market") return "二手市场当前已关闭";
  if (feature === "coursereview") return "课程点评当前已关闭";
  if (feature === "forum") return "论坛当前已关闭";
  return "该功能当前不可用";
}

export async function setFeature(f: FeatureKey, on: boolean): Promise<void> {
  const value = on ? "on" : "off";
  await prisma.siteSetting.upsert({
    where: { key: keyOf(f) },
    update: { value },
    create: { key: keyOf(f), value },
  });
  cache[f] = on;
}

export async function setSiteOrigin(input: string | null | undefined): Promise<SiteConfig> {
  const siteOrigin = normalizeSiteOrigin(input);
  await prisma.siteSetting.upsert({
    where: { key: SITE_ORIGIN_KEY },
    update: { value: siteOrigin },
    create: { key: SITE_ORIGIN_KEY, value: siteOrigin },
  });
  configCache.siteOrigin = siteOrigin;
  return getSiteConfig();
}
