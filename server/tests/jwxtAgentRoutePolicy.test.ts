import assert from "node:assert/strict";
import test from "node:test";

test("JWXT Agent routes live as long as the encrypted session", async () => {
  process.env.JWT_SECRET = "jwxt-route-policy-test-secret-0123456789abcdef";
  const [{ JWXT_TOKEN_ROUTE_MAX_AGE_MS }, { config }] = await Promise.all([
    import("../src/services/jwxtAgentRemote"),
    import("../src/config"),
  ]);

  assert.equal(JWXT_TOKEN_ROUTE_MAX_AGE_MS, config.jwxtSessionIdleMs);
  assert.ok(JWXT_TOKEN_ROUTE_MAX_AGE_MS > 7 * 24 * 60 * 60 * 1000);
});
