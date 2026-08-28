import assert from "node:assert/strict";
import test from "node:test";
import { forumReviewRetryDelayMs, forumReviewRetryDue } from "../src/services/forumSubmissionReview";

test("AI 审核故障按半小时窗口退避重试", () => {
  assert.equal(forumReviewRetryDelayMs(0), 0);
  assert.equal(forumReviewRetryDelayMs(1), 30_000);
  assert.equal(forumReviewRetryDelayMs(2), 60_000);
  assert.equal(forumReviewRetryDelayMs(6), 15 * 60_000);
  assert.equal(forumReviewRetryDelayMs(99), 15 * 60_000);
});

test("自动转人工后仍以较低频率继续 AI 审核", () => {
  const reviewedAt = new Date("2026-08-29T00:00:00.000Z");
  const detail = "[attempt:7] [auto-manual-retry:v1] upstream unavailable";
  assert.equal(forumReviewRetryDelayMs(7, true), 30 * 60_000);
  assert.equal(forumReviewRetryDue(detail, reviewedAt, true, reviewedAt.getTime() + 29 * 60_000), false);
  assert.equal(forumReviewRetryDue(detail, reviewedAt, true, reviewedAt.getTime() + 30 * 60_000), true);
});
