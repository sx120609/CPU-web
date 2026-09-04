import assert from "node:assert/strict";
import test from "node:test";
import {
  FORUM_SELF_VISIBLE_REVIEW_STATUSES,
  encodeTopicEditReviewContext,
  forumContentVisibilityWhere,
  forumReviewSnapshotWhere,
  forumSubmissionResultForReview,
  isForumSubmissionUniqueConflict,
  normalizeForumSubmissionId,
  parseTopicEditReviewContext,
  forumReviewAttempt,
  isAutomaticManualReviewRetry,
  resetForumReviewRetryDetail,
} from "../src/services/forumSubmission";
import {
  containsForumModerationPlaceholder,
  editableForumContentForViewer,
} from "../src/services/forumContentEditing";

test("帖子和回复只向可编辑者返回未替换的原始正文", () => {
  const raw = '<p><img src="/uploads/forum/a.webp"></p>';
  assert.equal(editableForumContentForViewer(raw, 42, { userId: 42, role: "user" }), raw);
  assert.equal(editableForumContentForViewer(raw, 42, { userId: 7, role: "admin" }), raw);
  assert.equal(editableForumContentForViewer(raw, 42, { userId: 8, role: "mod" }), raw);
  assert.equal(editableForumContentForViewer(raw, 42, { userId: 9, role: "user" }), undefined);
  assert.equal(editableForumContentForViewer(raw, 42, null), undefined);
});

test("服务端拒绝把图片或视频审核占位符写回正文", () => {
  assert.equal(containsForumModerationPlaceholder('<span data-image-review-state="pending">审核中</span>'), true);
  assert.equal(containsForumModerationPlaceholder('<span class="video-review-placeholder-error">审核异常</span>'), true);
  assert.equal(containsForumModerationPlaceholder('<img src="/uploads/forum/a.webp">'), false);
});

test("论坛列表只向作者本人补充审核生命周期中的隐藏内容", () => {
  assert.deepEqual(forumContentVisibilityWhere(null), { hidden: false });
  assert.deepEqual(forumContentVisibilityWhere(42), {
    OR: [
      { hidden: false },
      {
        hidden: true,
        authorId: 42,
        aiReviewStatus: { in: [...FORUM_SELF_VISIBLE_REVIEW_STATUSES] },
      },
    ],
  });
  assert.equal(FORUM_SELF_VISIBLE_REVIEW_STATUSES.includes("checking"), true);
  assert.equal(FORUM_SELF_VISIBLE_REVIEW_STATUSES.includes("rejected_manual"), true);
  assert.equal((FORUM_SELF_VISIBLE_REVIEW_STATUSES as readonly string[]).includes("auto_passed"), false);
  assert.equal((FORUM_SELF_VISIBLE_REVIEW_STATUSES as readonly string[]).includes("deleted"), false);
});

test("论坛提交 ID 只接受匹配类型的稳定客户端标识", () => {
  assert.equal(normalizeForumSubmissionId("topic-12345678-abcd", "topic"), "topic-12345678-abcd");
  assert.equal(normalizeForumSubmissionId("reply-12345678-abcd", "topic"), null);
  assert.equal(normalizeForumSubmissionId("topic-short", "topic"), null);
  assert.equal(normalizeForumSubmissionId("", "topic"), null);
});

test("论坛幂等写入只把 Prisma 唯一约束冲突识别为可恢复重放", () => {
  assert.equal(isForumSubmissionUniqueConflict({ code: "P2002" }), true);
  assert.equal(isForumSubmissionUniqueConflict({ code: "P2025" }), false);
  assert.equal(isForumSubmissionUniqueConflict(new Error("network")), false);
});

test("后台审核只允许写回自己读取到的内容版本", () => {
  const updatedAt = new Date("2026-08-24T12:34:56.000Z");
  assert.deepEqual(forumReviewSnapshotWhere(42, updatedAt), {
    id: 42,
    aiReviewStatus: "checking",
    hidden: true,
    updatedAt,
  });
});

test("编辑相似度上下文可以随异步队列持久化并恢复", () => {
  const encoded = encodeTopicEditReviewContext({
    originalTitle: "原标题",
    originalContent: "原正文",
    similarityThreshold: 0.7,
  });
  assert.deepEqual(parseTopicEditReviewContext(encoded), {
    kind: "topic-edit",
    version: 1,
    originalTitle: "原标题",
    originalContent: "原正文",
    similarityThreshold: 0.7,
    attempt: 0,
  });
  assert.equal(parseTopicEditReviewContext("[attempt:1] timeout"), null);
  assert.equal(forumReviewAttempt("[attempt:4] timeout"), 4);
  assert.equal(isAutomaticManualReviewRetry("[attempt:7] [auto-manual-retry:v1] timeout"), true);
  assert.equal(resetForumReviewRetryDetail("[attempt:7] timeout"), "");
});

test("异步论坛审核状态会稳定映射为前端可恢复的提交结果", () => {
  assert.deepEqual(forumSubmissionResultForReview({ aiReviewStatus: "checking", hidden: true }), {
    status: "pending",
    reason: "内容已提交审核，完成后会通过站内通知告知结果",
    replayed: false,
  });
  assert.deepEqual(forumSubmissionResultForReview({
    aiReviewStatus: "manual_requested",
    hidden: true,
    reason: "AI 服务异常，已自动转人工并继续重试",
  }), {
    status: "manual_review",
    reason: "AI 服务异常，已自动转人工并继续重试",
    replayed: false,
  });
  assert.deepEqual(forumSubmissionResultForReview({
    aiReviewStatus: "blocked_ai",
    hidden: true,
    riskLevel: "high",
    riskScore: 96,
    reason: "高风险内容",
  }), {
    status: "blocked_ai",
    riskLevel: "high",
    riskScore: 96,
    reason: "高风险内容",
    replayed: false,
  });
  assert.deepEqual(forumSubmissionResultForReview({
    aiReviewStatus: "review_failed",
    hidden: true,
    reason: "上游不可用",
    replayed: true,
  }), {
    status: "failed",
    reason: "上游不可用",
    replayed: true,
  });
  assert.deepEqual(forumSubmissionResultForReview({ aiReviewStatus: "auto_passed", hidden: false }), {
    status: "published",
    replayed: false,
  });
  assert.deepEqual(forumSubmissionResultForReview({ aiReviewStatus: "deleted", hidden: true }), {
    status: "deleted",
    reason: "内容已删除",
    replayed: false,
  });
});
