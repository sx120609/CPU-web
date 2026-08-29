import assert from "node:assert/strict";
import test from "node:test";
import { loadCredentials, validateExecutionApproval } from "../src/config.mjs";

test("credentials accept a complete environment pair and reject partial credentials", async () => {
  const credentials = await loadCredentials({
    TENCENTCLOUD_SECRET_ID: "id",
    TENCENTCLOUD_SECRET_KEY: "key",
    TENCENTCLOUD_SESSION_TOKEN: "token",
  });
  assert.deepEqual(credentials, { secretId: "id", secretKey: "key", token: "token", source: "environment" });
  await assert.rejects(() => loadCredentials({ TENCENTCLOUD_SECRET_ID: "id" }), /incomplete/);
});

test("execute requires durable state and the exact enabled domain set", () => {
  const domains = [
    { domain: "img.cputime.cn", enabled: true },
    { domain: "disabled.cputime.cn", enabled: false },
  ];
  assert.throws(() => validateExecutionApproval({ execute: true, confirmDomains: ["img.cputime.cn"] }, domains), /state-file/);
  assert.throws(() => validateExecutionApproval({ execute: true, stateFile: "state.json", confirmDomains: [] }, domains), /exact enabled set/);
  assert.doesNotThrow(() => validateExecutionApproval({ execute: true, stateFile: "state.json", confirmDomains: ["img.cputime.cn"] }, domains));
});
