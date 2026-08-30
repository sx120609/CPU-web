import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildWechatDefaultMenu,
  decryptWechatPayload,
  encryptWechatPayload,
  generateWechatEncodingAesKey,
  generateWechatToken,
  getWechatBindingCapabilities,
  markWechatServiceClientUrl,
  parseWechatBindCommand,
  parseWechatXml,
  renderWechatAutomaticReply,
  renderWechatFollowSettingsTip,
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

test("exposes every supported binding path when the service account is ready", () => {
  const ready = { enabled: true, appId: "wx-app-id", appSecret: "app-secret", token: "callback-token" };
  assert.deepEqual(getWechatBindingCapabilities(ready, "https://cputime.cn"), {
    oauthAvailable: true,
    qrBindingAvailable: true,
    messageBindingAvailable: true,
  });
  assert.deepEqual(getWechatBindingCapabilities(ready, ""), {
    oauthAvailable: false,
    qrBindingAvailable: true,
    messageBindingAvailable: true,
  });
  assert.deepEqual(getWechatBindingCapabilities({ ...ready, enabled: false }, "https://cputime.cn"), {
    oauthAvailable: false,
    qrBindingAvailable: false,
    messageBindingAvailable: false,
  });
});

test("builds a three-column HTTPS custom menu for campus, community, and account links", () => {
  const menu = buildWechatDefaultMenu("https://cputime.cn");
  assert.deepEqual(menu.button.map((group) => group.name), ["校园", "社区", "我的"]);
  assert.equal(menu.button.length, 3);
  assert.ok(menu.button.every((group) => group.name.length <= 4 && group.sub_button.length <= 5));
  assert.ok(menu.button.flatMap((group) => group.sub_button).every((item) => item.name.length <= 7 && item.url.startsWith("https://cputime.cn/")));
  assert.ok(menu.button.flatMap((group) => group.sub_button).every((item) => new URL(item.url).searchParams.get("client") === "wechat-service"));
  assert.deepEqual(menu.button[0].sub_button.map((item) => new URL(item.url).pathname), ["/schedule", "/jwxt", "/services"]);
  assert.deepEqual(menu.button[1].sub_button.map((item) => new URL(item.url).pathname), ["/forum", "/lost-found", "/post"]);
  assert.throws(() => buildWechatDefaultMenu("http://localhost:5173"), /HTTPS/);
});

test("marks same-site service-account links without changing external links", () => {
  const marked = new URL(markWechatServiceClientUrl("/schedule?week=2#today", "https://cputime.cn"));
  assert.equal(marked.pathname, "/schedule");
  assert.equal(marked.searchParams.get("week"), "2");
  assert.equal(marked.searchParams.get("client"), "wechat-service");
  assert.equal(marked.hash, "#today");
  assert.equal(markWechatServiceClientUrl("https://example.com/path", "https://cputime.cn"), "https://example.com/path");
});

test("keeps automatic replies limited to binding and notification guidance", () => {
  const origin = "https://cputime.cn";
  assert.match(renderWechatAutomaticReply("帮助", true, origin), /仅用于账号绑定和接收站内通知/);
  assert.match(renderWechatAutomaticReply("状态", false, origin), /尚未绑定/);
  const ordinaryReply = renderWechatAutomaticReply("帮我查一下课表", true, origin);
  assert.match(ordinaryReply, /不提供对话查询/);
  assert.doesNotMatch(ordinaryReply, /AI|投稿|论坛/iu);
});

test("recommends notification settings after the user follows the service account", () => {
  const tip = renderWechatFollowSettingsTip();
  assert.match(tip, /右上角进入设置/);
  assert.match(tip, /关闭“消息免打扰”/);
  assert.match(tip, /设为置顶/);
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
