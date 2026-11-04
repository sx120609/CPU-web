import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

const secret = "cpudate-test-secret-with-32-characters";
const callback = "https://cpudate.com/auth/sso/callback";
process.env.REDIS_ENABLED = "false";
process.env.NODE_ENV = "test";
delete process.env.CPUDATE_OAUTH_CLIENT_ID;
process.env.CPUDATE_ORIGIN = " https://cpudate.com/// ";
process.env.CPUDATE_INTEGRATION_SECRET = ` ${secret} `;

test("CPU Date configuration defaults the client ID and normalizes origin and secret", async () => {
  const { config } = await import("../src/config");
  assert.equal(config.cpudateOAuthClientId, "cpudate");
  assert.equal(config.cpudateOrigin, "https://cpudate.com");
  assert.equal(config.cpudateIntegrationSecret, secret);
});

test("CPU Date stays disabled without a sufficient secret or a callback origin", async t => {
  const { config } = await import("../src/config");
  const { isServiceOAuthClientId, serviceOAuthClient, oauthClientIsValid, oauthScopesAllowed } = await import("../src/services/oauthClients");
  const before = { ...config };
  t.after(() => Object.assign(config, before));
  assert.equal(isServiceOAuthClientId("cpudate"), true);
  for (const value of ["", "a".repeat(31)]) {
    config.cpudateIntegrationSecret = value;
    assert.equal(serviceOAuthClient("cpudate"), null);
    assert.equal(oauthClientIsValid("cpudate", callback), false);
    assert.equal(oauthScopesAllowed("cpudate", ["openid", "profile"]), false);
  }
  config.cpudateIntegrationSecret = "a".repeat(32);
  assert.equal(oauthClientIsValid("cpudate", callback), true);
  config.cpudateOrigin = "";
  assert.equal(oauthClientIsValid("cpudate", callback), false);
});

test("CPU Date requires its exact HTTPS callback and profile scopes in production", async t => {
  const { config } = await import("../src/config");
  const { serviceOAuthClient, oauthClientIsValid, oauthScopesAllowed } = await import("../src/services/oauthClients");
  const before = { ...config };
  t.after(() => Object.assign(config, before));
  config.nodeEnv = "production";
  assert.deepEqual(serviceOAuthClient("cpudate"), { secret, callback });
  assert.equal(oauthClientIsValid("cpudate", callback), true);
  for (const uri of [
    "https://www.cpudate.com/auth/sso/callback", "https://cpudate.com/other",
    "https://evil.test/auth/sso/callback", "http://cpudate.com/auth/sso/callback",
    "https://user:password@cpudate.com/auth/sso/callback",
    `${callback}/`, `${callback}?x=1`, `${callback}#x`,
  ]) assert.equal(oauthClientIsValid("cpudate", uri), false, uri);
  assert.equal(oauthClientIsValid("nope", callback), false);
  assert.equal(oauthClientIsValid("cpu-electron", "http://127.0.0.1:19723/callback"), true);
  assert.equal(oauthScopesAllowed("cpudate", ["openid", "profile"]), true);
  for (const scopes of [[], ["ai"], ["openid", "profile", "ai"], ["email"]]) {
    assert.equal(oauthScopesAllowed("cpudate", scopes), false);
  }
  config.cpudateOrigin = "http://127.0.0.1:18089";
  assert.equal(oauthClientIsValid("cpudate", `${config.cpudateOrigin}/auth/sso/callback`), false);
  config.cpudateOrigin = "https://cpudate.com";
  config.cpudateOAuthClientId = "cpudate-custom";
  assert.equal(oauthClientIsValid("cpudate", callback), false);
  assert.equal(oauthClientIsValid("cpudate-custom", callback), true);
});

