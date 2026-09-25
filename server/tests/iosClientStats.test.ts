import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticSignature, diagnosticSummary, extractTopFrames, iosClientHeartbeatSchema, iosDeviceName, parseIosClientStatsRange, summarizeIosClientInstalls, summarizeStability } from "../src/services/iosClientStats";

test("heartbeat schema accepts native payloads and rejects malformed fields", () => {
  const valid = { installId: "3F2504E0-4F89-41D3-9A0C-0305E82C3301", deviceModel: "iPhone17,1", systemVersion: "26.0.1", appVersion: "1.4.0", appBuild: "58" };
  assert.equal(iosClientHeartbeatSchema.safeParse(valid).success, true);
  assert.equal(iosClientHeartbeatSchema.safeParse({ ...valid, installId: "not-a-uuid" }).success, false);
  assert.equal(iosClientHeartbeatSchema.safeParse({ ...valid, deviceModel: "<script>" }).success, false);
  assert.equal(iosClientHeartbeatSchema.safeParse({ ...valid, appVersion: "" }).success, false);
});

test("device identifiers map to marketing names and fall back to the raw identifier", () => {
  assert.equal(iosDeviceName("iPhone16,2"), "iPhone 15 Pro Max");
  assert.equal(iosDeviceName("arm64"), "模拟器");
  assert.equal(iosDeviceName("iPad14,1"), "iPad14,1");
});

test("summary groups by model, client version and iOS major.minor", () => {
  const summary = summarizeIosClientInstalls([
    { deviceModel: "iPhone17,1", systemVersion: "26.0.1", appVersion: "1.4.0", appBuild: "58", userId: 1 },
    { deviceModel: "iPhone17,1", systemVersion: "26.0", appVersion: "1.3.2", appBuild: "51", userId: 1 },
    { deviceModel: "iPhone15,2", systemVersion: "18.6.2", appVersion: "1.4.0", appBuild: "58", userId: null },
  ]);
  assert.equal(summary.installs, 3);
  assert.equal(summary.signedInUsers, 1);
  assert.deepEqual(summary.byDeviceModel[0], { deviceModel: "iPhone17,1", name: "iPhone 16 Pro", count: 2 });
  assert.deepEqual(summary.byAppVersion.map((row) => row.version), ["1.4.0 (58)", "1.3.2 (51)"]);
  assert.deepEqual(summary.bySystemVersion, [{ version: "26.0", count: 2 }, { version: "18.6", count: 1 }]);
});

test("unknown ranges default to thirty days", () => {
  assert.equal(parseIosClientStatsRange("7d"), "7d");
  assert.equal(parseIosClientStatsRange("bogus"), "30d");
});

test("heartbeat schema accepts feature state and rejects unknown notification status", () => {
  const base = { installId: "3F2504E0-4F89-41D3-9A0C-0305E82C3301", deviceModel: "iPhone17,1", systemVersion: "26.0", appVersion: "1.4.0", appBuild: "58" };
  const full = { ...base, widgets: [{ kind: "cn.cputime.mobile.widget.today", family: "systemMedium" }], liveActivitySystemEnabled: true, liveActivityAppEnabled: false, notificationStatus: "authorized", watchPaired: null, watchAppInstalled: false };
  assert.equal(iosClientHeartbeatSchema.safeParse(full).success, true);
  assert.equal(iosClientHeartbeatSchema.safeParse({ ...full, notificationStatus: "maybe" }).success, false);
});

