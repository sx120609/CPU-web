/**
 * 站点功能开关
 *
 * KV 持久化 + 内存缓存。修改后立即更新缓存，公开 API 直接读缓存（高频）。
 *
 * 用途："言论敏感时一键关闭论坛 / 二手 / 课评"。
 * 默认值：全部为 on（即不破坏现有上线体验）。
 */
import { prisma } from "../prisma";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric" | "sponsor";
export type AnonymousTierConfig = {
  reputation: number;
  quota: number;
};
export type ReputationLevelConfig = {
  level: number;
  name: string;
  minReputation: number;
};
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
  aiTopicReviewSystemPrompt: string;
  aiTopicReviewUserPrompt: string;
  aiReplyReviewSystemPrompt: string;
  aiReplyReviewUserPrompt: string;
  aiEditSimilaritySystemPrompt: string;
  aiEditSimilarityUserPrompt: string;
  anonymousMinReputation: number;
  accountAgeDaysPerStep: number;
  accountAgePointsPerStep: number;
  accountAgePointsCap: number;
  postPointsPerTopic: number;
  postPointsCap: number;
  replyPointsPerReply: number;
  replyPointsCap: number;
  forumEnabledBonus: number;
  anonymousTiers: AnonymousTierConfig[];
  reputationLevels: ReputationLevelConfig[];
};

export const ALL_FEATURES: FeatureKey[] = ["forum", "market", "coursereview", "electric", "sponsor"];
export const DEFAULT_ANONYMOUS_TIERS: AnonymousTierConfig[] = [
  { reputation: 30, quota: 1 },
  { reputation: 60, quota: 2 },
  { reputation: 90, quota: 3 },
  { reputation: 120, quota: 4 },
];
export const DEFAULT_REPUTATION_LEVELS: ReputationLevelConfig[] = [
  { level: 1, name: "初来乍到", minReputation: 0 },
  { level: 2, name: "渐入佳境", minReputation: 30 },
  { level: 3, name: "活跃同学", minReputation: 60 },
  { level: 4, name: "资深成员", minReputation: 90 },
  { level: 5, name: "校园传说", minReputation: 120 },
];

const GLOBAL_PINNED_TOPICS_KEY = "forum.globalPinnedTopics";
const SITE_ORIGIN_KEY = "site.origin";
const AI_REVIEW_ENABLED_KEY = "ai.review.enabled";
const AI_REVIEW_PROVIDER_KEY = "ai.review.provider";
const AI_REVIEW_MODEL_KEY = "ai.review.model";
const AI_REVIEW_API_KEY = "ai.review.apiKey";
const AI_REVIEW_AUTO_PASS_SCORE_KEY = "ai.review.autoPassScore";
const AI_REVIEW_BLOCK_SCORE_KEY = "ai.review.blockScore";
const AI_REVIEW_FORCE_BLOCK_SCORE_KEY = "ai.review.forceBlockScore";
const AI_EDIT_SIMILARITY_THRESHOLD_KEY = "ai.review.editSimilarityThreshold";
const AI_TOPIC_REVIEW_SYSTEM_PROMPT_KEY = "ai.review.topic.systemPrompt";
const AI_TOPIC_REVIEW_USER_PROMPT_KEY = "ai.review.topic.userPrompt";
const AI_REPLY_REVIEW_SYSTEM_PROMPT_KEY = "ai.review.reply.systemPrompt";
const AI_REPLY_REVIEW_USER_PROMPT_KEY = "ai.review.reply.userPrompt";
const AI_EDIT_SIMILARITY_SYSTEM_PROMPT_KEY = "ai.review.editSimilarity.systemPrompt";
const AI_EDIT_SIMILARITY_USER_PROMPT_KEY = "ai.review.editSimilarity.userPrompt";
const ANONYMOUS_MIN_REPUTATION_KEY = "forum.anonymous.minReputation";
const ACCOUNT_AGE_DAYS_PER_STEP_KEY = "forum.reputation.accountAgeDaysPerStep";
const ACCOUNT_AGE_POINTS_PER_STEP_KEY = "forum.reputation.accountAgePointsPerStep";
const ACCOUNT_AGE_POINTS_CAP_KEY = "forum.reputation.accountAgePointsCap";
const POST_POINTS_PER_TOPIC_KEY = "forum.reputation.postPointsPerTopic";
const POST_POINTS_CAP_KEY = "forum.reputation.postPointsCap";
const REPLY_POINTS_PER_REPLY_KEY = "forum.reputation.replyPointsPerReply";
const REPLY_POINTS_CAP_KEY = "forum.reputation.replyPointsCap";
const FORUM_ENABLED_BONUS_KEY = "forum.reputation.forumEnabledBonus";
const ANONYMOUS_TIERS_KEY = "forum.anonymous.tiers";
const REPUTATION_LEVELS_KEY = "forum.reputation.levels";

