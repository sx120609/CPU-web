import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const close = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });

test("two API generations share one Agent connection and retain requests when the old API exits", async t => {
  process.env.JWT_SECRET = "gateway-test-secret-0123456789abcdef";
  process.env.JWXT_SESSION_SYNC_KEY = "gateway-test-sync-key-0123456789abcdef";
  const token = "test-agent-token-" + "a".repeat(40);
  process.env.JWXT_AGENTS = JSON.stringify([{ id: "campus-a", token, name: "A", enabled: true, jwxtEnabled: true, maxConcurrent: 4 }]);
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";
  const { GatewayClient, createGatewayRpc } = await import("../src/services/jwxtGatewayTransport");
  const gateway = await import("../src/services/jwxtAgentGateway");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const secret = "a".repeat(64);
  const owner = createServer(createGatewayRpc(secret, {
    snapshot: () => ({ protocol: 1, instance: "stable-owner", agents: { "campus-a": gateway.getJwxtAgentState("campus-a") }, recipients: gateway.getJwxtAgentReplicaRecipients() }),
    request: (id, action, payload, timeout) => gateway.requestJwxtAgent(id, action as any, payload, timeout),
  }));
  gateway.attachJwxtAgentGateway(owner);
  const port = await listen(owner);
  let dispatched = 0;
  const agent = startJwxtAgentClient({ serverUrl: `ws://127.0.0.1:${port}/api/internal/jwxt-agent/connect`, agentId: "campus-a", token,
    reconnectMs: 100, log: () => undefined,
    dispatch: async () => { dispatched++; return { pendingId: "test-pending", needCaptcha: false }; },
  });
  const oldClient = new GatewayClient(port, secret), newClient = new GatewayClient(port, secret);
  const oldApi = createServer(async (_req, res) => res.end(JSON.stringify(await oldClient.request("campus-a", "login.begin", {}, 2000))));
  const newApi = createServer(async (_req, res) => res.end(JSON.stringify(await newClient.request("campus-a", "login.begin", {}, 2000))));
  const oldPort = await listen(oldApi), newPort = await listen(newApi);
  t.after(async () => { oldClient.stop(); newClient.stop(); agent.stop(); await close(oldApi); await close(newApi); await close(owner); });
  const deadline = Date.now() + 5000;
  while (!gateway.getJwxtAgentState("campus-a").ready) {
    assert.ok(Date.now() < deadline, "Agent became ready"); await new Promise(resolve => setTimeout(resolve, 20));
  }
  await oldClient.start(); await newClient.start();
  const connectedAt = gateway.getJwxtAgentState("campus-a").connectedAt;
  assert.deepEqual(oldClient.current(), newClient.current());
  for (const target of [oldPort, newPort]) {
    assert.equal((await (await fetch(`http://127.0.0.1:${target}`)).json()).pendingId, "test-pending");
  }
  await close(oldApi); oldClient.stop();
  assert.equal((await (await fetch(`http://127.0.0.1:${newPort}`)).json()).pendingId, "test-pending");
  assert.equal(gateway.getJwxtAgentState("campus-a").connectedAt, connectedAt);
  assert.equal(dispatched, 3);
  assert.equal((await fetch(`http://127.0.0.1:${port}/snapshot`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/request`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ agentId: "campus-a", action: "login.begin", payload: {}, timeoutMs: -1 }) })).status, 400);
  assert.equal(dispatched, 3, "invalid RPC does not execute");
});

test("gateway transport never retries a failed request or reports a stale online snapshot", async () => {
  const { GatewayClient, createGatewayRpc } = await import("../src/services/jwxtGatewayTransport");
  const { HttpError } = await import("../src/utils/response");
  let calls = 0;
  const server = createServer(createGatewayRpc("secret", {
    snapshot: () => ({ protocol: 1, instance: "stable", agents: {}, recipients: [] }),
    request: async () => { calls++; throw new HttpError(503, 5000, "busy"); },
  }));
  const port = await listen(server);
  const client = new GatewayClient(port, "secret");
  await client.start();
  await assert.rejects(client.request("a", "login.begin", {}, 1000), /busy/);
  assert.equal(calls, 1);
  await close(server);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(client.current(), null);
  client.stop();
});
