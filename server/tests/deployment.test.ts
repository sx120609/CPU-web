import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentBaselineConfirmsCompletion,
  sanitizeDeploymentLog,
} from "../src/services/deployment";

test("deployment logs remove terminal controls and redact credentials", () => {
  const lines = sanitizeDeploymentLog([
    "\u001b[32m[deploy]\u001b[0m pulling",
    "Authorization: Bearer top-secret",
    "DATABASE_URL=postgresql://cpu:password@example.com/cpu",
    "remote https://user:private-token@example.com/repo.git",
  ].join("\n"));

  assert.equal(lines[0], "[deploy] pulling");
  assert.equal(lines[1], "Authorization: Bearer ***");
  assert.equal(lines[2], "DATABASE_URL=***");
  assert.equal(lines[3], "remote https://user:***@example.com/repo.git");
  assert.equal(lines.join("\n").includes("top-secret"), false);
  assert.equal(lines.join("\n").includes("private-token"), false);
});

test("deployment log response is bounded to recent output", () => {
  const lines = sanitizeDeploymentLog(Array.from({ length: 300 }, (_, index) => `line-${index}`).join("\n"));
  assert.equal(lines.length, 240);
  assert.equal(lines[0], "line-60");
  assert.equal(lines.at(-1), "line-299");
});

test("successful deployment baseline recovers a runner interrupted by PM2 reload", () => {
  assert.equal(deploymentBaselineConfirmsCompletion({
    currentCommit: "abc123",
    successfulDeployCommit: "abc123",
    startedAt: "2026-08-28T05:12:36.000Z",
    successfulDeployRecordedAt: "2026-08-28T05:13:20.000Z",
  }), true);
});

test("stale or mismatched deployment baseline does not hide a runner failure", () => {
  assert.equal(deploymentBaselineConfirmsCompletion({
    currentCommit: "abc123",
    successfulDeployCommit: "abc123",
    startedAt: "2026-08-28T05:12:36.000Z",
    successfulDeployRecordedAt: "2026-08-28T05:12:35.000Z",
  }), false);
  assert.equal(deploymentBaselineConfirmsCompletion({
    currentCommit: "abc123",
    successfulDeployCommit: "def456",
    startedAt: "2026-08-28T05:12:36.000Z",
    successfulDeployRecordedAt: "2026-08-28T05:13:20.000Z",
  }), false);
});