test("CPU Date authorize, token, userinfo and revoke reuse confidential OAuth protections", async t => {
  const { config } = await import("../src/config");
  const { prisma } = await import("../src/prisma");
  const { signToken } = await import("../src/utils/jwt");
  const { oauthRouter } = await import("../src/routes/oauth");
  const replace = (target: any, key: string, value: any) => {
    const original = target[key];
    target[key] = value;
    t.after(() => { target[key] = original; });
  };
  const before = { ...config };
  t.after(() => Object.assign(config, before));
  config.shopIntegrationSecret = "separate-shop-test-secret-32-characters";
  config.payIntegrationSecret = "separate-pay-test-secret-32-characters";
  config.noAiIntegrationSecret = "separate-noai-test-secret-32-characters";
  const user = { id: 7, username: "2020260001", studentSso: true, schoolId: "cpu", role: "user", status: "active", nickname: "Test member", avatar: "/uploads/avatars/test.png" };
  // In-memory persistence exercises the real router and authentication without a database.
  let code: any;
  let token: any;
  replace(prisma.user, "findUnique", async () => user);
  replace(prisma.oAuthAuthorizationCode, "create", async ({ data }: any) => (code = { id: 1, usedAt: null, ...data }));
  replace(prisma.oAuthAuthorizationCode, "findUnique", async ({ where }: any) => code?.codeHash === where.codeHash ? code : null);
  replace(prisma.oAuthAuthorizationCode, "updateMany", async () => {
    if (code.usedAt) return { count: 0 };
    code.usedAt = new Date();
    return { count: 1 };
  });
  replace(prisma.oAuthAccessToken, "create", async ({ data }: any) => (token = { id: 1, revokedAt: null, user, ...data }));
  replace(prisma.oAuthAccessToken, "findUnique", async ({ where }: any) => token?.tokenHash === where.tokenHash ? token : null);
  replace(prisma.oAuthAccessToken, "update", async () => token);
  replace(prisma.oAuthAccessToken, "updateMany", async ({ where }: any) => {
    assert.equal(where.clientId, "cpudate");
    assert.equal(where.tokenHash, token.tokenHash);
    token.revokedAt = new Date();
    return { count: 1 };
  });
  const app = express();
  app.use("/api/oauth", express.json(), express.urlencoded({ extended: false }), oauthRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 400).json({ error: err.message }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const verifier = "a".repeat(43);
  const params = {
    response_type: "code", client_id: "cpudate", redirect_uri: callback, scope: "openid profile", state: "test123",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  };
  const authorize = (overrides = {}, headers = {}) => fetch(`${origin}/api/oauth/authorize?${new URLSearchParams({ ...params, ...overrides })}`, { redirect: "manual", headers });
  const loggedOut = await authorize();
  assert.equal(loggedOut.status, 302);
  const login = new URL(loggedOut.headers.get("location")!, origin);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("redirect"), `/api/oauth/authorize?${new URLSearchParams(params)}`);
  assert.equal((await authorize({ client_id: "nope", redirect_uri: "https://x/cb" })).status, 400);
  config.cpudateIntegrationSecret = "";
  assert.equal((await authorize()).status, 400);
  config.cpudateIntegrationSecret = secret;
  const deniedScope = await authorize({ scope: "openid profile ai" });
  assert.equal(deniedScope.status, 302);
  assert.equal(new URL(deniedScope.headers.get("location")!).searchParams.get("error"), "invalid_scope");
  assert.equal((await authorize({ code_challenge_method: "plain" })).status, 400);
  const siteToken = signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "" });
  const authorized = await authorize({}, { Authorization: `Bearer ${siteToken}` });
  assert.equal(authorized.status, 302);
  const redirect = new URL(authorized.headers.get("location")!);
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get("state"), params.state);
  assert.equal(code.userId, user.id);
  const body = {
    grant_type: "authorization_code", code: redirect.searchParams.get("code")!, client_id: "cpudate",
    redirect_uri: callback, code_verifier: verifier, client_secret: secret,
  };
  const exchange = (overrides = {}) => fetch(`${origin}/api/oauth/token`, {
    method: "POST", body: new URLSearchParams({ ...body, ...overrides }),
  });
  for (const value of ["", "wrong", config.shopIntegrationSecret, config.payIntegrationSecret, config.noAiIntegrationSecret]) {
    assert.equal((await exchange({ client_secret: value })).status, 401);
  }
  assert.equal((await exchange({ code_verifier: "b".repeat(43) })).status, 400);
  assert.equal((await exchange({ redirect_uri: `${callback}/` })).status, 400);
  assert.equal(code.usedAt, null);
  const exchanged = await exchange();
  assert.equal(exchanged.status, 200);
  const credentials = await exchanged.json();
  assert.equal(credentials.scope, "openid profile");
  assert.equal(credentials.token_type, "Bearer");
  assert.equal((await exchange()).status, 400);
  const headers = { Authorization: `Bearer ${credentials.access_token}` };
  const profile = await fetch(`${origin}/api/oauth/userinfo`, { headers });
  assert.equal(profile.status, 200);
  assert.equal(profile.headers.get("cache-control"), "no-store");
  assert.deepEqual((await profile.json()).data, {
    sub: "7",
    user: { id: 7, studentId: user.username, studentSso: true, schoolId: "cpu", nickname: user.nickname, avatar: "https://cputime.cn/uploads/avatars/test.png" },
  });
  user.studentSso = false;
  const unverified = await fetch(`${origin}/api/oauth/userinfo`, { headers });
  assert.equal(unverified.status, 200);
  const unverifiedProfile = (await unverified.json()).data;
  assert.equal(unverifiedProfile.user.studentId, null);
  assert.equal(unverifiedProfile.user.studentSso, false);
  assert.equal((await fetch(`${origin}/api/oauth/v1/responses`, { method: "POST", headers })).status, 403);
  const revoke = (clientSecret: string) => fetch(`${origin}/api/oauth/revoke`, {
    method: "POST", body: new URLSearchParams({ client_id: "cpudate", client_secret: clientSecret, token: credentials.access_token }),
  });
  assert.equal((await revoke(config.noAiIntegrationSecret)).status, 401);
  assert.equal((await revoke(secret)).status, 200);
  assert.equal((await fetch(`${origin}/api/oauth/userinfo`, { headers })).status, 401);
});