export const DEFAULT_AI_PROMPTS = {
  topicReviewSystem: "你是校园社区内容安全审核助手。你需要根据用户稿件判断风险，只返回 JSON。请关注违法、辱骂、人身攻击、隐私泄露、联系方式引流、诈骗、色情、诽谤、校园敏感舆情等风险。",
  topicReviewUser: [
    "请审核以下校园社区稿件，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"violence\":0-100,\"porn\":0-100,\"abuse\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"political\":0-100,\"defamation\":0-100,\"spam\":0-100}}",
    "",
    "板块名称：{{boardName}}",
    "板块类型：{{boardType}}",
    "标题：{{title}}",
    "正文：{{content}}",
    "补充 metadata：{{metadataJson}}",
  ].join("\n"),
  replyReviewSystem: "你是校园社区内容安全审核助手。你需要根据用户回复判断风险，只返回 JSON。请关注违法、辱骂、人身攻击、隐私泄露、联系方式引流、诈骗、色情、诽谤、校园敏感舆情等风险。",
  replyReviewUser: [
    "请审核以下校园社区回复，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"violence\":0-100,\"porn\":0-100,\"abuse\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"political\":0-100,\"defamation\":0-100,\"spam\":0-100}}",
    "",
    "所属帖子标题：{{topicTitle}}",
    "板块名称：{{boardName}}",
    "板块类型：{{boardType}}",
    "引用/上文：{{parentContent}}",
    "回复内容：{{content}}",
  ].join("\n"),
  editSimilaritySystem: "你是校园社区帖子编辑相似度判断助手。你需要判断用户修改后的帖子，是否仍然是在编辑同一篇帖子，而不是借编辑入口改成另一篇新帖子。允许润色、扩写、缩写、重写表达；重点关注主题、对象、交易信息、课程/事件、核心诉求和结论是否仍一致。只返回 JSON。",
  editSimilarityUser: [
    "请比较以下校园社区帖子编辑前后的语义相似度，输出 JSON：",
    "{\"similarity_score\":0-100,\"same_topic\":true,\"reason\":\"一句短原因\",\"detail\":\"补充说明\"}",
    "",
    "原标题：{{originalTitle}}",
    "原正文：{{originalContent}}",
    "新标题：{{updatedTitle}}",
    "新正文：{{updatedContent}}",
  ].join("\n"),
} as const;

