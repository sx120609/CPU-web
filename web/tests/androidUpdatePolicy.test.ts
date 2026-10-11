import assert from "node:assert/strict";
import test from "node:test";
import {
  ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED,
  isAndroidUpdateAvailable,
  isAndroidUpdateRequired,
  canUseStagedAndroidUpdate,
  shouldPromptAndroidInstallRepair,
  ANDROID_BROWSER_DOWNLOAD_PAGE,
  isObsoleteAndroidUpdateFailure,
} from "../src/utils/androidUpdatePolicy";

test("安卓客户端启用自动更新提示", () => {
  assert.equal(ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED, true);
});

test("旧版和未声明修复能力的客户端必须使用浏览器", () => {
  assert.equal(canUseStagedAndroidUpdate(36, true), false);
  assert.equal(canUseStagedAndroidUpdate(37, false), false);
  assert.equal(canUseStagedAndroidUpdate(37, true), true);
  const path = new URL(ANDROID_BROWSER_DOWNLOAD_PAGE).pathname;
  assert.equal(path.endsWith(".apk") || path.includes("/downloads/"), false);
});

test("修复提示仅针对受影响的 3.x 原生旧版", () => {
  assert.equal(shouldPromptAndroidInstallRepair(true, 36), true);
  assert.equal(shouldPromptAndroidInstallRepair(true, 21), true);
  assert.equal(shouldPromptAndroidInstallRepair(true, 20), false);
  assert.equal(shouldPromptAndroidInstallRepair(true, 37), false);
  assert.equal(shouldPromptAndroidInstallRepair(false, 36), false);
});

test("仅向低于发布版本的安卓客户端提示更新", () => {
  assert.equal(isAndroidUpdateAvailable(true, 33, 34), true);
  assert.equal(isAndroidUpdateAvailable(true, 34, 34), false);
  assert.equal(isAndroidUpdateAvailable(true, 35, 34), false);
  assert.equal(isAndroidUpdateAvailable(false, 33, 34), false);
});

test("已安装版本的重复下载失败不再阻止检查下一版本", () => {
  assert.equal(isObsoleteAndroidUpdateFailure("failed", "CPU-Web-Android-V47.apk", 47), true);
  assert.equal(isObsoleteAndroidUpdateFailure("failed", "CPU-Web-Android-V46.apk", 47), true);
  assert.equal(isObsoleteAndroidUpdateFailure("failed", "CPU-Web-Android-V48.apk", 47), false);
  assert.equal(isObsoleteAndroidUpdateFailure("downloading", "CPU-Web-Android-V47.apk", 47), false);
  assert.equal(isObsoleteAndroidUpdateFailure("failed", "unknown.apk", 47), false);
});

test("低于最低支持版本的原生客户端必须更新，未知版本不强制", () => {
  assert.equal(isAndroidUpdateRequired(true, 58, 59), true);
  assert.equal(isAndroidUpdateRequired(true, 59, 59), false);
  assert.equal(isAndroidUpdateRequired(true, 0, 59), false);
  assert.equal(isAndroidUpdateRequired(false, 40, 59), false);
  assert.equal(isAndroidUpdateRequired(true, 40, 0), false);
});
