import assert from "node:assert/strict";
import test from "node:test";
import { smartPostRateLimitRetryMs } from "../src/utils/smartPostPolling";

test("智慧发帖轮询在 429 后遵循 Retry-After", () => {
  assert.equal(smartPostRateLimitRetryMs({ response: { headers: { "retry-after": "3600" } } }), 3_600_000);
  assert.equal(smartPostRateLimitRetryMs({ response: { headers: { get: () => "120" } } }), 120_000);
});

test("无有效 Retry-After 时不会高频重试", () => {
  assert.equal(smartPostRateLimitRetryMs({ response: { headers: {} } }), 3_600_000);
  assert.equal(smartPostRateLimitRetryMs({ response: { headers: { "retry-after": "1" } } }), 60_000);
});
