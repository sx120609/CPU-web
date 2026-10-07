import assert from "node:assert/strict";
import test from "node:test";
import {
  androidClientHeartbeatSchema,
  androidClientMetricsSchema,
  androidDiagnosticSignature,
  androidDiagnosticSummary,
  cleanDeviceLabel,
  extractJavaFrames,
  rootCauseLine,
  summarizeAndroidClientInstalls,
  summarizeAndroidStability,
} from "../src/services/androidClientStats";

const INSTALL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const heartbeat = { installId: INSTALL, deviceBrand: "Redmi", deviceModel: "23013RK75C", systemVersion: "14", sdkInt: 34, appVersion: "4.0.15", appBuild: "56" };

const CRASH = [
  "java.lang.RuntimeException: Unable to start activity ComponentInfo{cn.lizmt.cpuweb/cn.lizmt.cpuweb.schedule.MainActivity}",
  "\tat android.app.ActivityThread.performLaunchActivity(ActivityThread.java:3782)",
  "\tat android.os.Looper.loop(Looper.java:288)",
  "Caused by: java.lang.IllegalStateException: schedule archive is closed",
  "\tat cn.lizmt.cpuweb.schedule.ScheduleArchive.read(ScheduleArchive.kt:61)",
  "\tat cn.lizmt.cpuweb.schedule.ScheduleStore.restoreArchive(ScheduleStore.kt:140)",
  "\tat android.app.Activity.performCreate(Activity.java:8595)",
  "\t... 11 more",
].join("\n");

test("heartbeat schema accepts native payloads and rejects malformed fields", () => {
  assert.equal(androidClientHeartbeatSchema.safeParse(heartbeat).success, true);
  assert.equal(androidClientHeartbeatSchema.safeParse({ ...heartbeat, installId: "not-a-uuid" }).success, false);
  assert.equal(androidClientHeartbeatSchema.safeParse({ ...heartbeat, appVersion: "" }).success, false);
  assert.equal(androidClientHeartbeatSchema.safeParse({ ...heartbeat, sdkInt: "34" }).success, false);
  assert.equal(androidClientHeartbeatSchema.safeParse({ ...heartbeat, appearanceMode: "sepia" }).success, false);
  const full = {
    ...heartbeat, webViewVersion: "126.0.6478.122", webViewPackage: "com.google.android.webview",
    widgets: [{ kind: "ScheduleWidgetProviderWide" }], appearanceMode: "dark", scheduleStyle: "paper", customBackground: false, installPermission: null,
  };
  assert.equal(androidClientHeartbeatSchema.safeParse(full).success, true);
});

test("vendor strings are cleaned instead of rejecting the device", () => {
  assert.equal(cleanDeviceLabel("  vivo X90 Pro+  ", 60), "vivo X90 Pro+");
  assert.equal(cleanDeviceLabel("SM-A525F/DS", 60), "SM-A525F/DS");
  assert.equal(cleanDeviceLabel("<script>alert(1)</script>", 60), "script alert(1) /script");
  assert.equal(cleanDeviceLabel("荣耀", 60), "unknown");
  const parsed = androidClientHeartbeatSchema.parse({ ...heartbeat, deviceModel: "moto g(60)\u0000", deviceBrand: "motorola™" });
  assert.equal(parsed.deviceModel, "moto g(60)");
  assert.equal(parsed.deviceBrand, "motorola");
});

test("summary groups by brand, model, client version, Android major and WebView major", () => {
  const summary = summarizeAndroidClientInstalls([
    { deviceBrand: "Redmi", deviceModel: "23013RK75C", systemVersion: "14", appVersion: "4.0.15", appBuild: "56", userId: 1, webViewVersion: "126.0.6478.122" },
    { deviceBrand: "redmi", deviceModel: "23013RK75C", systemVersion: "13", appVersion: "4.0.14", appBuild: "55", userId: 1, webViewVersion: "103.0.5060.129" },
    { deviceBrand: "HUAWEI", deviceModel: "ALN-AL00", systemVersion: "12", appVersion: "4.0.15", appBuild: "56", userId: null },
  ]);
  assert.equal(summary.installs, 3);
  assert.equal(summary.signedInUsers, 1);
  assert.deepEqual(summary.byBrand, [{ brand: "redmi", name: "Redmi", count: 2 }, { brand: "huawei", name: "华为", count: 1 }]);
  assert.deepEqual(summary.byDeviceModel[0], { deviceModel: "23013RK75C", brand: "Redmi", count: 2 });
  assert.deepEqual(summary.otherDeviceModels, { models: 0, count: 0 });
  assert.deepEqual(summary.byAppVersion.map((row) => row.version), ["4.0.15 (56)", "4.0.14 (55)"]);
  assert.deepEqual(summary.bySystemVersion.map((row) => row.version), ["14", "13", "12"]);
  assert.deepEqual(summary.byWebView, [{ version: "126", count: 1 }, { version: "103", count: 1 }, { version: "unknown", count: 1 }]);
});

