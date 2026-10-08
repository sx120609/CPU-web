import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// appearance-bootstrap.js runs before the app and decides on its own whether the device is iOS (for the
// home-screen splash images). That decision must match the classifier the app uses afterwards.
const require = createRequire(new URL("../package.json", import.meta.url));
const { buildSync } = require("esbuild");
const core = (() => {
  const module = { exports: {} };
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/utils/formFactorCore.ts", import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "neutral",
  }).outputFiles[0].text;
  runInNewContext(code, { module, exports: module.exports });
  return module.exports;
})();
const bootstrap = readFileSync(new URL("../public/appearance-bootstrap.js", import.meta.url), "utf8");

/** Whether the bootstrap treated the device as iOS, i.e. went on to probe the splash-screen media queries. */
function bootstrapTreatsAsIos({ userAgent, platform, maxTouchPoints }) {
  const queries = [];
  const element = { setAttribute() {} };
  runInNewContext(bootstrap, {
    localStorage: { getItem: () => null },
    navigator: { userAgent, platform, maxTouchPoints },
    window: { matchMedia: (query) => { queries.push(query); return { matches: false }; } },
    document: {
      documentElement: { dataset: {}, classList: { toggle() {} }, style: {} },
      querySelector: () => element,
      createElement: () => ({}),
      head: { appendChild() {} },
    },
  });
  return queries.some((query) => query.includes("device-width"));
}

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CASES = [
  { label: "iPad desktop-class Safari", userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 5 },
  { label: "iPad mobile UA", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1", platform: "iPad", maxTouchPoints: 5 },
  { label: "iPad Chrome", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1", platform: "iPad", maxTouchPoints: 5 },
  { label: "iPad app", userAgent: `${MAC_UA.replace(/ Version\/\S+ Safari\/\S+/u, "")} CPUWebIOSApp/1 CPUTimeNative/1`, platform: "MacIntel", maxTouchPoints: 5 },
  { label: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 },
  { label: "iPod", userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Version/15.6 Mobile/15E148 Safari/604.1", platform: "iPod touch", maxTouchPoints: 5 },
  { label: "Mac Safari", userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 0 },
  { label: "Mac Chrome", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 0 },
  { label: "Mac with a single-touch digitizer", userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 1 },
  { label: "Android phone", userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 },
  { label: "Android tablet", userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", platform: "Linux aarch64", maxTouchPoints: 10 },
  { label: "Windows touch laptop", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", platform: "Win32", maxTouchPoints: 10 },
];

test("the bootstrap and the form-factor classifier agree on which devices are iOS", () => {
  for (const device of CASES) {
    const appleTouch = core.classifyFormFactor({
      userAgent: device.userAgent,
      maxTouchPoints: device.maxTouchPoints,
      screenWidth: 820,
      screenHeight: 1180,
      viewportWidth: 820,
      coarsePointer: device.maxTouchPoints > 0,
      fineHover: device.maxTouchPoints === 0,
    }).appleTouch;
    assert.equal(bootstrapTreatsAsIos(device), appleTouch, device.label);
  }
});

test("the parity check really observes both outcomes", () => {
  assert.equal(bootstrapTreatsAsIos(CASES[0]), true);
  assert.equal(bootstrapTreatsAsIos(CASES.find((device) => device.label === "Mac Safari")), false);
});
