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

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("等待状态变化超时");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("outbound JWXT Agent handles login pool, handoff, queries, and crawler without FRP", async (t) => {
  const token = "agent-token-" + "a".repeat(48);
  process.env.JWT_SECRET = "jwxt-agent-integration-secret";
  process.env.JWXT_AGENTS = JSON.stringify([{
    id: "campus-agent-a",
    name: "Campus Agent A",
    token,
    enabled: true,
    jwxtEnabled: true,
    crawlEnabled: true,
    weight: 1,
    maxConcurrent: 4,
  }]);
  process.env.JWXT_PROXY_AGENT_ID = "campus-agent-a";
  process.env.JWXT_CRAWL_AGENT_ID = "campus-agent-a";
  process.env.JWXT_PROXY_URL = "";
  process.env.JWXT_PROXY_AUTH = "";
  process.env.SSO_LOGIN_NODES = "";
  process.env.SSO_LOGIN_LOCAL_ENABLED = "false";
  process.env.SSO_LOGIN_TIMEOUT_MS = "2000";
  process.env.JWXT_PROXY_TIMEOUT_MS = "2000";
  process.env.JWXT_AGENT_PATH = "/api/internal/jwxt-agent/connect";
  process.env.JWXT_AGENT_HEARTBEAT_MS = "2000";
  process.env.JWXT_AGENT_OFFLINE_MS = "4000";
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";

  const gateway = await import("../src/services/jwxtAgentGateway");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  gateway.attachJwxtAgentGateway(server);
  await listen(server);
  const address = server.address() as AddressInfo;

  const actions: Array<{ action: string; payload: any }> = [];
  const client = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${address.port}/api/internal/jwxt-agent/connect`,
    agentId: "campus-agent-a",
    token,
    reconnectMs: 500,
    log: () => undefined,
    dispatch: async (action, payload) => {
      actions.push({ action, payload });
      if (action === "login.begin") {
        return { pendingId: "agent-inner-pending-0001", needCaptcha: false };
      }
      if (action === "login.submit-handoff") {
        const input = payload as { username: string };
        return {
          ok: true,
          handoff: {
            id: "b".repeat(48),
            callbackUrl: "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp?ticket=ST-agent-fake",
            cookies: { "jsxsd.cpu.edu.cn": { JSESSIONID: "pre-session" } },
            username: input.username,
            issuedAt: Date.now(),
          },
        };
      }
      if (action === "session.consume-handoff") return "agent-query-token";
      if (action === "session.status") {
        return { active: true, since: Date.now(), username: "20260001" };
      }
      if (action === "school-feed.crawl") return { items: [], pages: [] };
      throw new Error(`unexpected action: ${action}`);
    },
  });

  t.after(async () => {
    client.stop();
    await closeServer(server);
  });
  await client.waitUntilReady();
  await waitFor(() => gateway.getJwxtAgentState("campus-agent-a").ready);
  assert.equal(gateway.getJwxtAgentState("campus-agent-a").ready, true);

  const duplicateLogs: string[] = [];
  const duplicate = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${address.port}/api/internal/jwxt-agent/connect`,
    agentId: "campus-agent-a",
    token,
    reconnectMs: 60_000,
    log: (message) => duplicateLogs.push(message),
    dispatch: async () => { throw new Error("duplicate Agent must not receive requests"); },
  });
  t.after(() => duplicate.stop());
  await waitFor(() => duplicateLogs.some((message) => message.includes("4006")));
  assert.equal(gateway.getJwxtAgentState("campus-agent-a").ready, true);

  const pool = await import("../src/services/ssoLoginPool");
  const begin = await pool.beginLogin();
  assert.equal(pool.isPooledPendingId(begin.pendingId), true);

  const login = await pool.submitLogin({
    pendingId: begin.pendingId,
    username: "20260001",
    password: "not-logged-or-stored",
  });
  assert.equal(login.ok, true);
  assert.match(login.token || "", /^jqa1\./);

  const transport = await import("../src/services/jwxtTransport");
  const status = await transport.getStatus(login.token);
  assert.equal(status.active, true);

  const crawler = await import("../src/services/schoolCrawlerTransport");
  const crawled = await crawler.crawlSchoolFeedSource({
    slug: "test",
    listUrl: "https://www.cpu.edu.cn/test/list.htm",
    maxPages: 1,
  });
  assert.deepEqual(crawled, { items: [], pages: [] });

  assert.deepEqual(actions.map((item) => item.action), [
    "login.begin",
    "login.submit-handoff",
    "session.consume-handoff",
    "session.status",
    "school-feed.crawl",
  ]);
  assert.equal(actions[1].payload.password, "not-logged-or-stored");

  client.stop();
  await waitFor(() => !gateway.getJwxtAgentState("campus-agent-a").online);
  await assert.rejects(
    () => pool.beginLogin(),
    (error: unknown) => (
      (error as { status?: number }).status === 503
      && String((error as { message?: string }).message).includes("Agent 当前离线")
    ),
  );
});
