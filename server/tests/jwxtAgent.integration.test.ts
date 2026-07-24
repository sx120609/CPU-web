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

test("outbound JWXT Agent handles login, queries, dorm electricity, and crawler without FRP", async (t) => {
  const token = "agent-token-" + "a".repeat(48);
  const tokenB = "agent-token-" + "b".repeat(48);
  process.env.JWT_SECRET = "jwxt-agent-integration-secret-0123456789abcdef";
  process.env.JWXT_SESSION_SYNC_KEY = "integration-session-sync-key-0123456789abcdef";
  process.env.JWXT_AGENTS = JSON.stringify([
    {
      id: "campus-agent-a",
      name: "Campus Agent A",
      token,
      enabled: true,
      jwxtEnabled: true,
      crawlEnabled: true,
      weight: 1,
      maxConcurrent: 4,
    },
    {
      id: "campus-agent-b",
      name: "Campus Agent B",
      token: tokenB,
      enabled: true,
      jwxtEnabled: true,
      crawlEnabled: false,
      weight: 1,
      maxConcurrent: 4,
    },
  ]);
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
  const actionsB: Array<{ action: string; payload: any }> = [];
  const snapshotsA = new Map<string, any>();
  const snapshotsB = new Map<string, any>();
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
      if (action === "session.consume-handoff") {
        snapshotsA.set("agent-query-token", {
          version: 1,
          jar: { "jsxsd.cpu.edu.cn": { JSESSIONID: "private-cookie-value" } },
          username: "20260001",
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        });
        return "agent-query-token";
      }
      if (action === "session.export-snapshot") return snapshotsA.get((payload as { token: string }).token) ?? null;
      if (action === "session.import-snapshot") {
        const input = payload as { token: string; snapshot: any };
        snapshotsA.set(input.token, input.snapshot);
        return true;
      }
      if (action === "session.status") {
        const active = snapshotsA.has((payload as { token: string }).token);
        return active ? { active: true, since: Date.now(), username: "20260001" } : { active: false };
      }
      if (action === "jwxt.iapp-icon") {
        return { contentType: "image/png", dataBase64: "iVBORw0KGgo=", byteLength: 8 };
      }
      if (action === "dorm-electric.query") {
        return {
          balance: 23.45,
          remainKwh: 31.2,
          usedKwh: 102.8,
          price: 0.75,
          room: "0313房间",
          building: "H6",
          floor: "第3层",
          area: "江宁校区",
          lastUpdate: "2026-07-24 23:30",
        };
      }
      if (action === "agent.update") {
        return { accepted: true, alreadyScheduled: false, requestedAt: "2026-07-24T12:00:00.000Z" };
      }
      if (action === "school-feed.crawl") return { items: [], pages: [] };
      throw new Error(`unexpected action: ${action}`);
    },
  });
  const clientB = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${address.port}/api/internal/jwxt-agent/connect`,
    agentId: "campus-agent-b",
    token: tokenB,
    reconnectMs: 500,
    log: () => undefined,
    dispatch: async (action, payload) => {
      actionsB.push({ action, payload });
      if (action === "session.export-snapshot") return snapshotsB.get((payload as { token: string }).token) ?? null;
      if (action === "session.import-snapshot") {
        const input = payload as { token: string; snapshot: any };
        snapshotsB.set(input.token, input.snapshot);
        return true;
      }
      if (action === "session.status") {
        const snapshot = snapshotsB.get((payload as { token: string }).token);
        return snapshot ? { active: true, since: snapshot.createdAt, username: snapshot.username } : { active: false };
      }
      if (action === "login.begin") return { pendingId: "agent-b-inner-pending-0001", needCaptcha: false };
      if (action === "jwxt.iapp-icon") {
        return { contentType: "image/png", dataBase64: "iVBORw0KGgo=", byteLength: 8 };
      }
      if (action === "dorm-electric.query") {
        return {
          balance: 23.45,
          remainKwh: 31.2,
          usedKwh: 102.8,
          price: 0.75,
          room: "0313房间",
          building: "H6",
          floor: "第3层",
          area: "江宁校区",
          lastUpdate: "2026-07-24 23:30",
        };
      }
      throw new Error(`unexpected B action: ${action}`);
    },
  });

  t.after(async () => {
    client.stop();
    clientB.stop();
    await closeServer(server);
  });
  await Promise.all([client.waitUntilReady(), clientB.waitUntilReady()]);
  await waitFor(() => gateway.getJwxtAgentState("campus-agent-a").ready && gateway.getJwxtAgentState("campus-agent-b").ready);
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
  assert.ok(begin.credentialPublicKey);

  const { encryptAgentLoginCredentials } = await import("../src/services/jwxtAgentReplicaCrypto");
  const credentials = encryptAgentLoginCredentials(begin.credentialPublicKey!, {
    username: "20260001",
    password: "not-logged-or-stored",
  });
  assert.equal(JSON.stringify(credentials).includes("not-logged-or-stored"), false);
  const login = await pool.submitLogin({
    pendingId: begin.pendingId,
    credentials,
  });
  assert.equal(login.ok, true);
  assert.match(login.token || "", /^jqa1\./);

  const transport = await import("../src/services/jwxtTransport");
  const status = await transport.getStatus(login.token);
  assert.equal(status.active, true);
  const icon = await transport.getIAppIcon("/sopplus/_upload/appstore/abc-123/res/icon/icon.png");
  assert.deepEqual(icon, { contentType: "image/png", dataBase64: "iVBORw0KGgo=", byteLength: 8 });
  assert.ok([...actions, ...actionsB].some((item) => item.action === "jwxt.iapp-icon"));
  const dormElectric = await import("../src/services/dormElectric");
  const electric = await dormElectric.queryDormElectric("20260001");
  assert.equal(electric.balance, 23.45);
  assert.equal(electric.room, "0313房间");
  assert.ok([...actions, ...actionsB].some((item) => item.action === "dorm-electric.query"));
  const update = await gateway.requestJwxtAgent("campus-agent-a", "agent.update", {});
  assert.deepEqual(update, {
    accepted: true,
    alreadyScheduled: false,
    requestedAt: "2026-07-24T12:00:00.000Z",
  });
  assert.ok(actions.some((item) => item.action === "agent.update"));

  const replica = await import("../src/services/jwxtSessionReplica");
  const cache = await import("../src/services/cache");
  const encryptedReplica = await cache.getEphemeralValue(replica.jwxtSessionReplicaKey("agent-query-token"));
  assert.ok(encryptedReplica);
  assert.equal(encryptedReplica.includes("private-cookie-value"), false);
  assert.equal(encryptedReplica.includes("20260001"), false);
  const replicaEnvelope = JSON.parse(encryptedReplica);
  assert.equal(replicaEnvelope.version, 2);
  assert.equal("encryptedSnapshot" in replicaEnvelope, false);
  assert.deepEqual(
    replicaEnvelope.replicas.map((item: any) => item.recipientAgentId).sort(),
    ["campus-agent-a", "campus-agent-b"],
  );
  assert.ok(replicaEnvelope.replicas.every((item: any) => item.algorithm === "rsa-oaep-sha256+aes-256-gcm"));

  const jwxtClient = await import("../src/services/jwxtClient");
  const encryptedLocalToken = "local-encrypted-session-token";
  await jwxtClient.importSessionSnapshot(encryptedLocalToken, snapshotsA.get("agent-query-token"));
  const encryptedLocalSession = await cache.getEphemeralValue(cache.jwxtSessionKey(encryptedLocalToken));
  assert.ok(encryptedLocalSession);
  assert.equal(encryptedLocalSession.includes("private-cookie-value"), false);
  assert.equal(encryptedLocalSession.includes("20260001"), false);
  assert.equal((await jwxtClient.exportSessionSnapshot(encryptedLocalToken))?.username, "20260001");
  await jwxtClient.logout(encryptedLocalToken);

  const crawler = await import("../src/services/schoolCrawlerTransport");
  const crawled = await crawler.crawlSchoolFeedSource({
    slug: "test",
    listUrl: "https://www.cpu.edu.cn/test/list.htm",
    maxPages: 1,
  });
  assert.deepEqual(crawled, { items: [], pages: [] });

  assert.ok(actions.some((item) => item.action === "session.export-snapshot"));
  assert.ok(actions.some((item) => item.action === "school-feed.crawl"));
  assert.equal(actions[1].payload.password, "not-logged-or-stored");

  client.stop();
  await waitFor(() => !gateway.getJwxtAgentState("campus-agent-a").online);
  const migratedStatus = await transport.getStatus(login.token);
  assert.equal(migratedStatus.active, true);
  assert.ok(actionsB.some((item) => item.action === "session.import-snapshot"));
  assert.ok(actionsB.some((item) => item.action === "session.status"));
  const migratedReplica = await replica.loadJwxtSessionReplica("agent-query-token");
  assert.equal(migratedReplica?.ownerAgentId, "campus-agent-b");
  assert.equal("snapshot" in (migratedReplica || {}), false);

  clientB.stop();
  await waitFor(() => !gateway.getJwxtAgentState("campus-agent-b").online);
  await assert.rejects(
    () => pool.beginLogin(),
    (error: unknown) => (
      (error as { status?: number }).status === 503
      && String((error as { message?: string }).message).includes("Agent 当前离线")
    ),
  );
});

test("outbound JWXT Agent replaces a half-open socket when server heartbeats disappear", async (t) => {
  const { WebSocketServer } = require("ws") as {
    WebSocketServer: new (options: Record<string, unknown>) => any;
  };
  const { JWXT_AGENT_PROTOCOL_VERSION } = await import("../src/services/jwxtAgentProtocol");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const server = createServer();
  const sockets = new Set<any>();
  const logs: string[] = [];
  let connectionCount = 0;
  let readyCount = 0;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket: any) => {
    sockets.add(socket);
    connectionCount += 1;
    socket.once("close", () => sockets.delete(socket));
    socket.on("message", (data: Buffer | string) => {
      try {
        const message = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
        if (message?.type === "ready") readyCount += 1;
      } catch {
        // The client test only needs to observe valid ready messages.
      }
    });
    socket.send(JSON.stringify({
      type: "welcome",
      protocolVersion: JWXT_AGENT_PROTOCOL_VERSION,
      heartbeatMs: 500,
      agent: {
        id: "half-open-agent",
        name: "Half-open Agent",
        maxConcurrent: 1,
        jwxtEnabled: true,
        crawlEnabled: false,
      },
    }));
    // Intentionally do not send WebSocket pings. This leaves the connection
    // looking OPEN locally, matching a network outage that never delivers FIN.
  });

  await listen(server);
  const address = server.address() as AddressInfo;
  const client = startJwxtAgentClient({
    serverUrl: `ws://127.0.0.1:${address.port}`,
    agentId: "half-open-agent",
    token: "half-open-agent-token-" + "x".repeat(40),
    reconnectMs: 500,
    log: (message) => logs.push(message),
    dispatch: async () => undefined,
  });

  t.after(async () => {
    client.stop();
    for (const socket of sockets) {
      try { socket.terminate(); } catch { /* already disconnected */ }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await closeServer(server);
  });

  await waitFor(() => readyCount >= 1);
  await waitFor(() => connectionCount >= 2 && readyCount >= 2, 6_000);

  assert.ok(logs.some((message) => message.includes("未收到主服务心跳")));
  assert.equal(client.getState().ready, true);
});
