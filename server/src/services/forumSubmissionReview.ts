import { prisma } from "../prisma";
import { invalidateForumCaches } from "./cacheInvalidation";
import { ensureForumImageAssetsForContent } from "./imageModeration";
import { ensureForumVideoAssetsForContent } from "./videoModeration";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import {
  AUTO_MANUAL_RETRY_MARKER,
  forumReviewAttempt,
  isAutomaticManualReviewRetry,
  parseTopicEditReviewContext,
  type TopicEditReviewContext,
} from "./forumSubmission";
import {
  evaluateTopicEditSimilarity,
  generateTopicAiTags,
  notifyTopicAiBlocked,
  resolveReplyManualReviewAdminNotifications,
  resolveTopicManualReviewAdminNotifications,
  reviewReplyContent,
  reviewTopicContent,
  syncTopicAiTags,
} from "./topicAiReview";

const POLL_INTERVAL_MS = 5_000;
const POLL_BATCH_SIZE = 20;
const MAX_CONCURRENT_REVIEWS = 2;
const RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const;
const MAX_REVIEW_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const AUTO_MANUAL_RETRY_DELAY_MS = 30 * 60_000;
const activeTopicReviews = new Set<number>();
const activeReplyReviews = new Set<number>();
let pollerStarted = false;

export function scheduleTopicSubmissionReview(topicId: number) {
  if (
    !Number.isInteger(topicId)
    || topicId <= 0
    || activeTopicReviews.has(topicId)
    || activeTopicReviews.size + activeReplyReviews.size >= MAX_CONCURRENT_REVIEWS
  ) return;
  activeTopicReviews.add(topicId);
  setTimeout(() => {
    void processTopicSubmissionReview(topicId)
      .catch((error) => console.warn(`[forum-review] topic ${topicId} processing failed`, error instanceof Error ? error.message : error))
      .finally(() => activeTopicReviews.delete(topicId));
  }, 0).unref?.();
}

export function scheduleReplySubmissionReview(replyId: number) {
  if (
    !Number.isInteger(replyId)
    || replyId <= 0
    || activeReplyReviews.has(replyId)
    || activeTopicReviews.size + activeReplyReviews.size >= MAX_CONCURRENT_REVIEWS
  ) return;
  activeReplyReviews.add(replyId);
  setTimeout(() => {
    void processReplySubmissionReview(replyId)
      .catch((error) => failReplySubmissionReview(replyId, error))
      .catch((error) => console.warn(`[forum-review] reply ${replyId} failure handler failed`, error instanceof Error ? error.message : error))
      .finally(() => activeReplyReviews.delete(replyId));
  }, 0).unref?.();
}

export function startForumSubmissionReviewPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const scan = () => {
    void recoverPendingForumSubmissions().catch((error) => {
      console.warn("[forum-review] pending submission scan failed", error instanceof Error ? error.message : error);
    });
  };
  setTimeout(scan, 0).unref?.();
  setInterval(scan, POLL_INTERVAL_MS).unref?.();
}

