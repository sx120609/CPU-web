import assert from "node:assert/strict";
import test from "node:test";
import {
  desktopInstallReportData,
  desktopInstallReportSchema,
  desktopInstallTrend,
  parseDesktopInstallReportRange,
  scrubInstallText,
  summarizeDesktopInstallReports,
  windowsFamily,
} from "../src/services/desktopInstallReports";

const valid = {
  appVersion: "1.8.3",
  previousVersion: "1.8.2",
  osRelease: "10.0.26200",
  arch: "x64",
  mode: "upgrade",
  elevated: false,
  outcome: "failed",
  stage: "swap",
  errorCode: "EPERM",
  fileName: "CPU Time.exe",
  message: "EPERM: operation not permitted, rename '~\\AppData\\Local\\Programs\\cpu-time\\CPU Time.exe'",
  antivirus: ["360安全卫士", "火绒安全"],
  retries: 12,
  durationMs: 48_000,
};

test("install report schema accepts the installer contract and rejects malformed fields", () => {
  assert.equal(desktopInstallReportSchema.safeParse(valid).success, true);
  const minimal = { ...valid, previousVersion: undefined, errorCode: null, fileName: null, message: null, antivirus: [] };
  assert.equal(desktopInstallReportSchema.safeParse(minimal).success, true);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, outcome: "succeeded" }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, stage: "download" }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, arch: "mips" }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, appVersion: "<script>" }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, errorCode: "E".repeat(25) }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, message: "x".repeat(601) }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, antivirus: Array(13).fill("a") }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, retries: -1 }).success, false);
  assert.equal(desktopInstallReportSchema.safeParse({ ...valid, durationMs: 3_600_001 }).success, false);
});

test("stored text drops user profile paths and control characters", () => {
  assert.equal(
    scrubInstallText("EPERM, rename 'C:\\Users\\zhang san\\AppData\\Local\\x.exe'", 600),
    "EPERM, rename '%USERPROFILE%\\AppData\\Local\\x.exe'",
  );
  assert.equal(scrubInstallText("d:/users/Bob/Desktop/a.lnk", 600), "%USERPROFILE%/Desktop/a.lnk");
  assert.equal(scrubInstallText("line one\r\n\tline\u0000two", 600), "line one line two");
  assert.equal(scrubInstallText("\u0007  ", 600), null);
  assert.equal(scrubInstallText(null, 600), null);

  const data = desktopInstallReportData({ ...desktopInstallReportSchema.parse(valid), fileName: "C:\\Users\\alice\\x.dll", antivirus: ["火绒安全", " 火绒安全 ", "\u0001", "Windows Defender"] });
  assert.equal(data.fileName, "%USERPROFILE%\\x.dll");
  assert.deepEqual(JSON.parse(data.antivirus), ["火绒安全", "Windows Defender"]);
  assert.equal("userId" in data || "ip" in data, false);
});

test("Windows 11 is told apart from Windows 10 by build number", () => {
  assert.equal(windowsFamily("10.0.22631"), "Windows 11");
  assert.equal(windowsFamily("10.0.22000"), "Windows 11");
  assert.equal(windowsFamily("10.0.19045"), "Windows 10");
  assert.equal(windowsFamily("6.1.7601"), "其他");
});

test("summary counts outcomes and groups with failed subsets; each antivirus product is bumped", () => {
  const at = new Date("2026-09-25T04:00:00Z");
  const row = { stage: "swap", errorCode: "EPERM", antivirus: "[]", appVersion: "1.8.3", osRelease: "10.0.26200", createdAt: at };
  const summary = summarizeDesktopInstallReports([
    { ...row, outcome: "failed", antivirus: JSON.stringify(["360安全卫士", "火绒安全"]) },
    { ...row, outcome: "retried", antivirus: JSON.stringify(["360安全卫士"]) },
    { ...row, outcome: "elevated", stage: "shortcuts", errorCode: null, appVersion: "1.8.10", osRelease: "10.0.19045" },
    { ...row, outcome: "failed", errorCode: "ENOSPC", antivirus: "not json" },
  ]);
  assert.equal(summary.reports, 4);
  assert.deepEqual(summary.byOutcome, { failed: 2, retried: 1, elevated: 1 });
  assert.deepEqual(summary.byErrorCode, [
    { key: "EPERM", count: 2, failed: 1 },
    { key: "ENOSPC", count: 1, failed: 1 },
    { key: "无错误码", count: 1, failed: 0 },
  ]);
  assert.deepEqual(summary.byStage[0], { key: "swap", count: 3, failed: 2 });
  assert.deepEqual(summary.byAntivirus, [
    { key: "360安全卫士", count: 2, failed: 1 },
    { key: "未检测到", count: 2, failed: 1 },
    { key: "火绒安全", count: 1, failed: 1 },
  ]);
  assert.deepEqual(summary.byAppVersion.map((item) => item.key), ["1.8.10", "1.8.3"]);
  assert.deepEqual(summary.byWindows, [{ key: "Windows 11", count: 3, failed: 2 }, { key: "Windows 10", count: 1, failed: 0 }]);
});

test("trend buckets reports by China day into failed and recovered", () => {
  const trend = desktopInstallTrend([
    { outcome: "failed", createdAt: new Date("2026-09-24T15:59:00Z") }, // 23:59 on 09-24 in China
    { outcome: "failed", createdAt: new Date("2026-09-24T16:01:00Z") }, // 00:01 on 09-25
    { outcome: "retried", createdAt: new Date("2026-09-25T08:00:00Z") },
    { outcome: "elevated", createdAt: new Date("2026-09-25T09:00:00Z") },
    { outcome: "failed", createdAt: new Date("2026-08-01T00:00:00Z") },
  ], ["2026-09-24", "2026-09-25"]);
  assert.deepEqual(trend, { dates: ["2026-09-24", "2026-09-25"], failed: [1, 1], recovered: [0, 2] });
});

test("unknown ranges default to thirty days", () => {
  assert.equal(parseDesktopInstallReportRange("90d"), "90d");
  assert.equal(parseDesktopInstallReportRange(undefined), "30d");
});
