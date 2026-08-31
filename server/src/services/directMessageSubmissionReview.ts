import { prisma } from "../prisma";
import { directCounterpartId, directParticipantAlias } from "./directMessagePolicy";
import {
  directMessageModerationFailure,
  isDirectMessageReviewUnavailable,
} from "./directMessageModeration";
import { reviewDirectMessageContent } from "./topicAiReview";

const POLL_INTERVAL_MS = 5_000;
const POLL_BATCH_SIZE = 20;
const MAX_CONCURRENT_REVIEWS = 2;
const RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const;
const MAX_REVIEW_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const activeReviews = new Set<number>();
let pollerStarted = false;

export function scheduleDirectMessageSubmissionReview(messageId: number) {
  if (!Number.isInteger(messageId) || messageId <= 0 || activeReviews.has(messageId) || activeReviews.size >= MAX_CONCURRENT_REVIEWS) return;
  activeReviews.add(messageId);
  setTimeout(() => {
    void processDirectMessageSubmissionReview(messageId)
      .catch((error) => failDirectMessageSubmissionReview(messageId, error))
      .catch((error) => console.warn(`[direct-message-review] ${messageId} failure handler failed`, error instanceof Error ? error.message : error))
      .finally(() => activeReviews.delete(messageId));
  }, 0).unref?.();
}

export function startDirectMessageSubmissionReviewPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const scan = () => {
    void recoverPendingDirectMessages().catch((error) => {
      console.warn("[direct-message-review] pending scan failed", error instanceof Error ? error.message : error);
    });
  };
  setTimeout(scan, 0).unref?.();
  setInterval(scan, POLL_INTERVAL_MS).unref?.();
}

export async function recoverPendingDirectMessages(now = Date.now()) {
  const rows = await prisma.directMessage.findMany({
    where: {
      aiReviewStatus: "checking",
      hidden: true,
      OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: new Date(now - RETRY_DELAYS_MS[0]) } }],
    },
    orderBy: { aiReviewedAt: "asc" },
    take: POLL_BATCH_SIZE,
    select: { id: true, aiReviewDetail: true, aiReviewedAt: true },
  });
  rows
    .filter((row) => directMessageReviewRetryDue(row.aiReviewDetail, row.aiReviewedAt, now))
    .forEach((row) => scheduleDirectMessageSubmissionReview(row.id));
}

export function directMessageReviewAttempt(detail: string | null | undefined) {
  const matched = String(detail || "").match(/\[attempt:(\d+)\]/);
  return matched ? Math.max(0, Number(matched[1]) || 0) : 0;
}

export function directMessageReviewRetryDelayMs(attempt: number) {
  if (attempt <= 0) return 0;
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

export function directMessageReviewRetryDue(
  detail: string | null | undefined,
  reviewedAt: Date | string | null | undefined,
  now = Date.now(),
) {
  if (!reviewedAt) return true;
  const reviewedAtMs = new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedAtMs)) return true;
  return reviewedAtMs + directMessageReviewRetryDelayMs(directMessageReviewAttempt(detail)) <= now;
}

