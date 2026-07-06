import { createHash } from "node:crypto";
import { Errors } from "../utils/response";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { getSiteConfig } from "./siteSettings";

type QqGroupAdResponse = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};

export type QqGroupAdReviewResult = {
  action: "allow" | "block";
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  detail: string;
  model: string;
  modelDecision: string;
};

const QQ_GROUP_AD_REVIEW_RESULT_CACHE_TTL_MS = 10 * 60_000;
const QQ_GROUP_AD_KFC_MEME_PATTERNS = [
  /疯狂星期四/u,
  /[vV]\s*我\s*(?:50|五十)/u,
  /肯德基|kfc/iu,
];
const QQ_GROUP_AD_KFC_MEME_BLOCKER_PATTERNS = [
  /https?:\/\//iu,
  /www\./iu,
  /二维码|扫码/u,
  /加群|进群|拉群|群号/u,
  /下单|购买|出售|代购|办理/u,
  /代理|招代理|推广|合作/u,
  /兼职|刷单|返利|日结/u,
  /优惠|套餐|活动价|限时/u,
];
const localResultCache = new Map<string, { expiresAt: number; value: QqGroupAdReviewResult }>();

export function shouldRunQqGroupAdReview() {
  const config = getSiteConfig();
  return Boolean(config.qqGroupAdReviewEnabled && config.qqGroupAdReviewApiKey.trim());
}