const cache: Record<FeatureKey, boolean> = {
  forum: true,
  market: true,
  coursereview: true,
  electric: true,
  sponsor: true,
};
let globalPinnedTopicIdsCache: number[] = [];

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
  aiTopicReviewSystemPrompt: DEFAULT_AI_PROMPTS.topicReviewSystem,
  aiTopicReviewUserPrompt: DEFAULT_AI_PROMPTS.topicReviewUser,
  aiReplyReviewSystemPrompt: DEFAULT_AI_PROMPTS.replyReviewSystem,
  aiReplyReviewUserPrompt: DEFAULT_AI_PROMPTS.replyReviewUser,
  aiEditSimilaritySystemPrompt: DEFAULT_AI_PROMPTS.editSimilaritySystem,
  aiEditSimilarityUserPrompt: DEFAULT_AI_PROMPTS.editSimilarityUser,
  anonymousMinReputation: 30,
  accountAgeDaysPerStep: 14,
  accountAgePointsPerStep: 2,
  accountAgePointsCap: 36,
  postPointsPerTopic: 4,
  postPointsCap: 48,
  replyPointsPerReply: 2,
  replyPointsCap: 48,
  forumEnabledBonus: 6,
  anonymousTiers: DEFAULT_ANONYMOUS_TIERS.map((item) => ({ ...item })),
  reputationLevels: DEFAULT_REPUTATION_LEVELS.map((item) => ({ ...item })),
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
          GLOBAL_PINNED_TOPICS_KEY,
          SITE_ORIGIN_KEY,
          AI_REVIEW_ENABLED_KEY,
          AI_REVIEW_PROVIDER_KEY,
          AI_REVIEW_MODEL_KEY,
          AI_REVIEW_API_KEY,
          AI_REVIEW_AUTO_PASS_SCORE_KEY,
          AI_REVIEW_BLOCK_SCORE_KEY,
          AI_REVIEW_FORCE_BLOCK_SCORE_KEY,
          AI_EDIT_SIMILARITY_THRESHOLD_KEY,
          AI_TOPIC_REVIEW_SYSTEM_PROMPT_KEY,
          AI_TOPIC_REVIEW_USER_PROMPT_KEY,
          AI_REPLY_REVIEW_SYSTEM_PROMPT_KEY,
          AI_REPLY_REVIEW_USER_PROMPT_KEY,
          AI_EDIT_SIMILARITY_SYSTEM_PROMPT_KEY,
          AI_EDIT_SIMILARITY_USER_PROMPT_KEY,
          ANONYMOUS_MIN_REPUTATION_KEY,
          ACCOUNT_AGE_DAYS_PER_STEP_KEY,
          ACCOUNT_AGE_POINTS_PER_STEP_KEY,
          ACCOUNT_AGE_POINTS_CAP_KEY,
          POST_POINTS_PER_TOPIC_KEY,
          POST_POINTS_CAP_KEY,
          REPLY_POINTS_PER_REPLY_KEY,
          REPLY_POINTS_CAP_KEY,
          FORUM_ENABLED_BONUS_KEY,
          ANONYMOUS_TIERS_KEY,
          REPUTATION_LEVELS_KEY,
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
    if (r.key === AI_TOPIC_REVIEW_SYSTEM_PROMPT_KEY) {
      configCache.aiTopicReviewSystemPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.topicReviewSystem);
      continue;
    }
    if (r.key === AI_TOPIC_REVIEW_USER_PROMPT_KEY) {
      configCache.aiTopicReviewUserPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.topicReviewUser);
      continue;
    }
    if (r.key === AI_REPLY_REVIEW_SYSTEM_PROMPT_KEY) {
      configCache.aiReplyReviewSystemPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.replyReviewSystem);
      continue;
    }
    if (r.key === AI_REPLY_REVIEW_USER_PROMPT_KEY) {
      configCache.aiReplyReviewUserPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.replyReviewUser);
      continue;
    }
    if (r.key === AI_EDIT_SIMILARITY_SYSTEM_PROMPT_KEY) {
      configCache.aiEditSimilaritySystemPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.editSimilaritySystem);
      continue;
    }
    if (r.key === AI_EDIT_SIMILARITY_USER_PROMPT_KEY) {
      configCache.aiEditSimilarityUserPrompt = normalizePromptTemplate(r.value, DEFAULT_AI_PROMPTS.editSimilarityUser);
      continue;
    }
    if (r.key === ANONYMOUS_MIN_REPUTATION_KEY) {
      configCache.anonymousMinReputation = normalizeSmallInt(r.value, 30, 0, 9999);
      continue;
    }
    if (r.key === ACCOUNT_AGE_DAYS_PER_STEP_KEY) {
      configCache.accountAgeDaysPerStep = normalizeSmallInt(r.value, 14, 1, 3650);
      continue;
    }
    if (r.key === ACCOUNT_AGE_POINTS_PER_STEP_KEY) {
      configCache.accountAgePointsPerStep = normalizeSmallInt(r.value, 2, 0, 999);
      continue;
    }
    if (r.key === ACCOUNT_AGE_POINTS_CAP_KEY) {
      configCache.accountAgePointsCap = normalizeSmallInt(r.value, 36, 0, 9999);
      continue;
    }
    if (r.key === POST_POINTS_PER_TOPIC_KEY) {
      configCache.postPointsPerTopic = normalizeSmallInt(r.value, 4, 0, 999);
      continue;
    }
    if (r.key === POST_POINTS_CAP_KEY) {
      configCache.postPointsCap = normalizeSmallInt(r.value, 48, 0, 9999);
      continue;
    }
    if (r.key === REPLY_POINTS_PER_REPLY_KEY) {
      configCache.replyPointsPerReply = normalizeSmallInt(r.value, 2, 0, 999);
      continue;
    }
    if (r.key === REPLY_POINTS_CAP_KEY) {
      configCache.replyPointsCap = normalizeSmallInt(r.value, 48, 0, 9999);
      continue;
    }
    if (r.key === FORUM_ENABLED_BONUS_KEY) {
      configCache.forumEnabledBonus = normalizeSmallInt(r.value, 6, 0, 9999);
      continue;
    }
    if (r.key === ANONYMOUS_TIERS_KEY) {
      configCache.anonymousTiers = normalizeAnonymousTiers(r.value, DEFAULT_ANONYMOUS_TIERS);
      continue;
    }
    if (r.key === REPUTATION_LEVELS_KEY) {
      configCache.reputationLevels = normalizeReputationLevels(r.value, DEFAULT_REPUTATION_LEVELS);
      continue;
    }
    if (r.key === GLOBAL_PINNED_TOPICS_KEY) {
      globalPinnedTopicIdsCache = normalizeTopicIdList(r.value);
      continue;
    }
    const f = r.key.replace(/^feature\./, "") as FeatureKey;
    if (ALL_FEATURES.includes(f)) cache[f] = r.value === "on";
  }
  sanitizeAiReviewConfig();
  sanitizeCommunityTrustConfig();
}

