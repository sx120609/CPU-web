import assert from 'node:assert/strict';
import test from 'node:test';
import { lensOffset, stepSpring } from '../src/utils/liquidGlass';

test('the lens preserves its center and refracts opposite rims inward symmetrically', () => {
  assert.deepEqual(lensOffset(171, 32, 342, 64, 24, 24), { x: 0, y: 0 });
  const top = lensOffset(171, 1, 342, 64, 24, 24);
  const bottom = lensOffset(171, 63, 342, 64, 24, 24);
  assert.ok(top.y > 15 && bottom.y < -15);
  assert.ok(Math.abs(top.y + bottom.y) < 1e-9);
  const inner = lensOffset(171, 12, 342, 64, 24, 24);
  assert.ok(inner.y > 0 && inner.y < top.y);
  for (const x of [0, 10, 32, 171, 310, 341]) {
    for (const y of [0, 1, 16, 32, 48, 63]) {
      const offset = lensOffset(x, y, 342, 64, 10, 14, true);
      assert.ok(Number.isFinite(offset.x) && Number.isFinite(offset.y));
      assert.ok(Math.hypot(offset.x, offset.y) <= 14 + 1e-9);
    }
  }
});

test('finger tracking converges without overshoot and behaves the same at 60 and 120 Hz', () => {
  function advance(hz: number) {
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < hz / 5; i++) {
      state = stepSpring(state, 4, 1 / hz, 1000, 1);
      assert.ok(state.value >= 0 && state.value <= 4);
    }
    return state;
  }
  const sixty = advance(60);
  const oneTwenty = advance(120);
  assert.ok(sixty.value > 3.94);
  assert.ok(Math.abs(sixty.value - oneTwenty.value) < 1e-9);
  assert.ok(Math.abs(sixty.velocity - oneTwenty.velocity) < 1e-9);
});

test('press and release retain a continuous spring velocity and settle back to natural size', () => {
  let state = { value: 1, velocity: 0 };
  for (let i = 0; i < 12; i++) state = stepSpring(state, 78 / 56, 1 / 60, 250, 0.6);
  assert.ok(state.value > 1.3);
  const atRelease = state.value;
  state = stepSpring(state, 1, 1 / 120, 250, 0.6);
  assert.ok(Math.abs(state.value - atRelease) < 0.05);
  for (let i = 0; i < 180; i++) state = stepSpring(state, 1, 1 / 120, 250, 0.6);
  assert.ok(Math.abs(state.value - 1) < 0.001);
});