export async function recoverPendingForumSubmissions() {
  const now = Date.now();
  const retryBefore = new Date(now - RETRY_DELAYS_MS[0]);
  const automaticManualRetryBefore = new Date(now - AUTO_MANUAL_RETRY_DELAY_MS);
  const [checkingTopics, checkingReplies, automaticManualTopics, automaticManualReplies, failedTopics, failedReplies] = await Promise.all([
    prisma.topic.findMany({
      where: {
        aiReviewStatus: "checking",
        hidden: true,
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: retryBefore } }],
      },
      orderBy: { aiReviewedAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, aiReviewDetail: true, aiReviewedAt: true },
    }),
    prisma.reply.findMany({
      where: {
        aiReviewStatus: "checking",
        hidden: true,
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: retryBefore } }],
      },
      orderBy: { aiReviewedAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, aiReviewDetail: true, aiReviewedAt: true },
    }),
    prisma.topic.findMany({
      where: {
        aiReviewStatus: "manual_requested",
        hidden: true,
        aiReviewDetail: { contains: AUTO_MANUAL_RETRY_MARKER },
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: automaticManualRetryBefore } }],
      },
      orderBy: { aiReviewedAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, aiReviewDetail: true, aiReviewedAt: true },
    }),
    prisma.reply.findMany({
      where: {
        aiReviewStatus: "manual_requested",
        hidden: true,
        aiReviewDetail: { contains: AUTO_MANUAL_RETRY_MARKER },
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: automaticManualRetryBefore } }],
      },
      orderBy: { aiReviewedAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, aiReviewDetail: true, aiReviewedAt: true },
    }),
    prisma.topic.findMany({
      where: { aiReviewStatus: "review_failed", hidden: true },
      orderBy: { createdAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, authorId: true, title: true, submissionId: true },
    }),
    prisma.reply.findMany({
      where: { aiReviewStatus: "review_failed", hidden: true },
      orderBy: { createdAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true, authorId: true, topicId: true, submissionId: true },
    }),
  ]);
  checkingTopics
    .filter((item) => forumReviewRetryDue(item.aiReviewDetail, item.aiReviewedAt, false, now))
    .forEach((topic) => scheduleTopicSubmissionReview(topic.id));
  checkingReplies
    .filter((item) => forumReviewRetryDue(item.aiReviewDetail, item.aiReviewedAt, false, now))
    .forEach((reply) => scheduleReplySubmissionReview(reply.id));
  automaticManualTopics
    .filter((item) => forumReviewRetryDue(item.aiReviewDetail, item.aiReviewedAt, true, now))
    .forEach((topic) => scheduleTopicSubmissionReview(topic.id));
  automaticManualReplies
    .filter((item) => forumReviewRetryDue(item.aiReviewDetail, item.aiReviewedAt, true, now))
    .forEach((reply) => scheduleReplySubmissionReview(reply.id));

  await Promise.all([
    ...failedTopics.map((topic) => resumeFailedTopicReview(topic)),
    ...failedReplies.map((reply) => resumeFailedReplyReview(reply)),
  ]);
}

export function forumReviewRetryDelayMs(attempt: number, automaticManual = false) {
  if (automaticManual) return AUTO_MANUAL_RETRY_DELAY_MS;
  if (attempt <= 0) return 0;
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

export function forumReviewRetryDue(
  detail: string | null | undefined,
  reviewedAt: Date | string | null | undefined,
  automaticManual = false,
  now = Date.now(),
) {
  if (!reviewedAt) return true;
  const reviewedAtMs = new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedAtMs)) return true;
  return reviewedAtMs + forumReviewRetryDelayMs(forumReviewAttempt(detail), automaticManual) <= now;
}

