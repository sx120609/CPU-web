import { createHash } from "node:crypto";
import { Errors } from "../utils/response";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
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
const promptCacheKeySupport = new Map<string, boolean>();
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
  const endpoint = normalizeReviewApiUrl(config.qqGroupAdReviewApiUrl);
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
    let usedPromptCacheKey = isPromptCacheKeyEnabledForEndpoint(endpoint);
    try {
      response = await sendQqGroupAdReviewRequest({
        endpoint,
        apiKey: config.qqGroupAdReviewApiKey,
        model,
        messages,
        promptCacheKey,
        enablePromptCacheKey: usedPromptCacheKey,
      });
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "FETCH_ERROR", detail);
      lastError = Errors.server(`QQ群广告过滤请求失败：${detail}`);
      if (index < candidates.length - 1) continue;
      throw lastError;
    }

    if (!response.ok) {
      let text = await response.text().catch(() => "");
      if (usedPromptCacheKey && shouldDisablePromptCacheKey(response.status, text)) {
        promptCacheKeySupport.set(endpoint, false);
        usedPromptCacheKey = false;
        try {
          response = await sendQqGroupAdReviewRequest({
            endpoint,
            apiKey: config.qqGroupAdReviewApiKey,
            model,
            messages,
            promptCacheKey,
            enablePromptCacheKey: false,
          });
        } catch (error) {
          const detail = describeRequestError(error);
          await finishAiReviewLogError(logId, "FETCH_ERROR", detail);
          lastError = Errors.server(`QQ群广告过滤请求失败：${detail}`);
          if (index < candidates.length - 1) continue;
          throw lastError;
        }
        if (response.ok) {
          promptCacheKeySupport.set(endpoint, false);
        } else {
          text = await response.text().catch(() => "");
        }
      }
      if (!response.ok) {
        await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
        const canFallback = index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text);
        if (canFallback) {
          lastError = Errors.server(`QQ群广告过滤模型 ${model} 当前不可用，已自动尝试下一个备选模型`);
          continue;
        }
        throw Errors.server(`QQ群广告过滤请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
      }
    }

    let json: any;
    try {
      json = await response.json();
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "INVALID_JSON", detail);
      throw Errors.server(`QQ群广告过滤返回解析失败：${detail}`);
    }

    const content = extractChatCompletionContent(json);
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

async function sendQqGroupAdReviewRequest(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  promptCacheKey: string;
  enablePromptCacheKey: boolean;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${input.apiKey}`,
  };
  const body: Record<string, unknown> = {
    model: input.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: input.messages,
  };
  if (input.enablePromptCacheKey) {
    body.prompt_cache_key = input.promptCacheKey;
  }
  return fetch(input.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function normalizeReviewApiUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "https://api.deepseek.com/chat/completions";
  if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/+$/, "");
  if (/\/v1\/?$/i.test(raw)) return `${raw.replace(/\/+$/, "")}/chat/completions`;
  if (/^https?:\/\/[^/]+$/i.test(raw)) return `${raw.replace(/\/+$/, "")}/v1/chat/completions`;
  return raw.replace(/\/+$/, "");
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

function isPromptCacheKeyEnabledForEndpoint(endpoint: string) {
  return promptCacheKeySupport.get(endpoint) ?? true;
}

function shouldDisablePromptCacheKey(status: number, responseText: string) {
  if (status !== 400 && status !== 422) return false;
  const text = String(responseText || "").toLowerCase();
  return (
    text.includes("prompt_cache_key")
    && (
      text.includes("unknown")
      || text.includes("unsupported")
      || text.includes("not allowed")
      || text.includes("extra inputs")
      || text.includes("unrecognized")
      || text.includes("invalid")
    )
  );
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

function extractChatCompletionContent(json: any) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("\n");
  }
  return "";
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