async function processDirectMessageSubmissionReview(messageId: number) {
  const message = await prisma.directMessage.findFirst({
    where: { id: messageId, aiReviewStatus: "checking", hidden: true },
    include: {
      conversation: true,
      sender: { select: { nickname: true } },
    },
  });
  if (!message) return;

  const result = await reviewDirectMessageContent({ content: message.content, createdById: message.senderId });
  if (isDirectMessageReviewUnavailable(result)) {
    throw new Error(directMessageModerationFailure(result) || "私聊内容审核服务暂不可用");
  }
  const blocked = result.status === "blocked_ai";
  const recipientId = directCounterpartId(message.conversation, message.senderId);
  const finalized = await prisma.$transaction(async (tx) => {
    const updated = await tx.directMessage.updateMany({
      where: { id: message.id, aiReviewStatus: "checking", hidden: true },
      data: {
        aiReviewStatus: result.status,
        aiRiskLevel: result.riskLevel,
        aiRiskScore: result.riskScore,
        aiReviewReason: result.reason,
        aiReviewDetail: result.detail,
        aiModel: result.model,
        aiReviewedAt: new Date(),
        hidden: blocked,
      },
    });
    if (updated.count !== 1) return false;
    if (blocked) return true;

    await tx.$executeRaw`
      UPDATE "DirectConversation"
      SET
        "lastMessageAt" = GREATEST("lastMessageAt", ${message.createdAt}),
        "recipientRepliedAt" = CASE
          WHEN "initiatedById" <> ${message.senderId} AND "recipientRepliedAt" IS NULL THEN ${message.createdAt}
          ELSE "recipientRepliedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${message.conversationId}
    `;
    await tx.notification.create({
      data: {
        userId: recipientId,
        category: "direct-message",
        level: "normal",
        title: `${directParticipantAlias(message.conversation, message.senderId) || message.sender.nickname || "有用户"} 发来私聊`,
        content: "有一条新私聊消息，进入站内私聊查看。",
        link: `/messages?tab=private&conversation=${message.conversationId}`,
        source: "站内私聊",
        payload: JSON.stringify({ type: "direct-message", conversationId: message.conversationId, messageId: message.id }),
      },
    });
    return true;
  });
  if (!finalized || !blocked) return;
  await notifySender(message.senderId, {
    title: "你的私聊消息未通过审核",
    content: result.reason,
    link: `/messages?tab=private&conversation=${message.conversationId}`,
    payload: { type: "direct-message-review-blocked", conversationId: message.conversationId, messageId: message.id },
  });
}

async function failDirectMessageSubmissionReview(messageId: number, error: unknown) {
  const current = await prisma.directMessage.findFirst({
    where: { id: messageId, aiReviewStatus: "checking", hidden: true },
    select: { senderId: true, conversationId: true, aiReviewDetail: true },
  });
  if (!current) return;
  const attempt = directMessageReviewAttempt(current.aiReviewDetail) + 1;
  const reason = /超时|timeout/i.test(error instanceof Error ? error.message : String(error || ""))
    ? "AI 审核服务响应超时"
    : "AI 审核服务暂时不可用";
  const detail = `[attempt:${attempt}] ${error instanceof Error ? `${error.name}: ${error.message}` : String(error || "unknown error")}`.slice(0, 4000);
  const finalFailure = attempt >= MAX_REVIEW_ATTEMPTS;
  const updated = await prisma.directMessage.updateMany({
    where: { id: messageId, aiReviewStatus: "checking", hidden: true },
    data: {
      aiReviewStatus: finalFailure ? "review_failed" : "checking",
      aiReviewReason: finalFailure
        ? `${reason}；已自动重试 ${attempt} 次，请稍后重新发送。`
        : `${reason}；这不代表内容违规，系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
      aiReviewDetail: detail,
      aiReviewedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1 || (attempt !== 1 && !finalFailure)) return;
  await notifySender(current.senderId, {
    title: finalFailure ? "私聊消息审核未完成" : "私聊消息正在自动重试审核",
    content: finalFailure
      ? "AI 审核服务持续不可用，这不代表内容违规。请稍后重新发送。"
      : "消息已经安全保存且尚未发送给对方；AI 审核恢复后会自动继续。",
    link: `/messages?tab=private&conversation=${current.conversationId}`,
    payload: { type: finalFailure ? "direct-message-review-failed" : "direct-message-review-outage", conversationId: current.conversationId, messageId },
  });
}

async function notifySender(userId: number, input: {
  title: string;
  content: string;
  link: string;
  payload: Record<string, unknown>;
}) {
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "warning",
      title: input.title,
      content: input.content,
      link: input.link,
      source: "AI 审核",
      payload: JSON.stringify(input.payload),
    },
  }).catch(() => undefined);
}
