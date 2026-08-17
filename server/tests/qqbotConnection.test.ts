import assert from "node:assert/strict";
import test from "node:test";
import {
  getQqBotConnectionStatus,
  normalizeQqBotConnectionMode,
  QQBOT_INBOUND_WS_PATH,
} from "../src/services/qqbot/connection";

test("QQBot connection mode defaults to the compatible outbound direction", () => {
  assert.equal(normalizeQqBotConnectionMode(undefined), "outbound");
  assert.equal(normalizeQqBotConnectionMode("unexpected"), "outbound");
  assert.equal(normalizeQqBotConnectionMode("inbound"), "inbound");
  assert.equal(QQBOT_INBOUND_WS_PATH, "/api/qqbot/napcat");
});

test("NapCat主动连接模式不会尝试连接旧地址", () => {
  assert.equal(getQqBotConnectionStatus({
    enabled: true,
    connectionMode: "inbound",
    napcatBaseUrl: "http://napcat.example.invalid",
  }), "inbound");
  assert.equal(getQqBotConnectionStatus({
    enabled: true,
    connectionMode: "outbound",
    napcatBaseUrl: "http://napcat.example.invalid",
  }), "http");
});