export function getFeatures(): Record<FeatureKey, boolean> {
  return { ...cache };
}

export function getGlobalPinnedTopicIds(): number[] {
  return [...globalPinnedTopicIdsCache];
}

export function isGlobalPinnedTopic(topicId: number): boolean {
  return globalPinnedTopicIdsCache.includes(topicId);
}

export function isFeatureOn(f: FeatureKey): boolean {
  return cache[f];
}

export function getSiteConfig(): SiteConfig {
  return {
    ...configCache,
    anonymousTiers: configCache.anonymousTiers.map((item) => ({ ...item })),
    reputationLevels: configCache.reputationLevels.map((item) => ({ ...item })),
  };
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

export async function setGlobalPinnedTopicIds(ids: number[]): Promise<number[]> {
  const normalized = normalizeTopicIdList(JSON.stringify(ids));
  await prisma.siteSetting.upsert({
    where: { key: GLOBAL_PINNED_TOPICS_KEY },
    update: { value: JSON.stringify(normalized) },
    create: { key: GLOBAL_PINNED_TOPICS_KEY, value: JSON.stringify(normalized) },
  });
  globalPinnedTopicIdsCache = normalized;
  return getGlobalPinnedTopicIds();
}

export async function setTopicGlobalPinned(topicId: number, pinned: boolean): Promise<number[]> {
  const current = getGlobalPinnedTopicIds().filter((id) => id !== topicId);
  if (pinned) current.unshift(topicId);
  return setGlobalPinnedTopicIds(current);
}

export async function removeTopicFromGlobalPins(topicId: number): Promise<number[]> {
  return setGlobalPinnedTopicIds(globalPinnedTopicIdsCache.filter((id) => id !== topicId));
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

function normalizeSmallInt(input: string | number | null | undefined, fallback: number, min: number, max: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeTopicIdList(input: string | number[] | null | undefined) {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(
    raw
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  ));
}

function normalizeAiRatio(input: string | number | null | undefined, fallback: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

function normalizePromptTemplate(input: string | null | undefined, fallback: string) {
  const raw = String(input ?? "").replace(/\r\n/g, "\n").trim();
  return raw || fallback;
}

function resolvePromptTemplate(input: string | null | undefined, current: string, fallback: string) {
  if (input === undefined) return current;
  return normalizePromptTemplate(input, fallback);
}

function parseJsonValue<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function normalizeAnonymousTiers(
  input: string | AnonymousTierConfig[] | null | undefined,
  fallback: AnonymousTierConfig[]
) {
  const raw = parseJsonValue<AnonymousTierConfig[] | unknown>(typeof input === "string" ? input : JSON.stringify(input ?? fallback), fallback);
  if (!Array.isArray(raw) || !raw.length) return fallback.map((item) => ({ ...item }));
  return raw
    .map((item: any) => ({
      reputation: normalizeSmallInt(item?.reputation, 0, 0, 9999),
      quota: normalizeSmallInt(item?.quota, 0, 0, 999),
    }))
    .sort((a, b) => a.reputation - b.reputation);
}

function normalizeReputationLevels(
  input: string | ReputationLevelConfig[] | null | undefined,
  fallback: ReputationLevelConfig[]
) {
  const raw = parseJsonValue<ReputationLevelConfig[] | unknown>(typeof input === "string" ? input : JSON.stringify(input ?? fallback), fallback);
  if (!Array.isArray(raw) || raw.length !== 5) return fallback.map((item) => ({ ...item }));
  const normalized = raw
    .map((item: any, index) => ({
      level: normalizeSmallInt(item?.level, index + 1, 1, 5),
      name: String(item?.name ?? "").trim() || fallback[index]?.name || `等级 ${index + 1}`,
      minReputation: normalizeSmallInt(item?.minReputation, fallback[index]?.minReputation ?? 0, 0, 9999),
    }))
    .sort((a, b) => a.level - b.level)
    .map((item, index) => ({
      level: index + 1,
      name: item.name.slice(0, 20),
      minReputation: item.minReputation,
    }));
  normalized[0].minReputation = 0;
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].minReputation < normalized[i - 1].minReputation) {
      normalized[i].minReputation = normalized[i - 1].minReputation;
    }
  }
  return normalized;
}

