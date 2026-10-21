import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("login begin shares one deadline across nodes instead of multiplying timeouts", async t => {
  let calls = 0;
  const servers = Array.from({ length: 3 }, () => createServer((_req, res) => {
    calls++;
    setTimeout(() => { if (!res.destroyed) { res.writeHead(503, { "content-type": "application/json" }); res.end('{"code":5000,"message":"busy"}'); } }, 180);
  }));
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))));
  t.after(() => { for (const server of servers) { server.close(); server.closeAllConnections(); } });
  process.env.JWT_SECRET = "login-deadline-test-secret-0123456789abcdef";
  process.env.SSO_LOGIN_LOCAL_ENABLED = "false";
  process.env.JWXT_LOCAL_ENABLED = "false";
  process.env.JWXT_AGENTS = "";
  process.env.REDIS_ENABLED = "false";
  process.env.REDIS_URL = "";
  process.env.SSO_LOGIN_TIMEOUT_MS = "300";
  process.env.SSO_LOGIN_NODES = JSON.stringify(servers.map((server, i) => ({
    id: `node-${i}`, name: `node-${i}`, enabled: true, weight: 1, auth: "test-only-auth",
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  })));
  const { beginLogin } = await import("../src/services/ssoLoginPool");
  const started = Date.now();
  await assert.rejects(beginLogin(), { status: 503 });
  assert.ok(Date.now() - started < 550, "must not use a fresh 300ms budget per node");
  assert.ok(calls <= 3, "each node is attempted at most once within the shared budget");
});
