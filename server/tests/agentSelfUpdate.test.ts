import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { queueManagedAgentUpdate } from "../src/services/agentSelfUpdate";

test("artifact-only Agent queues one fixed request without requiring a repository or runner", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "managed-agent-request-"));
  const request = path.join(directory, "agent-remote-update.request");
  try {
    const first = queueManagedAgentUpdate(request);
    assert.equal(first.accepted, true);
    assert.equal(first.alreadyScheduled, false);
    assert.equal(readFileSync(request, "utf8"), `${first.requestedAt}\n`);
    assert.equal(queueManagedAgentUpdate(request).alreadyScheduled, true);
    assert.equal(readFileSync(request, "utf8"), `${first.requestedAt}\n`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("managed Agent retries a stale request and refuses relative or command-like request paths", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "managed-agent-request-"));
  const request = path.join(directory, "agent-remote-update.request");
  try {
    writeFileSync(request, "stale");
    utimesSync(request, 1, 1);
    assert.equal(queueManagedAgentUpdate(request).alreadyScheduled, false);
    assert.throws(() => queueManagedAgentUpdate("agent-remote-update.request"), /路径无效/);
    assert.throws(() => queueManagedAgentUpdate(path.join(directory, "update.sh")), /路径无效/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