function sanitizeAiReviewConfig() {
  configCache.aiReviewAutoPassScore = normalizeAiScore(configCache.aiReviewAutoPassScore, 24);
  configCache.aiReviewBlockScore = normalizeAiScore(configCache.aiReviewBlockScore, 70);
  configCache.aiReviewForceBlockScore = normalizeAiScore(configCache.aiReviewForceBlockScore, 90);
  configCache.aiEditSimilarityThreshold = normalizeAiRatio(configCache.aiEditSimilarityThreshold, 0);
  configCache.aiTopicReviewSystemPrompt = normalizePromptTemplate(configCache.aiTopicReviewSystemPrompt, DEFAULT_AI_PROMPTS.topicReviewSystem);
  configCache.aiTopicReviewUserPrompt = normalizePromptTemplate(configCache.aiTopicReviewUserPrompt, DEFAULT_AI_PROMPTS.topicReviewUser);
  configCache.aiReplyReviewSystemPrompt = normalizePromptTemplate(configCache.aiReplyReviewSystemPrompt, DEFAULT_AI_PROMPTS.replyReviewSystem);
  configCache.aiReplyReviewUserPrompt = normalizePromptTemplate(configCache.aiReplyReviewUserPrompt, DEFAULT_AI_PROMPTS.replyReviewUser);
  configCache.aiEditSimilaritySystemPrompt = normalizePromptTemplate(configCache.aiEditSimilaritySystemPrompt, DEFAULT_AI_PROMPTS.editSimilaritySystem);
  configCache.aiEditSimilarityUserPrompt = normalizePromptTemplate(configCache.aiEditSimilarityUserPrompt, DEFAULT_AI_PROMPTS.editSimilarityUser);
  if (configCache.aiReviewBlockScore < configCache.aiReviewAutoPassScore) {
    configCache.aiReviewBlockScore = configCache.aiReviewAutoPassScore;
  }
  if (configCache.aiReviewForceBlockScore < configCache.aiReviewBlockScore) {
    configCache.aiReviewForceBlockScore = configCache.aiReviewBlockScore;
  }
  if (!configCache.aiReviewProvider) configCache.aiReviewProvider = "deepseek";
  if (!configCache.aiReviewModel) configCache.aiReviewModel = "deepseek-v4-flash";
}

