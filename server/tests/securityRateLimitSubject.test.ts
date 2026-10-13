import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";

function call(limiter: any, req: any) {
  return new Promise<number>((resolve) => {
    const res: any = {
      setHeader() {},
      status(code: number) { resolve(code); return { json() {} }; },
    };
    limiter({ ip: "10.0.0.1", socket: {}, body: {}, ...req }, res, () => resolve(200));
  });
}

test("users behind one campus NAT address do not share a quota", async () => {
  const { securityRateLimit } = await import("../src/middleware/securityRateLimit");
  const limiter = securityRateLimit("test-campus-nat", 2, 60_000);
  for (const userId of [1, 2, 3]) {
    assert.equal(await call(limiter, { user: { userId } }), 200);
    assert.equal(await call(limiter, { user: { userId } }), 200);
  }
  assert.equal(await call(limiter, { user: { userId: 1 } }), 429, "each account still has its own limit");
});

test("an explicit subject wins over the account, and anonymous requests fall back to the address", async () => {
  const { securityRateLimit } = await import("../src/middleware/securityRateLimit");
  const limiter = securityRateLimit("test-install", 1, 60_000, (req: any) => req.body.installId);
  assert.equal(await call(limiter, { body: { installId: "a" }, user: { userId: 9 } }), 200);
  assert.equal(await call(limiter, { body: { installId: "b" }, user: { userId: 9 } }), 200);
  assert.equal(await call(limiter, { body: { installId: "a" } }), 429);
  const anonymous = securityRateLimit("test-anonymous", 1, 60_000);
  assert.equal(await call(anonymous, {}), 200);
  assert.equal(await call(anonymous, {}), 429);
});
