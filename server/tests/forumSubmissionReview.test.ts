import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forumReviewRetryDelayMs, forumReviewRetryDue } from "../src/services/forumSubmissionReview";

const submissionReviewSource = readFileSync(new URL("../src/services/forumSubmissionReview.ts", import.meta.url), "utf8");
const manualReviewSource = readFileSync(new URL("../src/services/topicAiReview.ts", import.meta.url), "utf8");

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

test("帖子和回复审核通过不打扰用户，未通过与异常状态仍发送通知", () => {
  assert.doesNotMatch(submissionReviewSource, /topic-submission-published/);
  assert.doesNotMatch(submissionReviewSource, /reply-submission-published/);
  assert.match(submissionReviewSource, /reply-submission-blocked/);
  assert.match(manualReviewSource, /topic-ai-blocked/);
  assert.match(manualReviewSource, /function notifyManualReviewDecision[\s\S]*?if \(input\.approved\) return;[\s\S]*?你的稿件未通过人工审核/);
  assert.match(manualReviewSource, /function notifyManualReplyReviewDecision[\s\S]*?if \(input\.approved\) return;[\s\S]*?你的回复未通过人工审核/);
});
