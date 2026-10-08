import assert from "node:assert/strict";
import test from "node:test";
import { summarizeJwxtAgents } from "../src/services/jwxtAgentSummary";

const agent = (id: string, enabled = true, jwxtEnabled = true) => ({ id, enabled, jwxtEnabled });

test("the public summary counts only enabled JWXT agents and exposes nothing but numbers", () => {
  const ready = new Set(["CPU-Sever-01", "crawler", "disabled"]);
  const summary = summarizeJwxtAgents(
    [agent("CPU-Sever-01"), agent("CPU-Sever-02"), agent("crawler", true, false), agent("disabled", false, true)],
    (agentId) => ({ ready: ready.has(agentId) }),
  );
  assert.deepEqual(summary, { total: 2, online: 1 });
  assert.doesNotMatch(JSON.stringify(summary), /CPU-Sever|crawler/u);
});

test("the public summary is all zeros when no agent is configured", () => {
  assert.deepEqual(summarizeJwxtAgents([], () => ({ ready: true })), { total: 0, online: 0 });
});
