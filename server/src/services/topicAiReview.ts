import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { type AiJsonMessage, extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { getSiteConfig } from "./siteSettings";

export type TopicAiReviewStatus =
  | "none"
  | "checking"
  | "auto_passed"
  | "blocked_ai"
  | "blocked_force"
  | "manual_requested"
  | "manual_reviewing"
  | "approved_manual"
  | "rejected_manual";

export type TopicAiRiskLevel = "low" | "medium" | "high";

export type TopicAiReviewResult = {
  status: TopicAiReviewStatus;
  riskLevel: TopicAiRiskLevel;
  riskScore: number;
  reason: string;
  detail: string;
  model: string;
};

export const AI_TOPIC_LABEL_VOCAB = [
  "日常闲聊",
  "求助咨询",
  "经验分享",
  "课程学习",
  "交易相关",
  "校园生活",
  "情绪表达",
  "争议内容",
  "容易不适",
  "性相关",
  "人身攻击",
  "联系方式",
  "医疗健康",
  "剧透",
] as const;

type TopicAiLabel = typeof AI_TOPIC_LABEL_VOCAB[number];

type DeepSeekReviewResponse = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};

type DeepSeekTagResponse = {
  tags?: string[];
};

type DeepSeekEditSimilarityResponse = {
  similarity_score?: number;
  same_topic?: boolean;
  reason?: string;
  detail?: string;
};

const DEFAULT_REVIEW_API_URL = "https://api.deepseek.com/chat/completions";
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*>/gi;
const HTML_TAG_RE = /<[^>]+>/g;

export function shouldBypassAiReview(role: string | null | undefined) {
  return role === "bot";
}

export async function shouldBypassAiReviewForUser(userId: number, role: string | null | undefined) {
  if (shouldBypassAiReview(role)) return true;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiReviewWhitelisted: true },
  });
  return Boolean(user?.aiReviewWhitelisted);
}

export async function ensureUserCanSubmitTopic(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { topicSubmissionLocked: true },
  });
  if (user?.topicSubmissionLocked) {
    throw Errors.forbidden("你当前有稿件正在人工审核，暂时不能继续投稿");
  }
}

export function shouldRunAiReview() {
  const config = getSiteConfig();
  return Boolean(config.aiReviewEnabled && config.aiReviewApiKey.trim());
}

type AiReviewLogContext = {
  kind: "topic" | "reply" | "topic-edit";
  targetId?: number | null;
  targetLabel?: string | null;
  createdById?: number | null;
};

type AiJsonRequestOptions = {
  logContext?: AiReviewLogContext;
  promptCacheScope?: string;
};