test("summary counts widget, appearance and style adoption", () => {
  const base = { deviceBrand: "OPPO", deviceModel: "PGT-AN10", systemVersion: "15", appVersion: "4.0.15", appBuild: "56", userId: null };
  const summary = summarizeAndroidClientInstalls([
    { ...base, widgets: JSON.stringify([{ kind: "ScheduleWidgetProviderWide" }, { kind: "ScheduleWidgetProviderWide" }, { kind: "ScheduleWidgetProviderLarge" }]), appearanceMode: "dark", scheduleStyle: "paper", customBackground: true, installPermission: true },
    { ...base, widgets: "[]", appearanceMode: "system", scheduleStyle: "classic", customBackground: false, installPermission: false },
    { ...base },
  ]);
  const widgets = summary.features.widgets;
  assert.equal(widgets.reported, 2);
  assert.equal(widgets.installsWithWidget, 1);
  assert.deepEqual(widgets.byKind.find((row) => row.kind === "ScheduleWidgetProviderWide"), { kind: "ScheduleWidgetProviderWide", name: "当前/接下来 4×2", installs: 1, count: 2 });
  assert.deepEqual(summary.features.customBackground, { yes: 1, no: 1, unknown: 1 });
  assert.deepEqual(summary.features.installPermission, { yes: 1, no: 1, unknown: 1 });
  assert.equal(summary.features.appearanceMode.find((row) => row.mode === "unknown")?.count, 1);
  assert.equal(summary.features.scheduleStyle.find((row) => row.style === "paper")?.name, "素笺");
});

test("only the first thirty models are listed; the rest is one total", () => {
  const rows = Array.from({ length: 34 }, (_, index) => ({ deviceBrand: "vivo", deviceModel: `V${2000 + index}A`, systemVersion: "14", appVersion: "4.0.15", appBuild: "56", userId: null }));
  const summary = summarizeAndroidClientInstalls(rows);
  assert.equal(summary.byDeviceModel.length, 30);
  assert.deepEqual(summary.otherDeviceModels, { models: 4, count: 4 });
});

test("a chained exception is identified by its root cause", () => {
  assert.equal(rootCauseLine(CRASH), "java.lang.IllegalStateException: schedule archive is closed");
  assert.deepEqual(extractJavaFrames(CRASH).slice(0, 2), [
    "cn.lizmt.cpuweb.schedule.ScheduleArchive.read(ScheduleArchive.kt:61)",
    "cn.lizmt.cpuweb.schedule.ScheduleStore.restoreArchive(ScheduleStore.kt:140)",
  ]);
  const item = { kind: "crash" as const, appVersion: "4.0.15", appBuild: "56", occurredAt: "2026-10-07T08:00:00+08:00", stackTrace: CRASH };
  assert.equal(androidDiagnosticSummary(item), "java.lang.IllegalStateException: schedule archive is closed");
  assert.equal(androidDiagnosticSummary({ ...item, threadName: "pool-2-thread-1" }), "java.lang.IllegalStateException: schedule archive is closed（线程 pool-2-thread-1）");
});

test("the same fault keeps one signature across builds and messages", () => {
  const moved = CRASH.replace("ScheduleArchive.kt:61", "ScheduleArchive.kt:74").replace("is closed", "was closed twice");
  const a = androidDiagnosticSignature("crash", rootCauseLine(CRASH), extractJavaFrames(CRASH));
  const b = androidDiagnosticSignature("crash", rootCauseLine(moved), extractJavaFrames(moved));
  assert.equal(a, b);
  const other = CRASH.replace("java.lang.IllegalStateException: schedule", "java.io.IOException: schedule");
  assert.notEqual(a, androidDiagnosticSignature("crash", rootCauseLine(other), extractJavaFrames(other)));
  assert.notEqual(a, androidDiagnosticSignature("anr", "ANR", extractJavaFrames(CRASH)));
});

