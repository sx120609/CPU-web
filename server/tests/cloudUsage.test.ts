import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAliyunPlanTraffic,
  mergeUsageSeries,
  normalizeCloudResourcePackage,
  resolveAliyunBillingMonthWindow,
  resolveCloudUsageWindow,
  summarizeAliyunCmsDatapoints,
} from "../src/services/cloudUsage";

test("today usage window starts at China Standard Time midnight", () => {
  const window = resolveCloudUsageWindow("today", new Date("2026-09-02T03:30:00.000Z"));
  assert.equal(window.start.toISOString(), "2026-09-01T16:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-02T03:30:00.000Z");
  assert.equal(window.tencentInterval, "5min");
  assert.equal(window.aliyunInterval, "300");
});

test("seven and thirty day windows choose bounded aggregation intervals", () => {
  const now = new Date("2026-09-02T03:30:00.000Z");
  const sevenDays = resolveCloudUsageWindow("7d", now);
  const thirtyDays = resolveCloudUsageWindow("30d", now);
  assert.equal(sevenDays.start.toISOString(), "2026-08-26T03:30:00.000Z");
  assert.equal(sevenDays.tencentInterval, "hour");
  assert.equal(thirtyDays.start.toISOString(), "2026-08-03T03:30:00.000Z");
  assert.equal(thirtyDays.aliyunInterval, "86400");
});

test("Aliyun billing month starts at China Standard Time month boundary", () => {
  const window = resolveAliyunBillingMonthWindow(new Date("2026-09-02T03:30:00.000Z"));
  assert.equal(window.start.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-02T03:30:00.000Z");
});

test("Aliyun plan usage converts billable bytes with decimal GB units", () => {
  assert.deepEqual(calculateAliyunPlanTraffic("50", 596_700_000), {
    includedTrafficGb: 50,
    usedTrafficGb: 0.5967,
    remainingTrafficGb: 49.4033,
  });
  assert.deepEqual(calculateAliyunPlanTraffic(null, null), {
    includedTrafficGb: null,
    usedTrafficGb: null,
    remainingTrafficGb: null,
  });
});

test("Aliyun OSS hourly metering datapoints are added for the billing month", () => {
  assert.deepEqual(summarizeAliyunCmsDatapoints(JSON.stringify([
    { timestamp: 1_788_256_800_000, Value: 16, storageType: "standard" },
    { timestamp: 1_788_260_400_000, Value: "62450", storageType: "standard" },
    { timestamp: 1_788_264_000_000, Sum: 44, storageType: "standard" },
  ])), {
    total: 62_510,
    measuredAt: "2026-09-01T12:00:00.000Z",
  });
  assert.deepEqual(summarizeAliyunCmsDatapoints("not-json"), { total: 0, measuredAt: "" });
});

test("traffic and request samples merge by normalized timestamp", () => {
  const points = mergeUsageSeries(
    [
      { timestamp: "2026-09-02 08:00:00", value: "1024" },
      { timestamp: "2026-09-02 08:05:00", value: 2048 },
    ],
    [
      { timestamp: "2026-09-02 08:00:00", value: "7" },
      { timestamp: "2026-09-02 08:10:00", value: 3 },
    ],
  );
  assert.deepEqual(points, [
    { timestamp: "2026-09-02T00:00:00.000Z", trafficBytes: 1024, requests: 7 },
    { timestamp: "2026-09-02T00:05:00.000Z", trafficBytes: 2048, requests: 0 },
    { timestamp: "2026-09-02T00:10:00.000Z", trafficBytes: 0, requests: 3 },
  ]);
});

test("resource package derives used amount without exposing invalid numbers", () => {
  assert.deepEqual(normalizeCloudResourcePackage({
    id: 12,
    name: "CDN 流量包",
    kind: "traffic",
    status: "enabled",
    total: "1000",
    remaining: "250",
    unit: "B",
    effectiveAt: "2026-09-01 00:00:00",
    expiresAt: "2026-10-01 00:00:00",
  }), {
    id: "12",
    name: "CDN 流量包",
    kind: "traffic",
    status: "enabled",
    total: 1000,
    used: 750,
    remaining: 250,
    unit: "B",
    effectiveAt: "2026-08-31T16:00:00.000Z",
    expiresAt: "2026-09-30T16:00:00.000Z",
  });
});