async function processTopicSubmissionReview(topicId: number) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, aiReviewStatus: { in: ["checking", "manual_requested"] }, hidden: true },
    include: {
      board: { select: { id: true, name: true, type: true } },
    },
  });
  if (!topic) return;
  const automaticManualRetry = topic.aiReviewStatus === "manual_requested" && isAutomaticManualReviewRetry(topic.aiReviewDetail);
  if (topic.aiReviewStatus === "manual_requested" && !automaticManualRetry) return;
  try {
    const metadata = parseJsonObject(topic.metadata);
    const editContext = parseTopicEditReviewContext(topic.aiReviewDetail);
    let result: Awaited<ReturnType<typeof reviewTopicContent>>;
    if (editContext && editContext.similarityThreshold > 0) {
      const similarity = await evaluateTopicEditSimilarity({
        originalTitle: editContext.originalTitle,
        originalContent: editContext.originalContent,
        updatedTitle: topic.title,
        updatedContent: topic.content,
      });
      if (similarity.similarity < editContext.similarityThreshold) {
        const riskScore = Math.round((1 - similarity.similarity) * 100);
        const reasonSuffix = similarity.reason ? `：${similarity.reason}` : "";
        result = {
          status: "blocked_ai",
          riskLevel: riskScore >= 80 ? "high" : "medium",
          riskScore,
          reason: `修改后的内容与原内容相似度过低（${Math.round(similarity.similarity * 100)}%），未达到站点要求${reasonSuffix}`.slice(0, 120),
          detail: JSON.stringify({
            kind: "topic-edit-similarity",
            similarity: similarity.similarity,
            threshold: editContext.similarityThreshold,
            reason: similarity.reason,
            detail: similarity.detail,
          }),
          model: similarity.model,
        };
      } else {
        result = await reviewTopicContent({
          title: topic.title,
          content: topic.content,
          boardName: topic.board.name,
          boardType: topic.board.type,
          metadata,
        });
      }
    } else {
      result = await reviewTopicContent({
        title: topic.title,
        content: topic.content,
        boardName: topic.board.name,
        boardType: topic.board.type,
        metadata,
      });
    }
    const blocked = result.status === "blocked_ai";
    const remainsInManualReview = automaticManualRetry && blocked;
    const snapshotWhere = forumReviewSnapshot(topic.id, topic.updatedAt, topic.aiReviewStatus);
    const finalized = await prisma.$transaction(async (tx) => {
      const updated = await tx.topic.updateMany({
        where: snapshotWhere,
        data: {
          aiReviewStatus: remainsInManualReview ? "manual_requested" : result.status,
          aiRiskLevel: result.riskLevel,
          aiRiskScore: result.riskScore,
          aiReviewReason: remainsInManualReview
            ? `AI 审核服务已恢复，但自动初审仍建议人工复核：${result.reason}`.slice(0, 500)
            : result.reason,
          aiReviewDetail: result.detail,
          aiModel: result.model,
          aiReviewedAt: new Date(),
          hidden: blocked,
        },
      });
      if (updated.count !== 1) return false;
      await Promise.all([
        refreshUserPostCount(topic.authorId, tx),
        refreshBoardTopicCounts([topic.boardId], tx),
      ]);
      return true;
    });
    if (!finalized) return;

    if (remainsInManualReview) {
      await notifySubmissionResult({
        userId: topic.authorId,
        title: "AI 审核服务已恢复，帖子仍等待人工复核",
        content: `系统已经完成自动初审，但认为仍需管理员确认：${result.reason}`,
        link: `/forum/topic/${topic.id}`,
        level: "warning",
        payload: { type: "topic-ai-recovered-manual-pending", topicId: topic.id, submissionId: topic.submissionId },
      });
      await invalidateForumCaches({ includeCourses: topic.board.type === "coursereview" }).catch(() => undefined);
      return;
    }

    if (blocked) {
      await notifyTopicAiBlocked({
        topicId: topic.id,
        userId: topic.authorId,
        title: topic.title,
        reason: result.reason,
        riskScore: result.riskScore,
      }).catch(() => undefined);
      await invalidateForumCaches({ includeCourses: topic.board.type === "coursereview" });
      return;
    }

    if (automaticManualRetry) {
      await resolveTopicManualReviewAdminNotifications({
        topicId: topic.id,
        approved: true,
        note: "AI 审核服务恢复后自动审核通过",
      });
    }

    await Promise.all([
      runNonCriticalSideEffect(`topic ${topic.id} media registration`, () => registerTopicMedia(topic.content, topic.authorId)),
      runNonCriticalSideEffect(`topic ${topic.id} AI tags`, () => generateAndSyncTopicTags(topic)),
      runNonCriticalSideEffect(`topic ${topic.id} course rating`, () => createCourseRatingIfNeeded(topic, metadata)),
    ]);
    await invalidateForumCaches({ includeCourses: topic.board.type === "coursereview" }).catch(() => undefined);
  } catch (error) {
    await failTopicSubmissionReview(topicId, error, topic.updatedAt);
  }
}

