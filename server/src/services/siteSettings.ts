/**
 * 站点功能开关
 *
 * KV 持久化 + 内存缓存。修改后立即更新缓存，公开 API 直接读缓存（高频）。
 *
 * 用途："言论敏感时一键关闭论坛 / 商城 / 课评"。
 * 默认值：全部为 on（即不破坏现有上线体验）。
 */
import { prisma } from "../prisma";
import { broadcastSiteSettingsReload } from "./runtimeBroadcast";
import { normalizeFallbackModelList } from "./modelFallback";

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
  siteFilingNumber: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewApiUrl: string;
  aiReviewModel: string;
  aiReviewFallbackModels: string;
  aiReviewApiKey: string;
  qqGroupAdReviewEnabled: boolean;
  qqGroupAdReviewProvider: string;
  qqGroupAdReviewApiUrl: string;
  qqGroupAdReviewModel: string;
  qqGroupAdReviewFallbackModels: string;
  qqGroupAdReviewApiKey: string;
  qqGroupAdReviewSystemPrompt: string;
  qqGroupAdReviewUserPrompt: string;
  imageReviewEnabled: boolean;
  imageReviewApiUrl: string;
  imageReviewModel: string;
  imageReviewFallbackModels: string;
  imageReviewApiKey: string;
  imageReviewSystemPrompt: string;
  imageReviewUserPrompt: string;
  imageReviewConcurrency: number;
  imageReviewRequestGroupSize: number;
  videoReviewEnabled: boolean;
  videoReviewApiUrl: string;
  videoReviewModel: string;
  videoReviewFallbackModels: string;
  videoReviewApiKey: string;
  videoReviewSystemPrompt: string;
  videoReviewUserPrompt: string;
  videoReviewConcurrency: number;
  aiReviewThreshold: number;
  qqGroupAdReviewThreshold: number;
  imageReviewThreshold: number;
  videoReviewThreshold: number;
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
export type SitePromptDefaults = Pick<
  SiteConfig,
  | "qqGroupAdReviewSystemPrompt"
  | "qqGroupAdReviewUserPrompt"
  | "imageReviewSystemPrompt"
  | "imageReviewUserPrompt"
  | "videoReviewSystemPrompt"
  | "videoReviewUserPrompt"
  | "aiTopicReviewSystemPrompt"
  | "aiTopicReviewUserPrompt"
  | "aiReplyReviewSystemPrompt"
  | "aiReplyReviewUserPrompt"
  | "aiEditSimilaritySystemPrompt"
  | "aiEditSimilarityUserPrompt"