test("CPU Date student IDs preserve leading zeros and retain the school namespace", async () => {
  const { buildCpudateUserInfo } = await import("../src/services/cpudateOAuth");
  const user = { id: 7, username: "0012345678", studentSso: true, schoolId: "cpu", nickname: "Test member", avatar: null };
  assert.equal(buildCpudateUserInfo(user).user.studentId, "0012345678");
  assert.equal(buildCpudateUserInfo({ ...user, schoolId: "njmu" }).user.schoolId, "njmu");
  assert.equal(buildCpudateUserInfo({ ...user, studentSso: false }).user.studentId, null);
});

test("CPU Date avatar URLs work outside CPU-web, including inline and missing avatars", async () => {
  const { buildCpudateUserInfo } = await import("../src/services/cpudateOAuth");
  const user = { id: 7, username: "2020260001", studentSso: true, schoolId: "cpu", nickname: "Test member", avatar: null as string | null };
  assert.equal(buildCpudateUserInfo(user).user.avatar, null);
  assert.equal(buildCpudateUserInfo({ ...user, avatar: "/uploads/avatar.png" }).user.avatar, "https://cputime.cn/uploads/avatar.png");
  assert.equal(buildCpudateUserInfo({ ...user, avatar: "/uploads/avatar.png" }, "https://cpu.example.com").user.avatar, "https://cpu.example.com/uploads/avatar.png");
  assert.equal(buildCpudateUserInfo({ ...user, avatar: "https://cdn.example.com/avatar.png" }).user.avatar, "https://cdn.example.com/avatar.png");
  assert.match(buildCpudateUserInfo({ ...user, avatar: "data:image/png;base64,aGVsbG8=" }).user.avatar!, /^https:\/\/cputime\.cn\/api\/user-avatars\/7\?v=[a-f0-9]{16}$/);
  for (const avatar of ["javascript:alert(1)", "file:///etc/passwd", "https://["]) {
    assert.equal(buildCpudateUserInfo({ ...user, avatar }).user.avatar, null);
  }
});
