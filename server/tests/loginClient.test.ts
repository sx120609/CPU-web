import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { detectLoginClient, IOS_ANALYTICS_CLIENTS, loginClientUsage } from "../src/utils/loginClient";
import { isIosCommerceRequest } from "../src/middleware/iosCommerce";

function detect(ua: string, client?: string) {
  return detectLoginClient({ get: (key: string) => key === "user-agent" ? ua : client } as Request);
}

test("native iOS is identified even with an outdated browser header", () => {
  for (const ua of ["Mozilla/5.0 CPUWebIOSApp/1 CPUTimeNative/1", "Mozilla/5.0 CPUTimeNative/1"]) {
    const info = detect(ua, "web");
    assert.equal(info.client, "ios");
    assert.equal(info.analyticsClient, "ios-native");
    assert.equal(loginClientUsage(info).usedIosNativeClient, true);
    assert.equal(loginClientUsage(info).usedIosPwaClient, undefined);
  }
});

test("Harmony's shared native shell is not counted as iOS", () => {
  assert.equal(detect("CPUWebHarmonyApp/3 CPUTimeNative/1").analyticsClient, "harmony");
  assert.equal(detect("CPUWebHarmonyApp/3 CPUTimeNative/1", "ios").client, "harmony");
});

test("Safari standalone telemetry keeps iOS announcement targeting", () => {
  const info = detect("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15", "ios-pwa");
  assert.equal(info.client, "ios");
  assert.equal(info.analyticsClient, "ios-pwa");
  assert.equal(loginClientUsage(info).usedIosClient, true);
  assert.equal(loginClientUsage(info).usedIosPwaClient, true);
  assert.equal(loginClientUsage(info).usedIosNativeClient, undefined);
});

test("old iOS telemetry remains unclassified; a browser is not a native install", () => {
  assert.equal(detect("Mozilla/5.0 (iPhone)", "ios").analyticsClient, "ios");
  assert.equal(detect("Mozilla/5.0 (iPhone)", "web").analyticsClient, "web");
  assert.equal(detect("Mozilla/5.0 (iPhone)").client, "web");
  assert.equal(detect("").client, "unknown");
});

test("every stored iOS analytics value still targets the iOS platform", () => {
  // Admin "ios" filters and iOS commerce rules rely on this list covering all stored variants.
  assert.deepEqual([...IOS_ANALYTICS_CLIENTS], ["ios", "ios-native", "ios-pwa"]);
  for (const value of IOS_ANALYTICS_CLIENTS) {
    const info = detect("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15", value);
    assert.equal(info.client, "ios");
    assert.equal(info.analyticsClient, value);
  }
});

test("usage flags only accumulate; switching clients never clears existing footprints", () => {
  const native = loginClientUsage(detect("CPUWebIOSApp/1"));
  const pwa = loginClientUsage(detect("iPhone", "ios-pwa"));
  const saved: Record<string, boolean> = {};
  for (const flags of [native, pwa, loginClientUsage(detect("Chrome/130", "web"))]) {
    for (const [key, value] of Object.entries(flags)) if (value !== undefined) saved[key] = value;
  }
  assert.equal(saved.usedIosClient, true);
  assert.equal(saved.usedIosNativeClient, true);
  assert.equal(saved.usedIosPwaClient, true);
  assert.equal(saved.usedAndroidClient, undefined);
});

test("detailed telemetry preserves existing iOS commerce restrictions", () => {
  for (const client of ["ios", "ios-native", "ios-pwa"]) {
    assert.equal(isIosCommerceRequest({ headers: { "x-cpu-client": client } }), true);
  }
  assert.equal(isIosCommerceRequest({ headers: { "user-agent": "CPUTimeNative/1" } }), true);
  assert.equal(isIosCommerceRequest({ headers: { "user-agent": "CPUWebHarmonyApp/3 CPUTimeNative/1" } }), false);
  assert.equal(isIosCommerceRequest({ headers: { "x-cpu-client": "web" } }), false);
});
