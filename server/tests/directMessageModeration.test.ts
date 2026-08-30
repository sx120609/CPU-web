import test from "node:test";
import assert from "node:assert/strict";
import {
  directMessageModerationFailure,
  isDirectMessageReviewUnavailable,
} from "../src/services/directMessageModeration";

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

test("private messages pass only after an explicit AI approval", () => {
  assert.equal(directMessageModerationFailure(result()), null);
  assert.match(directMessageModerationFailure(result({
    status: "blocked_ai",
    riskLevel: "high",
    riskScore: 95,
    reason: "包含诈骗引流",
  })) || "", /未通过内容审核.*诈骗引流/);
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
