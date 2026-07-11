import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
};

type FakeServer = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function startFakeServer(
  handler: (request: RecordedRequest, response: ServerResponse) => void | Promise<void>,
): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    if (rawBody) {
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    }
    const record: RecordedRequest = {
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body,
    };
    requests.push(record);
    await handler(record, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

function requestsFor(server: FakeServer, path: string) {
  return server.requests.filter((request) => request.path === path);
}

test("dedicated login pool fails over without cooldown, stays sticky, and hands off once", async (t) => {
  const events: string[] = [];
  let bPendingSequence = 0;
  const fakeHandoff = {
    id: "a".repeat(32),
    callbackUrl: "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp?ticket=ST-fake",
    cookies: { "jsxsd.cpu.edu.cn": { JSESSIONID: "fake-cookie" } },
    username: "20260001",
    issuedAt: Date.now(),
  };

  const nodeA = await startFakeServer((request, response) => {
    events.push(`A ${request.method} ${request.path}`);
    if (request.path === "/v1/login-pool/begin") {
      sendJson(response, 429, { code: 5429, data: null, message: "rate limited" });
      return;
    }
    sendJson(response, 404, { code: 404, data: null, message: "not found" });
  });

  const nodeB = await startFakeServer(async (request, response) => {
    events.push(`B ${request.method} ${request.path}`);
    if (request.path === "/v1/login-pool/begin") {
      bPendingSequence += 1;
      sendJson(response, 200, {
        code: 0,
        data: { pendingId: `b-pending-${String(bPendingSequence).padStart(8, "0")}`, needCaptcha: false },
        message: "",
      });
      return;
    }
    if (request.path === "/v1/login-pool/submit") {
      await new Promise((resolve) => setTimeout(resolve, 75));
      sendJson(response, 200, { code: 0, data: { ok: true, handoff: fakeHandoff }, message: "" });
      return;
    }
    sendJson(response, 404, { code: 404, data: null, message: "not found" });
  });

  const queryNode = await startFakeServer((request, response) => {
    events.push(`Q ${request.method} ${request.path}`);
    if (request.path === "/v1/login-pool/consume-handoff") {
      sendJson(response, 200, { code: 0, data: "query-node-final-token", message: "" });
      return;
    }
    sendJson(response, 404, { code: 404, data: null, message: "not found" });
  });

  t.after(async () => {
    await Promise.all([nodeA.close(), nodeB.close(), queryNode.close()]);
  });

  const envKeys = [
    "JWT_SECRET",
    "JWXT_PROXY_URL",
    "JWXT_PROXY_AGENT_ID",
    "JWXT_PROXY_AUTH",
    "JWXT_AGENTS",
    "SSO_LOGIN_NODES",
    "SSO_LOGIN_LOCAL_ENABLED",
    "SSO_LOGIN_TIMEOUT_MS",
    "SSO_LOGIN_FAILURE_COOLDOWN_MS",
    "REDIS_ENABLED",
    "REDIS_URL",
  ] as const;
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.JWT_SECRET = "login-pool-integration-secret";
  process.env.JWXT_PROXY_URL = queryNode.url;
  process.env.JWXT_PROXY_AGENT_ID = "";
  process.env.JWXT_PROXY_AUTH = "auth-q";
  process.env.JWXT_AGENTS = "";
  process.env.SSO_LOGIN_LOCAL_ENABLED = "false";
  process.env.SSO_LOGIN_TIMEOUT_MS = "2000";
  process.env.SSO_LOGIN_FAILURE_COOLDOWN_MS = "60000";
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";
  process.env.SSO_LOGIN_NODES = JSON.stringify([
    { id: "a", name: "A", url: nodeA.url, auth: "auth-a", weight: 1 },
    { id: "b", name: "B", url: nodeB.url, auth: "auth-b", weight: 1 },
  ]);

  const pool = await import("../src/services/ssoLoginPool");
  assert.equal(pool.isDedicatedSsoLoginPool(), true);

  const firstBegin = await pool.beginLogin();
  assert.equal(pool.isPooledPendingId(firstBegin.pendingId), true);
  assert.deepEqual(events.slice(0, 2), [
    "A POST /v1/login-pool/begin",
    "B POST /v1/login-pool/begin",
  ]);
  assert.equal(requestsFor(nodeA, "/v1/login-pool/begin").length, 1);
  assert.equal(requestsFor(nodeB, "/v1/login-pool/begin").length, 1);

  const secondBegin = await pool.beginLogin();
  assert.equal(pool.isPooledPendingId(secondBegin.pendingId), true);
  assert.notEqual(secondBegin.pendingId, firstBegin.pendingId);
  assert.equal(requestsFor(nodeA, "/v1/login-pool/begin").length, 1);
  assert.equal(requestsFor(nodeB, "/v1/login-pool/begin").length, 2);

  const thirdBegin = await pool.beginLogin();
  assert.equal(pool.isPooledPendingId(thirdBegin.pendingId), true);
  assert.equal(requestsFor(nodeA, "/v1/login-pool/begin").length, 2, "a failed node must be retried without cooldown");
  assert.equal(requestsFor(nodeB, "/v1/login-pool/begin").length, 3, "the same request must still fail over to B");

  const loginArgs = {
    pendingId: firstBegin.pendingId,
    username: "20260001",
    password: "secret-password",
  };
  const submissions = await Promise.allSettled([
    pool.submitLogin(loginArgs),
    pool.submitLogin(loginArgs),
  ]);
  const successful = submissions.find((entry) => entry.status === "fulfilled");
  const duplicate = submissions.find((entry) => entry.status === "rejected");
  assert.ok(successful && successful.status === "fulfilled");
  assert.deepEqual(successful.value, { ok: true, token: "query-node-final-token" });
  assert.ok(duplicate && duplicate.status === "rejected");
  assert.equal((duplicate.reason as { status?: number }).status, 409);

  assert.equal(requestsFor(nodeA, "/v1/login-pool/submit").length, 0);
  const bSubmits = requestsFor(nodeB, "/v1/login-pool/submit");
  assert.equal(bSubmits.length, 1, "concurrent duplicate submit must not reach B");
  assert.deepEqual(bSubmits[0].body, {
    pendingId: "b-pending-00000001",
    username: "20260001",
    password: "secret-password",
  });

  const qConsumes = requestsFor(queryNode, "/v1/login-pool/consume-handoff");
  assert.equal(qConsumes.length, 1);
  assert.deepEqual(qConsumes[0].body, { handoff: fakeHandoff });

  assert.ok(nodeA.requests.every((request) => request.headers["x-proxy-auth"] === "auth-a"));
  assert.ok(nodeB.requests.every((request) => request.headers["x-proxy-auth"] === "auth-b"));
  assert.ok(queryNode.requests.every((request) => request.headers["x-proxy-auth"] === "auth-q"));

  const jwxtClient = await import("../src/services/jwxtClient");
  const replayPendingId = "missing-pending-for-replay-check";
  const firstMissing = await jwxtClient.submitLoginForHandoff({
    pendingId: replayPendingId,
    username: "20260001",
    password: "first-password",
  });
  assert.equal(firstMissing.ok, false);
  await assert.rejects(
    () => jwxtClient.submitLoginForHandoff({
      pendingId: replayPendingId,
      username: "20269999",
      password: "different-password",
    }),
    (error: unknown) => (error as { status?: number }).status === 409,
    "a cached submit result must never be reusable with another username or password",
  );

  const cache = await import("../src/services/cache");
  const uncertainPendingId = "uncertain-submit-pending-id";
  await cache.setEphemeralValue(cache.jwxtPendingKey(uncertainPendingId), JSON.stringify({
    jar: {},
    ssoUrl: `${nodeA.url}/sso`,
    hidden: { execution: "fake-execution" },
    createdAt: Date.now(),
  }), 5 * 60 * 1000);
  const uncertainArgs = {
    pendingId: uncertainPendingId,
    username: "20260001",
    password: "must-not-be-replayed",
  };
  await assert.rejects(
    () => jwxtClient.submitLoginForHandoff(uncertainArgs),
    (error: unknown) => (error as { status?: number }).status === 404,
  );
  await assert.rejects(
    () => jwxtClient.submitLoginForHandoff(uncertainArgs),
    (error: unknown) => (error as { status?: number }).status === 409,
    "an uncertain credential POST must be at-most-once",
  );
  assert.equal(requestsFor(nodeA, "/sso").length, 1, "the password must not be replayed after an uncertain POST");
});
