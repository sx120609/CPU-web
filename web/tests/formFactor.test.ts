import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFormFactor,
  PHONE_MAX_QUERY,
  TABLET_COMPACT_QUERY,
  TABLET_MIN_SHORT_SIDE,
  type FormFactorEnv,
} from "../src/utils/formFactorCore";

const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPAD_MOBILE_UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_CHROME = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const IPAD_APP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CPUWebIOSApp/1 CPUTimeNative/1";
const IPAD_LEGACY_APP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CPUWebIOSApp/1 CPUTimeLegacy/1";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = IPAD_SAFARI;
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ELECTRON = `${WINDOWS_CHROME} CPUWebDesktopApp/2.0.0 Electron/31.0.0`;
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_TABLET_DESKTOP_MODE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_APP = `${PIXEL} CPUWebScheduleApp/38 CPUTimeNative/1`;
const HARMONY_APP = "Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile CPUWebHarmonyApp/20 CPUTimeNative/1";
const FLUTTER = `${PIXEL} CPUWebFlutterApp/1`;
const WECHAT_IPAD = `${IPAD_MOBILE_UA} MicroMessenger/8.0.50`;

type Screen = [number, number];
const IPAD_SCREENS: Record<string, Screen> = {
  mini: [744, 1133],
  air: [820, 1180],
  pro11: [834, 1194],
  pro13: [1024, 1366],
  m4: [1032, 1376],
};

function env(userAgent: string, width: number, overrides: Partial<FormFactorEnv> & { screen?: Screen; height?: number } = {}): FormFactorEnv {
  const [screenWidth, screenHeight] = overrides.screen ?? [width, overrides.height ?? 900];
  const coarsePointer = overrides.coarsePointer ?? false;
  return {
    userAgent,
    maxTouchPoints: 0,
    screenWidth,
    screenHeight,
    viewportWidth: width,
    viewportHeight: overrides.height ?? 900,
    coarsePointer,
    fineHover: overrides.fineHover ?? !coarsePointer,
    ...overrides,
  };
}

const ipad = (userAgent: string, width: number, screen: Screen, extra: Partial<FormFactorEnv> = {}) => classifyFormFactor(env(userAgent, width, {
  maxTouchPoints: 5,
  coarsePointer: true,
  screen,
  height: screen[0] === width ? screen[1] : Math.min(...screen),
  ...extra,
}));

test("the shared queries keep the existing phone switch", () => {
  assert.equal(PHONE_MAX_QUERY, "(max-width: 768px)");
  assert.equal(TABLET_COMPACT_QUERY, "(max-width: 1023px)");
  assert.equal(TABLET_MIN_SHORT_SIDE, 600);
});

test("iPad Safari: compact below 1024, desktop layout from 1024 in every model and orientation", () => {
  for (const userAgent of [IPAD_SAFARI, IPAD_MOBILE_UA, IPAD_CHROME]) {
    for (const [model, screen] of Object.entries(IPAD_SCREENS)) {
      const portrait = ipad(userAgent, screen[0], screen);
      const landscape = ipad(userAgent, screen[1], screen);
      assert.equal(portrait.device, "tablet", `${model} ${userAgent}`);
      assert.equal(portrait.isIpad, true, model);
      assert.equal(portrait.touchPrimary, true, model);
      assert.equal(portrait.compact, screen[0] < 1024, `${model} portrait`);
      assert.equal(portrait.layout, screen[0] < 1024 ? "compact" : "expanded");
      assert.equal(landscape.compact, false, `${model} landscape`);
      assert.equal(landscape.layout, "expanded");
      assert.equal(portrait.shell, "browser");
    }
  }
  for (const width of [744, 820, 834]) assert.equal(ipad(IPAD_SAFARI, width, [width, 1180]).compact, true, String(width));
  for (const width of [1024, 1032, 1133, 1180, 1194, 1366, 1376]) {
    assert.equal(ipad(IPAD_SAFARI, width, [1024, 1366]).compact, false, String(width));
  }
});

