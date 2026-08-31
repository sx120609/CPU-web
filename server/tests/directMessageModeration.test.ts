import test from "node:test";
import assert from "node:assert/strict";
import {
  directMessageCountsTowardPreReplyLimit,
  directMessageDeliveryState,
  directMessageModerationFailure,
  isDirectMessageReviewUnavailable,
} from "../src/services/directMessageModeration";
import {
  directMessageReviewAttempt,
  directMessageReviewRetryDelayMs,
  directMessageReviewRetryDue,
} from "../src/services/directMessageSubmissionReview";

function result(overrides: Record<string, unknown> = {}) {
  return {
    status: "auto_passed" as const,
    riskLevel: "low" as const,
    riskScore: 0,
    reason: "",
    detail: "",
    model: "test-model",
    ...overrides,
  };
}

test("private-message review results remain fail-closed before asynchronous delivery", () => {
  assert.equal(directMessageModerationFailure(result()), null);
  assert.match(directMessageModerationFailure(result({
    status: "blocked_ai",
    riskLevel: "high",
    riskScore: 95,
    reason: "包含诈骗引流",
  })) || "", /未通过内容审核.*诈骗引流/);
});

test("pending messages count toward the pre-reply limit but blocked messages do not", () => {
  assert.equal(directMessageCountsTowardPreReplyLimit("checking"), true);
  assert.equal(directMessageCountsTowardPreReplyLimit("auto_passed"), true);
  assert.equal(directMessageCountsTowardPreReplyLimit("blocked_ai"), false);
  assert.equal(directMessageDeliveryState("checking", true), "checking");
  assert.equal(directMessageDeliveryState("auto_passed", false), "delivered");
  assert.equal(directMessageDeliveryState("blocked_ai", true), "blocked");
});

test("asynchronous private-message review uses bounded retry delays", () => {
  assert.equal(directMessageReviewAttempt("[attempt:3] Error: timeout"), 3);
  assert.equal(directMessageReviewRetryDelayMs(1), 30_000);
  assert.equal(directMessageReviewRetryDelayMs(99), 15 * 60_000);
  assert.equal(directMessageReviewRetryDue("[attempt:2] Error", new Date(100_000), 159_999), false);
  assert.equal(directMessageReviewRetryDue("[attempt:2] Error", new Date(100_000), 160_000), true);
});

test("private messages fail closed when the AI review service is unavailable", () => {
  const unavailable = result({
    status: "blocked_ai",
    riskLevel: "medium",
    riskScore: 70,
    detail: JSON.stringify({ unavailable: true, scope: "direct-message" }),
  });
  assert.equal(isDirectMessageReviewUnavailable(unavailable), true);
  assert.equal(directMessageModerationFailure(unavailable), "私聊内容审核服务暂不可用，请稍后再试");
});
