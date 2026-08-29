import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import test from "node:test";

process.env.JWT_SECRET = "browser-security-integration-secret-0123456789abcdef";
process.env.JWXT_SESSION_SYNC_KEY = "browser-security-sync-secret-0123456789abcdef";
process.env.REDIS_ENABLED = "false";

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function cookiePair(setCookie: string, name: string) {
  const item = setCookie.split(/,(?=\s*[^;,]+=)/).find((part) => part.trim().startsWith(`${name}=`));
  return item?.trim().split(";", 1)[0] || "";
}

test("browser auth uses encrypted HttpOnly session and enforces CSRF", async (t) => {
  const { browserSessionMiddleware, requestOriginAndCsrfProtection } = await import("../src/middleware/browserSession");
  const { issueBrowserSession, browserSessionStorageKey } = await import("../src/services/browserSession");
  const { securityHeaders } = await import("../src/middleware/securityHeaders");
  const { getEphemeralValue } = await import("../src/services/cache");
  const app = express();
  app.set("trust proxy", true);
  app.use(securityHeaders, express.json(), browserSessionMiddleware, requestOriginAndCsrfProtection);
  app.post("/login", async (_req, res) => {
    await issueBrowserSession(res, {
      siteToken: "site-jwt-private-value-0123456789",
      jwxtToken: "jwxt-private-handle-0123456789",
    });
    res.json({ ok: true });
  });
  app.post("/session-login", async (_req, res) => {
    await issueBrowserSession(res, {
      siteToken: "site-jwt-private-value-0123456789",
      persistent: false,
    });
    res.json({ ok: true });
  });
  app.post("/write", (_req, res) => res.json({ ok: true }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(Number(error?.status || 500)).json({ error: String(error?.message || "error") });
  });

  const server = createServer(app);
  t.after(() => closeServer(server));
  await listen(server);
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const rejected = await fetch(`${origin}/login`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(rejected.status, 403);
  const spoofedForwardedHost = await fetch(`${origin}/login`, {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
      "X-Forwarded-Host": "evil.example",
    },
  });
  assert.equal(spoofedForwardedHost.status, 403);

  const login = await fetch(`${origin}/login`, {
    method: "POST",
    headers: { Origin: "https://unexpected.example", "X-CPU-Auth-Mode": "cookie" },
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /cpu-session=[^;]+;.*HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Max-Age=\d+/i);
  const sessionCookie = cookiePair(setCookie, "cpu-session");
  const csrfCookie = cookiePair(setCookie, "cpu-csrf");
  assert.ok(sessionCookie && csrfCookie);
  const sessionId = sessionCookie.split("=", 2)[1];
  const stored = await getEphemeralValue(browserSessionStorageKey(sessionId));
  assert.ok(stored);
  assert.equal(stored.includes("site-jwt-private-value"), false);
  assert.equal(stored.includes("jwxt-private-handle"), false);

  const missingCsrf = await fetch(`${origin}/write`, {
    method: "POST",
    headers: { Origin: origin, Cookie: `${sessionCookie}; ${csrfCookie}`, "X-CPU-Auth-Mode": "cookie" },
  });
  assert.equal(missingCsrf.status, 403);

  const csrf = csrfCookie.split("=", 2)[1];
  const accepted = await fetch(`${origin}/write`, {
    method: "POST",
    headers: {
      Origin: "https://unexpected.example",
      Cookie: `${sessionCookie}; ${csrfCookie}`,
      "X-CPU-Auth-Mode": "cookie",
      "X-CSRF-Token": csrf,
    },
  });
  assert.equal(accepted.status, 200);
  const contentSecurityPolicy = accepted.headers.get("content-security-policy") || "";
  assert.match(contentSecurityPolicy, /require-trusted-types-for 'script'/);
  assert.match(contentSecurityPolicy, /trusted-types default dompurify vue/);
  assert.match(contentSecurityPolicy, /script-src 'self' https:\/\/img\.cputime\.cn https:\/\/cputime-1462084442\.cos\.ap-shanghai\.myqcloud\.com/);
  assert.match(contentSecurityPolicy, /font-src 'self' data: https:\/\/img\.cputime\.cn https:\/\/cputime-1462084442\.cos\.ap-shanghai\.myqcloud\.com/);

  const nonPersistentLogin = await fetch(`${origin}/session-login`, {
    method: "POST",
    headers: { Origin: origin, "X-CPU-Auth-Mode": "cookie" },
  });
  assert.equal(nonPersistentLogin.status, 200);
  assert.doesNotMatch(nonPersistentLogin.headers.get("set-cookie") || "", /Max-Age=/i);
});