test("feature summary counts widget installs, kinds and tri-state flags", () => {
  const row = { deviceModel: "iPhone17,1", systemVersion: "26.0", appVersion: "1.4.0", appBuild: "58", userId: null };
  const summary = summarizeIosClientInstalls([
    { ...row, widgets: JSON.stringify([{ kind: "cn.cputime.mobile.widget.today", family: "systemMedium" }, { kind: "cn.cputime.mobile.widget.today", family: "systemLarge" }]), watchPaired: true, notificationStatus: "authorized" },
    { ...row, widgets: "[]", watchPaired: false, notificationStatus: "denied" },
    { ...row },
  ]);
  assert.equal(summary.features.widgets.reported, 2);
  assert.equal(summary.features.widgets.installsWithWidget, 1);
  assert.deepEqual(summary.features.widgets.byKind, [{ kind: "cn.cputime.mobile.widget.today", name: "今日课表", installs: 1, count: 2 }]);
  assert.deepEqual(summary.features.watchPaired, { yes: 1, no: 1, unknown: 1 });
  assert.equal(summary.features.notificationStatus.find((item) => item.status === "unknown")?.count, 1);
});

const callStack = JSON.stringify({
  callStackPerThread: true,
  callStacks: [
    { threadAttributed: false, callStackRootFrames: [{ binaryName: "libsystem_kernel.dylib", offsetIntoBinaryTextSegment: 1 }] },
    { threadAttributed: true, callStackRootFrames: [{ binaryName: "libswiftCore.dylib", offsetIntoBinaryTextSegment: 100, subFrames: [{ binaryName: "CpuTime", offsetIntoBinaryTextSegment: 200, subFrames: [{ binaryName: "CpuTime", offsetIntoBinaryTextSegment: 300 }] }] }] },
  ],
});

test("call stack frames come from the attributed thread, innermost first", () => {
  assert.deepEqual(extractTopFrames(callStack), [
    { binaryName: "libswiftCore.dylib", offset: 100 },
    { binaryName: "CpuTime", offset: 200 },
    { binaryName: "CpuTime", offset: 300 },
  ]);
  assert.deepEqual(extractTopFrames("not json"), []);
});

test("crash summaries name the Mach exception and signal; signatures prefer app frames", () => {
  const crash = { kind: "crash" as const, appVersion: "1.4.0", appBuild: "58", occurredAt: "2026-09-25T02:00:00Z", exceptionType: 6, signal: 5, callStack };
  assert.equal(diagnosticSummary(crash), "EXC_BREAKPOINT (SIGTRAP)");
  assert.equal(diagnosticSummary({ ...crash, kind: "hang", hangDurationMs: 2500 }), "卡顿 2.5 秒");
  const frames = extractTopFrames(callStack);
  const withApp = diagnosticSignature("crash", "58", "EXC_BREAKPOINT (SIGTRAP)", frames, "CpuTime");
  const otherSystemFrame = diagnosticSignature("crash", "58", "EXC_BREAKPOINT (SIGTRAP)", [{ binaryName: "libobjc.A.dylib", offset: 9 }, ...frames.slice(1)], "CpuTime");
  assert.equal(withApp, otherSystemFrame);
  assert.notEqual(withApp, diagnosticSignature("crash", "59", "EXC_BREAKPOINT (SIGTRAP)", frames, "CpuTime"));
});

test("stability summary weights launch time by launch count and counts crash devices", () => {
  const metric = { appVersion: "1.4.0", appBuild: "58", resumeCount: 0, resumeMsAvg: null, hangCount: 1, foregroundNormalExits: 9, backgroundAbnormalExits: 0 };
  const [row] = summarizeStability(
    [{ ...metric, launchCount: 10, launchMsAvg: 400, foregroundAbnormalExits: 1 }, { ...metric, launchCount: 30, launchMsAvg: 800, foregroundAbnormalExits: 0 }],
    [{ kind: "crash", appVersion: "1.4.0", appBuild: "58", installId: "a" }, { kind: "crash", appVersion: "1.4.0", appBuild: "58", installId: "a" }, { kind: "hang", appVersion: "1.4.0", appBuild: "58", installId: "b" }],
  );
  assert.equal(row.launches, 40);
  assert.equal(row.launchMsAvg, 700);
  assert.equal(row.foregroundAbnormalRate, 5.26);
  assert.equal(row.crashes, 2);
  assert.equal(row.crashInstalls, 1);
  assert.equal(row.hangReports, 1);
});