test("Split View, Slide Over and Stage Manager follow the window, not the device", () => {
  for (const screen of [IPAD_SCREENS.air, IPAD_SCREENS.pro13]) {
    for (const width of [320, 375, 507, 694, 778, 904, 981]) {
      const result = ipad(IPAD_SAFARI, width, screen);
      assert.equal(result.device, "tablet", `${width} on ${screen}`);
      assert.equal(result.isIpad, true);
      assert.equal(result.compact, true, `${width} on ${screen}`);
    }
  }
  assert.equal(ipad(IPAD_SAFARI, 900, IPAD_SCREENS.pro13).compact, true);
  assert.equal(ipad(IPAD_SAFARI, 1100, IPAD_SCREENS.pro13).compact, false);
});

test("a trackpad on an iPad never turns on hover-only interactions", () => {
  const result = ipad(IPAD_SAFARI, 1180, IPAD_SCREENS.air, { fineHover: true });
  assert.equal(result.device, "tablet");
  assert.equal(result.canHover, false);
  assert.equal(result.touchPrimary, true);
});

test("the iPad app always uses the phone pages under its native chrome; the legacy app follows Safari", () => {
  for (const width of [820, 1180, 1366]) {
    const app = ipad(IPAD_APP, width, width === 1366 ? IPAD_SCREENS.pro13 : IPAD_SCREENS.air);
    assert.equal(app.shell, "ios-native");
    assert.equal(app.nativeChrome, true);
    assert.equal(app.compact, true, String(width));
  }
  const legacyPortrait = ipad(IPAD_LEGACY_APP, 820, IPAD_SCREENS.air);
  const legacyLandscape = ipad(IPAD_LEGACY_APP, 1180, IPAD_SCREENS.air);
  assert.equal(legacyPortrait.shell, "ios-legacy");
  assert.equal(legacyPortrait.nativeChrome, false);
  assert.equal(legacyPortrait.compact, true);
  assert.equal(legacyLandscape.compact, false);
});

test("iPhones keep today's layout, including desktop-site mode", () => {
  const portrait = classifyFormFactor(env(IPHONE, 390, { maxTouchPoints: 5, coarsePointer: true, screen: [390, 844], height: 844 }));
  const landscape = classifyFormFactor(env(IPHONE, 844, { maxTouchPoints: 5, coarsePointer: true, screen: [390, 844], height: 390 }));
  assert.equal(portrait.device, "phone");
  assert.equal(portrait.compact, true);
  assert.equal(portrait.isIpad, false);
  assert.equal(landscape.device, "phone");
  assert.equal(landscape.compact, false);
  assert.equal(landscape.orientation, "landscape");

  const desktopSite = classifyFormFactor(env(MAC_SAFARI, 980, { maxTouchPoints: 5, coarsePointer: true, screen: [390, 844] }));
  assert.equal(desktopSite.appleTouch, true);
  assert.equal(desktopSite.isIpad, false);
  assert.equal(desktopSite.device, "phone");
});

test("Mac browsers keep the 768 px switch and hover", () => {
  for (const userAgent of [MAC_SAFARI, MAC_CHROME]) {
    const wide = classifyFormFactor(env(userAgent, 769, { screen: [1512, 982] }));
    const narrow = classifyFormFactor(env(userAgent, 768, { screen: [1512, 982] }));
    assert.equal(wide.device, "desktop");
    assert.equal(wide.appleTouch, false);
    assert.equal(wide.touchPrimary, false);
    assert.equal(wide.canHover, true);
    assert.equal(wide.compact, false);
    assert.equal(narrow.compact, true);
  }
});

test("touchscreen Windows laptops with a mouse stay desktop, even in a portrait-shaped window", () => {
  for (const screen of [[1280, 720], [1366, 768]] as Screen[]) {
    const result = classifyFormFactor(env(WINDOWS_CHROME, 960, { maxTouchPoints: 10, screen, height: 1032 }));
    assert.equal(result.device, "desktop");
    assert.equal(result.touchPrimary, false);
    assert.equal(result.canHover, true);
    assert.equal(result.compact, false);
    assert.equal(result.orientation, "portrait");
  }
});

test("a Surface in tablet mode is a tablet", () => {
  const portrait = classifyFormFactor(env(WINDOWS_CHROME, 912, { maxTouchPoints: 10, coarsePointer: true, screen: [1368, 912], height: 1368 }));
  const landscape = classifyFormFactor(env(WINDOWS_CHROME, 1368, { maxTouchPoints: 10, coarsePointer: true, screen: [1368, 912], height: 912 }));
  assert.equal(portrait.device, "tablet");
  assert.equal(portrait.compact, true);
  assert.equal(landscape.compact, false);
});

