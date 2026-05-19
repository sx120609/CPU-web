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
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewModel: string;
  aiReviewApiKey: string;
  aiReviewAutoPassScore: number;
  aiReviewBlockScore: number;
  aiReviewForceBlockScore: number;
  aiEditSimilarityThreshold: number;
};

export const ALL_FEATURES: FeatureKey[] = ["forum", "market", "coursereview", "electric"];
const SITE_ORIGIN_KEY = "site.origin";
const AI_REVIEW_ENABLED_KEY = "ai.review.enabled";
const AI_REVIEW_PROVIDER_KEY = "ai.review.provider";
const AI_REVIEW_MODEL_KEY = "ai.review.model";
const AI_REVIEW_API_KEY = "ai.review.apiKey";
const AI_REVIEW_AUTO_PASS_SCORE_KEY = "ai.review.autoPassScore";
const AI_REVIEW_BLOCK_SCORE_KEY = "ai.review.blockScore";
const AI_REVIEW_FORCE_BLOCK_SCORE_KEY = "ai.review.forceBlockScore";
const AI_EDIT_SIMILARITY_THRESHOLD_KEY = "ai.review.editSimilarityThreshold";

const cache: Record<FeatureKey, boolean> = {
  forum: true,
  market: true,
  coursereview: true,
  electric: true,
};

const configCache: SiteConfig = {
  siteOrigin: "",
  aiReviewEnabled: false,
  aiReviewProvider: "deepseek",
  aiReviewModel: "deepseek-v4-flash",
  aiReviewApiKey: "",
  aiReviewAutoPassScore: 24,
  aiReviewBlockScore: 70,
  aiReviewForceBlockScore: 90,
  aiEditSimilarityThreshold: 0,
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
    where: {
      key: {
        in: [
          ...ALL_FEATURES.map(keyOf),
          SITE_ORIGIN_KEY,
          AI_REVIEW_ENABLED_KEY,
          AI_REVIEW_PROVIDER_KEY,
          AI_REVIEW_MODEL_KEY,
          AI_REVIEW_API_KEY,
          AI_REVIEW_AUTO_PASS_SCORE_KEY,
          AI_REVIEW_BLOCK_SCORE_KEY,
          AI_REVIEW_FORCE_BLOCK_SCORE_KEY,
          AI_EDIT_SIMILARITY_THRESHOLD_KEY,
        ],
      },
    },
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
    if (r.key === AI_REVIEW_ENABLED_KEY) {
      configCache.aiReviewEnabled = r.value === "on";
      continue;
    }
    if (r.key === AI_REVIEW_PROVIDER_KEY) {
      configCache.aiReviewProvider = String(r.value || "deepseek").trim() || "deepseek";
      continue;
    }
    if (r.key === AI_REVIEW_MODEL_KEY) {
      configCache.aiReviewModel = String(r.value || "deepseek-v4-flash").trim() || "deepseek-v4-flash";
      continue;
    }
    if (r.key === AI_REVIEW_API_KEY) {
      configCache.aiReviewApiKey = String(r.value || "");
      continue;
    }
    if (r.key === AI_REVIEW_AUTO_PASS_SCORE_KEY) {
      configCache.aiReviewAutoPassScore = normalizeAiScore(r.value, 24);
      continue;
    }
    if (r.key === AI_REVIEW_BLOCK_SCORE_KEY) {
      configCache.aiReviewBlockScore = normalizeAiScore(r.value, 70);
      continue;
    }
    if (r.key === AI_REVIEW_FORCE_BLOCK_SCORE_KEY) {
      configCache.aiReviewForceBlockScore = normalizeAiScore(r.value, 90);
      continue;
    }
    if (r.key === AI_EDIT_SIMILARITY_THRESHOLD_KEY) {
      configCache.aiEditSimilarityThreshold = normalizeAiRatio(r.value, 0);
      continue;
    }
    const f = r.key.replace(/^feature\./, "") as FeatureKey;
    if (ALL_FEATURES.includes(f)) cache[f] = r.value === "on";
  }
  sanitizeAiReviewConfig();
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

