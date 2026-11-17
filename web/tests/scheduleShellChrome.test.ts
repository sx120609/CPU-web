import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyFormFactor, keepsSiteHeaderOnBarePages, type FormFactorEnv } from "../src/utils/formFactorCore";

const schedule = readFileSync(new URL("../src/views/Schedule.vue", import.meta.url), "utf8");
const scheduleScript = schedule.slice(schedule.indexOf("<script setup"), schedule.indexOf("</script>"));
const updateDialog = readFileSync(new URL("../src/components/install/AndroidUpdateDialog.vue", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/layouts/MainLayout.vue", import.meta.url), "utf8");
const router = readFileSync(new URL("../src/router/index.ts", import.meta.url), "utf8");

const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_APP = `${IPAD_SAFARI.replace(" Version/17.5 Safari/605.1.15", "")} CPUWebIOSApp/1 CPUTimeNative/1`;
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ELECTRON = `${WINDOWS_CHROME} CPUWebDesktopApp/2.0.0 Electron/31.0.0`;
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_APP = `${PIXEL} CPUWebScheduleApp/38 CPUTimeNative/1`;
const FLUTTER = `${PIXEL} CPUWebFlutterApp/1`;
const ANDROID_TABLET_LEGACY_APP = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 CPUWebScheduleApp/30";

function classify(userAgent: string, width: number, height: number, screen: [number, number], touch: boolean) {
  const env: FormFactorEnv = {
    userAgent,
    maxTouchPoints: touch ? 5 : 0,
    screenWidth: screen[0],
    screenHeight: screen[1],
    viewportWidth: width,
    viewportHeight: height,
    coarsePointer: touch,
    fineHover: !touch,
  };
  return classifyFormFactor(env);
}

/** Mirrors Schedule.vue's and MainLayout's rules; the source assertions below keep them in step. */
function scheduleChrome(userAgent: string, width: number, height: number, screen: [number, number], touch: boolean) {
  const flutter = /CPUWebFlutterApp/i.test(userAgent);
  const formFactor = classify(userAgent, width, height, screen, touch);
  const tabbar = !flutter && formFactor.compact;
  const header = keepsSiteHeaderOnBarePages(formFactor);
  return { tabbar, header, exit: !tabbar && !header };
}

test("the schedule exit button follows the shared form factor instead of its own touch detector", () => {
  assert.match(scheduleScript, /import \{ keepsSiteHeaderOnBarePages, useFormFactor \} from "@\/utils\/formFactor";/);
  assert.match(
    scheduleScript,
    /const scheduleHasBottomTabbar = computed\(\(\) => !isFlutterNativeShell\(\) && formFactor\.value\.compact\);/,
  );
  assert.match(scheduleScript, /const hasSiteHeader = computed\(\(\) => keepsSiteHeaderOnBarePages\(formFactor\.value\)\);/);
  assert.match(
    scheduleScript,
    /const showScheduleExitButton = computed\(\(\) => !scheduleHasBottomTabbar\.value && !hasSiteHeader\.value\);/,
  );
  assert.match(schedule, /v-if="showScheduleExitButton"[\s\S]{0,200}aria-label="退出课表"/);
  for (const stale of ["isTouchLikeViewport", "touchLikeViewport", "(hover: none)", "maxTouchPoints", "viewportWidth"]) {
    assert.equal(scheduleScript.includes(stale), false, `Schedule.vue still contains ${stale}`);
  }
  // The 760px query only sizes dialogs; it must not drive the shell chrome.
  assert.match(scheduleScript, /compactViewport\.value = window\.matchMedia\?\.\("\(max-width: 760px\)"\)/);
});

test("MainLayout shows its web tab bar on the same compact flag Schedule reads", () => {
  assert.match(layout, /const showWebTabbar = computed\(\(\) => ff\.value\.compact && !useNativeShell\.value/);
});

test("MainLayout keeps the site header over /schedule on the rule Schedule reads", () => {
  assert.match(router, /name: "schedule", component: loadScheduleView, meta: \{[^}]*hideChrome: true, desktopHeader: true \}/);
  assert.match(
    layout,
    /const bareHeader = computed\(\(\) => hideChrome\.value\s+&& Boolean\(route\.meta\?\.desktopHeader\)\s+&& keepsSiteHeaderOnBarePages\(ff\.value\)\);/,
  );
  assert.match(layout, /<header v-if="\(!hideChrome \|\| bareHeader\) && !useNativeShell && /);
});

test("/schedule always offers exactly one way out: tab bar, site header or 退出", () => {
  type Way = "tabbar" | "header" | "exit";
  const cases: Array<[string, string, number, number, [number, number], boolean, Way]> = [
    // label, UA, width, height, screen, touch, way out
    ["iPhone portrait", IPHONE, 390, 844, [390, 844], true, "tabbar"],
    ["iPad Air portrait", IPAD_SAFARI, 820, 1180, [820, 1180], true, "tabbar"],
    ["iPad Air landscape", IPAD_SAFARI, 1180, 820, [820, 1180], true, "header"],
    ["iPad Pro 13 portrait", IPAD_SAFARI, 1024, 1366, [1024, 1366], true, "header"],
    ["iPad Pro M4 portrait", IPAD_SAFARI, 1032, 1376, [1032, 1376], true, "header"],
    ["Windows touch laptop portrait window", WINDOWS_CHROME, 960, 1032, [1366, 768], false, "header"],
    ["Electron", ELECTRON, 1180, 820, [1920, 1080], true, "header"],
    ["mouse desktop", WINDOWS_CHROME, 1440, 900, [1440, 900], false, "header"],
    ["mouse desktop at the phone width", WINDOWS_CHROME, 768, 900, [1440, 900], false, "tabbar"],
    // Native chrome: the iOS/Android CPUTimeNative shells draw their own tab bar; the Flutter shell has none
    // over /schedule and keeps 退出, as before.
    ["iPad app landscape", IPAD_APP, 1366, 1024, [1024, 1366], true, "tabbar"],
    ["Android app", ANDROID_APP, 412, 915, [412, 915], true, "tabbar"],
    ["Flutter shell", FLUTTER, 412, 915, [412, 915], true, "exit"],
    // Older app shells decide their own bars by whether the site header exists, so a wide tablet keeps 退出.
    ["legacy Android app on a wide tablet", ANDROID_TABLET_LEGACY_APP, 1280, 800, [800, 1280], true, "exit"],
  ];
  for (const [label, userAgent, width, height, screen, touch, expected] of cases) {
    const chrome = scheduleChrome(userAgent, width, height, screen, touch);
    const ways = (["tabbar", "header", "exit"] as const).filter((way) => chrome[way]);
    assert.deepEqual(ways, [expected], label);
  }
});

test("Apple and HarmonyOS NEXT browsers are never offered the Android APK", () => {
  const gate = scheduleScript.slice(scheduleScript.indexOf("const canShowAndroidClientDownload"));
  assert.match(gate.slice(0, gate.indexOf("});")), /if \(!canInstallAndroidApk\(\)\) return false;/);
  assert.match(schedule, />下载 Android 客户端</);

  const openPrompt = updateDialog.slice(updateDialog.indexOf("function openPrompt("));
  const guard = openPrompt.slice(0, openPrompt.indexOf("readUpdateStatus();"));
  assert.match(
    guard,
    /if \(kind === "install" && !isAndroidNativeApp\(\) && !canInstallAndroidApk\(\)\) \{\s*void router\.push\("\/download"\);\s*return;\s*\}/,
  );
});
