import assert from "node:assert/strict";
import test from "node:test";
import {
  assumesKeyboardOnFocus,
  closeKeyboardAfterBlur,
  initialKeyboardViewportState,
  KEYBOARD_BLUR_CLOSE_MS,
  measureKeyboardInset,
  reduceKeyboardBaseline,
  reduceKeyboardGeometry,
  settleKeyboardGeometryClose,
  type KeyboardViewportState,
  type ViewportSample,
} from "../src/utils/keyboardViewport";

type Focus = { editableFocused: boolean; closePending?: boolean; innerHeightIgnoresKeyboard?: boolean };

/** Mirrors MainLayout: baseline first, then geometry, for every viewport event. */
function step(state: KeyboardViewportState, sample: ViewportSample, focus: Focus, enabled = true) {
  const closePending = focus.closePending ?? state.geometryOpen;
  const baseline = reduceKeyboardBaseline(state, sample, { ...focus, closePending });
  return reduceKeyboardGeometry(baseline, sample, { editableFocused: focus.editableFocused, enabled });
}

function replay(samples: ViewportSample[], focus: Focus) {
  let state = initialKeyboardViewportState;
  for (const sample of samples) state = step(state, sample, focus).state;
  return state;
}

const view = (innerWidth: number, innerHeight: number, visualHeight = innerHeight, extra: Partial<ViewportSample> = {}): ViewportSample => ({
  innerWidth,
  innerHeight,
  visualHeight,
  ...extra,
});

test("rotating an iPad without a focused field never reports a keyboard (iPadOS 16 has no screen.orientation)", () => {
  const state = replay([view(820, 1106), view(1180, 746), view(820, 1106), view(1180, 746)], { editableFocused: false });
  assert.equal(state.geometryOpen, false);
  assert.equal(state.baseHeight, 746);
});

test("shrinking a Stage Manager window is not a keyboard", () => {
  const state = replay([view(900, 760), view(900, 600)], { editableFocused: false });
  assert.equal(state.geometryOpen, false);
  assert.equal(state.baseHeight, 600);
});

test("a stale taller baseline is replaced, not kept as a maximum", () => {
  let state = replay([view(900, 760), view(900, 600)], { editableFocused: false });
  // Focusing a field now must measure against 600, so a 40 px toolbar is not read as a keyboard.
  state = step(state, view(900, 600, 560), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, false);
});

test("the iOS keyboard shrinks the visual viewport while a field is focused", () => {
  let state = replay([view(820, 1106)], { editableFocused: false });
  state = step(state, view(820, 1106, 700), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, true);
  assert.equal(measureKeyboardInset(state, view(820, 1106, 700)), 406);
});

test("on iPadOS a focused Stage Manager window that gets shorter is not a keyboard", () => {
  const ios = { innerHeightIgnoresKeyboard: true };
  let state = replay([view(900, 760)], { editableFocused: false, ...ios });
  // Hardware keyboard: no software keyboard, but window and visual viewport shrink together.
  state = step(state, view(900, 600), { editableFocused: true, ...ios }).state;
  assert.equal(state.geometryOpen, false);
  assert.equal(state.baseHeight, 600);
  // The software keyboard still opens, because it only shrinks the visual viewport.
  state = step(state, view(900, 600, 300), { editableFocused: true, ...ios }).state;
  assert.equal(state.geometryOpen, true);
  // A resize with the keyboard up moves the baseline with the window; the keyboard stays measured.
  state = step(state, view(900, 700, 400), { editableFocused: true, ...ios }).state;
  assert.equal(state.geometryOpen, true);
  assert.equal(measureKeyboardInset(state, view(900, 700, 400)), 300);
  assert.equal(step(state, view(900, 700), { editableFocused: true, ...ios }).scheduleClose, true);
});

test("a field that stays focused across a route change keeps the keyboard measurable", () => {
  let state = replay([view(800, 1200)], { editableFocused: false });
  state = step(state, view(800, 760), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, true);
  // Even if the route change reset the geometry, the focused field keeps the Android adjustResize
  // baseline, so the next viewport event reports the keyboard again instead of adopting 760 as the baseline.
  const next = step({ ...state, geometryOpen: false }, view(800, 760), { editableFocused: true, closePending: false }).state;
  assert.equal(next.geometryOpen, true);
  assert.equal(next.baseHeight, 1200);
});