function normalizeAiScore(input: string | number | null | undefined, fallback: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeAiRatio(input: string | number | null | undefined, fallback: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

function sanitizeAiReviewConfig() {
  configCache.aiReviewAutoPassScore = normalizeAiScore(configCache.aiReviewAutoPassScore, 24);
  configCache.aiReviewBlockScore = normalizeAiScore(configCache.aiReviewBlockScore, 70);
  configCache.aiReviewForceBlockScore = normalizeAiScore(configCache.aiReviewForceBlockScore, 90);
  configCache.aiEditSimilarityThreshold = normalizeAiRatio(configCache.aiEditSimilarityThreshold, 0);
  if (configCache.aiReviewBlockScore < configCache.aiReviewAutoPassScore) {
    configCache.aiReviewBlockScore = configCache.aiReviewAutoPassScore;
  }
  if (configCache.aiReviewForceBlockScore < configCache.aiReviewBlockScore) {
    configCache.aiReviewForceBlockScore = configCache.aiReviewBlockScore;
  }
  if (!configCache.aiReviewProvider) configCache.aiReviewProvider = "deepseek";
  if (!configCache.aiReviewModel) configCache.aiReviewModel = "deepseek-v4-flash";
}

export async function setAiReviewConfig(input: Partial<SiteConfig>): Promise<SiteConfig> {
  const next: SiteConfig = {
    ...configCache,
    aiReviewEnabled: input.aiReviewEnabled ?? configCache.aiReviewEnabled,
    aiReviewProvider: String(input.aiReviewProvider ?? configCache.aiReviewProvider ?? "deepseek").trim() || "deepseek",
    aiReviewModel: String(input.aiReviewModel ?? configCache.aiReviewModel ?? "deepseek-v4-flash").trim() || "deepseek-v4-flash",
    aiReviewApiKey: String(input.aiReviewApiKey ?? configCache.aiReviewApiKey ?? "").trim(),
    aiReviewAutoPassScore: normalizeAiScore(input.aiReviewAutoPassScore, configCache.aiReviewAutoPassScore),
    aiReviewBlockScore: normalizeAiScore(input.aiReviewBlockScore, configCache.aiReviewBlockScore),
    aiReviewForceBlockScore: normalizeAiScore(input.aiReviewForceBlockScore, configCache.aiReviewForceBlockScore),
    aiEditSimilarityThreshold: normalizeAiRatio(input.aiEditSimilarityThreshold, configCache.aiEditSimilarityThreshold),
  };
  if (next.aiReviewBlockScore < next.aiReviewAutoPassScore) {
    throw new Error("AI 自动拦截阈值不能低于自动通过阈值");
  }
  if (next.aiReviewForceBlockScore < next.aiReviewBlockScore) {
    throw new Error("AI 强制拦截阈值不能低于自动拦截阈值");
  }
  await prisma.$transaction([
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_ENABLED_KEY },
      update: { value: next.aiReviewEnabled ? "on" : "off" },
      create: { key: AI_REVIEW_ENABLED_KEY, value: next.aiReviewEnabled ? "on" : "off" },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_PROVIDER_KEY },
      update: { value: next.aiReviewProvider },
      create: { key: AI_REVIEW_PROVIDER_KEY, value: next.aiReviewProvider },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_MODEL_KEY },
      update: { value: next.aiReviewModel },
      create: { key: AI_REVIEW_MODEL_KEY, value: next.aiReviewModel },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_API_KEY },
      update: { value: next.aiReviewApiKey },
      create: { key: AI_REVIEW_API_KEY, value: next.aiReviewApiKey },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_AUTO_PASS_SCORE_KEY },
      update: { value: String(next.aiReviewAutoPassScore) },
      create: { key: AI_REVIEW_AUTO_PASS_SCORE_KEY, value: String(next.aiReviewAutoPassScore) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_BLOCK_SCORE_KEY },
      update: { value: String(next.aiReviewBlockScore) },
      create: { key: AI_REVIEW_BLOCK_SCORE_KEY, value: String(next.aiReviewBlockScore) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_FORCE_BLOCK_SCORE_KEY },
      update: { value: String(next.aiReviewForceBlockScore) },
      create: { key: AI_REVIEW_FORCE_BLOCK_SCORE_KEY, value: String(next.aiReviewForceBlockScore) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_EDIT_SIMILARITY_THRESHOLD_KEY },
      update: { value: String(next.aiEditSimilarityThreshold) },
      create: { key: AI_EDIT_SIMILARITY_THRESHOLD_KEY, value: String(next.aiEditSimilarityThreshold) },
    }),
  ]);
  Object.assign(configCache, next);
  sanitizeAiReviewConfig();
  return getSiteConfig();
}
