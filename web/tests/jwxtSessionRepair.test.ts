import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareManualJwxtReauthorization,
  repairUnavailableJwxtSession,
  retryJwxtAuthorization,
  shouldAutoRecoverJwxtSession,
} from "../src/utils/jwxtSessionRepair";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("老教务会话有保存凭据时自动断开并重建", async () => {
  const steps: string[] = [];
  const recovered = await repairUnavailableJwxtSession({
    username: "old-student-with-creds",
    storage: memoryStorage(),
    disconnect: async () => { steps.push("disconnect"); },
    resetLocalState: () => { steps.push("reset"); },
    hasSavedCredentials: () => true,
    autoLogin: async () => { steps.push("login"); return true; },
  });

  assert.equal(recovered, true);
  assert.deepEqual(steps, ["disconnect", "reset", "login"]);
});

test("没有保存凭据时只清理旧教务会话并回到教务登录框", async () => {
  const steps: string[] = [];
  const recovered = await repairUnavailableJwxtSession({
    username: "old-student-without-creds",
    storage: memoryStorage(),
    disconnect: async () => { steps.push("disconnect"); },
    resetLocalState: () => { steps.push("reset"); },
    hasSavedCredentials: () => false,
    autoLogin: async () => { steps.push("login"); return true; },
  });

  assert.equal(recovered, false);
  assert.deepEqual(steps, ["disconnect", "reset"]);
});

test("同一迁移版本每个账号只自动修复一次", async () => {
  const storage = memoryStorage();
  let disconnects = 0;
  const input = {
    username: "freshman-without-data",
    storage,
    disconnect: async () => { disconnects += 1; },
    resetLocalState: () => undefined,
    hasSavedCredentials: () => true,
    autoLogin: async () => false,
  };

  assert.equal(await repairUnavailableJwxtSession(input), false);
  assert.equal(await repairUnavailableJwxtSession(input), false);
  assert.equal(disconnects, 1);
});

test("上一版修复标记不会阻止新版会话修复", async () => {
  const storage = memoryStorage();
  storage.setItem("cpu-jwxt-session-repair-modern-v2:stale-mobile-session", "1");
  let disconnects = 0;

  const recovered = await repairUnavailableJwxtSession({
    username: "stale-mobile-session",
    storage,
    disconnect: async () => { disconnects += 1; },
    resetLocalState: () => undefined,
    hasSavedCredentials: () => true,
    autoLogin: async () => true,
  });

  assert.equal(recovered, true);
  assert.equal(disconnects, 1);
});

test("手动重新授权即使断开请求失败也会清理本地误判状态", async () => {
  const steps: string[] = [];
  await prepareManualJwxtReauthorization({
    disconnect: async () => {
      steps.push("disconnect");
      throw new Error("upstream unavailable");
    },
    resetLocalState: () => { steps.push("reset"); },
  });

  assert.deepEqual(steps, ["disconnect", "reset"]);
});

test("用户点重试时优先使用已保存信息自动恢复", async () => {
  const steps: string[] = [];
  const result = await retryJwxtAuthorization({
    disconnect: async () => { steps.push("disconnect"); },
    resetLocalState: () => { steps.push("reset"); },
    hasSavedCredentials: () => true,
    autoLogin: async () => { steps.push("auto-login"); return true; },
    needsCaptcha: () => false,
    prepareLogin: async () => { steps.push("prepare-manual"); },
  });

  assert.equal(result, "restored");
  assert.deepEqual(steps, ["disconnect", "reset", "auto-login"]);
});

test("页面禁用常规自动登录时，已确认过期的会话仍会自动恢复", () => {
  assert.equal(shouldAutoRecoverJwxtSession({
    allowAutoLogin: false,
    authorizationExpired: true,
    hasSavedCredentials: true,
  }), true);
  assert.equal(shouldAutoRecoverJwxtSession({
    allowAutoLogin: false,
    authorizationExpired: false,
    hasSavedCredentials: true,
  }), false);
  assert.equal(shouldAutoRecoverJwxtSession({
    allowAutoLogin: true,
    authorizationExpired: true,
    hasSavedCredentials: false,
  }), false);
});

test("保存信息触发验证码时保留当前验证码流程且不要求密码", async () => {
  const steps: string[] = [];
  const result = await retryJwxtAuthorization({
    disconnect: async () => { steps.push("disconnect"); },
    resetLocalState: () => { steps.push("reset"); },
    hasSavedCredentials: () => true,
    autoLogin: async () => { steps.push("auto-login"); return false; },
    needsCaptcha: () => true,
    prepareLogin: async () => { steps.push("prepare-manual"); },
  });

  assert.equal(result, "saved-captcha");
  assert.deepEqual(steps, ["disconnect", "reset", "auto-login"]);
});

test("没有保存信息时才准备手动登录表单", async () => {
  const steps: string[] = [];
  const result = await retryJwxtAuthorization({
    disconnect: async () => { steps.push("disconnect"); },
    resetLocalState: () => { steps.push("reset"); },
    hasSavedCredentials: () => false,
    autoLogin: async () => { steps.push("auto-login"); return true; },
    needsCaptcha: () => false,
    prepareLogin: async () => { steps.push("prepare-manual"); },
  });

  assert.equal(result, "manual");
  assert.deepEqual(steps, ["disconnect", "reset", "prepare-manual"]);
});
