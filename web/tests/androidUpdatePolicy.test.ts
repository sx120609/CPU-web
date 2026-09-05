import assert from "node:assert/strict";
import test from "node:test";
import {
  ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED,
  isAndroidUpdateAvailable,
  canUseStagedAndroidUpdate,
  shouldPromptAndroidInstallRepair,
  ANDROID_BROWSER_DOWNLOAD_PAGE,
} from "../src/utils/androidUpdatePolicy";

test("安卓客户端自动更新提示暂时关闭", () => {
  assert.equal(ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED, false);
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

test("关闭自动提示不影响手动更新判断", () => {
  assert.equal(isAndroidUpdateAvailable(true, 33, 34), true);
  assert.equal(isAndroidUpdateAvailable(true, 34, 34), false);
  assert.equal(isAndroidUpdateAvailable(false, 33, 34), false);
});