test("Android adjustResize shrinks innerHeight while a field is focused", () => {
  let state = replay([view(800, 1200)], { editableFocused: false });
  state = step(state, view(800, 760), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, true);
  assert.equal(state.baseHeight, 1200);
});

test("the keyboard closes at the latest 600 ms after the last blur, even if the geometry is stuck", () => {
  assert.ok(KEYBOARD_BLUR_CLOSE_MS <= 600);
  let state = replay([view(820, 1106)], { editableFocused: false });
  state = step(state, view(820, 1106, 700), { editableFocused: true }).state;
  // Rotated while the keyboard was up; the viewport still looks covered after the blur.
  const rotated = view(1180, 746, 400);
  const blurred = step(state, rotated, { editableFocused: false, closePending: true });
  assert.equal(blurred.state.geometryOpen, true);
  const closed = closeKeyboardAfterBlur(blurred.state, view(1180, 746));
  assert.equal(closed.geometryOpen, false);
  assert.equal(closed.baseHeight, 746);
  assert.equal(step(closed, view(1180, 746), { editableFocused: false }).state.geometryOpen, false);
});

test("a normal close is confirmed after the keyboard has gone", () => {
  let state = replay([view(820, 1106)], { editableFocused: false });
  state = step(state, view(820, 1106, 700), { editableFocused: true }).state;
  const result = step(state, view(820, 1106), { editableFocused: true });
  assert.equal(result.scheduleClose, true);
  assert.equal(settleKeyboardGeometryClose(result.state, view(820, 1106, 700)).geometryOpen, true);
  assert.equal(settleKeyboardGeometryClose(result.state, view(820, 1106)).geometryOpen, false);
});

test("pinch zoom with nothing focused is not a keyboard and does not move the baseline", () => {
  let state = replay([view(820, 1106)], { editableFocused: false });
  const zoomed = view(410, 553, 553, { visualScale: 2 });
  const result = step(state, zoomed, { editableFocused: false });
  assert.equal(result.state.geometryOpen, false);
  assert.equal(result.state.baseHeight, 1106);
  state = result.state;
  // Focus zoom: the keyboard is measured in unzoomed pixels.
  state = step(state, view(820, 1106, 350, { visualScale: 2 }), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, true);
});

test("a hardware-keyboard shortcut bar is not a software keyboard", () => {
  let state = replay([view(820, 1106)], { editableFocused: false });
  state = step(state, view(820, 1106, 1051), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, false);
});

test("mouse-driven layouts never report a keyboard", () => {
  let state = replay([view(1280, 900)], { editableFocused: false });
  state = step(state, view(1280, 900, 400), { editableFocused: true }, false).state;
  assert.equal(state.geometryOpen, false);
});

test("the VirtualKeyboard API inset counts even when the viewport does not shrink", () => {
  let state = replay([view(800, 1200)], { editableFocused: false });
  state = step(state, view(800, 1200, 1200, { keyboardInset: 380 }), { editableFocused: true }).state;
  assert.equal(state.geometryOpen, true);
});

test("only phones assume a keyboard as soon as an editor is focused", () => {
  const focus = { editableFocused: true, withinFocusGrace: true, fullHeightContent: false, editorFocused: true };
  assert.equal(assumesKeyboardOnFocus("phone", focus), true);
  assert.equal(assumesKeyboardOnFocus("tablet", focus), false);
  assert.equal(assumesKeyboardOnFocus("desktop", focus), false);
  assert.equal(assumesKeyboardOnFocus("phone", { ...focus, withinFocusGrace: false }), false);
  assert.equal(assumesKeyboardOnFocus("phone", { ...focus, editorFocused: false }), false);
  assert.equal(assumesKeyboardOnFocus("phone", { ...focus, editorFocused: false, fullHeightContent: true }), true);
});
