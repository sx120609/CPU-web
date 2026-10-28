import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function waitFor(check: () => boolean, timeoutMs = 3_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the Agent");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("a paused Agent stays connected for its update but is given no work", async (t) => {
  const token = "paused-agent-token-" + "p".repeat(44);
  process.env.JWT_SECRET = "paused-agent-secret-0123456789abcdef0123";
  process.env.JWXT_SESSION_SYNC_KEY = "paused-agent-sync-key-0123456789abcdef01";
  process.env.JWXT_AGENTS = JSON.stringify([{
    id: "paused-agent", name: "Paused Agent", token,
    enabled: false, jwxtEnabled: true, crawlEnabled: true, weight: 1, maxConcurrent: 2,
  }]);
  process.env.JWXT_PROXY_URL = "";
  process.env.SSO_LOGIN_NODES = "";
  process.env.SSO_LOGIN_LOCAL_ENABLED = "false";
  process.env.JWXT_AGENT_PATH = "/api/internal/jwxt-agent/connect";
  process.env.JWXT_AGENT_HEARTBEAT_MS = "2000";
  process.env.JWXT_AGENT_OFFLINE_MS = "4000";
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";
  process.env.DATABASE_URL = "";

  const gateway = await import("../src/services/jwxtAgentGateway");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  gateway.attachJwxtAgentGateway(server);
  await listen(server);
  const address = server.address() as AddressInfo;
  const dispatched: string[] = [];
  const logs: string[] = [];
  const client = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${address.port}/api/internal/jwxt-agent/connect`,
    agentId: "paused-agent",
    token,
    buildCommit: "c".repeat(40),
    reconnectMs: 500,
    log: (message) => logs.push(message),
    dispatch: async (action) => {
      dispatched.push(action);
      if (action === "agent.update") return { accepted: true, alreadyScheduled: false, requestedAt: new Date(0).toISOString() };
      return null;
    },
  });
  t.after(async () => {
    client.stop();
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  });

  // It used to be refused with 401 and retry forever, so an update never reached it.
  await waitFor(() => client.getState().ready && gateway.getJwxtAgentState("paused-agent").ready);
  assert.ok(logs.some((line) => line.includes("已注册上线")), "the managed updater waits for this line");

  const state = gateway.getJwxtAgentState("paused-agent");
  assert.equal(state.jwxtEnabled, false);
  assert.equal(state.crawlEnabled, false);
  assert.equal(gateway.isJwxtAgentAvailable("paused-agent", "jwxt"), false);
  assert.equal(gateway.isJwxtAgentAvailable("paused-agent", "crawl"), false);
  assert.deepEqual(gateway.getJwxtAgentReplicaRecipients().map((item) => item.agentId), []);

  await assert.rejects(
    gateway.requestJwxtAgent("paused-agent", "session.status", { token: "school-session" }, 1_000),
    (error: any) => error.status === 503 && /已禁用/.test(error.message),
  );
  await assert.rejects(gateway.requestJwxtAgent("paused-agent", "school-feed.crawl", { limit: 1 } as any, 1_000));
  assert.deepEqual(dispatched, []);

  const update = await gateway.requestJwxtAgent("paused-agent", "agent.update", {}, 1_000);
  assert.equal(update.accepted, true);
  assert.deepEqual(dispatched, ["agent.update"]);
});
