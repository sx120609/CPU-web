import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyFormFactor, type FormFactorEnv } from "../src/utils/formFactorCore";

const schedule = readFileSync(new URL("../src/views/Schedule.vue", import.meta.url), "utf8");
const scheduleScript = schedule.slice(schedule.indexOf("<script setup"), schedule.indexOf("</script>"));
const updateDialog = readFileSync(new URL("../src/components/install/AndroidUpdateDialog.vue", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/layouts/MainLayout.vue", import.meta.url), "utf8");

const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_APP = `${IPAD_SAFARI.replace(" Version/17.5 Safari/605.1.15", "")} CPUWebIOSApp/1 CPUTimeNative/1`;
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ELECTRON = `${WINDOWS_CHROME} CPUWebDesktopApp/2.0.0 Electron/31.0.0`;
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_APP = `${PIXEL} CPUWebScheduleApp/38 CPUTimeNative/1`;
const FLUTTER = `${PIXEL} CPUWebFlutterApp/1`;

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

/** Mirrors Schedule.vue's rule; the source assertion below keeps the two in step. */
function scheduleExitVisible(userAgent: string, width: number, height: number, screen: [number, number], touch: boolean) {
  const flutter = /CPUWebFlutterApp/i.test(userAgent);
  const scheduleHasBottomTabbar = !flutter && classify(userAgent, width, height, screen, touch).compact;
  return !scheduleHasBottomTabbar;
}

test("the schedule exit button follows the shared form factor instead of its own touch detector", () => {
  assert.match(scheduleScript, /import \{ useFormFactor \} from "@\/utils\/formFactor";/);
  assert.match(
    scheduleScript,
    /const scheduleHasBottomTabbar = computed\(\(\) => !isFlutterNativeShell\(\) && formFactor\.value\.compact\);/,
  );
  assert.match(scheduleScript, /const showScheduleExitButton = computed\(\(\) => !scheduleHasBottomTabbar\.value\);/);
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

test("/schedule always offers a way out: tab bar or 退出, never neither", () => {
  const cases: Array<[string, string, number, number, [number, number], boolean, boolean]> = [
    // label, UA, width, height, screen, touch, exit visible
    ["iPhone portrait", IPHONE, 390, 844, [390, 844], true, false],
    ["iPad Air portrait", IPAD_SAFARI, 820, 1180, [820, 1180], true, false],
    ["iPad Air landscape", IPAD_SAFARI, 1180, 820, [820, 1180], true, true],
    ["iPad Pro 13 portrait", IPAD_SAFARI, 1024, 1366, [1024, 1366], true, true],
    ["iPad Pro M4 portrait", IPAD_SAFARI, 1032, 1376, [1032, 1376], true, true],
    ["Windows touch laptop portrait window", WINDOWS_CHROME, 960, 1032, [1366, 768], false, true],
    ["Electron", ELECTRON, 1180, 820, [1920, 1080], true, true],
    ["mouse desktop", WINDOWS_CHROME, 1440, 900, [1440, 900], false, true],
    ["mouse desktop at the phone width", WINDOWS_CHROME, 768, 900, [1440, 900], false, false],
    // Native chrome: the iOS/Android CPUTimeNative shells hide it, the Flutter shell keeps it, as before.
    ["iPad app landscape", IPAD_APP, 1366, 1024, [1024, 1366], true, false],
    ["Android app", ANDROID_APP, 412, 915, [412, 915], true, false],
    ["Flutter shell", FLUTTER, 412, 915, [412, 915], true, true],
  ];
  for (const [label, userAgent, width, height, screen, touch, expected] of cases) {
    assert.equal(scheduleExitVisible(userAgent, width, height, screen, touch), expected, label);
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
