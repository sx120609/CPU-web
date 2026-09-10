import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentView = await readFile(new URL("../cpuweb/ContentView.swift", import.meta.url), "utf8");
const bridge = await readFile(new URL("../cpuweb/CPUIOSBridge.swift", import.meta.url), "utf8");
const profile = await readFile(new URL("../../web/src/views/profile/Index.vue", import.meta.url), "utf8");

test("Watch sync is opened from the iOS-only profile entry instead of a global overlay", () => {
  assert.equal(contentView.includes('.overlay(alignment: .trailing)'), false);
  assert.match(bridge, /openWatchSyncStatus/);
  assert.match(profile, /v-if="iosWatchSyncAvailable"/);
  assert.match(profile, /Apple Watch 课表/);
});
