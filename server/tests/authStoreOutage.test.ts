import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";
process.env.JWT_SECRET = "auth-outage-test-secret-0123456789abcdef";
process.env.JWXT_SESSION_SYNC_KEY = "auth-outage-sync-test-0123456789abcdef";

const sessionId = "s".repeat(43);

async function run(middleware: (req: any, res: any, next: (error?: any) => void) => unknown, req: any) {
  let passed: any = "not called";
  await middleware(req, { cookie() {}, setHeader() {} }, (error?: any) => { passed = error; });
  return passed;
}

async function requestWithSessionCookie() {
  const { BROWSER_SESSION_COOKIE } = await import("../src/services/browserSession");
  return { headers: { cookie: `${BROWSER_SESSION_COOKIE}=${sessionId}` }, get: () => "" } as any;
}

test("a session store that cannot be read answers 503, not a sign-out", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { readEphemeralValueChecked } = await import("../src/services/cache");
  const { browserSessionStorageKey } = await import("../src/services/browserSession");
  const { browserSessionMiddleware } = await import("../src/middleware/browserSession");
  const { authRequired } = await import("../src/middleware/auth");
  const original = prisma.runtimeSession.findUnique;
  t.after(() => { prisma.runtimeSession.findUnique = original; process.env.DATABASE_URL = ""; });
  // Redis is off and the database is the session store, so a failing query leaves the answer open.
  process.env.DATABASE_URL = "postgresql://outage.invalid/cpu";
  prisma.runtimeSession.findUnique = (async () => { throw new Error("connection refused"); }) as any;

  assert.deepEqual(await readEphemeralValueChecked(browserSessionStorageKey(sessionId)), { value: null, complete: false });
  const req = await requestWithSessionCookie();
  assert.equal(await run(browserSessionMiddleware, req), undefined);
  assert.equal(req.browserSessionUnavailable, true);
  const error = await run(authRequired, req);
  assert.equal(error.status, 503);
  assert.equal(error.code, 5032);

  // The database answers that there is no such session: that one is signed out.
  prisma.runtimeSession.findUnique = (async () => null) as any;
  assert.deepEqual(await readEphemeralValueChecked(browserSessionStorageKey(sessionId)), { value: null, complete: true });
  const gone = await requestWithSessionCookie();
  await run(browserSessionMiddleware, gone);
  assert.equal(gone.browserSessionUnavailable, false);
  assert.equal((await run(authRequired, gone)).status, 401);
});

test("only an invalid credential is a 401; a failing user lookup is a 503", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { authRequired } = await import("../src/middleware/auth");
  const { signToken } = await import("../src/utils/jwt");
  const original = prisma.user.findUnique;
  t.after(() => { prisma.user.findUnique = original; });
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` }, get: () => "" }) as any;
  const token = signToken({ userId: 7, studentId: "2020240444", role: "user", campus: "" } as any);

  assert.equal((await run(authRequired, bearer("not-a-token"))).status, 401);

  prisma.user.findUnique = (async () => { throw new Error("database unavailable"); }) as any;
  const outage = await run(authRequired, bearer(token));
  assert.equal(outage.status, 503);

  prisma.user.findUnique = (async () => ({ id: 7, username: "2020240444", role: "user", voiceHubRole: null, lostFoundRole: null, status: "active", blocksOwned: [] })) as any;
  const req = bearer(token);
  assert.equal(await run(authRequired, req), undefined);
  assert.equal(req.user.userId, 7);

  prisma.user.findUnique = (async () => null) as any;
  assert.equal((await run(authRequired, bearer(token))).status, 401);
});

test("an unreadable 教务 session is unavailable, not expired", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { getSession } = await import("../src/services/jwxtClient");
  const original = prisma.runtimeSession.findUnique;
  t.after(() => { prisma.runtimeSession.findUnique = original; process.env.DATABASE_URL = ""; });
  process.env.DATABASE_URL = "postgresql://outage.invalid/cpu";
  prisma.runtimeSession.findUnique = (async () => { throw new Error("connection refused"); }) as any;
  await assert.rejects(getSession("school-token"), (error: any) => error.status === 503 && !/已失效|重新授权|重新登录/.test(error.message));
  prisma.runtimeSession.findUnique = (async () => null) as any;
  assert.equal(await getSession("school-token"), null);
});