test("an ANR is summarised by the system description and grouped by the main thread's app frames", () => {
  const trace = [
    "\"main\" prio=5 tid=1 Blocked",
    "  | group=\"main\" sCount=1 ucsCount=0 flags=1 obj=0x72a1b2c8 self=0xb400007a",
    "  at cn.lizmt.cpuweb.schedule.ScheduleWidgetCardRenderer.render(ScheduleWidgetCardRenderer.java:210)",
    "  - waiting to lock <0x0d3f1a2b> (a java.lang.Object) held by thread 31",
    "  at android.os.Handler.dispatchMessage(Handler.java:106)",
  ].join("\n");
  const item = { kind: "anr" as const, appVersion: "4.0.15", appBuild: "56", occurredAt: "2026-10-07T08:00:00+08:00", message: "Input dispatching timed out", stackTrace: trace };
  assert.equal(androidDiagnosticSummary(item), "ANR · Input dispatching timed out");
  assert.equal(extractJavaFrames(trace)[0], "cn.lizmt.cpuweb.schedule.ScheduleWidgetCardRenderer.render(ScheduleWidgetCardRenderer.java:210)");
  const withOtherToken = androidDiagnosticSignature("anr", "ANR · Input dispatching timed out (a1b2c3)", extractJavaFrames(trace));
  assert.equal(androidDiagnosticSignature("anr", androidDiagnosticSummary(item), extractJavaFrames(trace)), withOtherToken);
});

test("metrics schema fills defaults and rejects unknown exit reasons' types", () => {
  const parsed = androidClientMetricsSchema.parse({
    installId: INSTALL, deviceBrand: "Redmi", deviceModel: "23013RK75C", systemVersion: "14",
    reports: [{ date: "2026-10-06", appVersion: "4.0.15", appBuild: "56", launchCount: 3, launchMsAvg: 812.5, exits: { foreground: { crash: 1 } } }],
  });
  assert.equal(parsed.reports[0].rendererCrashes, 0);
  assert.deepEqual(parsed.reports[0].exits.background, {});
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(androidClientMetricsSchema.safeParse({ installId: INSTALL, deviceBrand: "a", deviceModel: "b", systemVersion: "14", reports: [{ date: "10-06", appVersion: "4.0.15", appBuild: "56" }] }).success, false);
  assert.equal(androidClientMetricsSchema.safeParse({ installId: INSTALL, deviceBrand: "a", deviceModel: "b", systemVersion: "14", reports: [{ date: "2026-10-06", appVersion: "4.0.15", appBuild: "56", exits: { foreground: { crash: -1 } } }] }).success, false);
});

test("stability is summed per version with launch time weighted by launches", () => {
  const metric = { rendererCrashes: 0, rendererKills: 0, crashExits: 0, nativeCrashExits: 0, anrExits: 0, foregroundKills: 0 };
  const rows = summarizeAndroidStability(
    [
      { ...metric, appVersion: "4.0.15", appBuild: "56", launchCount: 30, launchMsAvg: 600, crashExits: 1, rendererKills: 2 },
      { ...metric, appVersion: "4.0.15", appBuild: "56", launchCount: 10, launchMsAvg: 1000, nativeCrashExits: 1, anrExits: 1, foregroundKills: 3 },
      { ...metric, appVersion: "4.0.14", appBuild: "55", launchCount: 0, launchMsAvg: null },
    ],
    [
      { kind: "crash", appVersion: "4.0.15", appBuild: "56", installId: "a" },
      { kind: "crash", appVersion: "4.0.15", appBuild: "56", installId: "a" },
      { kind: "anr", appVersion: "4.0.14", appBuild: "55", installId: "b" },
    ],
  );
  assert.deepEqual(rows.map((row) => row.version), ["4.0.15 (56)", "4.0.14 (55)"]);
  assert.deepEqual(rows[0], {
    version: "4.0.15 (56)", launches: 40, launchMsAvg: 700, crashExits: 1, nativeCrashExits: 1, crashRate: 5, anrExits: 1, foregroundKills: 3,
    rendererCrashes: 0, rendererKills: 2, crashReports: 2, crashInstalls: 1, anrReports: 0,
  });
  assert.equal(rows[1].launchMsAvg, null);
  assert.equal(rows[1].crashRate, null);
  assert.equal(rows[1].anrReports, 1);
});
