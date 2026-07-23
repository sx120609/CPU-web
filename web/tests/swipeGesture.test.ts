import assert from "node:assert/strict";
import test from "node:test";
import { resolveSwipeIntent } from "../src/views/schedule/swipeGesture";

test("locks a slightly diagonal week swipe horizontally", () => {
  assert.equal(resolveSwipeIntent(4, 6), "horizontal");
  assert.equal(resolveSwipeIntent(-5, 8), "horizontal");
});

test("keeps a clear vertical scroll vertical", () => {
  assert.equal(resolveSwipeIntent(2, 10), "vertical");
  assert.equal(resolveSwipeIntent(-3, -12), "vertical");
});

test("waits through tiny touch jitter and preserves an existing lock", () => {
  assert.equal(resolveSwipeIntent(2, 2), "pending");
  assert.equal(resolveSwipeIntent(20, 1, "vertical"), "vertical");
  assert.equal(resolveSwipeIntent(1, 20, "horizontal"), "horizontal");
});
