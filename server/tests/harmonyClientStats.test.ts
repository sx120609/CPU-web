import assert from "node:assert/strict";
import test from "node:test";
import {
  harmonyBrandName,
  harmonyClientHeartbeatSchema,
  harmonyDeviceTypeName,
  summarizeHarmonyClientInstalls,
} from "../src/services/harmonyClientStats";

const INSTALL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const heartbeat = {
  installId: INSTALL, deviceBrand: "HUAWEI", deviceModel: "ALN-AL00", deviceType: "phone", systemVersion: "6.0.0(20)", apiVersion: 20,
  appVersion: "3.0.7", appBuild: "27",
};

test("heartbeat schema accepts native payloads and rejects malformed fields", () => {
  assert.equal(harmonyClientHeartbeatSchema.safeParse(heartbeat).success, true);
  assert.equal(harmonyClientHeartbeatSchema.safeParse({ ...heartbeat, installId: "not-a-uuid" }).success, false);
  assert.equal(harmonyClientHeartbeatSchema.safeParse({ ...heartbeat, appVersion: "" }).success, false);
  assert.equal(harmonyClientHeartbeatSchema.safeParse({ ...heartbeat, apiVersion: "20" }).success, false);
  assert.equal(harmonyClientHeartbeatSchema.safeParse({ ...heartbeat, appearanceMode: "sepia" }).success, false);
  const full = { ...heartbeat, appearanceMode: "dark", scheduleStyle: "paper", schedulePalette: "color-glass", customBackground: false, customDisplay: null };
  assert.equal(harmonyClientHeartbeatSchema.safeParse(full).success, true);
});

test("odd characters in device strings are dropped instead of rejecting the report", () => {
  const parsed = harmonyClientHeartbeatSchema.parse({ ...heartbeat, deviceModel: "MatePad Pro 13.2” <b>", systemVersion: "HarmonyOS 6.0.0(20)" });
  assert.equal(parsed.deviceModel, "MatePad Pro 13.2 b");
  assert.equal(parsed.systemVersion, "HarmonyOS 6.0.0(20)");
});

test("installs are summarized by type, model, version and feature use", () => {
  const row = (extra: Record<string, unknown>) => ({
    deviceBrand: "HUAWEI", deviceModel: "ALN-AL00", deviceType: "phone", systemVersion: "6.0.0(20)", apiVersion: 20,
    appVersion: "3.0.7", appBuild: "27", userId: null, ...extra,
  });
  const summary = summarizeHarmonyClientInstalls([
    row({ userId: 1, scheduleStyle: "classic", appearanceMode: "system", customDisplay: true, customBackground: false }),
    row({ userId: 1, deviceModel: "MRO-W00", deviceType: "tablet", systemVersion: "HarmonyOS 6.0.0.115", scheduleStyle: "paper", customDisplay: false }),
    row({ userId: 2, systemVersion: "5.1.0(18)", apiVersion: 18, appVersion: "3.0.6", appBuild: "26" }),
  ]);
  assert.equal(summary.installs, 3);
  assert.equal(summary.signedInUsers, 2);
  assert.deepEqual(summary.byDeviceType, [{ type: "phone", name: "手机", count: 2 }, { type: "tablet", name: "平板", count: 1 }]);
  assert.deepEqual(summary.byDeviceModel[0], { deviceModel: "ALN-AL00", brand: "华为", count: 2 });
  assert.deepEqual(summary.byAppVersion, [{ version: "3.0.7 (27)", count: 2 }, { version: "3.0.6 (26)", count: 1 }]);
  assert.deepEqual(summary.bySystemVersion, [{ version: "6.0", count: 2 }, { version: "5.1", count: 1 }]);
  assert.deepEqual(summary.byApiVersion, [{ version: "20", count: 2 }, { version: "18", count: 1 }]);
  assert.deepEqual(summary.features.customDisplay, { yes: 1, no: 1, unknown: 1 });
  assert.deepEqual(summary.features.scheduleStyle.find((item) => item.style === "paper"), { style: "paper", name: "素笺", count: 1 });
  assert.equal(summary.features.scheduleStyle.find((item) => item.style === "unknown")?.count, 1);
});

test("brand and device type names fall back to what was reported", () => {
  assert.equal(harmonyBrandName("HUAWEI"), "华为");
  assert.equal(harmonyBrandName("Other"), "Other");
  assert.equal(harmonyDeviceTypeName("2in1"), "二合一");
  assert.equal(harmonyDeviceTypeName("glasses"), "glasses");
});
