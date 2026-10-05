import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../package.json", import.meta.url));
const { buildSync } = require("esbuild");
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/utils/clientInfo.ts", import.meta.url))],
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  bundle: true, write: false, format: "cjs", platform: "browser",
}).outputFiles[0].text;

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

function client(ua, { standalone = false, touch = 0, bridge, override = "" } = {}) {
  const module = { exports: {} };
  const storage = new Map();
  runInNewContext(compiled, {
    module, exports: module.exports, URLSearchParams,
    navigator: { userAgent: ua, maxTouchPoints: touch, standalone },
    window: { location: { search: override }, matchMedia: () => ({ matches: standalone }), CPUIOS: bridge },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  return module.exports;
}

test("Safari browsers receive a recommendation but stay in web statistics", () => {
  const api = client(iphone);
  assert.equal(api.detectAnalyticsClient(), "web");
  assert.equal(api.shouldRecommendIosApp(), true);
  assert.equal(api.IOS_APP_STORE_URL, "https://apps.apple.com/cn/app/id6811073406");
});

test("Safari home-screen apps use a separate bucket and get the native recommendation", () => {
  const api = client(iphone.replace(/ Version\/[^ ]+| Safari\/[^ ]+/g, ""), { standalone: true });
  assert.equal(api.detectAnalyticsClient(), "ios-pwa");
  assert.equal(api.detectClientPlatform(), "ios");
  assert.equal(api.shouldRecommendIosApp(), true);
});

test("iPad desktop UA uses touch points; Mac Safari does not receive the iOS banner", () => {
  assert.equal(client(ipad, { touch: 5 }).shouldRecommendIosApp(), true);
  assert.equal(client(ipad, { touch: 5, standalone: true }).detectAnalyticsClient(), "ios-pwa");
  assert.equal(client(ipad).shouldRecommendIosApp(), false);
});

test("native iOS tokens beat stale overrides and never recommend reinstalling", () => {
  for (const token of ["CPUWebIOSApp/1 CPUTimeNative/1", "CPUTimeNative/1"]) {
    const api = client(`${iphone} ${token}`, { override: "?client=web" });
    assert.equal(api.detectAnalyticsClient(), "ios-native");
    assert.equal(api.shouldRecommendIosApp(), false);
  }
});

test("web image bridge is not treated as a native app; a native widget bridge is", () => {
  const web = client(iphone, { bridge: { getVersionName: () => "ios-web", saveImage: () => true } });
  assert.equal(web.detectAnalyticsClient(), "web");
  assert.equal(web.shouldRecommendIosApp(), true);
  const native = client(iphone, { bridge: { supportsScheduleWidget: () => true } });
  assert.equal(native.detectAnalyticsClient(), "ios-native");
  assert.equal(native.shouldRecommendIosApp(), false);
});

test("devices below the App Store minimum keep the Safari home-screen path", () => {
  const ios14 = iphone.replace("OS 18_0", "OS 14_8").replace("Version/18.0", "Version/14.1");
  assert.equal(client(ios14).iosMajorVersion(), 14);
  assert.equal(client(ios14).canInstallIosNativeApp(), false);
  assert.equal(client(ios14).shouldRecommendIosApp(), false);
  assert.equal(client(ios14, { standalone: true }).shouldRecommendIosApp(), false);
  assert.equal(client(ios14, { standalone: true }).detectAnalyticsClient(), "ios-pwa");
  for (const major of [15, 16, 17]) {
    const ua = iphone.replace("OS 18_0", `OS ${major}_0`).replace("Version/18.0", `Version/${major}.0`);
    assert.equal(client(ua).canInstallIosNativeApp(), true, `iOS ${major}`);
    assert.equal(client(ua).shouldRecommendIosApp(), true, `iOS ${major} Safari`);
    assert.equal(client(ua, { standalone: true }).shouldRecommendIosApp(), true, `iOS ${major} home-screen app`);
    assert.equal(client(ipad.replace("Version/18.0", `Version/${major}.0`), { touch: 5 }).shouldRecommendIosApp(), true, `iPadOS ${major}`);
  }
  // iOS 26 freezes the OS token at 18_6; the major version still clears the minimum.
  assert.equal(client(iphone.replace("OS 18_0", "OS 18_6").replace("Version/18.0", "Version/26.0")).shouldRecommendIosApp(), true);
  assert.equal(client(ipad.replace("Version/18.0", "Version/14.1"), { touch: 5 }).shouldRecommendIosApp(), false);
  // Desktop-class iPad home-screen apps expose no version; the App Store page decides.
  assert.equal(client(ipad.replace(/ Version\/[^ ]+| Safari\/[^ ]+/g, ""), { touch: 5, standalone: true }).shouldRecommendIosApp(), true);
});

test("other clients and embedded browsers do not receive Safari recommendations", () => {
  for (const token of ["MicroMessenger/8", "QQ/8", "MQQBrowser/14", "CriOS/130", "FxiOS/130", "EdgiOS/130", "CPUWebFlutterApp/1"]) {
    assert.equal(client(`${iphone} ${token}`).shouldRecommendIosApp(), false, token);
  }
  assert.equal(client("Mozilla/5.0 CPUWebHarmonyApp/3 CPUTimeNative/1").detectAnalyticsClient(), "harmony");
  assert.equal(client("Mozilla/5.0 Android CPUWebScheduleApp/38").detectAnalyticsClient(), "android");
});

test("the Android native shell shares CPUTimeNative without being treated as iOS", () => {
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
  const api = client(`${android} CPUWebScheduleApp/39 CPUWebScheduleAppVersion/4.0.0 CPUTimeNative/1`);
  assert.equal(api.isIosNativeApp(), false);
  assert.equal(api.hidesNativeCommerce(), false);
  assert.equal(api.isNativeScheduleShell(), true);
  assert.equal(api.detectClientPlatform(), "android");
  assert.equal(api.getAndroidNativeVersionCode(), 39);
  assert.equal(api.getAndroidNativeVersionName(), "4.0.0");
});
