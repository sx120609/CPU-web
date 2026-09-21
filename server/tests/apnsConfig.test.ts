import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApnsConfig } from "../src/services/apnsConfig";

test("APNs config accepts an empty disabled configuration", () => {
  assert.deepEqual(normalizeApnsConfig({ keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 5, channels: {} }), {
    keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 5, channels: {},
  });
});

test("APNs config requires all provider credentials together", () => {
  assert.throws(() => normalizeApnsConfig({ keyPath: "/tmp/key.p8", keyID: "", teamID: "T", bundleID: "b", tickSeconds: 5, channels: {} }), /必须同时填写/);
});

test("APNs config validates production and sandbox channel keys", () => {
  const value = normalizeApnsConfig({ keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 2.5, channels: {
    "production:nju": "prod-channel",
    "sandbox:nju": { channelID: "sandbox-channel" },
  } });
  assert.equal(value.channels["sandbox:nju"], "sandbox-channel");
  assert.throws(() => normalizeApnsConfig({ keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 5, channels: { nju: "bad" } }), /频道键/);
});