function sanitizeCommunityTrustConfig() {
  configCache.anonymousMinReputation = normalizeSmallInt(configCache.anonymousMinReputation, 30, 0, 9999);
  configCache.accountAgeDaysPerStep = normalizeSmallInt(configCache.accountAgeDaysPerStep, 14, 1, 3650);
  configCache.accountAgePointsPerStep = normalizeSmallInt(configCache.accountAgePointsPerStep, 2, 0, 999);
  configCache.accountAgePointsCap = normalizeSmallInt(configCache.accountAgePointsCap, 36, 0, 9999);
  configCache.postPointsPerTopic = normalizeSmallInt(configCache.postPointsPerTopic, 4, 0, 999);
  configCache.postPointsCap = normalizeSmallInt(configCache.postPointsCap, 48, 0, 9999);
  configCache.replyPointsPerReply = normalizeSmallInt(configCache.replyPointsPerReply, 2, 0, 999);
  configCache.replyPointsCap = normalizeSmallInt(configCache.replyPointsCap, 48, 0, 9999);
  configCache.forumEnabledBonus = normalizeSmallInt(configCache.forumEnabledBonus, 6, 0, 9999);
  configCache.anonymousTiers = normalizeAnonymousTiers(configCache.anonymousTiers, DEFAULT_ANONYMOUS_TIERS);
  configCache.reputationLevels = normalizeReputationLevels(configCache.reputationLevels, DEFAULT_REPUTATION_LEVELS);
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
    aiTopicReviewSystemPrompt: resolvePromptTemplate(input.aiTopicReviewSystemPrompt, configCache.aiTopicReviewSystemPrompt, DEFAULT_AI_PROMPTS.topicReviewSystem),
    aiTopicReviewUserPrompt: resolvePromptTemplate(input.aiTopicReviewUserPrompt, configCache.aiTopicReviewUserPrompt, DEFAULT_AI_PROMPTS.topicReviewUser),
    aiReplyReviewSystemPrompt: resolvePromptTemplate(input.aiReplyReviewSystemPrompt, configCache.aiReplyReviewSystemPrompt, DEFAULT_AI_PROMPTS.replyReviewSystem),
    aiReplyReviewUserPrompt: resolvePromptTemplate(input.aiReplyReviewUserPrompt, configCache.aiReplyReviewUserPrompt, DEFAULT_AI_PROMPTS.replyReviewUser),
    aiEditSimilaritySystemPrompt: resolvePromptTemplate(input.aiEditSimilaritySystemPrompt, configCache.aiEditSimilaritySystemPrompt, DEFAULT_AI_PROMPTS.editSimilaritySystem),
    aiEditSimilarityUserPrompt: resolvePromptTemplate(input.aiEditSimilarityUserPrompt, configCache.aiEditSimilarityUserPrompt, DEFAULT_AI_PROMPTS.editSimilarityUser),
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
    prisma.siteSetting.upsert({
      where: { key: AI_TOPIC_REVIEW_SYSTEM_PROMPT_KEY },
      update: { value: next.aiTopicReviewSystemPrompt },
      create: { key: AI_TOPIC_REVIEW_SYSTEM_PROMPT_KEY, value: next.aiTopicReviewSystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_TOPIC_REVIEW_USER_PROMPT_KEY },
      update: { value: next.aiTopicReviewUserPrompt },
      create: { key: AI_TOPIC_REVIEW_USER_PROMPT_KEY, value: next.aiTopicReviewUserPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REPLY_REVIEW_SYSTEM_PROMPT_KEY },
      update: { value: next.aiReplyReviewSystemPrompt },
      create: { key: AI_REPLY_REVIEW_SYSTEM_PROMPT_KEY, value: next.aiReplyReviewSystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REPLY_REVIEW_USER_PROMPT_KEY },
      update: { value: next.aiReplyReviewUserPrompt },
      create: { key: AI_REPLY_REVIEW_USER_PROMPT_KEY, value: next.aiReplyReviewUserPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_EDIT_SIMILARITY_SYSTEM_PROMPT_KEY },
      update: { value: next.aiEditSimilaritySystemPrompt },
      create: { key: AI_EDIT_SIMILARITY_SYSTEM_PROMPT_KEY, value: next.aiEditSimilaritySystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_EDIT_SIMILARITY_USER_PROMPT_KEY },
      update: { value: next.aiEditSimilarityUserPrompt },
      create: { key: AI_EDIT_SIMILARITY_USER_PROMPT_KEY, value: next.aiEditSimilarityUserPrompt },
    }),
  ]);
  Object.assign(configCache, next);
  sanitizeAiReviewConfig();
  return getSiteConfig();
}