export async function requestAiJson(messages: AiJsonMessage[], options?: AiJsonRequestOptions) {
  const config = getSiteConfig();
  const endpoint = normalizeAiJsonApiUrl(config.aiReviewApiUrl, DEFAULT_REVIEW_API_URL);
  const userPrompt = messages
    .filter((item) => item.role === "user")
    .map((item) => summarizeAiJsonMessageContent(item.content))
    .join("\n\n");
  const candidates = resolveModelCandidates(config.aiReviewModel, config.aiReviewFallbackModels);
  const promptCacheKey = buildAiReviewPromptCacheKey({
    configHash: buildAiReviewConfigHash(config),
    scope: options?.promptCacheScope || options?.logContext?.kind || "generic",
  });
  let lastError: Error | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    let logId: number | null = null;
    if (options?.logContext) {
      const started = await startAiReviewLog({
        kind: options.logContext.kind,
        targetId: options.logContext.targetId ?? null,
        targetLabel: options.logContext.targetLabel ?? null,
        createdById: options.logContext.createdById ?? null,
        provider: config.aiReviewProvider,
        model,
        endpoint,
        requestSummary: userPrompt,
      });
      logId = started?.id ?? null;
    }
    let response: Response;
    let responseMode = detectTextReviewApiMode(endpoint);
    let responseErrorText = "";
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: config.aiReviewApiKey,
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
      const detail = describeAiRequestError(error);
      await finishAiReviewLogError(logId, "FETCH_ERROR", detail);
      lastError = Errors.server(`AI 审核请求失败：${detail}`);
      if (index < candidates.length - 1) continue;
      throw lastError;
    }
    if (!response.ok) {
      const text = responseErrorText || await response.text().catch(() => "");
      await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
      const canFallback = index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text);
      if (canFallback) {
        lastError = Errors.server(`AI 审核模型 ${model} 当前不可用，已自动尝试下一个备选模型`);
        continue;
      }
      throw Errors.server(`AI 审核请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
    }
    let json: any;
    try {
      json = await response.json();
    } catch (error) {
      const detail = describeAiRequestError(error);
      await finishAiReviewLogError(logId, "INVALID_JSON", detail);
      throw Errors.server(`AI 审核返回解析失败：${detail}`);
    }
    const content = extractAiJsonTextResponse(json, responseMode);
    await finishAiReviewLogSuccess(logId, typeof content === "string" ? content : JSON.stringify(content ?? {}).slice(0, 4000));
    return { content, model };
  }
  throw lastError || Errors.server("AI 审核请求失败");
}

function describeAiRequestError(error: unknown) {
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

function buildAiReviewUnavailableResult(
  config: ReturnType<typeof getSiteConfig>,
  scope: "topic" | "reply",
  error: unknown,
  model = config.aiReviewModel,
): TopicAiReviewResult {
  const detail = describeAiRequestError(error);
  return {
    status: "blocked_ai",
    riskLevel: "medium",
    riskScore: Math.max(1, Number(config.aiReviewThreshold || 70)),
    reason: "AI 审核服务暂不可用，已转人工复核",
    detail: JSON.stringify({
      unavailable: true,
      scope,
      detail,
    }),
    model,
  };
}


export async function reviewTopicContent(input: {
  title: string;
  content: string;
  boardName?: string | null;
  boardType?: string | null;
  metadata?: Record<string, any> | null;
}): Promise<TopicAiReviewResult> {
  const config = getSiteConfig();
  if (!config.aiReviewEnabled || !config.aiReviewApiKey.trim()) {
    return {
      status: "auto_passed",
      riskLevel: "low",
      riskScore: 0,
      reason: "AI 审核未开启",
      detail: "",
      model: config.aiReviewModel,
    };
  }

  let content = "";
  let model = config.aiReviewModel;
  try {
    const result = await requestAiJson([
      {
        role: "system",
        content: config.aiTopicReviewSystemPrompt,
      },
      {
        role: "user",
        content: renderPromptTemplate(config.aiTopicReviewUserPrompt, {
          boardName: input.boardName,
          boardType: input.boardType,
          title: input.title,
          content: normalizeTextContentForAiReview(input.content),
          metadataJson: JSON.stringify(input.metadata ?? {}),
        }),
      },
    ], {
      logContext: {
        kind: "topic",
        targetLabel: input.title,
      },
      promptCacheScope: "topic-review",
    });
    content = result.content;
    model = result.model;
  } catch (error) {
    return buildAiReviewUnavailableResult(config, "topic", error);
  }
  let parsed: DeepSeekReviewResponse;
  try {
    parsed = parseReviewJson(content);
  } catch (error) {
    return buildAiReviewUnavailableResult(config, "topic", error, model);
  }
  const riskScore = clampScore(parsed.risk_score);
  const riskLevel = normalizeRiskLevel(parsed.risk_level, riskScore);
  const decision = decideByThreshold(riskScore, config.aiReviewThreshold);
  return {
    status: decision === "auto_pass" ? "auto_passed" : "blocked_ai",
    riskLevel,
    riskScore,
    reason: String(parsed.reason || fallbackReason(riskLevel)).slice(0, 120),
    detail: JSON.stringify({
      modelDecision: parsed.decision ?? "",
      decision,
      categories: parsed.categories ?? {},
      detail: String(parsed.detail || "").slice(0, 1000),
    }),
    model,
  };
}

export async function reviewReplyContent(input: {
  topicTitle?: string | null;
  boardName?: string | null;
  boardType?: string | null;
  content: string;
  parentContent?: string | null;
}): Promise<TopicAiReviewResult> {
  const config = getSiteConfig();
  if (!config.aiReviewEnabled || !config.aiReviewApiKey.trim()) {
    return {
      status: "auto_passed",
      riskLevel: "low",
      riskScore: 0,
      reason: "AI 审核未开启",
      detail: "",
      model: config.aiReviewModel,
    };
  }

  let content = "";
  let model = config.aiReviewModel;
  try {
    const result = await requestAiJson([
      {
        role: "system",
        content: config.aiReplyReviewSystemPrompt,
      },
      {
        role: "user",
        content: renderPromptTemplate(config.aiReplyReviewUserPrompt, {
          topicTitle: input.topicTitle,
          boardName: input.boardName,
          boardType: input.boardType,
          parentContent: normalizeTextContentForAiReview(input.parentContent || ""),
          content: normalizeTextContentForAiReview(input.content),
        }),
      },
    ], {
      logContext: {
        kind: "reply",
        targetLabel: input.topicTitle || input.content.slice(0, 60),
      },
      promptCacheScope: "reply-review",
    });
    content = result.content;
    model = result.model;
  } catch (error) {
    return buildAiReviewUnavailableResult(config, "reply", error);
  }
  let parsed: DeepSeekReviewResponse;
  try {
    parsed = parseReviewJson(content);
  } catch (error) {
    return buildAiReviewUnavailableResult(config, "reply", error, model);
  }
  const riskScore = clampScore(parsed.risk_score);
  const riskLevel = normalizeRiskLevel(parsed.risk_level, riskScore);
  const decision = decideByThreshold(riskScore, config.aiReviewThreshold);
  return {
    status: decision === "auto_pass" ? "auto_passed" : "blocked_ai",
    riskLevel,
    riskScore,
    reason: String(parsed.reason || fallbackReason(riskLevel)).slice(0, 120),
    detail: JSON.stringify({
      modelDecision: parsed.decision ?? "",
      decision,
      categories: parsed.categories ?? {},
      detail: String(parsed.detail || "").slice(0, 1000),
    }),
    model,
  };
}

export async function evaluateTopicEditSimilarity(input: {
  originalTitle: string;
  originalContent: string;
  updatedTitle: string;
  updatedContent: string;
}) {
  const config = getSiteConfig();
  if (!config.aiReviewApiKey.trim()) {
    return {
      similarity: fallbackEditSimilarity(
        `${input.originalTitle}\n${input.originalContent}`,
        `${input.updatedTitle}\n${input.updatedContent}`,
      ),
      reason: "AI 未配置，已回退到本地相似度判定",
      detail: "",
      model: config.aiReviewModel,
      sameTopic: true,
    };
  }
  const { content, model } = await requestAiJson([
    {
      role: "system",
      content: config.aiEditSimilaritySystemPrompt,
    },
    {
      role: "user",
      content: renderPromptTemplate(config.aiEditSimilarityUserPrompt, {
        originalTitle: input.originalTitle,
        originalContent: input.originalContent,
        updatedTitle: input.updatedTitle,
        updatedContent: input.updatedContent,
      }),
    },
  ], {
    logContext: {
      kind: "topic-edit",
      targetLabel: input.updatedTitle || input.originalTitle,
    },
    promptCacheScope: "edit-similarity",
  });
  const parsed = parseEditSimilarityJson(content);
  return {
    similarity: clampRatio(parsed.similarity_score),
    reason: String(parsed.reason || "AI 未提供原因").slice(0, 120),
    detail: String(parsed.detail || "").slice(0, 1000),
    model,
    sameTopic: Boolean(parsed.same_topic),
  };
}

function parseReviewJson(content: string): DeepSeekReviewResponse {
  if (!content || typeof content !== "string") {
    throw Errors.server("AI 审核返回为空");
  }
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
    throw Errors.server("AI 审核返回格式异常");
  }
}

function parseEditSimilarityJson(content: string): DeepSeekEditSimilarityResponse {
  if (!content || typeof content !== "string") {
    throw Errors.server("AI 相似度判定返回为空");
  }
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
    throw Errors.server("AI 相似度判定返回格式异常");
  }
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeRiskLevel(value: unknown, score: number): TopicAiRiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (score >= 70) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function decideByThreshold(score: number, threshold: number) {
  return score < threshold ? "auto_pass" : "block";
}

function renderPromptTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => stringifyPromptValue(vars[key]));
}

function stringifyPromptValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTextContentForAiReview(content: string) {
  return String(content || "")
    .replace(MARKDOWN_IMAGE_RE, "\n")
    .replace(HTML_IMAGE_RE, "\n")
    .replace(/\n?\[图片\]\n?/g, "\n")
    .replace(HTML_TAG_RE, " ")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function generateTopicAiTags(input: {
  title: string;
  content: string;
  boardName?: string | null;
  boardType?: string | null;
  metadata?: Record<string, any> | null;
}) {
  const config = getSiteConfig();
  if (!config.aiReviewApiKey.trim()) return [] as TopicAiLabel[];
  const { content } = await requestAiJson([
    {
      role: "system",
      content:
        "你是校园社区内容标签助手。你必须只从给定词库中选择 1-2 个最合适的标签。不要创造新标签。若内容没有特别明显特征，也应从较中性的标签中选择最合适的 1 个。只返回 JSON。",
    },
    {
      role: "user",
      content: [
        "请从以下固定词库中为帖子选择 1-2 个标签：",
        JSON.stringify(AI_TOPIC_LABEL_VOCAB),
        "",
        '输出格式：{"tags":["标签1","标签2"]}',
        "",
        `板块名称：${input.boardName || ""}`,
        `板块类型：${input.boardType || ""}`,
        `标题：${input.title}`,
        `正文：${input.content}`,
        `补充 metadata：${JSON.stringify(input.metadata ?? {})}`,
      ].join("\n"),
    },
  ], {
    promptCacheScope: "topic-tags",
  });
  const parsed = parseTagJson(content);
  const allowed = new Set<string>(AI_TOPIC_LABEL_VOCAB);
  const cleaned = Array.from(new Set((parsed.tags ?? []).map((tag) => String(tag).trim()).filter((tag) => allowed.has(tag))));
  return cleaned.slice(0, 2) as TopicAiLabel[];
}

function parseTagJson(content: string): DeepSeekTagResponse {
  if (!content || typeof content !== "string") return { tags: [] };
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return { tags: [] };
      }
    }
    return { tags: [] };
  }
}

export async function syncTopicAiTags(topicId: number, nextTags: string[]) {
  const aiTagSet = new Set<string>(AI_TOPIC_LABEL_VOCAB);
  const current = await prisma.topicTag.findMany({
    where: { topicId },
    include: { tag: true },
  });
  const currentAiTagIds = current.filter((item) => aiTagSet.has(item.tag.name)).map((item) => item.tagId);
  if (currentAiTagIds.length) {
    await prisma.topicTag.deleteMany({
      where: { topicId, tagId: { in: currentAiTagIds } },
    });
  }
  for (const name of nextTags) {
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    await prisma.topicTag.create({
      data: { topicId, tagId: tag.id },
    }).catch(() => {});
  }
}

function clampRatio(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, Number((n / 100).toFixed(2))));
}

function fallbackEditSimilarity(a: string, b: string) {
  const sa = normalizeSimilaritySource(a);
  const sb = normalizeSimilaritySource(b);
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  const aBigrams = buildBigrams(sa);
  const bBigrams = buildBigrams(sb);
  if (!aBigrams.length || !bBigrams.length) {
    return sa === sb ? 1 : 0;
  }
  const counts = new Map<string, number>();
  for (const item of aBigrams) counts.set(item, (counts.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of bBigrams) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      intersection += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * intersection) / (aBigrams.length + bBigrams.length);
}

function normalizeSimilaritySource(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function buildBigrams(value: string) {
  if (value.length < 2) return value ? [value] : [];
  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.push(value.slice(i, i + 2));
  }
  return grams;
}

function fallbackReason(level: TopicAiRiskLevel) {
  if (level === "high") return "检测到较高风险内容";
  if (level === "medium") return "内容存在一定风险，需要人工复核";
  return "风险较低";
}

function buildAiReviewConfigHash(config: ReturnType<typeof getSiteConfig>) {
  return hashString([
    config.aiReviewProvider,
    config.aiReviewApiUrl,
    config.aiReviewModel,
    config.aiReviewFallbackModels,
    config.aiTopicReviewSystemPrompt,
    config.aiTopicReviewUserPrompt,
    config.aiReplyReviewSystemPrompt,
    config.aiReplyReviewUserPrompt,
    config.aiEditSimilaritySystemPrompt,
    config.aiEditSimilarityUserPrompt,
  ].join("\n"));
}

function buildAiReviewPromptCacheKey(input: {
  configHash: string;
  scope: string;
}) {
  return `ai-review:${hashString(`${input.configHash}\n${input.scope}`)}`;
}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function summarizeAiJsonMessageContent(content: AiJsonMessage["content"]) {
  if (typeof content === "string") return content;
  return content
    .map((item) => item.type === "text" ? item.text : "[image]")
    .join("\n");
}

function detectTextReviewApiMode(endpoint: string) {
  return /\/responses\/?$/i.test(endpoint) ? "responses" as const : "chat_completions" as const;
}

export async function requestManualTopicReview(topicId: number, userId: number) {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, authorId: true, aiReviewStatus: true, hidden: true },
  });
  if (!topic) throw Errors.notFound("稿件不存在");
  if (topic.authorId !== userId) throw Errors.forbidden("只能申请人工审核自己的稿件");
  if (topic.aiReviewStatus !== "blocked_ai") throw Errors.badRequest("当前稿件不能申请人工审核");
  if (!topic.hidden) throw Errors.badRequest("当前稿件无需申请人工审核");

  const pendingCount = await prisma.topic.count({
    where: {
      authorId: userId,
      aiReviewStatus: { in: ["manual_requested", "manual_reviewing"] },
    },
  });
  if (pendingCount > 0) throw Errors.badRequest("你已有稿件在人工审核中");

  await prisma.$transaction([
    prisma.topic.update({
      where: { id: topicId },
      data: { aiReviewStatus: "manual_requested" },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { topicSubmissionLocked: true },
    }),
  ]);
  await createAiReviewNotifications(topicId, userId);
}

export async function requestManualReplyReview(replyId: number, userId: number) {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: { id: true, authorId: true, hidden: true, content: true, aiReviewStatus: true, aiReviewReason: true, aiRiskScore: true, topicId: true },
  });
  if (!reply) throw Errors.notFound("回复不存在");
  if (reply.authorId !== userId) throw Errors.forbidden("只能申请人工审核自己的回复");
  if (!reply.hidden) throw Errors.badRequest("当前回复无需申请人工审核");
  if (reply.aiReviewStatus !== "blocked_ai") throw Errors.badRequest("当前回复不能申请人工审核");
  await prisma.reply.update({
    where: { id: replyId },
    data: { aiReviewStatus: "manual_requested" },
  });
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "normal",
      title: "已提交回复人工审核申请",
      content: "审核期间不能继续投递新稿件，请等待管理员处理。",
      source: "AI 审核",
      link: `/forum/topic/${reply.topicId}`,
      payload: JSON.stringify({
        type: "reply-manual-review-pending",
        replyId: reply.id,
        topicId: reply.topicId,
        reason: reply.aiReviewReason,
        riskScore: reply.aiRiskScore,
      }),
    },
  }).catch(() => {});

  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["admin", "mod"] }, status: "active" },
    select: { id: true },
  });
  if (reviewers.length) {
    await prisma.notification.createMany({
      data: reviewers.map((reviewer) => ({
        userId: reviewer.id,
        category: "system",
        level: "normal",
        title: "有新的回复待人工审核",
        content: reply.content.slice(0, 80),
        source: "AI 审核",
        payload: JSON.stringify({
          type: "reply-manual-review-admin",
          replyId: reply.id,
          topicId: reply.topicId,
          reason: reply.aiReviewReason,
          riskScore: reply.aiRiskScore,
        }),
      })),
    }).catch(() => {});
  }
}

export async function refreshTopicSubmissionLock(userId: number) {
  const pending = await prisma.topic.count({
    where: {
      authorId: userId,
      aiReviewStatus: { in: ["manual_requested", "manual_reviewing"] },
    },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { topicSubmissionLocked: pending > 0 },
  }).catch(() => {});
}

export async function notifyTopicAiBlocked(input: {
  topicId: number;
  userId: number;
  title: string;
  reason: string;
  riskScore: number;
}) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      category: "system",
      level: "warning",
      title: "稿件未通过 AI 初审",
      content: `${input.title}：${input.reason}`,
      source: "AI 审核",
      link: `/forum/topic/${input.topicId}`,
      payload: JSON.stringify({
        type: "topic-ai-blocked",
        topicId: input.topicId,
        title: input.title,
        reason: input.reason,
        riskScore: input.riskScore,
      }),
    },
  }).catch(() => {});
}

async function createAiReviewNotifications(topicId: number, userId: number) {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, title: true, aiReviewReason: true, aiRiskScore: true },
  });
  if (!topic) return;
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "normal",
      title: "已提交人工审核申请",
      content: "审核期间不能继续投递新稿件，请等待管理员处理。",
      source: "AI 审核",
      link: `/forum/topic/${topic.id}`,
      payload: JSON.stringify({
        type: "topic-manual-review-pending",
        topicId: topic.id,
        title: topic.title,
        reason: topic.aiReviewReason,
        riskScore: topic.aiRiskScore,
      }),
    },
  }).catch(() => {});

  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["admin", "mod"] }, status: "active" },
    select: { id: true },
  });
  if (!reviewers.length) return;
  await prisma.notification.createMany({
    data: reviewers.map((reviewer) => ({
      userId: reviewer.id,
      category: "system",
      level: "normal",
      title: "有新的稿件待人工审核",
      content: topic.title,
      source: "AI 审核",
      payload: JSON.stringify({
        type: "topic-manual-review-admin",
        topicId: topic.id,
        title: topic.title,
        reason: topic.aiReviewReason,
        riskScore: topic.aiRiskScore,
      }),
    })),
  }).catch(() => {});
}

export async function notifyManualReviewDecision(input: {
  topicId: number;
  userId: number;
  approved: boolean;
  title: string;
  note?: string | null;
}) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      category: "system",
      level: input.approved ? "normal" : "warning",
      title: input.approved ? "你的稿件已通过人工审核" : "你的稿件未通过人工审核",
      content: input.note?.trim() || input.title,
      source: "站务审核",
      link: `/forum/topic/${input.topicId}`,
      payload: JSON.stringify({
        type: "topic-manual-review-result",
        topicId: input.topicId,
        title: input.title,
        approved: input.approved,
        note: input.note || "",
      }),
    },
  }).catch(() => {});
}

export async function notifyManualReplyReviewDecision(input: {
  replyId: number;
  topicId: number;
  userId: number;
  approved: boolean;
  content: string;
  note?: string | null;
}) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      category: "system",
      level: input.approved ? "normal" : "warning",
      title: input.approved ? "你的回复已通过人工审核" : "你的回复未通过人工审核",
      content: input.note?.trim() || input.content.slice(0, 80),
      source: "站务审核",
      link: `/forum/topic/${input.topicId}`,
      payload: JSON.stringify({
        type: "reply-manual-review-result",
        replyId: input.replyId,
        topicId: input.topicId,
        approved: input.approved,
        note: input.note || "",
      }),
    },
  }).catch(() => {});
}

export async function resolveTopicManualReviewAdminNotifications(input: {
  topicId: number;
  approved: boolean;
  note?: string | null;
}) {
  const payload = JSON.stringify({
    type: "topic-manual-review-admin-resolved",
    topicId: input.topicId,
    approved: input.approved,
    note: input.note || "",
  });
  await prisma.notification.updateMany({
    where: {
      category: "system",
      source: "AI 审核",
      title: "有新的稿件待人工审核",
      AND: [
        { payload: { contains: "\"type\":\"topic-manual-review-admin\"" } },
        { payload: { contains: `"topicId":${input.topicId}` } },
      ],
    },
    data: {
      level: "normal",
      title: input.approved ? "待审稿件已处理" : "待审稿件已驳回",
      readAt: new Date(),
      payload,
    },
  }).catch(() => {});
}

export async function resolveReplyManualReviewAdminNotifications(input: {
  replyId: number;
  approved: boolean;
  note?: string | null;
}) {
  const payload = JSON.stringify({
    type: "reply-manual-review-admin-resolved",
    replyId: input.replyId,
    approved: input.approved,
    note: input.note || "",
  });
  await prisma.notification.updateMany({
    where: {
      category: "system",
      source: "AI 审核",
      title: "有新的回复待人工审核",
      AND: [
        { payload: { contains: "\"type\":\"reply-manual-review-admin\"" } },
        { payload: { contains: `"replyId":${input.replyId}` } },
      ],
    },
    data: {
      level: "normal",
      title: input.approved ? "待审回复已处理" : "待审回复已驳回",
      readAt: new Date(),
      payload,
    },
  }).catch(() => {});
}
