import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ConcurrencyGate } from "../src/utils/loadShield";

test("local SSO deadlines cancel real HTTP work through redirects, bodies and captcha", async t => {
  const token = "local-deadline-agent-" + "a".repeat(40);
  Object.assign(process.env, {
    JWT_SECRET: "local-deadline-secret-0123456789abcdef",
    JWXT_SESSION_SYNC_KEY: "local-deadline-sync-0123456789abcdef",
    SSO_LOGIN_LOCAL_ENABLED: "true", SSO_LOGIN_LOCAL_WEIGHT: "10", SSO_LOGIN_TIMEOUT_MS: "200",
    SSO_LOGIN_NODES: "", REDIS_ENABLED: "false", REDIS_URL: "",
    JWXT_AGENTS: JSON.stringify([{ id: "healthy-agent", name: "test", token, enabled: true, jwxtEnabled: true, maxConcurrent: 1, weight: 1 }]),
  });
  const pool = await import("../src/services/ssoLoginPool");
  const local = await import("../src/services/jwxtClient");
  const gateway = await import("../src/services/jwxtAgentGateway");
  const { startJwxtAgentClient } = await import("../src/services/jwxtAgentClient");
  const { getJwxtAgentRuntimeConfig } = await import("../src/services/jwxtAgentConfig");
  let mode = "headers", submits = 0, openStreams = 0, captchaRequests = 0;
  const form = (captcha: boolean) => `<form id="loginForm" action="http://id.cpu.edu.cn/sso/login"><input type="hidden" name="execution" value="test-execution"><input type="hidden" name="service" value="http://jsxsd.cpu.edu.cn/zgykdx/callback"><input type="hidden" name="useVCode" value="${captcha}"><input name="username"><input name="password" type="password"></form>`;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://test").pathname;
    if (path === "/sso/authImg") captchaRequests++;
    if (req.method === "POST") submits++;
    const stall = mode === "headers" || (mode === "redirect" && path === "/sso/login")
      || (mode === "captcha" && path === "/sso/authImg") || req.method === "POST";
    if (stall || (mode === "body" && path === "/sso/login")) {
      openStreams++;
      let timer: ReturnType<typeof setInterval> | undefined;
      if (mode === "body" || req.method === "POST") {
        res.writeHead(200, { "content-type": "text/html" }); res.write("<html>");
        timer = setInterval(() => res.write(" "), 20);
      }
      res.once("close", () => { clearInterval(timer); openStreams--; });
      return;
    }
    if (path === "/zgykdx/tyrz.jsp") { res.writeHead(302, { location: "http://id.cpu.edu.cn/sso/login" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end(form(mode === "captcha"));
  });
  gateway.attachJwxtAgentGateway(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const originalFetch = globalThis.fetch;
  let cancellationSeen!: () => void, releaseCancellation!: () => void;
  let cleanup: Promise<void> | undefined;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    try { return await originalFetch(base + url.pathname + url.search, init); }
    catch (error) {
      if (init?.signal?.aborted && cleanup) { cancellationSeen(); await cleanup; }
      throw error;
    }
  }) as typeof fetch;
  let client: ReturnType<typeof startJwxtAgentClient> | undefined;
  t.after(async () => {
    releaseCancellation?.(); globalThis.fetch = originalFetch; client?.stop();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  });
  const waitClosed = async () => {
    const until = Date.now() + 1000;
    while (openStreams && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(openStreams, 0, "aborted HTTP connections must stop doing work");
  };
  await t.test("deadline holds gate and runtime capacity until aborted adapter settles", async () => {
    const seen = new Promise<void>(resolve => { cancellationSeen = resolve; });
    cleanup = new Promise<void>(resolve => { releaseCancellation = resolve; });
    const gate = new ConcurrencyGate(1, 1, 1000);
    const rejected = assert.rejects(gate.run(() => pool.beginLogin()), { status: 503 });
    await seen;
    assert.equal(gate.active, 1);
    assert.equal(pool.getSsoLoginPoolSnapshot().nodes.find(n => n.kind === "local")!.inFlight, 1);
    let nextStarted = false;
    const next = gate.run(async () => { nextStarted = true; });
    await Promise.resolve(); assert.equal(nextStarted, false);
    releaseCancellation(); await Promise.all([rejected, next]); cleanup = undefined;
    assert.equal(gate.active, 0);
    assert.equal(pool.getSsoLoginPoolSnapshot().nodes.find(n => n.kind === "local")!.inFlight, 0);
    await waitClosed();
  });
  for (const phase of ["redirect", "body", "captcha"]) await t.test(`aborts stalled ${phase}`, async () => {
    mode = phase;
    const started = Date.now();
    await assert.rejects(pool.beginLogin(), { status: 503 });
    assert.ok(Date.now() - started >= 150, "test must reach the deadline, not an unrelated error");
    assert.ok(Date.now() - started < 1000);
    if (phase === "captcha") assert.equal(captchaRequests, 1);
    await waitClosed();
  });
  await t.test("submission body timeout never replays credentials", async () => {
    mode = "normal";
    const pending = await local.beginLogin();
    const started = Date.now();
    await assert.rejects(local.submitLoginForHandoff({ pendingId: pending.pendingId, username: "test-user", password: "test-password" }), { status: 504 });
    assert.ok(Date.now() - started < 1000);
    assert.equal(submits, 1);
    await waitClosed();
  });
  await t.test("a stalled local node leaves budget for a healthy Agent", async () => {
    let agentCalls = 0;
    client = startJwxtAgentClient({ serverUrl: base.replace("http", "ws") + "/api/internal/jwxt-agent/connect", agentId: "healthy-agent", token, reconnectMs: 100, log: () => {},
      dispatch: async action => { assert.equal(action, "login.begin"); agentCalls++; return { pendingId: "healthy-agent-pending", needCaptcha: false }; } });
    const until = Date.now() + 5000;
    while (!gateway.getJwxtAgentState("healthy-agent").ready) { assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(getJwxtAgentRuntimeConfig().localJwxtEnabled, true);
    mode = "headers";
    const started = Date.now();
    const result = await pool.beginLogin();
    assert.ok(result.pendingId); assert.equal(agentCalls, 1);
    assert.ok(Date.now() - started < 1000);
    await waitClosed();
  });
});
