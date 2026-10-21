import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryJwxtRead, jwxtRetryDelay, waitForJwxtRetry } from "../src/utils/jwxtReadRetry";

test("temporary recovery retries reads with a bound, without replaying mutations or school failures", () => {
  const input = { method: "get", status: 503, code: 5306, message: "recovering", attempts: 0 };
  assert.equal(shouldRetryJwxtRead(input), true);
  for (const method of ["post", "delete", "patch", "put"]) assert.equal(shouldRetryJwxtRead({ ...input, method }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, attempts: 2 }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, aborted: true }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, status: 502, code: 5002 }), false);
  assert.equal(shouldRetryJwxtRead({ ...input, status: 401, code: 4001 }), false);
});

test("read retry respects Retry-After and adds jitter without unbounded waiting", () => {
  assert.equal(jwxtRetryDelay(0, "3", 0, 0.5), 3250);
  assert.equal(jwxtRetryDelay(1, undefined, 0, 0), 1000);
  assert.equal(jwxtRetryDelay(0, "invalid", 0, 0), 500);
  assert.equal(jwxtRetryDelay(0, new Date(5000).toUTCString(), 0, 0), 5000);
  assert.equal(jwxtRetryDelay(0, "60", 0, 0), null);
});

test("aborting retry backoff stops waiting immediately", async () => {
  const controller = new AbortController();
  const waiting = assert.rejects(waitForJwxtRetry(10000, controller.signal), { name: "AbortError" });
  controller.abort(); await waiting;
  await assert.rejects(waitForJwxtRetry(10000, controller.signal), { name: "AbortError" });
});
