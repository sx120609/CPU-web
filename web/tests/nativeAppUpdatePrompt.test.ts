import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_UPDATE_REMIND_AFTER_MS,
  iosNativeAppVersion,
  nativeUpdatePlatform,
  parseNativeUpdateSnooze,
  shouldAnnounceNativeUpdate,
} from "../src/utils/nativeAppUpdatePrompt";

test("the page announces updates only for shells that do not prompt themselves", () => {
  assert.equal(nativeUpdatePlatform(true, false, "Mozilla CPUWebIOSApp/1 CPUTimeNative/1", undefined), "ios");
  assert.equal(nativeUpdatePlatform(true, false, "Mozilla CPUWebIOSApp/1 CPUWebIOSAppVersion/4.20 CPUTimeNative/1", undefined), null);
  assert.equal(nativeUpdatePlatform(false, true, "CPUWebHarmonyApp/32", {}), "harmony");
  assert.equal(nativeUpdatePlatform(false, true, "CPUWebHarmonyApp/34", { supportsNativeUpdatePrompt: () => true }), null);
  assert.equal(nativeUpdatePlatform(false, true, "CPUWebHarmonyApp/34", { supportsNativeUpdatePrompt: () => { throw new Error("gone"); } }), "harmony");
  assert.equal(nativeUpdatePlatform(false, false, "Chrome", undefined), null);
  assert.equal(iosNativeAppVersion("CPUWebIOSApp/1 CPUWebIOSAppVersion/4.19 CPUTimeLegacy/1"), "4.19");
});

test("a version is announced until answered, then every few days while still missing", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldAnnounceNativeUpdate("4.18", null, now), true);
  assert.equal(shouldAnnounceNativeUpdate("4.18", { version: "4.17", at: now }, now), true);
  assert.equal(shouldAnnounceNativeUpdate("4.18", { version: "4.18", at: now - 60_000 }, now), false);
  assert.equal(shouldAnnounceNativeUpdate("4.18", { version: "4.18", at: now - NATIVE_UPDATE_REMIND_AFTER_MS }, now), true);
  assert.equal(shouldAnnounceNativeUpdate("4.18", { version: "4.18", at: now + 60_000 }, now), true);
  assert.deepEqual(parseNativeUpdateSnooze('{"version":"3.1.1","at":5}'), { version: "3.1.1", at: 5 });
  assert.equal(parseNativeUpdateSnooze("4.18"), null);
  assert.equal(parseNativeUpdateSnooze(null), null);
});
