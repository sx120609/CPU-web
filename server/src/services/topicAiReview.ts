import { prisma } from "../prisma";
import { Errors } from "../utils/response";
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

type DeepSeekReviewResponse = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};

const REVIEW_API_URL = "https://api.deepseek.com/chat/completions";

export function shouldBypassAiReview(role: string | null | undefined) {
  return role === "admin" || role === "mod" || role === "bot";
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

  const prompt = buildReviewPrompt(input);
  const response = await fetch(REVIEW_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiReviewApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiReviewModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是校园社区内容安全审核助手。你需要根据用户稿件判断风险，只返回 JSON。请关注违法、辱骂、人身攻击、隐私泄露、联系方式引流、诈骗、色情、诽谤、校园敏感舆情等风险。",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Errors.server(`AI 审核请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
  }
  const json: any = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  const parsed = parseReviewJson(content);
  const riskScore = clampScore(parsed.risk_score);
  const riskLevel = normalizeRiskLevel(parsed.risk_level, riskScore);
  const decision = decideByThreshold(riskScore, config.aiReviewAutoPassScore, config.aiReviewBlockScore);
  return {
    status: decision === "auto_pass" ? "auto_passed" : decision === "block" ? "blocked_ai" : "blocked_ai",
    riskLevel,
    riskScore,
    reason: String(parsed.reason || fallbackReason(riskLevel)).slice(0, 120),
    detail: JSON.stringify({
      modelDecision: parsed.decision ?? "",
      decision,
      categories: parsed.categories ?? {},
      detail: String(parsed.detail || "").slice(0, 1000),
    }),
    model: config.aiReviewModel,
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

  const prompt = [
    "请审核以下校园社区回复，输出 JSON：",
    `{"risk_score":0-100,"risk_level":"low|medium|high","decision":"auto_pass|manual_review|block","reason":"一句短原因","detail":"补充说明","categories":{"violence":0-100,"porn":0-100,"abuse":0-100,"privacy":0-100,"fraud":0-100,"political":0-100,"defamation":0-100,"spam":0-100}}`,
    "",
    `所属帖子标题：${input.topicTitle || ""}`,
    `板块名称：${input.boardName || ""}`,
    `板块类型：${input.boardType || ""}`,
    `引用/上文：${input.parentContent || ""}`,
    `回复内容：${input.content}`,
  ].join("\n");

  const response = await fetch(REVIEW_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiReviewApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiReviewModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是校园社区内容安全审核助手。你需要根据用户回复判断风险，只返回 JSON。请关注违法、辱骂、人身攻击、隐私泄露、联系方式引流、诈骗、色情、诽谤、校园敏感舆情等风险。",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Errors.server(`AI 审核请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
  }
  const json: any = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  const parsed = parseReviewJson(content);
  const riskScore = clampScore(parsed.risk_score);
  const riskLevel = normalizeRiskLevel(parsed.risk_level, riskScore);
  const decision = decideByThreshold(riskScore, config.aiReviewAutoPassScore, config.aiReviewBlockScore);
  return {
    status: decision === "auto_pass" ? "auto_passed" : decision === "block" ? "blocked_ai" : "blocked_ai",
    riskLevel,
    riskScore,
    reason: String(parsed.reason || fallbackReason(riskLevel)).slice(0, 120),
    detail: JSON.stringify({
      modelDecision: parsed.decision ?? "",
      decision,
      categories: parsed.categories ?? {},
      detail: String(parsed.detail || "").slice(0, 1000),
    }),
    model: config.aiReviewModel,
  };
}

function buildReviewPrompt(input: {
  title: string;
  content: string;
  boardName?: string | null;
  boardType?: string | null;
  metadata?: Record<string, any> | null;
}) {
  return [
    "请审核以下校园社区稿件，输出 JSON：",
    `{"risk_score":0-100,"risk_level":"low|medium|high","decision":"auto_pass|manual_review|block","reason":"一句短原因","detail":"补充说明","categories":{"violence":0-100,"porn":0-100,"abuse":0-100,"privacy":0-100,"fraud":0-100,"political":0-100,"defamation":0-100,"spam":0-100}}`,
    "",
    `板块名称：${input.boardName || ""}`,
    `板块类型：${input.boardType || ""}`,
    `标题：${input.title}`,
    `正文：${input.content}`,
    `补充 metadata：${JSON.stringify(input.metadata ?? {})}`,
  ].join("\n");
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

function decideByThreshold(score: number, autoPassScore: number, blockScore: number) {
  if (score < autoPassScore) return "auto_pass";
  if (score >= blockScore) return "block";
  return "manual_review";
}

function fallbackReason(level: TopicAiRiskLevel) {
  if (level === "high") return "检测到较高风险内容";
  if (level === "medium") return "内容存在一定风险，需要人工复核";
  return "风险较低";
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
      link: input.approved ? `/forum/topic/${input.topicId}` : null,
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
