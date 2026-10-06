import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryJwxtRead } from "../src/utils/jwxtReadRetry";

test("temporary recovery retries reads with a bound, without replaying mutations or school failures", () => {
  const input = { method: "get", status: 503, code: 5306, message: "recovering", attempts: 0 };
  assert.equal(shouldRetryJwxtRead(input), true);
  for (const method of ["post", "delete", "patch", "put"]) assert.equal(shouldRetryJwxtRead({ ...input, method }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, attempts: 2 }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, aborted: true }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, status: 502, code: 5002 }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, status: 401, code: 4001 }), false);
});
