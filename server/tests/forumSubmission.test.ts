import assert from "node:assert/strict";
import test from "node:test";
import {
  forumSubmissionResultForReview,
  isForumSubmissionUniqueConflict,
  normalizeForumSubmissionId,
} from "../src/services/forumSubmission";

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

test("异步论坛审核状态会稳定映射为前端可恢复的提交结果", () => {
  assert.deepEqual(forumSubmissionResultForReview({ aiReviewStatus: "checking", hidden: true }), {
    status: "pending",
    reason: "内容已提交审核，完成后会通过站内通知告知结果",
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
});
