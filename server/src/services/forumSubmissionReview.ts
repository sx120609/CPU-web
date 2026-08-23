import { prisma } from "../prisma";
import { invalidateForumCaches } from "./cacheInvalidation";
import { ensureForumImageAssetsForContent } from "./imageModeration";
import { ensureForumVideoAssetsForContent } from "./videoModeration";
import { refreshBoardTopicCounts, refreshUserPostCount } from "./forumStats";
import { forumReviewSnapshotWhere, parseTopicEditReviewContext, type TopicEditReviewContext } from "./forumSubmission";
import {
  evaluateTopicEditSimilarity,
  generateTopicAiTags,
  notifyTopicAiBlocked,
  reviewReplyContent,
  reviewTopicContent,
  syncTopicAiTags,
} from "./topicAiReview";

const POLL_INTERVAL_MS = 5_000;
const POLL_BATCH_SIZE = 20;
const MAX_CONCURRENT_REVIEWS = 2;
const RETRY_DELAY_MS = 30_000;
const MAX_REVIEW_ATTEMPTS = 3;
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
  const retryBefore = new Date(Date.now() - RETRY_DELAY_MS);
  const [topics, replies] = await Promise.all([
    prisma.topic.findMany({
      where: {
        aiReviewStatus: "checking",
        hidden: true,
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: retryBefore } }],
      },
      orderBy: { createdAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true },
    }),
    prisma.reply.findMany({
      where: {
        aiReviewStatus: "checking",
        hidden: true,
        OR: [{ aiReviewedAt: null }, { aiReviewedAt: { lte: retryBefore } }],
      },
      orderBy: { createdAt: "asc" },
      take: POLL_BATCH_SIZE,
      select: { id: true },
    }),
  ]);
  topics.forEach((topic) => scheduleTopicSubmissionReview(topic.id));
  replies.forEach((reply) => scheduleReplySubmissionReview(reply.id));
}

async function processTopicSubmissionReview(topicId: number) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, aiReviewStatus: "checking", hidden: true },
    include: {
      board: { select: { id: true, name: true, type: true } },
    },
  });
  if (!topic) return;
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
    const finalized = await prisma.$transaction(async (tx) => {
      const updated = await tx.topic.updateMany({
        where: forumReviewSnapshotWhere(topic.id, topic.updatedAt),
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
      await Promise.all([
        refreshUserPostCount(topic.authorId, tx),
        refreshBoardTopicCounts([topic.boardId], tx),
      ]);
      return true;
    });
    if (!finalized) return;

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

    await Promise.all([
      runNonCriticalSideEffect(`topic ${topic.id} media registration`, () => registerTopicMedia(topic.content, topic.authorId)),
      runNonCriticalSideEffect(`topic ${topic.id} AI tags`, () => generateAndSyncTopicTags(topic)),
      runNonCriticalSideEffect(`topic ${topic.id} course rating`, () => createCourseRatingIfNeeded(topic, metadata)),
      notifySubmissionResult({
        userId: topic.authorId,
        title: "你的帖子已通过审核并发布",
        content: topic.title,
        link: `/forum/topic/${topic.id}`,
        payload: { type: "topic-submission-published", topicId: topic.id, submissionId: topic.submissionId },
      }),
    ]);
    await invalidateForumCaches({ includeCourses: topic.board.type === "coursereview" }).catch(() => undefined);
  } catch (error) {
    await failTopicSubmissionReview(topicId, error, topic.updatedAt);
  }
}