>;

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
const SITE_FILING_NUMBER_KEY = "site.filingNumber";
const AI_REVIEW_ENABLED_KEY = "ai.review.enabled";
const AI_REVIEW_PROVIDER_KEY = "ai.review.provider";
const AI_REVIEW_API_URL_KEY = "ai.review.apiUrl";
const AI_REVIEW_MODEL_KEY = "ai.review.model";
const AI_REVIEW_FALLBACK_MODELS_KEY = "ai.review.fallbackModels";
const AI_REVIEW_API_KEY = "ai.review.apiKey";
const QQ_GROUP_AD_REVIEW_ENABLED_KEY = "ai.qqGroupAdReview.enabled";
const QQ_GROUP_AD_REVIEW_PROVIDER_KEY = "ai.qqGroupAdReview.provider";
const QQ_GROUP_AD_REVIEW_API_URL_KEY = "ai.qqGroupAdReview.apiUrl";
const QQ_GROUP_AD_REVIEW_MODEL_KEY = "ai.qqGroupAdReview.model";
const QQ_GROUP_AD_REVIEW_FALLBACK_MODELS_KEY = "ai.qqGroupAdReview.fallbackModels";
const QQ_GROUP_AD_REVIEW_API_KEY = "ai.qqGroupAdReview.apiKey";
const QQ_GROUP_AD_REVIEW_SYSTEM_PROMPT_KEY = "ai.qqGroupAdReview.systemPrompt";
const QQ_GROUP_AD_REVIEW_USER_PROMPT_KEY = "ai.qqGroupAdReview.userPrompt";
const IMAGE_REVIEW_ENABLED_KEY = "ai.imageReview.enabled";
const IMAGE_REVIEW_API_URL_KEY = "ai.imageReview.apiUrl";
const IMAGE_REVIEW_MODEL_KEY = "ai.imageReview.model";
const IMAGE_REVIEW_FALLBACK_MODELS_KEY = "ai.imageReview.fallbackModels";
const IMAGE_REVIEW_API_KEY_KEY = "ai.imageReview.apiKey";
const IMAGE_REVIEW_SYSTEM_PROMPT_KEY = "ai.imageReview.systemPrompt";
const IMAGE_REVIEW_USER_PROMPT_KEY = "ai.imageReview.userPrompt";
const IMAGE_REVIEW_CONCURRENCY_KEY = "ai.imageReview.concurrency";
const IMAGE_REVIEW_REQUEST_GROUP_SIZE_KEY = "ai.imageReview.requestGroupSize";
const VIDEO_REVIEW_ENABLED_KEY = "ai.videoReview.enabled";
const VIDEO_REVIEW_API_URL_KEY = "ai.videoReview.apiUrl";
const VIDEO_REVIEW_MODEL_KEY = "ai.videoReview.model";
const VIDEO_REVIEW_FALLBACK_MODELS_KEY = "ai.videoReview.fallbackModels";
const VIDEO_REVIEW_API_KEY_KEY = "ai.videoReview.apiKey";
const VIDEO_REVIEW_SYSTEM_PROMPT_KEY = "ai.videoReview.systemPrompt";
const VIDEO_REVIEW_USER_PROMPT_KEY = "ai.videoReview.userPrompt";
const VIDEO_REVIEW_CONCURRENCY_KEY = "ai.videoReview.concurrency";
const AI_REVIEW_THRESHOLD_KEY = "ai.review.threshold";
const QQ_GROUP_AD_REVIEW_THRESHOLD_KEY = "ai.qqGroupAdReview.threshold";
const IMAGE_REVIEW_THRESHOLD_KEY = "ai.imageReview.threshold";
const VIDEO_REVIEW_THRESHOLD_KEY = "ai.videoReview.threshold";
const AI_REVIEW_AUTO_PASS_SCORE_KEY = "ai.review.autoPassScore";
const AI_REVIEW_BLOCK_SCORE_KEY = "ai.review.blockScore";
const IMAGE_REVIEW_AUTO_PASS_SCORE_KEY = "ai.imageReview.autoPassScore";
const IMAGE_REVIEW_BLOCK_SCORE_KEY = "ai.imageReview.blockScore";
const VIDEO_REVIEW_AUTO_PASS_SCORE_KEY = "ai.videoReview.autoPassScore";
const VIDEO_REVIEW_BLOCK_SCORE_KEY = "ai.videoReview.blockScore";
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
  topicReviewSystem: "你是校园社区文字内容安全审核助手。你只根据标题、正文中的文字内容做判断，不要根据图片、图片占位符、图片链接、附件、分享卡片或外链落地页的想象内容加重风险。本站用户均为成年人，因此不需要对普通成人表达、恋爱讨论、两性话题、情绪吐槽采取过严标准；仅在出现违法、露骨色情、骚扰引导、仇恨攻击、性别对立煽动、隐私泄露、联系方式引流、诈骗、诽谤、极端政治动员等明确风险时提高分数。只返回 JSON。",
  topicReviewUser: [
    "请审核以下校园社区稿件，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"violence\":0-100,\"porn_explicit\":0-100,\"abuse\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"political_extremism\":0-100,\"defamation\":0-100,\"spam\":0-100,\"gender_conflict\":0-100}}",
    "",
    "注意：只审核文字内容，不审核图片本身、图片链接、图片占位符、分享卡片预览图或外链落地页内容。",
    "板块名称：{{boardName}}",
    "板块类型：{{boardType}}",
    "标题：{{title}}",
    "正文：{{content}}",
    "补充 metadata：{{metadataJson}}",
  ].join("\n"),
  replyReviewSystem: "你是校园社区文字内容安全审核助手。你只根据回复中的文字内容做判断，不要根据图片、图片占位符、图片链接、附件、分享卡片或外链落地页的想象内容加重风险。本站用户均为成年人，因此不需要对普通成人表达、恋爱讨论、两性话题、情绪吐槽采取过严标准；仅在出现违法、露骨色情、骚扰引导、仇恨攻击、性别对立煽动、隐私泄露、联系方式引流、诈骗、诽谤、极端政治动员等明确风险时提高分数。只返回 JSON。",
  replyReviewUser: [
    "请审核以下校园社区回复，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"violence\":0-100,\"porn_explicit\":0-100,\"abuse\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"political_extremism\":0-100,\"defamation\":0-100,\"spam\":0-100,\"gender_conflict\":0-100}}",
    "",
    "注意：只审核文字内容，不审核图片本身、图片链接、图片占位符、分享卡片预览图或外链落地页内容。",
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

export const DEFAULT_IMAGE_REVIEW_PROMPTS = {
  system: "你是校园社区图片合规审核助手。前置假设：上游模型已经完成基础安全筛查。你这一层只做公开展示合规判断，默认从宽，不做泛化拦截。只有当图片中存在明确、可直接识别、并且不适合在校园公开社区展示的风险时，才提高分数。重点关注：违法违规的公共事务表达、针对个人或组织的攻击性曝光、未经授权的个人敏感信息展示、可疑引流或欺诈性招募、明显煽动群体对立的内容。用户主动发布自己的联系方式、社交账号、二维码、交易或招募联系方式，通常不算违规，不要仅因出现联系方式就拦截。普通截图、聊天记录、新闻配图、评论区截图、日常吐槽、普通讨论一般应放行。信息模糊、证据不足、需要依赖图外上下文时，优先 auto_pass 或 manual_review，不要直接 block。只返回 JSON。",
  user: [
    "请审核这张图片是否可以在校园社区公开展示，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"sexual\":0-100,\"minor\":0-100,\"violence\":0-100,\"self_harm\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"hate\":0-100,\"gender_conflict\":0-100,\"extremism\":0-100}}",
    "",
    "要求：",
    "1. 默认尽量放行。",
    "2. 不要仅因图片中出现手机号、微信号、二维码、群号、社交账号就判违规；如果看起来是发布者主动公开自己的联系方式，通常应放行。",
    "3. 只有在明显属于攻击性曝光、敏感信息泄露、可疑引流、明显违法违规表达或煽动对立时，才提高风险。",
    "4. 看不清、证据不足、需要图外上下文才能成立的，优先 auto_pass 或 manual_review。",
    "图片来源：{{imageUrl}}",
    "文件类型：{{mimeType}}",
    "文件名：{{fileName}}",
  ].join("\n"),
} as const;

export const DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS = {
  system: [
    "你是 QQ 群广告过滤助手。",
    "你的任务是判断这条群消息是否属于广告、推广、拉新、招代理、刷单、兼职引流、交易导流、二维码/链接拉群或重复营销。",
    "正常的校园交流、功能使用咨询、普通求助、二手闲聊、课程讨论、个人经验分享通常不算广告。",
    "如果只是模仿广告句式玩梗、抽象整活、转述别人的广告、吐槽或批评广告，而没有真实引流、交易、招募、拉群、导流意图，通常不算广告，优先 auto_pass 或 manual_review，不要直接 block。",
    "像“疯狂星期四”“V我50”“请奶茶”这类熟人玩笑、网络梗、夸张情绪文案，只要没有卖货、招募、拉群、二维码、链接或持续导流安排，通常也不算广告；即便顺手自报微信、手机号或让朋友转一顿饭钱，也不要仅凭这个直接判广告。",
    "不要仅因出现联系方式、群号、二维码、链接或价格数字就直接判广告，要结合整段语义、营销意图、利益承诺、频率和导流倾向综合判断。",
    "只返回 JSON。",
  ].join(" "),
  user: [
    "请审核这条 QQ 群消息是否应按广告过滤，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"spam\":0-100,\"traffic\":0-100,\"fraud\":0-100,\"marketing\":0-100,\"recruitment\":0-100}}",
    "",
    "群号：{{groupId}}",
    "群名：{{groupName}}",
    "发送者 QQ：{{qqId}}",
    "发送者昵称：{{nickname}}",
    "消息内容：{{content}}",
    "附加 metadata：{{metadataJson}}",
  ].join("\n"),
} as const;

export const DEFAULT_VIDEO_REVIEW_PROMPTS = {
  system: [
    "你是校园社区视频公开展示审核助手。",
    "你会收到这个视频的关键帧、可选音频转写、以及帖子上下文。",
    "你的任务是判断这个视频是否适合在公开校园社区直接展示。",
    "默认从宽：信息不足、证据不足、只靠脑补才能成立的风险，不要直接拦截，优先 manual_review 或 auto_pass。",
    "重点关注：明确的裸露色情、未成年人相关性内容、血腥暴力、自残鼓励、毒品、违法演示、诈骗引流、隐私证件与敏感信息泄露、针对个人或群体的攻击性曝光、煽动性极端内容。",
    "只返回 JSON。",
  ].join(" "),
  user: [
    "请审核这个视频是否可以在校园社区公开展示，输出 JSON：",
    "{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"sexual\":0-100,\"minor\":0-100,\"violence\":0-100,\"self_harm\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"hate\":0-100,\"gender_conflict\":0-100,\"extremism\":0-100}}",
    "",
    "视频来源：{{videoUrl}}",
    "文件类型：{{mimeType}}",
    "文件名：{{fileName}}",
    "时长（秒）：{{durationSeconds}}",
    "分辨率：{{resolution}}",
    "是否有音轨：{{hasAudio}}",
    "所属对象：{{targetKind}}",
    "板块：{{boardName}}",
    "标题：{{targetTitle}}",
    "正文上下文：{{contextText}}",
    "音频转写：{{transcript}}",
    "请结合关键帧、音频转写和文字上下文给出判断。",
  ].join("\n"),
} as const;

const LEGACY_DEFAULT_IMAGE_REVIEW_PROMPTS = {
  system: "你是校园社区图片安全审核助手。你需要判断这张图片是否适合在公开学生社区直接展示。重点关注色情裸露、未成年人相关性内容、血腥暴力、极端不适、自残鼓励、毒品、违法展示、仇恨符号、诈骗引流、联系方式与隐私证件等风险。只返回 JSON。",
  user: [
    "请审核这张图片是否可以在校园社区公开展示，输出 JSON：",
    "{\"approved\":true,\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"risk_level\":\"low|medium|high\"}",
    "",
    "图片来源：{{imageUrl}}",
    "文件类型：{{mimeType}}",
    "文件名：{{fileName}}",
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
  siteFilingNumber: "",
  aiReviewEnabled: false,
  aiReviewProvider: "deepseek",
  aiReviewApiUrl: "https://api.deepseek.com/chat/completions",
  aiReviewModel: "deepseek-v4-flash",
  aiReviewFallbackModels: "",
  aiReviewApiKey: "",
  qqGroupAdReviewEnabled: false,
  qqGroupAdReviewProvider: "deepseek",
  qqGroupAdReviewApiUrl: "https://api.deepseek.com/chat/completions",
  qqGroupAdReviewModel: "deepseek-v4-flash",
  qqGroupAdReviewFallbackModels: "",
  qqGroupAdReviewApiKey: "",
  qqGroupAdReviewSystemPrompt: DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.system,
  qqGroupAdReviewUserPrompt: DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.user,
  imageReviewEnabled: false,
  imageReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  imageReviewModel: "gpt-4o-mini",
  imageReviewFallbackModels: "",
  imageReviewApiKey: "",
  imageReviewSystemPrompt: DEFAULT_IMAGE_REVIEW_PROMPTS.system,
  imageReviewUserPrompt: DEFAULT_IMAGE_REVIEW_PROMPTS.user,
  imageReviewConcurrency: 2,
  imageReviewRequestGroupSize: 3,
  videoReviewEnabled: false,
  videoReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  videoReviewModel: "gpt-4o-mini",
  videoReviewFallbackModels: "",
  videoReviewApiKey: "",
  videoReviewSystemPrompt: DEFAULT_VIDEO_REVIEW_PROMPTS.system,
  videoReviewUserPrompt: DEFAULT_VIDEO_REVIEW_PROMPTS.user,
  videoReviewConcurrency: 1,
  aiReviewThreshold: 24,
  qqGroupAdReviewThreshold: 70,
  imageReviewThreshold: 36,
  videoReviewThreshold: 36,
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

export function normalizeSiteFilingNumber(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/** 服务启动时加载一次；之后每次写入会同步更新缓存 */
export async function loadFeatures(): Promise<void> {
  let hasAiReviewThreshold = false;
  let hasImageReviewThreshold = false;
  let hasVideoReviewThreshold = false;
  const rows = await prisma.siteSetting.findMany({
    where: {
      key: {
        in: [
          ...ALL_FEATURES.map(keyOf),
          GLOBAL_PINNED_TOPICS_KEY,
          SITE_ORIGIN_KEY,
          SITE_FILING_NUMBER_KEY,
          AI_REVIEW_ENABLED_KEY,
          AI_REVIEW_PROVIDER_KEY,
          AI_REVIEW_API_URL_KEY,
          AI_REVIEW_MODEL_KEY,
          AI_REVIEW_FALLBACK_MODELS_KEY,
          AI_REVIEW_API_KEY,
          QQ_GROUP_AD_REVIEW_ENABLED_KEY,
          QQ_GROUP_AD_REVIEW_PROVIDER_KEY,
          QQ_GROUP_AD_REVIEW_API_URL_KEY,
          QQ_GROUP_AD_REVIEW_MODEL_KEY,
          QQ_GROUP_AD_REVIEW_FALLBACK_MODELS_KEY,
          QQ_GROUP_AD_REVIEW_API_KEY,
          QQ_GROUP_AD_REVIEW_SYSTEM_PROMPT_KEY,
          QQ_GROUP_AD_REVIEW_USER_PROMPT_KEY,
          IMAGE_REVIEW_ENABLED_KEY,
          IMAGE_REVIEW_API_URL_KEY,
          IMAGE_REVIEW_MODEL_KEY,
          IMAGE_REVIEW_FALLBACK_MODELS_KEY,
          IMAGE_REVIEW_API_KEY_KEY,
          IMAGE_REVIEW_SYSTEM_PROMPT_KEY,
          IMAGE_REVIEW_USER_PROMPT_KEY,
          IMAGE_REVIEW_CONCURRENCY_KEY,
          IMAGE_REVIEW_REQUEST_GROUP_SIZE_KEY,
          VIDEO_REVIEW_ENABLED_KEY,
          VIDEO_REVIEW_API_URL_KEY,
          VIDEO_REVIEW_MODEL_KEY,
          VIDEO_REVIEW_FALLBACK_MODELS_KEY,
          VIDEO_REVIEW_API_KEY_KEY,
          VIDEO_REVIEW_SYSTEM_PROMPT_KEY,
          VIDEO_REVIEW_USER_PROMPT_KEY,
          VIDEO_REVIEW_CONCURRENCY_KEY,
          AI_REVIEW_THRESHOLD_KEY,
          QQ_GROUP_AD_REVIEW_THRESHOLD_KEY,
          IMAGE_REVIEW_THRESHOLD_KEY,
          VIDEO_REVIEW_THRESHOLD_KEY,
          AI_REVIEW_AUTO_PASS_SCORE_KEY,
          AI_REVIEW_BLOCK_SCORE_KEY,
          IMAGE_REVIEW_AUTO_PASS_SCORE_KEY,
          IMAGE_REVIEW_BLOCK_SCORE_KEY,
          VIDEO_REVIEW_AUTO_PASS_SCORE_KEY,
          VIDEO_REVIEW_BLOCK_SCORE_KEY,
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
    if (r.key === SITE_FILING_NUMBER_KEY) {
      configCache.siteFilingNumber = normalizeSiteFilingNumber(r.value);
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
    if (r.key === AI_REVIEW_API_URL_KEY) {
      configCache.aiReviewApiUrl = normalizePromptTemplate(r.value, "https://api.deepseek.com/chat/completions");
      continue;
    }
    if (r.key === AI_REVIEW_MODEL_KEY) {
      configCache.aiReviewModel = String(r.value || "deepseek-v4-flash").trim() || "deepseek-v4-flash";
      continue;
    }
    if (r.key === AI_REVIEW_FALLBACK_MODELS_KEY) {
      configCache.aiReviewFallbackModels = normalizeFallbackModelList(r.value, configCache.aiReviewModel);
      continue;
    }
    if (r.key === AI_REVIEW_API_KEY) {
      configCache.aiReviewApiKey = String(r.value || "");
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_ENABLED_KEY) {
      configCache.qqGroupAdReviewEnabled = r.value === "on";
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_PROVIDER_KEY) {
      configCache.qqGroupAdReviewProvider = String(r.value || "deepseek").trim() || "deepseek";
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_API_URL_KEY) {
      configCache.qqGroupAdReviewApiUrl = normalizePromptTemplate(r.value, "https://api.deepseek.com/chat/completions");
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_MODEL_KEY) {
      configCache.qqGroupAdReviewModel = String(r.value || "deepseek-v4-flash").trim() || "deepseek-v4-flash";
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_FALLBACK_MODELS_KEY) {
      configCache.qqGroupAdReviewFallbackModels = normalizeFallbackModelList(r.value, configCache.qqGroupAdReviewModel);
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_API_KEY) {
      configCache.qqGroupAdReviewApiKey = String(r.value || "");
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_SYSTEM_PROMPT_KEY) {
      configCache.qqGroupAdReviewSystemPrompt = normalizePromptTemplate(r.value, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.system);
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_USER_PROMPT_KEY) {
      configCache.qqGroupAdReviewUserPrompt = normalizePromptTemplate(r.value, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.user);
      continue;
    }
    if (r.key === IMAGE_REVIEW_ENABLED_KEY) {
      configCache.imageReviewEnabled = r.value === "on";
      continue;
    }
    if (r.key === IMAGE_REVIEW_API_URL_KEY) {
      configCache.imageReviewApiUrl = normalizePromptTemplate(r.value, "https://api.openai.com/v1/chat/completions");
      continue;
    }
    if (r.key === IMAGE_REVIEW_MODEL_KEY) {
      configCache.imageReviewModel = String(r.value || "gpt-4o-mini").trim() || "gpt-4o-mini";
      continue;
    }
    if (r.key === IMAGE_REVIEW_FALLBACK_MODELS_KEY) {
      configCache.imageReviewFallbackModels = normalizeFallbackModelList(r.value, configCache.imageReviewModel);
      continue;
    }
    if (r.key === IMAGE_REVIEW_API_KEY_KEY) {
      configCache.imageReviewApiKey = String(r.value || "");
      continue;
    }
    if (r.key === IMAGE_REVIEW_SYSTEM_PROMPT_KEY) {
      configCache.imageReviewSystemPrompt = normalizePromptTemplate(r.value, DEFAULT_IMAGE_REVIEW_PROMPTS.system);
      continue;
    }
    if (r.key === IMAGE_REVIEW_USER_PROMPT_KEY) {
      configCache.imageReviewUserPrompt = normalizePromptTemplate(r.value, DEFAULT_IMAGE_REVIEW_PROMPTS.user);
      continue;
    }
    if (r.key === IMAGE_REVIEW_CONCURRENCY_KEY) {
      configCache.imageReviewConcurrency = normalizeSmallInt(r.value, 2, 1, 8);
      continue;
    }
    if (r.key === IMAGE_REVIEW_REQUEST_GROUP_SIZE_KEY) {
      configCache.imageReviewRequestGroupSize = normalizeSmallInt(r.value, 3, 1, 6);
      continue;
    }
    if (r.key === VIDEO_REVIEW_ENABLED_KEY) {
      configCache.videoReviewEnabled = r.value === "on";
      continue;
    }
    if (r.key === VIDEO_REVIEW_API_URL_KEY) {
      configCache.videoReviewApiUrl = normalizePromptTemplate(r.value, "https://api.openai.com/v1/chat/completions");
      continue;
    }
    if (r.key === VIDEO_REVIEW_MODEL_KEY) {
      configCache.videoReviewModel = String(r.value || "gpt-4o-mini").trim() || "gpt-4o-mini";
      continue;
    }
    if (r.key === VIDEO_REVIEW_FALLBACK_MODELS_KEY) {
      configCache.videoReviewFallbackModels = normalizeFallbackModelList(r.value, configCache.videoReviewModel);
      continue;
    }
    if (r.key === VIDEO_REVIEW_API_KEY_KEY) {
      configCache.videoReviewApiKey = String(r.value || "");
      continue;
    }
    if (r.key === VIDEO_REVIEW_SYSTEM_PROMPT_KEY) {
      configCache.videoReviewSystemPrompt = normalizePromptTemplate(r.value, DEFAULT_VIDEO_REVIEW_PROMPTS.system);
      continue;
    }
    if (r.key === VIDEO_REVIEW_USER_PROMPT_KEY) {
      configCache.videoReviewUserPrompt = normalizePromptTemplate(r.value, DEFAULT_VIDEO_REVIEW_PROMPTS.user);
      continue;
    }
    if (r.key === VIDEO_REVIEW_CONCURRENCY_KEY) {
      configCache.videoReviewConcurrency = normalizeSmallInt(r.value, 1, 1, 2);
      continue;
    }
    if (r.key === AI_REVIEW_THRESHOLD_KEY) {
      configCache.aiReviewThreshold = normalizeAiScore(r.value, 24);
      hasAiReviewThreshold = true;
      continue;
    }
    if (r.key === QQ_GROUP_AD_REVIEW_THRESHOLD_KEY) {
      configCache.qqGroupAdReviewThreshold = normalizeAiScore(r.value, 70);
      continue;
    }
    if (r.key === IMAGE_REVIEW_THRESHOLD_KEY) {
      configCache.imageReviewThreshold = normalizeAiScore(r.value, 36);
      hasImageReviewThreshold = true;
      continue;
    }
    if (r.key === VIDEO_REVIEW_THRESHOLD_KEY) {
      configCache.videoReviewThreshold = normalizeAiScore(r.value, 36);
      hasVideoReviewThreshold = true;
      continue;
    }
    if (r.key === AI_REVIEW_AUTO_PASS_SCORE_KEY) {
      if (!hasAiReviewThreshold) {
        configCache.aiReviewThreshold = normalizeAiScore(r.value, 24);
      }
      continue;
    }
    if (r.key === AI_REVIEW_BLOCK_SCORE_KEY) {
      continue;
    }
    if (r.key === IMAGE_REVIEW_AUTO_PASS_SCORE_KEY) {
      if (!hasImageReviewThreshold) {
        configCache.imageReviewThreshold = normalizeAiScore(r.value, 36);
      }
      continue;
    }
    if (r.key === IMAGE_REVIEW_BLOCK_SCORE_KEY) {
      continue;
    }
    if (r.key === VIDEO_REVIEW_AUTO_PASS_SCORE_KEY) {
      if (!hasVideoReviewThreshold) {
        configCache.videoReviewThreshold = normalizeAiScore(r.value, 36);
      }
      continue;
    }
    if (r.key === VIDEO_REVIEW_BLOCK_SCORE_KEY) {
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

export function getSitePromptDefaults(): SitePromptDefaults {
  return {
    qqGroupAdReviewSystemPrompt: DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.system,
    qqGroupAdReviewUserPrompt: DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.user,
    imageReviewSystemPrompt: DEFAULT_IMAGE_REVIEW_PROMPTS.system,
    imageReviewUserPrompt: DEFAULT_IMAGE_REVIEW_PROMPTS.user,
    videoReviewSystemPrompt: DEFAULT_VIDEO_REVIEW_PROMPTS.system,
    videoReviewUserPrompt: DEFAULT_VIDEO_REVIEW_PROMPTS.user,
    aiTopicReviewSystemPrompt: DEFAULT_AI_PROMPTS.topicReviewSystem,
    aiTopicReviewUserPrompt: DEFAULT_AI_PROMPTS.topicReviewUser,
    aiReplyReviewSystemPrompt: DEFAULT_AI_PROMPTS.replyReviewSystem,
    aiReplyReviewUserPrompt: DEFAULT_AI_PROMPTS.replyReviewUser,
    aiEditSimilaritySystemPrompt: DEFAULT_AI_PROMPTS.editSimilaritySystem,
    aiEditSimilarityUserPrompt: DEFAULT_AI_PROMPTS.editSimilarityUser,
  };
}

export function getSiteOrigin(): string {
  return configCache.siteOrigin;
}

export function getSiteFilingNumber(): string {
  return configCache.siteFilingNumber;
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
  if (feature === "market") return "商城当前已关闭";
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
  await broadcastSiteSettingsReload();
}

export async function setGlobalPinnedTopicIds(ids: number[]): Promise<number[]> {
  const normalized = normalizeTopicIdList(JSON.stringify(ids));
  await prisma.siteSetting.upsert({
    where: { key: GLOBAL_PINNED_TOPICS_KEY },
    update: { value: JSON.stringify(normalized) },
    create: { key: GLOBAL_PINNED_TOPICS_KEY, value: JSON.stringify(normalized) },
  });
  globalPinnedTopicIdsCache = normalized;
  await broadcastSiteSettingsReload();
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
  await broadcastSiteSettingsReload();
  return getSiteConfig();
}

export async function setSiteFilingNumber(input: string | null | undefined): Promise<SiteConfig> {
  const siteFilingNumber = normalizeSiteFilingNumber(input);
  await prisma.siteSetting.upsert({
    where: { key: SITE_FILING_NUMBER_KEY },
    update: { value: siteFilingNumber },
    create: { key: SITE_FILING_NUMBER_KEY, value: siteFilingNumber },
  });
  configCache.siteFilingNumber = siteFilingNumber;
  await broadcastSiteSettingsReload();
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
  configCache.aiReviewThreshold = normalizeAiScore(configCache.aiReviewThreshold, 24);
  configCache.qqGroupAdReviewThreshold = normalizeAiScore(configCache.qqGroupAdReviewThreshold, 70);
  configCache.imageReviewThreshold = normalizeAiScore(configCache.imageReviewThreshold, 36);
  configCache.videoReviewThreshold = normalizeAiScore(configCache.videoReviewThreshold, 36);
  configCache.aiEditSimilarityThreshold = normalizeAiRatio(configCache.aiEditSimilarityThreshold, 0);
  configCache.aiTopicReviewSystemPrompt = normalizePromptTemplate(configCache.aiTopicReviewSystemPrompt, DEFAULT_AI_PROMPTS.topicReviewSystem);
  configCache.aiTopicReviewUserPrompt = normalizePromptTemplate(configCache.aiTopicReviewUserPrompt, DEFAULT_AI_PROMPTS.topicReviewUser);
  configCache.aiReplyReviewSystemPrompt = normalizePromptTemplate(configCache.aiReplyReviewSystemPrompt, DEFAULT_AI_PROMPTS.replyReviewSystem);
  configCache.aiReplyReviewUserPrompt = normalizePromptTemplate(configCache.aiReplyReviewUserPrompt, DEFAULT_AI_PROMPTS.replyReviewUser);
  configCache.aiEditSimilaritySystemPrompt = normalizePromptTemplate(configCache.aiEditSimilaritySystemPrompt, DEFAULT_AI_PROMPTS.editSimilaritySystem);
  configCache.aiEditSimilarityUserPrompt = normalizePromptTemplate(configCache.aiEditSimilarityUserPrompt, DEFAULT_AI_PROMPTS.editSimilarityUser);
  if (!configCache.aiReviewProvider) configCache.aiReviewProvider = "deepseek";
  configCache.aiReviewApiUrl = normalizePromptTemplate(configCache.aiReviewApiUrl, "https://api.deepseek.com/chat/completions");
  if (!configCache.aiReviewModel) configCache.aiReviewModel = "deepseek-v4-flash";
  configCache.aiReviewFallbackModels = normalizeFallbackModelList(configCache.aiReviewFallbackModels, configCache.aiReviewModel);
  if (!configCache.qqGroupAdReviewProvider) configCache.qqGroupAdReviewProvider = "deepseek";
  configCache.qqGroupAdReviewApiUrl = normalizePromptTemplate(configCache.qqGroupAdReviewApiUrl, "https://api.deepseek.com/chat/completions");
  configCache.qqGroupAdReviewModel = String(configCache.qqGroupAdReviewModel || "deepseek-v4-flash").trim() || "deepseek-v4-flash";
  configCache.qqGroupAdReviewFallbackModels = normalizeFallbackModelList(configCache.qqGroupAdReviewFallbackModels, configCache.qqGroupAdReviewModel);
  configCache.qqGroupAdReviewSystemPrompt = normalizePromptTemplate(configCache.qqGroupAdReviewSystemPrompt, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.system);
  configCache.qqGroupAdReviewUserPrompt = normalizePromptTemplate(configCache.qqGroupAdReviewUserPrompt, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.user);
  configCache.imageReviewApiUrl = normalizePromptTemplate(configCache.imageReviewApiUrl, "https://api.openai.com/v1/chat/completions");
  configCache.imageReviewModel = String(configCache.imageReviewModel || "gpt-4o-mini").trim() || "gpt-4o-mini";
  configCache.imageReviewFallbackModels = normalizeFallbackModelList(configCache.imageReviewFallbackModels, configCache.imageReviewModel);
  configCache.imageReviewConcurrency = normalizeSmallInt(configCache.imageReviewConcurrency, 2, 1, 8);
  configCache.imageReviewRequestGroupSize = normalizeSmallInt(configCache.imageReviewRequestGroupSize, 3, 1, 6);
  upgradeLegacyImageReviewPrompts();
  configCache.imageReviewSystemPrompt = normalizePromptTemplate(configCache.imageReviewSystemPrompt, DEFAULT_IMAGE_REVIEW_PROMPTS.system);
  configCache.imageReviewUserPrompt = normalizePromptTemplate(configCache.imageReviewUserPrompt, DEFAULT_IMAGE_REVIEW_PROMPTS.user);
  configCache.videoReviewApiUrl = normalizePromptTemplate(configCache.videoReviewApiUrl, "https://api.openai.com/v1/chat/completions");
  configCache.videoReviewModel = String(configCache.videoReviewModel || "gpt-4o-mini").trim() || "gpt-4o-mini";
  configCache.videoReviewFallbackModels = normalizeFallbackModelList(configCache.videoReviewFallbackModels, configCache.videoReviewModel);
  configCache.videoReviewConcurrency = normalizeSmallInt(configCache.videoReviewConcurrency, 1, 1, 2);
  configCache.videoReviewSystemPrompt = normalizePromptTemplate(configCache.videoReviewSystemPrompt, DEFAULT_VIDEO_REVIEW_PROMPTS.system);
  configCache.videoReviewUserPrompt = normalizePromptTemplate(configCache.videoReviewUserPrompt, DEFAULT_VIDEO_REVIEW_PROMPTS.user);
}

function upgradeLegacyImageReviewPrompts() {
  const currentSystem = normalizePromptTemplate(configCache.imageReviewSystemPrompt, "");
  const currentUser = normalizePromptTemplate(configCache.imageReviewUserPrompt, "");
  const legacySystem = normalizePromptTemplate(LEGACY_DEFAULT_IMAGE_REVIEW_PROMPTS.system, "");
  const legacyUser = normalizePromptTemplate(LEGACY_DEFAULT_IMAGE_REVIEW_PROMPTS.user, "");
  if (currentSystem === legacySystem) {
    configCache.imageReviewSystemPrompt = DEFAULT_IMAGE_REVIEW_PROMPTS.system;
  }
  if (currentUser === legacyUser) {
    configCache.imageReviewUserPrompt = DEFAULT_IMAGE_REVIEW_PROMPTS.user;
  }
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
    aiReviewApiUrl: normalizePromptTemplate(input.aiReviewApiUrl, configCache.aiReviewApiUrl),
    aiReviewModel: String(input.aiReviewModel ?? configCache.aiReviewModel ?? "deepseek-v4-flash").trim() || "deepseek-v4-flash",
    aiReviewFallbackModels: normalizeFallbackModelList(input.aiReviewFallbackModels, input.aiReviewModel ?? configCache.aiReviewModel),
    aiReviewApiKey: String(input.aiReviewApiKey ?? configCache.aiReviewApiKey ?? "").trim(),
    qqGroupAdReviewEnabled: input.qqGroupAdReviewEnabled ?? configCache.qqGroupAdReviewEnabled,
    qqGroupAdReviewProvider: String(input.qqGroupAdReviewProvider ?? configCache.qqGroupAdReviewProvider ?? "deepseek").trim() || "deepseek",
    qqGroupAdReviewApiUrl: normalizePromptTemplate(input.qqGroupAdReviewApiUrl, configCache.qqGroupAdReviewApiUrl),
    qqGroupAdReviewModel: String(input.qqGroupAdReviewModel ?? configCache.qqGroupAdReviewModel ?? "deepseek-v4-flash").trim() || "deepseek-v4-flash",
    qqGroupAdReviewFallbackModels: normalizeFallbackModelList(input.qqGroupAdReviewFallbackModels, input.qqGroupAdReviewModel ?? configCache.qqGroupAdReviewModel),
    qqGroupAdReviewApiKey: String(input.qqGroupAdReviewApiKey ?? configCache.qqGroupAdReviewApiKey ?? "").trim(),
    qqGroupAdReviewSystemPrompt: resolvePromptTemplate(input.qqGroupAdReviewSystemPrompt, configCache.qqGroupAdReviewSystemPrompt, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.system),
    qqGroupAdReviewUserPrompt: resolvePromptTemplate(input.qqGroupAdReviewUserPrompt, configCache.qqGroupAdReviewUserPrompt, DEFAULT_QQ_GROUP_AD_REVIEW_PROMPTS.user),
    imageReviewEnabled: input.imageReviewEnabled ?? configCache.imageReviewEnabled,
    imageReviewApiUrl: normalizePromptTemplate(input.imageReviewApiUrl, configCache.imageReviewApiUrl),
    imageReviewModel: String(input.imageReviewModel ?? configCache.imageReviewModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
    imageReviewFallbackModels: normalizeFallbackModelList(input.imageReviewFallbackModels, input.imageReviewModel ?? configCache.imageReviewModel),
    imageReviewApiKey: String(input.imageReviewApiKey ?? configCache.imageReviewApiKey ?? "").trim(),
    imageReviewSystemPrompt: resolvePromptTemplate(input.imageReviewSystemPrompt, configCache.imageReviewSystemPrompt, DEFAULT_IMAGE_REVIEW_PROMPTS.system),
    imageReviewUserPrompt: resolvePromptTemplate(input.imageReviewUserPrompt, configCache.imageReviewUserPrompt, DEFAULT_IMAGE_REVIEW_PROMPTS.user),
    imageReviewConcurrency: normalizeSmallInt(input.imageReviewConcurrency, configCache.imageReviewConcurrency, 1, 8),
    imageReviewRequestGroupSize: normalizeSmallInt(input.imageReviewRequestGroupSize, configCache.imageReviewRequestGroupSize, 1, 6),
    videoReviewEnabled: input.videoReviewEnabled ?? configCache.videoReviewEnabled,
    videoReviewApiUrl: normalizePromptTemplate(input.videoReviewApiUrl, configCache.videoReviewApiUrl),
    videoReviewModel: String(input.videoReviewModel ?? configCache.videoReviewModel ?? "gpt-4o-mini").trim() || "gpt-4o-mini",
    videoReviewFallbackModels: normalizeFallbackModelList(input.videoReviewFallbackModels, input.videoReviewModel ?? configCache.videoReviewModel),
    videoReviewApiKey: String(input.videoReviewApiKey ?? configCache.videoReviewApiKey ?? "").trim(),
    videoReviewSystemPrompt: resolvePromptTemplate(input.videoReviewSystemPrompt, configCache.videoReviewSystemPrompt, DEFAULT_VIDEO_REVIEW_PROMPTS.system),
    videoReviewUserPrompt: resolvePromptTemplate(input.videoReviewUserPrompt, configCache.videoReviewUserPrompt, DEFAULT_VIDEO_REVIEW_PROMPTS.user),
    videoReviewConcurrency: normalizeSmallInt(input.videoReviewConcurrency, configCache.videoReviewConcurrency, 1, 2),
    aiReviewThreshold: normalizeAiScore(
      (input as Partial<SiteConfig> & { aiReviewAutoPassScore?: number; aiReviewBlockScore?: number }).aiReviewThreshold
        ?? (input as any).aiReviewAutoPassScore
        ?? (input as any).aiReviewBlockScore,
      configCache.aiReviewThreshold,
    ),
    qqGroupAdReviewThreshold: normalizeAiScore(input.qqGroupAdReviewThreshold, configCache.qqGroupAdReviewThreshold),
    imageReviewThreshold: normalizeAiScore(
      (input as Partial<SiteConfig> & { imageReviewAutoPassScore?: number; imageReviewBlockScore?: number }).imageReviewThreshold
        ?? (input as any).imageReviewAutoPassScore
        ?? (input as any).imageReviewBlockScore,
      configCache.imageReviewThreshold,
    ),
    videoReviewThreshold: normalizeAiScore(
      (input as Partial<SiteConfig> & { videoReviewAutoPassScore?: number; videoReviewBlockScore?: number }).videoReviewThreshold
        ?? (input as any).videoReviewAutoPassScore
        ?? (input as any).videoReviewBlockScore,
      configCache.videoReviewThreshold,
    ),
    aiEditSimilarityThreshold: normalizeAiRatio(input.aiEditSimilarityThreshold, configCache.aiEditSimilarityThreshold),
    aiTopicReviewSystemPrompt: resolvePromptTemplate(input.aiTopicReviewSystemPrompt, configCache.aiTopicReviewSystemPrompt, DEFAULT_AI_PROMPTS.topicReviewSystem),
    aiTopicReviewUserPrompt: resolvePromptTemplate(input.aiTopicReviewUserPrompt, configCache.aiTopicReviewUserPrompt, DEFAULT_AI_PROMPTS.topicReviewUser),
    aiReplyReviewSystemPrompt: resolvePromptTemplate(input.aiReplyReviewSystemPrompt, configCache.aiReplyReviewSystemPrompt, DEFAULT_AI_PROMPTS.replyReviewSystem),
    aiReplyReviewUserPrompt: resolvePromptTemplate(input.aiReplyReviewUserPrompt, configCache.aiReplyReviewUserPrompt, DEFAULT_AI_PROMPTS.replyReviewUser),
    aiEditSimilaritySystemPrompt: resolvePromptTemplate(input.aiEditSimilaritySystemPrompt, configCache.aiEditSimilaritySystemPrompt, DEFAULT_AI_PROMPTS.editSimilaritySystem),
    aiEditSimilarityUserPrompt: resolvePromptTemplate(input.aiEditSimilarityUserPrompt, configCache.aiEditSimilarityUserPrompt, DEFAULT_AI_PROMPTS.editSimilarityUser),
  };
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
      where: { key: AI_REVIEW_API_URL_KEY },
      update: { value: next.aiReviewApiUrl },
      create: { key: AI_REVIEW_API_URL_KEY, value: next.aiReviewApiUrl },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_MODEL_KEY },
      update: { value: next.aiReviewModel },
      create: { key: AI_REVIEW_MODEL_KEY, value: next.aiReviewModel },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_FALLBACK_MODELS_KEY },
      update: { value: next.aiReviewFallbackModels },
      create: { key: AI_REVIEW_FALLBACK_MODELS_KEY, value: next.aiReviewFallbackModels },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_API_KEY },
      update: { value: next.aiReviewApiKey },
      create: { key: AI_REVIEW_API_KEY, value: next.aiReviewApiKey },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_ENABLED_KEY },
      update: { value: next.qqGroupAdReviewEnabled ? "on" : "off" },
      create: { key: QQ_GROUP_AD_REVIEW_ENABLED_KEY, value: next.qqGroupAdReviewEnabled ? "on" : "off" },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_PROVIDER_KEY },
      update: { value: next.qqGroupAdReviewProvider },
      create: { key: QQ_GROUP_AD_REVIEW_PROVIDER_KEY, value: next.qqGroupAdReviewProvider },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_API_URL_KEY },
      update: { value: next.qqGroupAdReviewApiUrl },
      create: { key: QQ_GROUP_AD_REVIEW_API_URL_KEY, value: next.qqGroupAdReviewApiUrl },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_MODEL_KEY },
      update: { value: next.qqGroupAdReviewModel },
      create: { key: QQ_GROUP_AD_REVIEW_MODEL_KEY, value: next.qqGroupAdReviewModel },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_FALLBACK_MODELS_KEY },
      update: { value: next.qqGroupAdReviewFallbackModels },
      create: { key: QQ_GROUP_AD_REVIEW_FALLBACK_MODELS_KEY, value: next.qqGroupAdReviewFallbackModels },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_API_KEY },
      update: { value: next.qqGroupAdReviewApiKey },
      create: { key: QQ_GROUP_AD_REVIEW_API_KEY, value: next.qqGroupAdReviewApiKey },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_SYSTEM_PROMPT_KEY },
      update: { value: next.qqGroupAdReviewSystemPrompt },
      create: { key: QQ_GROUP_AD_REVIEW_SYSTEM_PROMPT_KEY, value: next.qqGroupAdReviewSystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_USER_PROMPT_KEY },
      update: { value: next.qqGroupAdReviewUserPrompt },
      create: { key: QQ_GROUP_AD_REVIEW_USER_PROMPT_KEY, value: next.qqGroupAdReviewUserPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_ENABLED_KEY },
      update: { value: next.imageReviewEnabled ? "on" : "off" },
      create: { key: IMAGE_REVIEW_ENABLED_KEY, value: next.imageReviewEnabled ? "on" : "off" },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_API_URL_KEY },
      update: { value: next.imageReviewApiUrl },
      create: { key: IMAGE_REVIEW_API_URL_KEY, value: next.imageReviewApiUrl },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_MODEL_KEY },
      update: { value: next.imageReviewModel },
      create: { key: IMAGE_REVIEW_MODEL_KEY, value: next.imageReviewModel },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_FALLBACK_MODELS_KEY },
      update: { value: next.imageReviewFallbackModels },
      create: { key: IMAGE_REVIEW_FALLBACK_MODELS_KEY, value: next.imageReviewFallbackModels },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_API_KEY_KEY },
      update: { value: next.imageReviewApiKey },
      create: { key: IMAGE_REVIEW_API_KEY_KEY, value: next.imageReviewApiKey },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_SYSTEM_PROMPT_KEY },
      update: { value: next.imageReviewSystemPrompt },
      create: { key: IMAGE_REVIEW_SYSTEM_PROMPT_KEY, value: next.imageReviewSystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_USER_PROMPT_KEY },
      update: { value: next.imageReviewUserPrompt },
      create: { key: IMAGE_REVIEW_USER_PROMPT_KEY, value: next.imageReviewUserPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_CONCURRENCY_KEY },
      update: { value: String(next.imageReviewConcurrency) },
      create: { key: IMAGE_REVIEW_CONCURRENCY_KEY, value: String(next.imageReviewConcurrency) },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_REQUEST_GROUP_SIZE_KEY },
      update: { value: String(next.imageReviewRequestGroupSize) },
      create: { key: IMAGE_REVIEW_REQUEST_GROUP_SIZE_KEY, value: String(next.imageReviewRequestGroupSize) },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_ENABLED_KEY },
      update: { value: next.videoReviewEnabled ? "on" : "off" },
      create: { key: VIDEO_REVIEW_ENABLED_KEY, value: next.videoReviewEnabled ? "on" : "off" },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_API_URL_KEY },
      update: { value: next.videoReviewApiUrl },
      create: { key: VIDEO_REVIEW_API_URL_KEY, value: next.videoReviewApiUrl },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_MODEL_KEY },
      update: { value: next.videoReviewModel },
      create: { key: VIDEO_REVIEW_MODEL_KEY, value: next.videoReviewModel },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_FALLBACK_MODELS_KEY },
      update: { value: next.videoReviewFallbackModels },
      create: { key: VIDEO_REVIEW_FALLBACK_MODELS_KEY, value: next.videoReviewFallbackModels },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_API_KEY_KEY },
      update: { value: next.videoReviewApiKey },
      create: { key: VIDEO_REVIEW_API_KEY_KEY, value: next.videoReviewApiKey },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_SYSTEM_PROMPT_KEY },
      update: { value: next.videoReviewSystemPrompt },
      create: { key: VIDEO_REVIEW_SYSTEM_PROMPT_KEY, value: next.videoReviewSystemPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_USER_PROMPT_KEY },
      update: { value: next.videoReviewUserPrompt },
      create: { key: VIDEO_REVIEW_USER_PROMPT_KEY, value: next.videoReviewUserPrompt },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_CONCURRENCY_KEY },
      update: { value: String(next.videoReviewConcurrency) },
      create: { key: VIDEO_REVIEW_CONCURRENCY_KEY, value: String(next.videoReviewConcurrency) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_THRESHOLD_KEY },
      update: { value: String(next.aiReviewThreshold) },
      create: { key: AI_REVIEW_THRESHOLD_KEY, value: String(next.aiReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: QQ_GROUP_AD_REVIEW_THRESHOLD_KEY },
      update: { value: String(next.qqGroupAdReviewThreshold) },
      create: { key: QQ_GROUP_AD_REVIEW_THRESHOLD_KEY, value: String(next.qqGroupAdReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_THRESHOLD_KEY },
      update: { value: String(next.imageReviewThreshold) },
      create: { key: IMAGE_REVIEW_THRESHOLD_KEY, value: String(next.imageReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_THRESHOLD_KEY },
      update: { value: String(next.videoReviewThreshold) },
      create: { key: VIDEO_REVIEW_THRESHOLD_KEY, value: String(next.videoReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_AUTO_PASS_SCORE_KEY },
      update: { value: String(next.aiReviewThreshold) },
      create: { key: AI_REVIEW_AUTO_PASS_SCORE_KEY, value: String(next.aiReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: AI_REVIEW_BLOCK_SCORE_KEY },
      update: { value: String(next.aiReviewThreshold) },
      create: { key: AI_REVIEW_BLOCK_SCORE_KEY, value: String(next.aiReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_AUTO_PASS_SCORE_KEY },
      update: { value: String(next.imageReviewThreshold) },
      create: { key: IMAGE_REVIEW_AUTO_PASS_SCORE_KEY, value: String(next.imageReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: IMAGE_REVIEW_BLOCK_SCORE_KEY },
      update: { value: String(next.imageReviewThreshold) },
      create: { key: IMAGE_REVIEW_BLOCK_SCORE_KEY, value: String(next.imageReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_AUTO_PASS_SCORE_KEY },
      update: { value: String(next.videoReviewThreshold) },
      create: { key: VIDEO_REVIEW_AUTO_PASS_SCORE_KEY, value: String(next.videoReviewThreshold) },
    }),
    prisma.siteSetting.upsert({
      where: { key: VIDEO_REVIEW_BLOCK_SCORE_KEY },
      update: { value: String(next.videoReviewThreshold) },
      create: { key: VIDEO_REVIEW_BLOCK_SCORE_KEY, value: String(next.videoReviewThreshold) },
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
  await broadcastSiteSettingsReload();
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
  await broadcastSiteSettingsReload();
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
