import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  decryptWechatPayload,
  encryptWechatPayload,
  generateWechatEncodingAesKey,
  generateWechatToken,
  parseWechatBindCommand,
  parseWechatXml,
  shouldDeliverWechatNotification,
  verifyWechatSignature,
} from "../src/services/wechatService";

test("verifies plaintext and encrypted callback signatures", () => {
  const token = "test-token";
  const timestamp = "1724550000";
  const nonce = "nonce-value";
  const encrypted = "encrypted-payload";
  const plainSignature = sha1([token, timestamp, nonce]);
  const encryptedSignature = sha1([token, timestamp, nonce, encrypted]);

  assert.equal(verifyWechatSignature(token, timestamp, nonce, undefined, plainSignature), true);
  assert.equal(verifyWechatSignature(token, timestamp, nonce, encrypted, encryptedSignature), true);
  assert.equal(verifyWechatSignature(token, timestamp, nonce, encrypted, "bad"), false);
});

test("decrypts WeChat safe-mode payload and checks AppID", () => {
  const appId = "wx-test-app-id";
  const key = crypto.createHash("sha256").update("wechat-test-key").digest();
  const encodingAesKey = key.toString("base64").replace(/=+$/g, "");
  const xml = "<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content></xml>";
  const encrypted = encryptWechatPayloadForTest(xml, appId, key);

  assert.equal(decryptWechatPayload(encrypted, encodingAesKey, appId), xml);
  assert.throws(() => decryptWechatPayload(encrypted, encodingAesKey, "another-app"));
});

test("round-trips encrypted passive replies", () => {
  const encodingAesKey = generateWechatEncodingAesKey();
  const appId = "wx-test-passive-reply";
  const xml = "<xml><Content><![CDATA[帮助]]></Content></xml>";
  const encrypted = encryptWechatPayload(xml, encodingAesKey, appId);
  assert.equal(decryptWechatPayload(encrypted, encodingAesKey, appId), xml);
});

test("parses text and scan event XML", () => {
  const text = parseWechatXml("<xml><FromUserName><![CDATA[o123]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[A &amp; B]]></Content><MsgId>42</MsgId></xml>");
  assert.equal(text.fromUserName, "o123");
  assert.equal(text.content, "A & B");
  assert.equal(text.msgId, "42");

  const event = parseWechatXml("<xml><FromUserName><![CDATA[o456]]></FromUserName><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[SCAN]]></Event><EventKey><![CDATA[bind_token]]></EventKey></xml>");
  assert.equal(event.msgType, "event");
  assert.equal(event.event, "SCAN");
  assert.equal(event.eventKey, "bind_token");
});

test("respects channel and category preferences", () => {
  assert.equal(shouldDeliverWechatNotification({ category: "reply" }, { wechatNotifyEnabled: true, subscribeReply: true }), true);
  assert.equal(shouldDeliverWechatNotification({ category: "reply" }, { wechatNotifyEnabled: true, subscribeReply: false }), false);
  assert.equal(shouldDeliverWechatNotification({ category: "system" }, { wechatNotifyEnabled: false, subscribeSystem: true }), false);
  assert.equal(shouldDeliverWechatNotification({ category: "system", targetClient: "ios" }, { wechatNotifyEnabled: true }), false);
});

test("generates credentials accepted by the public-platform form", () => {
  assert.match(generateWechatToken(), /^[a-f0-9]{32}$/);
  assert.match(generateWechatEncodingAesKey(), /^[A-Za-z0-9]{43}$/);
});

test("parses WeChat message binding commands", () => {
  assert.equal(parseWechatBindCommand("绑定 A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseWechatBindCommand("绑定A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseWechatBindCommand("绑定码：A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseWechatBindCommand("A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseWechatBindCommand("  绑定   123456  "), "123456");
  assert.equal(parseWechatBindCommand("绑定"), "");
  assert.equal(parseWechatBindCommand("绑定 12345"), "");
  assert.equal(parseWechatBindCommand("请绑定 A1B2C3D4"), "");
});

function sha1(parts: string[]) {
  return crypto.createHash("sha1").update([...parts].sort().join("")).digest("hex");
}

function encryptWechatPayloadForTest(xml: string, appId: string, key: Buffer) {
  const message = Buffer.from(xml);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length);
  const plain = Buffer.concat([crypto.randomBytes(16), length, message, Buffer.from(appId)]);
  const padding = 32 - (plain.length % 32 || 32);
  const paddingLength = padding || 32;
  const padded = Buffer.concat([plain, Buffer.alloc(paddingLength, paddingLength)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}