test("Electron is always the desktop layout", () => {
  for (const electron of [{ userAgent: ELECTRON }, { userAgent: WINDOWS_CHROME, electron: true }]) {
    const result = classifyFormFactor(env(electron.userAgent, 1180, { coarsePointer: true, maxTouchPoints: 10, screen: [820, 1180], electron: electron.electron }));
    assert.equal(result.device, "desktop");
    assert.equal(result.touchPrimary, false);
    assert.equal(result.compact, false);
    assert.equal(result.shell, "desktop-native");
  }
});

test("Android phones and tablets follow the same rules as iPhone and iPad", () => {
  const phoneLandscape = classifyFormFactor(env(PIXEL, 915, { maxTouchPoints: 5, coarsePointer: true, screen: [412, 915], height: 412 }));
  assert.equal(phoneLandscape.device, "phone");
  assert.equal(phoneLandscape.compact, false);
  for (const userAgent of [ANDROID_TABLET, ANDROID_TABLET_DESKTOP_MODE]) {
    const portrait = classifyFormFactor(env(userAgent, 800, { maxTouchPoints: 10, coarsePointer: true, screen: [800, 1280], height: 1280 }));
    const landscape = classifyFormFactor(env(userAgent, 1280, { maxTouchPoints: 10, coarsePointer: true, screen: [800, 1280], height: 800 }));
    assert.equal(portrait.device, "tablet", userAgent);
    assert.equal(portrait.isIpad, false);
    assert.equal(portrait.compact, true);
    assert.equal(landscape.compact, false);
  }
});

test("native shells that own the chrome are always compact", () => {
  const android = classifyFormFactor(env(ANDROID_APP, 1280, { maxTouchPoints: 10, coarsePointer: true, screen: [800, 1280] }));
  assert.equal(android.shell, "android-native");
  assert.equal(android.compact, true);
  const harmony = classifyFormFactor(env(HARMONY_APP, 1280, { maxTouchPoints: 10, coarsePointer: true, screen: [800, 1280] }));
  assert.equal(harmony.shell, "harmony-native");
  assert.equal(harmony.compact, true);
  const flutter = classifyFormFactor(env(FLUTTER, 1180, { maxTouchPoints: 5, coarsePointer: true, screen: [820, 1180] }));
  assert.equal(flutter.shell, "flutter");
  assert.equal(flutter.compact, true);
  const flutterByQuery = classifyFormFactor(env(PIXEL, 915, { coarsePointer: true, screen: [412, 915], flutterShell: true }));
  assert.equal(flutterByQuery.nativeChrome, true);
  assert.equal(flutterByQuery.compact, true);
  assert.equal(classifyFormFactor(env(`${PIXEL} CPUWebScheduleApp/38`, 412, { coarsePointer: true, screen: [412, 915] })).shell, "android-legacy");
  assert.equal(classifyFormFactor(env("Mozilla/5.0 CPUWebHarmonyApp/3", 412, { coarsePointer: true, screen: [412, 915] })).shell, "harmony-legacy");
  assert.equal(classifyFormFactor(env(IPHONE, 390, { coarsePointer: true, screen: [390, 844], standalone: true })).shell, "standalone");
});

test("WeChat on iPad is a tablet", () => {
  const result = ipad(WECHAT_IPAD, 820, IPAD_SCREENS.air);
  assert.equal(result.device, "tablet");
  assert.equal(result.isIpad, true);
  assert.equal(result.compact, true);
});

test("explicit media results win over the width fallback", () => {
  const result = classifyFormFactor(env(IPAD_SAFARI, 769, {
    maxTouchPoints: 5,
    coarsePointer: true,
    screen: IPAD_SCREENS.air,
    phoneWidth: true,
    tabletCompactWidth: true,
    portrait: true,
  }));
  assert.equal(result.compact, true);
  assert.equal(result.orientation, "portrait");
  const noScreen = classifyFormFactor(env(IPAD_MOBILE_UA, 820, { maxTouchPoints: 5, coarsePointer: true, screen: [0, 0] }));
  assert.equal(noScreen.device, "tablet");
});
