import assert from "node:assert/strict";
import test from "node:test";
import { OVERLAY_MAX, OVERLAY_MIN, recommendBackgroundOverlay } from "../src/views/schedule/backgroundTone";

function solid(red: number, green: number, blue: number, count = 64, alpha = 255) {
  const pixels: number[] = [];
  for (let index = 0; index < count; index += 1) pixels.push(red, green, blue, alpha);
  return pixels;
}

test("a pale picture keeps the lightest veil in light mode but needs a thick one in dark mode", () => {
  const pale = solid(236, 240, 244);
  assert.equal(recommendBackgroundOverlay(pale, false), OVERLAY_MIN);
  assert.equal(recommendBackgroundOverlay(pale, true), OVERLAY_MAX);
});

test("a dark picture needs a thick veil in light mode but the lightest one in dark mode", () => {
  const night = solid(20, 24, 40);
  assert.equal(recommendBackgroundOverlay(night, true), OVERLAY_MIN);
  const light = recommendBackgroundOverlay(night, false)!;
  assert.ok(light > 0.5 && light <= OVERLAY_MAX, String(light));
});

test("a mid-tone picture lands in between, and darker patches push the light veil up", () => {
  const mid = recommendBackgroundOverlay(solid(90, 100, 110), false)!;
  assert.ok(mid > OVERLAY_MIN && mid < OVERLAY_MAX, String(mid));
  const patchy = recommendBackgroundOverlay([...solid(90, 100, 110, 48), ...solid(30, 30, 30, 16)], false)!;
  assert.ok(patchy > mid, `${patchy} > ${mid}`);
});

test("fully transparent pixels are ignored and an empty picture gives no advice", () => {
  assert.equal(recommendBackgroundOverlay(solid(0, 0, 0, 64, 0), false), null);
  assert.equal(recommendBackgroundOverlay([...solid(236, 240, 244), ...solid(0, 0, 0, 64, 0)], false), OVERLAY_MIN);
});