async function processReplySubmissionReview(replyId: number) {
  const reply = await prisma.reply.findFirst({
    where: { id: replyId, aiReviewStatus: { in: ["checking", "manual_requested"] }, hidden: true },
    include: {
      topic: {
        include: {
          board: { select: { name: true, type: true } },
        },
      },
      parentReply: { select: { id: true, authorId: true, content: true } },
    },
  });
  if (!reply) return;
  const automaticManualRetry = reply.aiReviewStatus === "manual_requested" && isAutomaticManualReviewRetry(reply.aiReviewDetail);
  if (reply.aiReviewStatus === "manual_requested" && !automaticManualRetry) return;
  const result = await reviewReplyContent({
    topicTitle: reply.topic.title,
    boardName: reply.topic.board.name,
    boardType: reply.topic.board.type,
    content: reply.content,
    parentContent: reply.parentReply?.content || "",
  });
  const blocked = result.status === "blocked_ai";
  const remainsInManualReview = automaticManualRetry && blocked;
  let floor = 0;
  const finalized = await prisma.$transaction(async (tx) => {
    if (!blocked) {
      // Serialize floor allocation and topic counters on the topic row.
      await tx.topic.update({
        where: { id: reply.topicId },
        data: { replyCount: { increment: 0 } },
      });
      const last = await tx.reply.findFirst({
        where: { topicId: reply.topicId, hidden: false },
        orderBy: { floor: "desc" },
        select: { floor: true },
      });
      floor = (last?.floor || 0) + 1;
    }
    const updated = await tx.reply.updateMany({
      where: forumReviewStatusSnapshot(reply.id, reply.aiReviewStatus),
      data: {
        aiReviewStatus: remainsInManualReview ? "manual_requested" : result.status,
        aiRiskLevel: result.riskLevel,
        aiRiskScore: result.riskScore,
        aiReviewReason: remainsInManualReview
          ? `AI 审核服务已恢复，但自动初审仍建议人工复核：${result.reason}`.slice(0, 500)
          : result.reason,
        aiReviewDetail: result.detail,
        aiModel: result.model,
        aiReviewedAt: new Date(),
        hidden: blocked,
        floor,
      },
    });
    if (updated.count !== 1) return false;
    if (!blocked) {
      await tx.topic.update({
        where: { id: reply.topicId },
        data: {
          replyCount: { increment: 1 },
          lastReplyAt: reply.createdAt,
          lastReplyById: reply.authorId,
        },
      });
      await tx.user.update({ where: { id: reply.authorId }, data: { replyCount: { increment: 1 } } });
    }
    return true;
  });
  if (!finalized) return;

  if (remainsInManualReview) {
    await notifySubmissionResult({
      userId: reply.authorId,
      title: "AI 审核服务已恢复，回复仍等待人工复核",
      content: `系统已经完成自动初审，但认为仍需管理员确认：${result.reason}`,
      link: `/forum/topic/${reply.topicId}#reply-${reply.id}`,
      level: "warning",
      payload: { type: "reply-ai-recovered-manual-pending", replyId: reply.id, topicId: reply.topicId, submissionId: reply.submissionId },
    });
    await invalidateForumCaches().catch(() => undefined);
    return;
  }

  if (blocked) {
    await notifySubmissionResult({
      userId: reply.authorId,
      title: "你的回复暂未通过审核",
      content: result.reason,
      link: `/forum/topic/${reply.topicId}`,
      level: "warning",
      payload: { type: "reply-submission-blocked", replyId: reply.id, topicId: reply.topicId, submissionId: reply.submissionId },
    });
    await invalidateForumCaches();
    return;
  }

  if (automaticManualRetry) {
    await resolveReplyManualReviewAdminNotifications({
      replyId: reply.id,
      approved: true,
      note: "AI 审核服务恢复后自动审核通过",
    });
  }

  await Promise.all([
    runNonCriticalSideEffect(`reply ${reply.id} media registration`, () => registerReplyMedia(reply.content, reply.authorId)),
    runNonCriticalSideEffect(`reply ${reply.id} notifications`, () => createReplyNotifications(reply, floor)),
  ]);
  await invalidateForumCaches().catch(() => undefined);
}

