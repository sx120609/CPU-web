import assert from "node:assert/strict";
import test from "node:test";
import { resolveTextReviewPolicy } from "../src/services/topicAiReview";

test("explicit political risk categories cannot be hidden by a low aggregate score", () => {
  const result = resolveTextReviewPolicy({
    risk_score: 8,
    risk_level: "low",
    decision: "auto_pass",
    categories: { separatism: 92 },
  }, 70);
  assert.equal(result.decision, "block");
  assert.equal(result.riskScore, 90);
  assert.equal(result.politicalRiskScore, 92);
});

test("neutral political discussion remains governed by the normal threshold", () => {
  const result = resolveTextReviewPolicy({
    risk_score: 12,
    risk_level: "low",
    decision: "auto_pass",
    categories: { political_extremism: 4, political_rumor: 3 },
  }, 70);
  assert.equal(result.decision, "auto_pass");
  assert.equal(result.riskScore, 12);
});

test("an explicit model manual-review decision is honored even with a low total score", () => {
  const result = resolveTextReviewPolicy({ risk_score: 15, decision: "manual_review" }, 70);
  assert.equal(result.decision, "block");
  assert.equal(result.riskScore, 70);
});
