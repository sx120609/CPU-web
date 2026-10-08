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

function client(ua, { standalone = false, touch = 0, bridge, override = "", screen = [1440, 900], desktop } = {}) {
  const module = { exports: {} };
  const storage = new Map();
  runInNewContext(compiled, {
    module, exports: module.exports, URLSearchParams,
    navigator: { userAgent: ua, maxTouchPoints: touch, standalone },
    screen: { width: screen[0], height: screen[1] },
    window: { location: { search: override }, matchMedia: () => ({ matches: standalone }), CPUIOS: bridge, CPUDesktop: desktop },
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

test("iPad, desktop-client and APK offers follow the device rather than the browser token", () => {
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  const androidTablet = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  const harmony4 = "Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00) AppleWebKit/537.36 Chrome/99.0 Mobile Safari/537.36 HuaweiBrowser/15.0";
  const harmonyNext = "Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 Chrome/114.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile HuaweiBrowser/5.0";
  const electron = `${windows} CPUWebDesktopApp/2.0.0 Electron/31.0.0`;
  const cases = [
    // [label, ua, options, isLikelyIpadDevice, canOfferDesktopClient, canInstallAndroidApk]
    ["iPad Safari", ipad, { touch: 5, screen: [820, 1180] }, true, false, false],
    ["iPad UA", iphone.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"), { touch: 5, screen: [820, 1180] }, true, false, false],
    ["iPad legacy app", `${ipad} CPUWebIOSApp/1 CPUTimeLegacy/1`, { touch: 5, screen: [1024, 1366] }, true, false, false],
    ["iPad native app", `${ipad} CPUWebIOSApp/1 CPUTimeNative/1`, { touch: 5, screen: [1024, 1366] }, true, false, false],
    ["iPhone", iphone, { touch: 5, screen: [390, 844] }, false, false, false],
    ["iPhone desktop-site mode", ipad, { touch: 5, screen: [390, 844] }, false, false, false],
    ["Mac Safari", ipad, { touch: 0 }, false, true, true],
    ["Mac Chrome", mac, { touch: 0 }, false, true, true],
    ["Windows touch laptop", windows, { touch: 10, screen: [1366, 768] }, false, true, true],
    ["Android tablet", androidTablet, { touch: 10, screen: [800, 1280] }, false, false, true],
    ["HarmonyOS 4 Huawei Browser", harmony4, { touch: 10, screen: [360, 780] }, false, false, true],
    ["OpenHarmony NEXT", harmonyNext, { touch: 10, screen: [360, 780] }, false, false, false],
    ["Harmony native app", "Mozilla/5.0 (Phone; OpenHarmony 5.0) CPUWebHarmonyApp/20 CPUTimeNative/1", { touch: 10 }, false, false, false],
    ["Electron by UA", electron, {}, false, false, true],
    ["Electron by bridge", windows, { desktop: {} }, false, false, true],
  ];
  for (const [label, ua, options, ipadDevice, desktopClient, apk] of cases) {
    const api = client(ua, options);
    assert.equal(api.isLikelyIpadDevice(), ipadDevice, `${label}: isLikelyIpadDevice`);
    assert.equal(api.canOfferDesktopClient(), desktopClient, `${label}: canOfferDesktopClient`);
    assert.equal(api.canInstallAndroidApk(), apk, `${label}: canInstallAndroidApk`);
  }
});

test("native shells that draw their own chrome are recognised by UA token", () => {
  assert.equal(client(`${iphone} CPUWebIOSApp/1 CPUTimeNative/1`).nativeShellOwnsChrome(), true);
  assert.equal(client(`${iphone} CPUWebIOSApp/1`).nativeShellOwnsChrome(), false);
  assert.equal(client(`${iphone} CPUWebFlutterApp/1`).nativeShellOwnsChrome(), true);
  assert.equal(client(iphone).nativeShellOwnsChrome(), false);
});