async function processReplySubmissionReview(replyId: number) {
  const reply = await prisma.reply.findFirst({
    where: { id: replyId, aiReviewStatus: "checking", hidden: true },
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
  const result = await reviewReplyContent({
    topicTitle: reply.topic.title,
    boardName: reply.topic.board.name,
    boardType: reply.topic.board.type,
    content: reply.content,
    parentContent: reply.parentReply?.content || "",
  });
  const blocked = result.status === "blocked_ai";
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
      where: { id: reply.id, aiReviewStatus: "checking", hidden: true },
      data: {
        aiReviewStatus: result.status,
        aiRiskLevel: result.riskLevel,
        aiRiskScore: result.riskScore,
        aiReviewReason: result.reason,
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

  await Promise.all([
    runNonCriticalSideEffect(`reply ${reply.id} media registration`, () => registerReplyMedia(reply.content, reply.authorId)),
    runNonCriticalSideEffect(`reply ${reply.id} notifications`, () => createReplyNotifications(reply, floor)),
    notifySubmissionResult({
      userId: reply.authorId,
      title: "你的回复已通过审核并发布",
      content: reply.content.slice(0, 80),
      link: `/forum/topic/${reply.topicId}#reply-${reply.id}`,
      payload: { type: "reply-submission-published", replyId: reply.id, topicId: reply.topicId, submissionId: reply.submissionId },
    }),
  ]);
  await invalidateForumCaches().catch(() => undefined);
}

async function failTopicSubmissionReview(topicId: number, error: unknown, expectedUpdatedAt?: Date) {
  const reason = reviewFailureReason(error);
  const snapshotWhere = expectedUpdatedAt
    ? forumReviewSnapshotWhere(topicId, expectedUpdatedAt)
    : { id: topicId, aiReviewStatus: "checking", hidden: true } as const;
  const current = await prisma.topic.findFirst({
    where: snapshotWhere,
    select: { authorId: true, title: true, submissionId: true, aiReviewDetail: true },
  });
  if (!current) return;
  const attempt = reviewAttempt(current.aiReviewDetail) + 1;
  if (attempt < MAX_REVIEW_ATTEMPTS) {
    await prisma.topic.updateMany({
      where: snapshotWhere,
      data: {
        aiReviewReason: `${reason}，系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
        aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail),
        aiReviewedAt: new Date(),
      },
    }).catch(() => undefined);
    return;
  }
  const updated = await prisma.topic.updateMany({
    where: snapshotWhere,
    data: { aiReviewStatus: "review_failed", aiReviewReason: reason, aiReviewDetail: attemptDetail(attempt, error, current.aiReviewDetail), aiReviewedAt: new Date() },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await notifySubmissionResult({
    userId: current.authorId,
    title: "帖子审核暂未完成",
    content: `${current.title}：${reason}`,
    link: `/forum/post/${topicId}/edit`,
    level: "warning",
    payload: { type: "topic-submission-failed", topicId, submissionId: current.submissionId },
  });
}

async function failReplySubmissionReview(replyId: number, error: unknown) {
  const reason = reviewFailureReason(error);
  const current = await prisma.reply.findFirst({
    where: { id: replyId, aiReviewStatus: "checking", hidden: true },
    select: { authorId: true, topicId: true, submissionId: true, aiReviewDetail: true },
  });
  if (!current) return;
  const attempt = reviewAttempt(current.aiReviewDetail) + 1;
  if (attempt < MAX_REVIEW_ATTEMPTS) {
    await prisma.reply.updateMany({
      where: { id: replyId, aiReviewStatus: "checking", hidden: true },
      data: {
        aiReviewReason: `${reason}，系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
        aiReviewDetail: attemptDetail(attempt, error),
        aiReviewedAt: new Date(),
      },
    }).catch(() => undefined);
    return;
  }
  const updated = await prisma.reply.updateMany({
    where: { id: replyId, aiReviewStatus: "checking", hidden: true },
    data: { aiReviewStatus: "review_failed", aiReviewReason: reason, aiReviewDetail: attemptDetail(attempt, error), aiReviewedAt: new Date() },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return;
  await notifySubmissionResult({
    userId: current.authorId,
    title: "回复审核暂未完成",
    content: reason,
    link: `/forum/topic/${current.topicId}`,
    level: "warning",
    payload: { type: "reply-submission-failed", replyId, topicId: current.topicId, submissionId: current.submissionId },
  });
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
  return message.includes("超时") || message.includes("timeout")
    ? "审核服务响应超时，请稍后重新提交"
    : "审核服务暂时不可用，请稍后重新提交";
}

function reviewAttempt(detail: string | null | undefined) {
  const editContext = parseTopicEditReviewContext(detail);
  if (editContext) return editContext.attempt;
  const match = String(detail || "").match(/^\[attempt:(\d+)\]/);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

function attemptDetail(attempt: number, error: unknown, previousDetail?: string | null) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "unknown error");
  const editContext = parseTopicEditReviewContext(previousDetail);
  if (editContext) {
    return JSON.stringify({
      ...editContext,
      attempt,
      lastError: detail.slice(0, 500),
    } satisfies TopicEditReviewContext);
  }
  return `[attempt:${attempt}] ${detail}`.slice(0, 4000);
}
