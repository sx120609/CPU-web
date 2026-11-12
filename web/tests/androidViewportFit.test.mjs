import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

// appearance-bootstrap.js lays a narrow phone in the Android app out as a 393-wide one and shrinks the
// page to the window, so it shows what an iPhone shows. These run the real script against a fake window.
const bootstrap = readFileSync(new URL("../public/appearance-bootstrap.js", import.meta.url), "utf8");
const DEVICE = "width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no";
const APP = "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 CPUWebScheduleApp/66 CPUWebScheduleAppVersion/4.2.0 CPUTimeNative/1";

function run({ userAgent = APP, screen, outerWidth }) {
  const meta = { content: DEVICE, getAttribute() { return this.content; }, setAttribute(_name, value) { this.content = value; } };
  const root = { dataset: {}, classList: { toggle() {} }, style: {} };
  const listeners = {};
  const window = {
    outerWidth,
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, listener) => { listeners[type] = listener; },
  };
  runInNewContext(bootstrap, {
    localStorage: { getItem: () => null },
    navigator: { userAgent, platform: "Linux armv8l", maxTouchPoints: 5 },
    screen,
    window,
    document: {
      documentElement: root,
      querySelector: (selector) => (selector.includes("viewport") ? meta : { setAttribute() {} }),
      createElement: () => ({}),
      head: { appendChild() {} },
    },
  });
  return { meta, root, screen, window, resize: () => listeners.resize?.() };
}

test("a 360dp phone in the Android app lays out 393 wide", () => {
  const page = run({ screen: { width: 360, height: 800 }, outerWidth: 360 });
  assert.equal(page.meta.content, "width=393, viewport-fit=cover, user-scalable=no");
  assert.ok(Math.abs(Number(page.root.dataset.cpuViewportScale) - 360 / 393) < 1e-6);
});

test("the scale follows the short side, so it stays the same in landscape and split screen", () => {
  const page = run({ screen: { width: 360, height: 800 }, outerWidth: 360 });
  // Landscape: the window is 800 wide, shown at the same 360/393.
  Object.assign(page.screen, { width: 800, height: 360 });
  page.window.outerWidth = 800;
  page.resize();
  assert.equal(page.meta.content, "width=873, viewport-fit=cover, user-scalable=no");
  // Split screen in landscape: half the width, same scale.
  page.window.outerWidth = 400;
  page.resize();
  assert.equal(page.meta.content, "width=437, viewport-fit=cover, user-scalable=no");
  // Back to portrait.
  Object.assign(page.screen, { width: 360, height: 800 });
  page.window.outerWidth = 360;
  page.resize();
  assert.equal(page.meta.content, "width=393, viewport-fit=cover, user-scalable=no");
});

test("a very narrow phone stops shrinking at 0.84", () => {
  const page = run({ screen: { width: 320, height: 712 }, outerWidth: 320 });
  assert.equal(page.meta.content, "width=381, viewport-fit=cover, user-scalable=no");
});

test("before the window has a size, or with an implausible one, the screen width is used", () => {
  assert.equal(run({ screen: { width: 360, height: 800 }, outerWidth: 0 }).meta.content, "width=393, viewport-fit=cover, user-scalable=no");
  assert.equal(run({ screen: { width: 360, height: 800 }, outerWidth: 1080 }).meta.content, "width=393, viewport-fit=cover, user-scalable=no");
});

test("phones about as wide as the design, tablets, browsers and iOS keep the device viewport", () => {
  for (const options of [
    { screen: { width: 393, height: 852 }, outerWidth: 393 },
    { screen: { width: 384, height: 832 }, outerWidth: 384 },
    { screen: { width: 412, height: 915 }, outerWidth: 412 },
    { screen: { width: 800, height: 1280 }, outerWidth: 800 },
    { screen: { width: 360, height: 800 }, outerWidth: 360, userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36" },
    { screen: { width: 375, height: 667 }, outerWidth: 375, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CPUTimeNative/1" },
  ]) {
    const page = run(options);
    assert.equal(page.meta.content, DEVICE);
    assert.equal(page.root.dataset.cpuViewportScale, undefined);
  }
});

test("a phone that becomes wide enough (unfolded) goes back to the device viewport", () => {
  const page = run({ screen: { width: 360, height: 800 }, outerWidth: 360 });
  Object.assign(page.screen, { width: 700, height: 800 });
  page.window.outerWidth = 700;
  page.resize();
  assert.equal(page.meta.content, DEVICE);
  assert.equal(page.root.dataset.cpuViewportScale, undefined);
});
