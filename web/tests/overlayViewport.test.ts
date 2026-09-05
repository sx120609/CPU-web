import assert from "node:assert/strict";
import test from "node:test";
import { getOverlayViewport } from "../src/utils/overlayViewport";

test("Android browser keyboard shrinks only the visual viewport", () => {
  assert.deepEqual(getOverlayViewport({ layoutHeight: 800, visualHeight: 460 }), { top: 0, height: 460 });
});

test("native WebView resize does not subtract the keyboard a second time", () => {
  assert.deepEqual(getOverlayViewport({ layoutHeight: 460, visualHeight: 460 }), { top: 0, height: 460 });
});

test("viewport panning keeps the dialog above the keyboard", () => {
  assert.deepEqual(getOverlayViewport({ layoutHeight: 800, visualHeight: 420, offsetTop: 60 }), { top: 60, height: 420 });
});

test("overlay keyboards clip at their top edge without adding their height twice", () => {
  const keyboard = { keyboardTop: 440, keyboardHeight: 360 };
  assert.deepEqual(getOverlayViewport({ layoutHeight: 800, visualHeight: 800, ...keyboard }), { top: 0, height: 440 });
  assert.deepEqual(getOverlayViewport({ layoutHeight: 800, visualHeight: 440, ...keyboard }), { top: 0, height: 440 });
});

test("closed keyboard, rotation, and browsers without VisualViewport use current dimensions", () => {
  assert.deepEqual(getOverlayViewport({ layoutHeight: 800, visualHeight: 800, keyboardHeight: 0 }), { top: 0, height: 800 });
  assert.deepEqual(getOverlayViewport({ layoutHeight: 390, visualHeight: 390 }), { top: 0, height: 390 });
  assert.deepEqual(getOverlayViewport({ layoutHeight: 720 }), { top: 0, height: 720 });
});
