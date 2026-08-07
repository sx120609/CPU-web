import assert from "node:assert/strict";
import test from "node:test";
import { shouldNotifyQqBotAdReport } from "../src/services/qqbot/adReportPolicy";

test("notifies again at every configured strike multiple", () => {
  assert.equal(shouldNotifyQqBotAdReport(3, 3), true);
  assert.equal(shouldNotifyQqBotAdReport(6, 3), true);
  assert.equal(shouldNotifyQqBotAdReport(9, 3), true);
});

test("does not notify before or between strike thresholds", () => {
  assert.equal(shouldNotifyQqBotAdReport(2, 3), false);
  assert.equal(shouldNotifyQqBotAdReport(4, 3), false);
  assert.equal(shouldNotifyQqBotAdReport(5, 3), false);
});

test("keeps reporting disabled when the threshold is zero", () => {
  assert.equal(shouldNotifyQqBotAdReport(100, 0), false);
});