export async function setCommunityTrustConfig(input: Partial<SiteConfig>): Promise<SiteConfig> {
  const next: SiteConfig = {
    ...configCache,
    anonymousMinReputation: normalizeSmallInt(input.anonymousMinReputation, configCache.anonymousMinReputation, 0, 9999),
    accountAgeDaysPerStep: normalizeSmallInt(input.accountAgeDaysPerStep, configCache.accountAgeDaysPerStep, 1, 3650),
    accountAgePointsPerStep: normalizeSmallInt(input.accountAgePointsPerStep, configCache.accountAgePointsPerStep, 0, 999),
    accountAgePointsCap: normalizeSmallInt(input.accountAgePointsCap, configCache.accountAgePointsCap, 0, 9999),
    postPointsPerTopic: normalizeSmallInt(input.postPointsPerTopic, configCache.postPointsPerTopic, 0, 999),
    postPointsCap: normalizeSmallInt(input.postPointsCap, configCache.postPointsCap, 0, 9999),
    replyPointsPerReply: normalizeSmallInt(input.replyPointsPerReply, configCache.replyPointsPerReply, 0, 999),
    replyPointsCap: normalizeSmallInt(input.replyPointsCap, configCache.replyPointsCap, 0, 9999),
    forumEnabledBonus: normalizeSmallInt(input.forumEnabledBonus, configCache.forumEnabledBonus, 0, 9999),
    anonymousTiers: input.anonymousTiers !== undefined
      ? normalizeAnonymousTiers(input.anonymousTiers, configCache.anonymousTiers)
      : configCache.anonymousTiers.map((item) => ({ ...item })),
    reputationLevels: input.reputationLevels !== undefined
      ? normalizeReputationLevels(input.reputationLevels, configCache.reputationLevels)
      : configCache.reputationLevels.map((item) => ({ ...item })),
  };
  sanitizeCommunityTrustConfigFor(next);
  await prisma.$transaction([
    prisma.siteSetting.upsert({
      where: { key: ANONYMOUS_MIN_REPUTATION_KEY },
      update: { value: String(next.anonymousMinReputation) },
      create: { key: ANONYMOUS_MIN_REPUTATION_KEY, value: String(next.anonymousMinReputation) },
    }),
    prisma.siteSetting.upsert({
      where: { key: ACCOUNT_AGE_DAYS_PER_STEP_KEY },
      update: { value: String(next.accountAgeDaysPerStep) },
      create: { key: ACCOUNT_AGE_DAYS_PER_STEP_KEY, value: String(next.accountAgeDaysPerStep) },
    }),
    prisma.siteSetting.upsert({
      where: { key: ACCOUNT_AGE_POINTS_PER_STEP_KEY },
      update: { value: String(next.accountAgePointsPerStep) },
      create: { key: ACCOUNT_AGE_POINTS_PER_STEP_KEY, value: String(next.accountAgePointsPerStep) },
    }),
    prisma.siteSetting.upsert({
      where: { key: ACCOUNT_AGE_POINTS_CAP_KEY },
      update: { value: String(next.accountAgePointsCap) },
      create: { key: ACCOUNT_AGE_POINTS_CAP_KEY, value: String(next.accountAgePointsCap) },
    }),
    prisma.siteSetting.upsert({
      where: { key: POST_POINTS_PER_TOPIC_KEY },
      update: { value: String(next.postPointsPerTopic) },
      create: { key: POST_POINTS_PER_TOPIC_KEY, value: String(next.postPointsPerTopic) },
    }),
    prisma.siteSetting.upsert({
      where: { key: POST_POINTS_CAP_KEY },
      update: { value: String(next.postPointsCap) },
      create: { key: POST_POINTS_CAP_KEY, value: String(next.postPointsCap) },
    }),
    prisma.siteSetting.upsert({
      where: { key: REPLY_POINTS_PER_REPLY_KEY },
      update: { value: String(next.replyPointsPerReply) },
      create: { key: REPLY_POINTS_PER_REPLY_KEY, value: String(next.replyPointsPerReply) },
    }),
    prisma.siteSetting.upsert({
      where: { key: REPLY_POINTS_CAP_KEY },
      update: { value: String(next.replyPointsCap) },
      create: { key: REPLY_POINTS_CAP_KEY, value: String(next.replyPointsCap) },
    }),
    prisma.siteSetting.upsert({
      where: { key: FORUM_ENABLED_BONUS_KEY },
      update: { value: String(next.forumEnabledBonus) },
      create: { key: FORUM_ENABLED_BONUS_KEY, value: String(next.forumEnabledBonus) },
    }),
    prisma.siteSetting.upsert({
      where: { key: ANONYMOUS_TIERS_KEY },
      update: { value: JSON.stringify(next.anonymousTiers) },
      create: { key: ANONYMOUS_TIERS_KEY, value: JSON.stringify(next.anonymousTiers) },
    }),
    prisma.siteSetting.upsert({
      where: { key: REPUTATION_LEVELS_KEY },
      update: { value: JSON.stringify(next.reputationLevels) },
      create: { key: REPUTATION_LEVELS_KEY, value: JSON.stringify(next.reputationLevels) },
    }),
  ]);
  Object.assign(configCache, next);
  sanitizeCommunityTrustConfig();
  return getSiteConfig();
}