async function failTopicSubmissionReview(topicId: number, error: unknown, expectedUpdatedAt?: Date) {
  const reason = reviewFailureReason(error);
  const current = await prisma.topic.findFirst({
    where: { id: topicId, aiReviewStatus: { in: ["checking", "manual_requested"] }, hidden: true },
    select: { authorId: true, title: true, submissionId: true, aiReviewStatus: true, aiReviewDetail: true, updatedAt: true },
  });
  if (!current) return;
  if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return;
  const automaticManualRetry = current.aiReviewStatus === "manual_requested" && isAutomaticManualReviewRetry(current.aiReviewDetail);
  if (current.aiReviewStatus === "manual_requested" && !automaticManualRetry) return;
  const attempt = forumReviewAttempt(current.aiReviewDetail) + 1;
  const snapshotWhere = forumReviewSnapshot(topicId, current.updatedAt, current.aiReviewStatus);

  if (!automaticManualRetry && attempt < MAX_REVIEW_ATTEMPTS) {
    const updated = await prisma.topic.updateMany({
      where: snapshotWhere,
      data: {
        aiReviewReason: `${reason}；这不代表内容违规。系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
        aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail),
        aiReviewedAt: new Date(),
      },
    }).catch(() => ({ count: 0 }));
    if (updated.count === 1 && attempt === 1) {
      await notifyInitialReviewOutage({
        kind: "topic",
        userId: current.authorId,
        topicId,
        title: current.title,
        submissionId: current.submissionId,
      });
    }
    return;
  }

  if (automaticManualRetry) {
    await prisma.topic.updateMany({
      where: snapshotWhere,
      data: {
        aiReviewReason: `${reason}；帖子已在人工审核队列中，AI 仍会每 30 分钟自动重试。`,
        aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail, true),
        aiReviewedAt: new Date(),
      },
    }).catch(() => undefined);
    return;
  }

  const updated = await prisma.topic.updateMany({
    where: snapshotWhere,
    data: {
      aiReviewStatus: "manual_requested",
      aiReviewReason: `${reason}；系统已自动重试 ${attempt} 次，现已转入人工审核。AI 恢复前仍会每 30 分钟继续尝试。`,
      aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail, true),
      aiReviewedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await invalidateForumCaches().catch(() => undefined);
  await notifyAutomaticManualQueue({
    kind: "topic",
    id: topicId,
    topicId,
    userId: current.authorId,
    preview: current.title,
    submissionId: current.submissionId,
    attempt,
  });
}

async function failReplySubmissionReview(replyId: number, error: unknown) {
  const reason = reviewFailureReason(error);
  const current = await prisma.reply.findFirst({
    where: { id: replyId, aiReviewStatus: { in: ["checking", "manual_requested"] }, hidden: true },
    select: { authorId: true, topicId: true, content: true, submissionId: true, aiReviewStatus: true, aiReviewDetail: true },
  });
  if (!current) return;
  const automaticManualRetry = current.aiReviewStatus === "manual_requested" && isAutomaticManualReviewRetry(current.aiReviewDetail);
  if (current.aiReviewStatus === "manual_requested" && !automaticManualRetry) return;
  const attempt = forumReviewAttempt(current.aiReviewDetail) + 1;
  const snapshotWhere = forumReviewStatusSnapshot(replyId, current.aiReviewStatus);

  if (!automaticManualRetry && attempt < MAX_REVIEW_ATTEMPTS) {
    const updated = await prisma.reply.updateMany({
      where: snapshotWhere,
      data: {
        aiReviewReason: `${reason}；这不代表内容违规。系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
        aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail),
        aiReviewedAt: new Date(),
      },
    }).catch(() => ({ count: 0 }));
    if (updated.count === 1 && attempt === 1) {
      await notifyInitialReviewOutage({
        kind: "reply",
        userId: current.authorId,
        topicId: current.topicId,
        replyId,
        submissionId: current.submissionId,
      });
    }
    return;
  }

  if (automaticManualRetry) {
    await prisma.reply.updateMany({
      where: snapshotWhere,
      data: {
        aiReviewReason: `${reason}；回复已在人工审核队列中，AI 仍会每 30 分钟自动重试。`,
        aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail, true),
        aiReviewedAt: new Date(),
      },
    }).catch(() => undefined);
    return;
  }

  const updated = await prisma.reply.updateMany({
    where: snapshotWhere,
    data: {
      aiReviewStatus: "manual_requested",
      aiReviewReason: `${reason}；系统已自动重试 ${attempt} 次，现已转入人工审核。AI 恢复前仍会每 30 分钟继续尝试。`,
      aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail, true),
      aiReviewedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await invalidateForumCaches().catch(() => undefined);
  await notifyAutomaticManualQueue({
    kind: "reply",
    id: replyId,
    topicId: current.topicId,
    userId: current.authorId,
    preview: current.content.slice(0, 80),
    submissionId: current.submissionId,
    attempt,
  });
}

async function resumeFailedTopicReview(topic: {
  id: number;
  authorId: number;
  title: string;
  submissionId: string | null;
}) {
  const updated = await prisma.topic.updateMany({
    where: { id: topic.id, aiReviewStatus: "review_failed", hidden: true },
    data: {
      aiReviewStatus: "checking",
      aiReviewReason: "此前因 AI 审核服务异常未能完成，系统现已自动重新排队；这不代表内容违规。",
      aiReviewedAt: null,
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await invalidateForumCaches().catch(() => undefined);
  await notifySubmissionResult({
    userId: topic.authorId,
    title: "系统已重新开始审核你的帖子",
    content: `${topic.title}：此前是审核服务异常，并非内容违规。系统会继续自动重试，必要时自动转入人工审核。`,
    link: `/forum/topic/${topic.id}`,
    payload: { type: "topic-submission-retry-resumed", topicId: topic.id, submissionId: topic.submissionId },
  });
  scheduleTopicSubmissionReview(topic.id);
}

async function resumeFailedReplyReview(reply: {
  id: number;
  authorId: number;
  topicId: number;
  submissionId: string | null;
}) {
  const updated = await prisma.reply.updateMany({
    where: { id: reply.id, aiReviewStatus: "review_failed", hidden: true },
    data: {
      aiReviewStatus: "checking",
      aiReviewReason: "此前因 AI 审核服务异常未能完成，系统现已自动重新排队；这不代表内容违规。",
      aiReviewedAt: null,
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await invalidateForumCaches().catch(() => undefined);
  await notifySubmissionResult({
    userId: reply.authorId,
    title: "系统已重新开始审核你的回复",
    content: "此前是审核服务异常，并非内容违规。系统会继续自动重试，必要时自动转入人工审核。",
    link: `/forum/topic/${reply.topicId}#reply-${reply.id}`,
    payload: { type: "reply-submission-retry-resumed", replyId: reply.id, topicId: reply.topicId, submissionId: reply.submissionId },
  });
  scheduleReplySubmissionReview(reply.id);
}

async function notifyInitialReviewOutage(input: {
  kind: "topic" | "reply";
  userId: number;
  topicId: number;
  replyId?: number;
  title?: string;
  submissionId?: string | null;
}) {
  const target = input.kind === "topic" ? "帖子" : "回复";
  await notifySubmissionResult({
    userId: input.userId,
    title: `AI 审核服务临时异常，${target}正在自动重试`,
    content: `${input.title ? `${input.title}：` : ""}内容已经安全保存，这不代表内容违规。系统将在约 30 分钟内分 7 次自动重试；若仍未恢复，会自动转入人工审核。`,
    link: input.kind === "topic" ? `/forum/topic/${input.topicId}` : `/forum/topic/${input.topicId}#reply-${input.replyId}`,
    level: "warning",
    payload: {
      type: `${input.kind}-submission-review-outage`,
      topicId: input.topicId,
      ...(input.replyId ? { replyId: input.replyId } : {}),
      submissionId: input.submissionId,
    },
  });
}

async function notifyAutomaticManualQueue(input: {
  kind: "topic" | "reply";
  id: number;
  topicId: number;
  userId: number;
  preview: string;
  submissionId?: string | null;
  attempt: number;
}) {
  const target = input.kind === "topic" ? "帖子" : "回复";
  await notifySubmissionResult({
    userId: input.userId,
    title: `AI 审核服务持续异常，${target}已自动转入人工审核`,
    content: `这不是内容违规判定。系统已自动尝试 ${input.attempt} 次，现已加入人工审核队列；在管理员处理前，AI 仍会每 30 分钟继续重试。`,
    link: input.kind === "topic" ? `/forum/topic/${input.topicId}` : `/forum/topic/${input.topicId}#reply-${input.id}`,
    level: "warning",
    payload: {
      type: `${input.kind}-auto-manual-review-pending`,
      topicId: input.topicId,
      ...(input.kind === "reply" ? { replyId: input.id } : {}),
      submissionId: input.submissionId,
    },
  });

  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["admin", "mod"] }, status: "active" },
    select: { id: true },
  });
  if (!reviewers.length) return;
  const notificationType = input.kind === "topic" ? "topic-manual-review-admin" : "reply-manual-review-admin";
  await prisma.notification.createMany({
    data: reviewers.map((reviewer) => ({
      userId: reviewer.id,
      category: "system",
      level: "warning",
      title: input.kind === "topic" ? "有新的稿件待人工审核" : "有新的回复待人工审核",
      content: `${input.preview}（AI 服务异常自动转入，后台仍会继续重试）`,
      source: "AI 审核",
      link: `/forum/topic/${input.topicId}${input.kind === "reply" ? `#reply-${input.id}` : ""}`,
      payload: JSON.stringify({
        type: notificationType,
        topicId: input.topicId,
        ...(input.kind === "reply" ? { replyId: input.id } : {}),
        automatic: true,
      }),
    })),
  }).catch(() => undefined);
}

function forumReviewSnapshot(id: number, updatedAt: Date, aiReviewStatus: string) {
  return { id, updatedAt, hidden: true, aiReviewStatus } as const;
}

function forumReviewStatusSnapshot(id: number, aiReviewStatus: string) {
  return { id, hidden: true, aiReviewStatus } as const;
}

async function generateAndSyncTopicTags(topic: {
  id: number;
  title: string;
  content: string;
  metadata: string;
  board: { name: string; type: string };
}) {
  const tags = await generateTopicAiTags({
    title: topic.title,
    content: topic.content,
    boardName: topic.board.name,
    boardType: topic.board.type,
    metadata: parseJsonObject(topic.metadata),
  });
  await syncTopicAiTags(topic.id, tags);
}

async function registerTopicMedia(content: string, userId: number) {
  await Promise.all([
    ensureForumImageAssetsForContent(content, userId).catch(() => null),
    ensureForumVideoAssetsForContent(content, userId).catch(() => null),
  ]);
}

async function registerReplyMedia(content: string, userId: number) {
  await registerTopicMedia(content, userId);
}

async function createReplyNotifications(reply: {
  id: number;
  topicId: number;
  authorId: number;
  content: string;
  topic: { authorId: number };
  parentReply: { id: number; authorId: number } | null;
}, floor: number) {
  const link = `/forum/topic/${reply.topicId}#reply-${reply.id}`;
  const notifications = [];
  if (reply.parentReply && reply.parentReply.authorId !== reply.authorId) {
    notifications.push({
      userId: reply.parentReply.authorId,
      category: "reply",
      level: "normal",
      title: "有人回复了你的回复",
      content: reply.content.slice(0, 80),
      payload: JSON.stringify({ type: "reply", topicId: reply.topicId, replyId: reply.id, parentReplyId: reply.parentReply.id, floor }),
      link,
      source: "论坛",
    });
  }
  if (reply.topic.authorId !== reply.authorId && reply.topic.authorId !== reply.parentReply?.authorId) {
    notifications.push({
      userId: reply.topic.authorId,
      category: "reply",
      level: "normal",
      title: "有人回复了你的帖子",
      content: reply.content.slice(0, 80),
      payload: JSON.stringify({ type: "reply", topicId: reply.topicId, replyId: reply.id, floor }),
      link,
      source: "论坛",
    });
  }
  if (notifications.length) await prisma.notification.createMany({ data: notifications }).catch(() => undefined);
}

async function createCourseRatingIfNeeded(topic: {
  id: number;
  authorId: number;
  board: { type: string };
}, metadata: Record<string, any>) {
  if (topic.board.type !== "coursereview" || !metadata.courseId || !metadata.ratings) return;
  const courseId = Number(metadata.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) return;
  let courseTeacherId: number | null = null;
  if (metadata.courseTeacherId) {
    const courseTeacher = await prisma.courseTeacher.findFirst({
      where: { id: Number(metadata.courseTeacherId), courseId },
      select: { id: true },
    });
    courseTeacherId = courseTeacher?.id || null;
  } else if (typeof metadata.teacherName === "string" && metadata.teacherName.trim()) {
    const name = metadata.teacherName.trim().slice(0, 40);
    const teacher = await prisma.teacher.upsert({
      where: { name },
      update: {},
      create: { name, createdById: topic.authorId },
    });
    const courseTeacher = await prisma.courseTeacher.upsert({
      where: { courseId_teacherId: { courseId, teacherId: teacher.id } },
      update: {},
      create: { courseId, teacherId: teacher.id, source: "user-add" },
    });
    courseTeacherId = courseTeacher.id;
  }
  const ratings = metadata.ratings;
  await prisma.courseRating.upsert({
    where: { topicId: topic.id },
    update: {},
    create: {
      topicId: topic.id,
      courseId,
      courseTeacherId,
      authorId: topic.authorId,
      difficulty: clampInt(ratings.difficulty, 1, 5),
      reward: clampInt(ratings.reward, 1, 5),
      recommend: clampInt(ratings.recommend, 1, 5),
      givingScore: clampInt(ratings.givingScore ?? ratings.score, 1, 5),
      semester: metadata.semester ?? null,
    },
  });
  await refreshCourseStats(courseId);
}

async function refreshCourseStats(courseId: number) {
  const aggregate = await prisma.courseRating.aggregate({
    where: { courseId },
    _count: true,
    _avg: { difficulty: true, reward: true, recommend: true, givingScore: true },
  });
  await prisma.course.update({
    where: { id: courseId },
    data: {
      ratingCount: aggregate._count,
      avgDifficulty: aggregate._avg.difficulty || 0,
      avgReward: aggregate._avg.reward || 0,
      avgRecommend: aggregate._avg.recommend || 0,
      avgScore: aggregate._avg.givingScore || 0,
    },
  });
}

async function notifySubmissionResult(input: {
  userId: number;
  title: string;
  content: string;
  link: string;
  level?: string;
  payload: Record<string, unknown>;
}) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      category: "system",
      level: input.level || "normal",
      title: input.title,
      content: input.content,
      link: input.link,
      source: "AI 审核",
      payload: JSON.stringify(input.payload),
    },
  }).catch(() => undefined);
}

async function runNonCriticalSideEffect(label: string, task: () => Promise<unknown>) {
  await task().catch((error) => {
    console.warn(`[forum-review] ${label} failed`, error instanceof Error ? error.message : error);
  });
}

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clampInt(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function reviewFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /超时|timeout/i.test(message)
    ? "AI 审核服务响应超时"
    : "AI 审核服务暂时不可用";
}

function attemptDetail(attempt: number, error: unknown, previousDetail?: string | null, automaticManual = false) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "unknown error");
  const editContext = parseTopicEditReviewContext(previousDetail);
  if (editContext) {
    return JSON.stringify({
      ...editContext,
      attempt,
      lastError: detail.slice(0, 500),
      ...(automaticManual || editContext.retryMode === AUTO_MANUAL_RETRY_MARKER
        ? { retryMode: AUTO_MANUAL_RETRY_MARKER }
        : {}),
    } satisfies TopicEditReviewContext);
  }
  const retryMarker = automaticManual || isAutomaticManualReviewRetry(previousDetail)
    ? ` [${AUTO_MANUAL_RETRY_MARKER}]`
    : "";
  return `[attempt:${attempt}]${retryMarker} ${detail}`.slice(0, 4000);
}
