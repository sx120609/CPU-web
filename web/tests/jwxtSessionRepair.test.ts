import assert from "node:assert/strict";
import test from "node:test";
import { repairUnavailableJwxtSession } from "../src/utils/jwxtSessionRepair";

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
