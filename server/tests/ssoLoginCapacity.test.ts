import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("concurrent login begins wait for Agent capacity without replaying or exceeding its limit", async t => {
  const token = "capacity-test-" + "a".repeat(48);
  process.env.JWT_SECRET = "capacity-test-secret-0123456789abcdef";
  process.env.JWXT_SESSION_SYNC_KEY = "capacity-test-sync-0123456789abcdef";
  process.env.JWXT_AGENTS = JSON.stringify([{ id: "capacity-agent", name: "test", token,
    enabled: true, jwxtEnabled: true, maxConcurrent: 1, weight: 1 }]);
  process.env.SSO_LOGIN_LOCAL_ENABLED = "false";
  process.env.SSO_LOGIN_NODES = "";
  process.env.SSO_LOGIN_TIMEOUT_MS = "2000";
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";
  const gateway = await import("../src/services/jwxtAgentGateway");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const { beginLogin } = await import("../src/services/ssoLoginPool");
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  gateway.attachJwxtAgentGateway(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let active = 0, peak = 0, calls = 0;
  let block: Promise<void> | undefined;
  const client = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/internal/jwxt-agent/connect`,
    agentId: "capacity-agent", token, reconnectMs: 100, log: () => {},
    dispatch: async action => {
      assert.equal(action, "login.begin");
      active++; peak = Math.max(peak, active); const id = ++calls;
      try { await (block ?? new Promise(resolve => setTimeout(resolve, 20))); return { pendingId: `capacity-pending-${id}`, needCaptcha: false }; }
      finally { active--; }
    },
  });
  t.after(async () => {
    client.stop();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  });
  const deadline = Date.now() + 5000;
  while (!gateway.getJwxtAgentState("capacity-agent").ready) {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const results = await Promise.all(Array.from({ length: 6 }, () => beginLogin()));
  assert.equal(new Set(results.map(result => result.pendingId)).size, 6);
  assert.equal(calls, 6);
  assert.equal(peak, 1);
  let release!: () => void;
  block = new Promise<void>(resolve => { release = resolve; });
  const first = beginLogin();
  while (calls < 7) await new Promise(resolve => setTimeout(resolve, 5));
  const controller = new AbortController();
  const cancelled = assert.rejects(beginLogin(controller.signal), { name: "AbortError" });
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort();
  await cancelled;
  release(); await first;
  block = undefined;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(calls, 7, "cancelled capacity wait must never dispatch after capacity returns");
  await beginLogin();
  assert.equal(calls, 8);
});
