import assert from "node:assert/strict";
import test from "node:test";
import {
  ANDROID_APP_UPDATE_CHECK_ENABLED,
  canOpenAndroidUpdatePrompt,
  isAndroidUpdateAvailable,
} from "../src/utils/androidUpdatePolicy";

test("安卓客户端更新检查暂时关闭", () => {
  assert.equal(ANDROID_APP_UPDATE_CHECK_ENABLED, false);
  assert.equal(isAndroidUpdateAvailable(true, 1, 34), false);
  assert.equal(isAndroidUpdateAvailable(true, 33, 34), false);
});

test("关闭更新检查时仅保留新安装入口", () => {
  assert.equal(canOpenAndroidUpdatePrompt("app"), false);
  assert.equal(canOpenAndroidUpdatePrompt("widget"), false);
  assert.equal(canOpenAndroidUpdatePrompt("install"), true);
});
