import assert from "node:assert/strict";
import test from "node:test";
import { resolveAndroidPdsShareSettings, resolveAssessmentToolPdsShareSettings } from "../src/config";
import {
  parseDesktopVersionFromFileName,
  parseAssessmentToolVersionFromFileName,
  parseShareUrl,
  pickAndroidInstaller,
  pickAssessmentToolPackage,
  pickCampusMapOriginal,
  pickInstaller,
  pickMacInstaller,
  PdsEntry,
  walkShareTree,
} from "../src/services/pdsShare";

test("综测工具 PDS 未单独配置时复用桌面端分享", () => {
  assert.deepEqual(
    resolveAssessmentToolPdsShareSettings("", "ignored", "https://pds.example/shared", "desktop-password"),
    { url: "https://pds.example/shared", password: "desktop-password" },
  );
});

test("安卓 PDS 未单独配置时复用桌面端分享与提取码", () => {
  assert.deepEqual(
    resolveAndroidPdsShareSettings("", "ignored", "https://pds.example/shared", "desktop-password"),
    {
      url: "https://pds.example/shared",
      password: "desktop-password",
    },
  );
});

test("安卓专用 PDS 配置优先于桌面端分享", () => {
  assert.deepEqual(
    resolveAndroidPdsShareSettings(
      " https://pds.example/android ",
      " android-password ",
      "https://pds.example/shared",
      "desktop-password",
    ),
    {
      url: "https://pds.example/android",
      password: "android-password",
    },
  );
});

test("PDS 文件夹分享会递归找到内部安装包", async () => {
  const tree = new Map<string, PdsEntry[]>([
    ["root", [
      { file_id: "windows", name: "Windows", type: "folder" },
      { file_id: "readme", name: "说明.txt", type: "file", size: 10 },
    ]],
    ["windows", [
      { file_id: "old", name: "药大拾间桌面端-0.1.0-win-x64-安装版.exe", type: "file", size: 80, updated_at: "2026-07-26T00:00:00Z" },
      { file_id: "new", name: "药大拾间桌面端-0.1.1-win-x64-安装版.exe", type: "file", size: 81, updated_at: "2026-07-27T00:00:00Z", url: "https://pds.example/view-new" },
    ]],
  ]);

  const files = await walkShareTree(async (parent) => tree.get(parent) ?? []);
  assert.equal(files.length, 3);
  assert.equal(pickInstaller(files)?.fileId, "new");
  assert.equal(pickInstaller(files)?.viewUrl, "https://pds.example/view-new");
});

test("PDS 文件夹同时包含 Windows 与 macOS 时会分别选择正确安装包", () => {
  const files = [
    { fileId: "win", name: "药大拾间桌面端-0.1.1-win-x64-安装版.exe", size: 80, updatedAt: "2026-07-27T00:00:00Z" },
    { fileId: "mac-old", name: "药大拾间桌面端-0.1.0-mac-arm64.dmg", size: 90, updatedAt: "2026-07-26T00:00:00Z" },
    { fileId: "mac-new", name: "药大拾间桌面端-0.1.1-mac-arm64.dmg", size: 91, updatedAt: "2026-07-27T00:00:00Z" },
    { fileId: "mac-zip", name: "药大拾间桌面端-0.1.2-mac-arm64.zip", size: 88, updatedAt: "2026-07-28T00:00:00Z" },
  ];
  assert.equal(pickInstaller(files)?.fileId, "win");
  assert.equal(pickMacInstaller(files)?.fileId, "mac-new");
});

test("PDS 安装包优先选择最高版本，不受旧文件重新上传时间影响", () => {
  const files = [
    { fileId: "win-new", name: "CPU-Web-Desktop-0.1.6-win-x64-installer.exe", size: 82, updatedAt: "2026-07-27T08:00:00Z" },
    { fileId: "win-old-reuploaded", name: "药大拾间桌面端-0.1.5-win-x64-安装版.exe", size: 81, updatedAt: "2026-07-27T09:00:00Z" },
    { fileId: "mac-new", name: "CPU-Web-Desktop-0.1.6-mac-arm64.dmg", size: 108, updatedAt: "2026-07-27T08:00:00Z" },
    { fileId: "mac-old-reuploaded", name: "CPU-Web-Desktop-0.1.5-mac-arm64.dmg", size: 107, updatedAt: "2026-07-27T09:00:00Z" },
  ];

  assert.equal(pickInstaller(files)?.fileId, "win-new");
  assert.equal(pickMacInstaller(files)?.fileId, "mac-new");
});

test("新的企业版文件夹分享链接能解析 domain 与 share id", () => {
  assert.deepEqual(
    parseShareUrl("https://bj37249.apps.aliyunfile.com/disk/s/TunDZWtpXk5?domainId=bj37249"),
    {
      apiBase: "https://bj37249.api.aliyunfile.com",
      shareId: "TunDZWtpXk5",
    },
  );
});

test("桌面端版本会从标准安装包文件名自动提取", () => {
  assert.equal(
    parseDesktopVersionFromFileName("药大拾间桌面端-0.1.1-win-x64-安装版.exe"),
    "0.1.1",
  );
  assert.equal(
    parseDesktopVersionFromFileName("药大拾间桌面端-0.1.1-mac-arm64.dmg"),
    "0.1.1",
  );
  assert.equal(parseDesktopVersionFromFileName("药大拾间桌面端-latest.exe"), "");
});
test("PDS Android APK prefers Android", () => {
  const files = [
    { fileId: "android-old", name: "CPU-Web-Android-V6.apk", size: 80, updatedAt: "2026-07-26T00:00:00Z" },
    {
      fileId: "android-new",
      name: "CPU-Web-Android-V7.apk",
      size: 82,
      updatedAt: "2026-07-28T00:00:00Z",
      viewUrl: "https://pds.example/android-v7",
    },
  ];

  assert.equal(pickAndroidInstaller(files)?.fileId, "android-new");
  assert.equal(pickAndroidInstaller(files)?.viewUrl, "https://pds.example/android-v7");
});

test("综测工具只选择固定命名且优先最高版本", () => {
  const files = [
    { fileId: "other", name: "其他材料-v99.zip", size: 1, updatedAt: "2026-09-05T03:00:00Z" },
    { fileId: "old", name: "药大拾间-综测填表工具-v8.zip", size: 42, updatedAt: "2026-09-05T02:00:00Z" },
    { fileId: "new", name: "药大拾间-综测填表工具-v9.zip", size: 43, updatedAt: "2026-09-05T01:00:00Z" },
  ];
  assert.equal(parseAssessmentToolVersionFromFileName(files[2].name), "9");
  assert.equal(parseAssessmentToolVersionFromFileName(files[0].name), "");
  assert.equal(pickAssessmentToolPackage(files)?.fileId, "new");
});

test("校园地图原图选择最大图片而不是压缩预览", () => {
  const files = [
    { fileId: "preview", name: "校园地图-预览.png", size: 2_146_518, updatedAt: "2026-08-29T00:00:00Z" },
    { fileId: "original", name: "校园地图-原图.png", size: 21_330_392, updatedAt: "2026-08-28T00:00:00Z" },
    { fileId: "readme", name: "说明.txt", size: 50, updatedAt: "2026-08-29T00:00:00Z" },
  ];

  assert.equal(pickCampusMapOriginal(files)?.fileId, "original");
});
