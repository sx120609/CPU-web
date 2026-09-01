import assert from "node:assert/strict";
import test from "node:test";
import {
  ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED,
  isAndroidUpdateAvailable,
} from "../src/utils/androidUpdatePolicy";

test("安卓客户端自动更新提示暂时关闭", () => {
  assert.equal(ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED, false);
});

test("关闭自动提示不影响手动更新判断", () => {
  assert.equal(isAndroidUpdateAvailable(true, 33, 34), true);
  assert.equal(isAndroidUpdateAvailable(true, 34, 34), false);
  assert.equal(isAndroidUpdateAvailable(false, 33, 34), false);
});