function sanitizeCommunityTrustConfigFor(next: SiteConfig) {
  next.anonymousMinReputation = normalizeSmallInt(next.anonymousMinReputation, 30, 0, 9999);
  next.accountAgeDaysPerStep = normalizeSmallInt(next.accountAgeDaysPerStep, 14, 1, 3650);
  next.accountAgePointsPerStep = normalizeSmallInt(next.accountAgePointsPerStep, 2, 0, 999);
  next.accountAgePointsCap = normalizeSmallInt(next.accountAgePointsCap, 36, 0, 9999);
  next.postPointsPerTopic = normalizeSmallInt(next.postPointsPerTopic, 4, 0, 999);
  next.postPointsCap = normalizeSmallInt(next.postPointsCap, 48, 0, 9999);
  next.replyPointsPerReply = normalizeSmallInt(next.replyPointsPerReply, 2, 0, 999);
  next.replyPointsCap = normalizeSmallInt(next.replyPointsCap, 48, 0, 9999);
  next.forumEnabledBonus = normalizeSmallInt(next.forumEnabledBonus, 6, 0, 9999);
  next.anonymousTiers = normalizeAnonymousTiers(next.anonymousTiers, DEFAULT_ANONYMOUS_TIERS);
  next.reputationLevels = normalizeReputationLevels(next.reputationLevels, DEFAULT_REPUTATION_LEVELS);
}