export async function reviewQqGroupMessageForAd(input: {
  groupId: string;
  groupName?: string | null;
  qqId: string;
  nickname?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}): Promise<QqGroupAdReviewResult> {
  const config = getSiteConfig();
  if (!config.qqGroupAdReviewEnabled || !config.qqGroupAdReviewApiKey.trim()) {
    return {
      action: "allow",
      riskScore: 0,
      riskLevel: "low",
      reason: "QQ群广告过滤未开启",
      detail: "",
      model: config.qqGroupAdReviewModel,
      modelDecision: "auto_pass",
    };
  }

  const localBypassReason = detectHarmlessQqGroupAdBypassReason(input.content);
  if (localBypassReason) {
    return {
      action: "allow",
      riskScore: 0,
      riskLevel: "low",
      reason: localBypassReason,
      detail: "命中本地玩梗误判豁免，未见真实卖货、拉群、招募、二维码或链接导流信号。",
      model: "local-bypass",
      modelDecision: "auto_pass",
    };
  }

  const configHash = buildQqGroupAdReviewConfigHash(config);
  const normalizedContent = normalizeMessageForCache(input.content);
  const resultCacheKey = buildQqGroupAdReviewResultCacheKey({
    configHash,
    groupId: input.groupId,
    content: normalizedContent,
  });
  const cached = readLocalResultCache(resultCacheKey);
  if (cached) {
    return cached;
  }

  const messages = [
    { role: "system" as const, content: config.qqGroupAdReviewSystemPrompt },
    {
      role: "user" as const,
      content: fillPromptTemplate(config.qqGroupAdReviewUserPrompt, {
        groupId: input.groupId,
        groupName: input.groupName || input.groupId,
        qqId: input.qqId,
        nickname: input.nickname || "",
        content: input.content,
        metadataJson: JSON.stringify(input.metadata || {}),
      }),
    },
  ];
  const endpoint = normalizeAiJsonApiUrl(config.qqGroupAdReviewApiUrl, "https://api.deepseek.com/chat/completions");
  const candidates = resolveModelCandidates(config.qqGroupAdReviewModel, config.qqGroupAdReviewFallbackModels);
  const promptCacheKey = buildQqGroupAdPromptCacheKey({
    configHash,
    groupId: input.groupId,
  });
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const started = await startAiReviewLog({
      kind: "qqbot-group-ad",
      targetId: null,
      targetLabel: `${input.groupName || input.groupId} / ${input.qqId}`,
      createdById: null,
      provider: config.qqGroupAdReviewProvider,
      model,
      endpoint,
      requestSummary: messages[1].content,
    });
    const logId = started?.id ?? null;

    let response: Response;
    let responseMode = detectReviewApiMode(endpoint);
    let responseErrorText = "";
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: config.qqGroupAdReviewApiKey,
        model,
        temperature: 0.1,
        messages,
        promptCacheKey,
        enablePromptCacheRetention: true,
      });
      response = result.response;
      responseMode = result.mode;
      responseErrorText = result.errorText;
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "FETCH_ERROR", detail);
      lastError = Errors.server(`QQ群广告过滤请求失败：${detail}`);
      if (index < candidates.length - 1) continue;
      throw lastError;
    }

    if (!response.ok) {
      const text = responseErrorText || await response.text().catch(() => "");
      await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
      const canFallback = index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text);
      if (canFallback) {
        lastError = Errors.server(`QQ群广告过滤模型 ${model} 当前不可用，已自动尝试下一个备选模型`);
        continue;
      }
      throw Errors.server(`QQ群广告过滤请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
    }

    let json: any;
    try {
      json = await response.json();
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "INVALID_JSON", detail);
      throw Errors.server(`QQ群广告过滤返回解析失败：${detail}`);
    }

    const content = extractAiJsonTextResponse(json, responseMode);
    await finishAiReviewLogSuccess(logId, typeof content === "string" ? content : JSON.stringify(content ?? {}).slice(0, 4000));

    const parsed = parseAdReviewResponse(content);
    const riskScore = clampScore(parsed.risk_score);
    const modelDecision = String(parsed.decision || "").trim().toLowerCase();
    const action = resolveQqGroupAdReviewAction({
      riskScore,
      threshold: config.qqGroupAdReviewThreshold,
      modelDecision,
    });
    const result: QqGroupAdReviewResult = {
      action,
      riskScore,
      riskLevel: normalizeRiskLevel(parsed.risk_level),
      reason: String(parsed.reason || "").trim() || (action === "block" ? "疑似广告或引流内容" : "通过"),
      detail: String(parsed.detail || "").trim(),
      model,
      modelDecision,
    };
    writeLocalResultCache(resultCacheKey, result, QQ_GROUP_AD_REVIEW_RESULT_CACHE_TTL_MS);
    return result;
  }

  throw lastError || Errors.server("QQ群广告过滤请求失败");
}

export function detectHarmlessQqGroupAdBypassReason(input: string) {
  const content = normalizeMessageForCache(input);
  if (!content) return null;
  const normalized = content.toLowerCase();
  const memeSignalCount = QQ_GROUP_AD_KFC_MEME_PATTERNS.reduce((count, pattern) => (
    pattern.test(content) ? count + 1 : count
  ), 0);
  if (memeSignalCount < 2) return null;
  if (QQ_GROUP_AD_KFC_MEME_BLOCKER_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  return "命中疯狂星期四等玩梗文案豁免";
}

function fillPromptTemplate(template: string, values: Record<string, string>) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function readLocalResultCache(key: string) {
  const cached = localResultCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    localResultCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeLocalResultCache(key: string, value: QqGroupAdReviewResult, ttlMs: number) {
  pruneLocalResultCache();
  localResultCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
}

function pruneLocalResultCache() {
  const now = Date.now();
  if (localResultCache.size > 500) {
    for (const [key, cached] of localResultCache.entries()) {
      if (cached.expiresAt <= now) localResultCache.delete(key);
    }
  }
}

function normalizeMessageForCache(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function buildQqGroupAdReviewConfigHash(config: ReturnType<typeof getSiteConfig>) {
  return hashString([
    config.qqGroupAdReviewProvider,
    config.qqGroupAdReviewApiUrl,
    config.qqGroupAdReviewModel,
    config.qqGroupAdReviewFallbackModels,
    config.qqGroupAdReviewThreshold,
    config.qqGroupAdReviewSystemPrompt,
    config.qqGroupAdReviewUserPrompt,
  ].join("\n"));
}

function buildQqGroupAdReviewResultCacheKey(input: {
  configHash: string;
  groupId: string;
  content: string;
}) {
  return `qqbot:group-ad-review:${hashString(`${input.configHash}\n${input.groupId}\n${input.content}`)}`;
}

function buildQqGroupAdPromptCacheKey(input: {
  configHash: string;
  groupId: string;
}) {
  return `qqbot-group-ad:${hashString(`${input.configHash}\n${input.groupId}`)}`;
}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function describeRequestError(error: unknown) {
  const parts: string[] = [];
  const maybeError = error as { message?: unknown; cause?: unknown; code?: unknown };
  if (typeof maybeError?.message === "string" && maybeError.message.trim()) parts.push(maybeError.message.trim());
  if (typeof maybeError?.code === "string" && maybeError.code.trim()) parts.push(maybeError.code.trim());
  const cause = maybeError?.cause as { message?: unknown; code?: unknown } | undefined;
  if (typeof cause?.message === "string" && cause.message.trim()) parts.push(cause.message.trim());
  if (typeof cause?.code === "string" && cause.code.trim()) parts.push(cause.code.trim());
  if (!parts.length && error) parts.push(String(error));
  return Array.from(new Set(parts)).join("；").slice(0, 500) || "网络请求失败";
}

function detectReviewApiMode(endpoint: string) {
  return /\/responses\/?$/i.test(endpoint) ? "responses" as const : "chat_completions" as const;
}

function parseAdReviewResponse(content: unknown): QqGroupAdResponse {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed ? parsed as QqGroupAdResponse : {};
  } catch {
    return {};
  }
}

function clampScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function resolveQqGroupAdReviewAction(input: {
  riskScore: number;
  threshold: number;
  modelDecision: string;
}): "allow" | "block" {
  if (input.modelDecision === "manual_review") return "allow";
  if (input.modelDecision === "block") return "block";
  return input.riskScore >= input.threshold ? "block" : "allow";
}
