import assert from "node:assert/strict";
import test from "node:test";
import { AgentErrorCode, sessionFailureReason } from "../src/services/jwxtAgentErrors";
import { HttpError } from "../src/utils/response";

test("failover distinguishes node failure from busy, slow upstream and gateway failure", () => {
  assert.equal(sessionFailureReason(new HttpError(503, AgentErrorCode.busy, "busy")), null);
  assert.equal(sessionFailureReason(new HttpError(504, AgentErrorCode.timeout, "timeout")), null);
  assert.equal(sessionFailureReason(new HttpError(502, 5002, "school unavailable")), null);
  assert.equal(sessionFailureReason(new HttpError(503, AgentErrorCode.gateway, "gateway unavailable")), null);
  assert.equal(sessionFailureReason(new HttpError(503, AgentErrorCode.offline, "offline")), "agent_offline");
  assert.equal(sessionFailureReason(new HttpError(502, AgentErrorCode.transport, "transport")), "agent_transport");
  assert.equal(sessionFailureReason(new HttpError(401, 4001, "session missing")), "session_missing");
});
