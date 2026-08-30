import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildWechatDefaultMenu,
  buildWechatBoundMenu,
  buildWechatSubscriptionNotificationPayload,
  createWechatJsSdkSignature,
  decryptWechatPayload,
  encryptWechatPayload,
  generateWechatEncodingAesKey,
  generateWechatToken,
  getWechatBindingCapabilities,
  markWechatServiceClientUrl,
  parseWechatXml,
  renderWechatAssistantReplyImage,
  renderWechatAssistantReplyMarkdown,
  renderWechatAutomaticReply,
  renderWechatFollowSettingsTip,
  selectWechatGeneratedImageUrl,
  shouldDeliverWechatNotification,
  verifyWechatSignature,
} from "../src/services/wechatService";
import { normalizeAudioTranscriptionsUrl } from "../src/services/audioTranscription";
import {
  parseWechatScheduleRequest,
  renderWechatScheduleMarkdown,
  renderWechatTodayScheduleMarkdown,
} from "../src/services/wechatSchedule";
import { renderWechatScheduleImage } from "../src/services/wechatScheduleImage";

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

test("parses image and voice fields used by the multimodal assistant", () => {
  const image = parseWechatXml("<xml><MsgType><![CDATA[image]]></MsgType><MediaId><![CDATA[image-media]]></MediaId><PicUrl><![CDATA[https://example.com/a.jpg]]></PicUrl></xml>");
  assert.equal(image.mediaId, "image-media");
  assert.equal(image.picUrl, "https://example.com/a.jpg");
  const voice = parseWechatXml("<xml><MsgType><![CDATA[voice]]></MsgType><MediaId><![CDATA[voice-media]]></MediaId><Format><![CDATA[amr]]></Format><Recognition><![CDATA[今天有什么课？]]></Recognition></xml>");
  assert.equal(voice.mediaId, "voice-media");
  assert.equal(voice.format, "amr");
  assert.equal(voice.recognition, "今天有什么课？");
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

test("exposes OAuth binding paths without manual message codes", () => {
  const ready = { enabled: true, appId: "wx-app-id", appSecret: "app-secret", token: "callback-token" };
  assert.deepEqual(getWechatBindingCapabilities(ready, "https://cputime.cn"), {
    oauthAvailable: true,
    qrBindingAvailable: true,
    messageBindingAvailable: false,
  });
  assert.deepEqual(getWechatBindingCapabilities(ready, ""), {
    oauthAvailable: false,
    qrBindingAvailable: true,
    messageBindingAvailable: false,
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

test("builds a personalized bound menu with common schedule-range events", () => {
  const menu = buildWechatBoundMenu("https://cputime.cn");
  const campus = menu.button[0].sub_button;
  assert.deepEqual(menu.button.map((group) => group.name), ["校园", "社区", "我的"]);
  assert.deepEqual(campus[0], { type: "click", name: "今日课表", key: "SHIJIAN_TODAY_SCHEDULE" });
  assert.deepEqual(campus.slice(0, 4).map((item) => item.name), ["今日课表", "明日课表", "本周课表", "下周课表"]);
  assert.equal(new URL(campus[4].url!).searchParams.get("client"), "wechat-service");
});

test("marks same-site service-account links without changing external links", () => {
  const marked = new URL(markWechatServiceClientUrl("/schedule?week=2#today", "https://cputime.cn"));
  assert.equal(marked.pathname, "/schedule");
  assert.equal(marked.searchParams.get("week"), "2");
  assert.equal(marked.searchParams.get("client"), "wechat-service");
  assert.equal(marked.hash, "#today");
  assert.equal(markWechatServiceClientUrl("https://example.com/path", "https://cputime.cn"), "https://example.com/path");
});

test("keeps fixed replies concise and lets ordinary text continue to the assistant", () => {
  const origin = "https://cputime.cn";
  const helpReply = renderWechatAutomaticReply("帮助", true, origin);
  assert.match(helpReply, /拾小间服务号/);
  assert.doesNotMatch(helpReply, /药里拾间服务号/);
  assert.match(helpReply, /拾间AI/);
  assert.match(renderWechatAutomaticReply("状态", false, origin), /尚未绑定/);
  const bindReply = renderWechatAutomaticReply("绑定 A1B2C3D4", false, origin);
  assert.match(bindReply, /不再使用手动绑定码/);
  assert.match(bindReply, /微信内绑定.*扫码绑定/);
  const ordinaryReply = renderWechatAutomaticReply("帮我查一下课表", true, origin);
  assert.equal(ordinaryReply, "");
  assert.doesNotMatch(helpReply, /生成绑定码|发送：绑定/);
});

test("formats WeChat assistant answers for the QQBot image renderer", () => {
  const response = {
    answer: "今天是第 3 教学周。",
    actions: [{ id: "schedule", label: "我的课表", description: "", url: "/schedule", icon: "", owner: "", requireLogin: true }],
    suggestions: [],
    fallback: false,
    sources: [
      { title: "校历", url: "https://example.edu/calendar" },
      { title: "无效", url: "javascript:alert(1)" },
    ],
  };
  const reply = renderWechatAssistantReplyMarkdown(response);
  assert.match(reply, /今天是第 3 教学周/);
  assert.match(reply, /校历：https:\/\/example\.edu\/calendar/);
  assert.match(reply, /我的课表：https:\/\/cputime\.cn\/schedule/);
  assert.doesNotMatch(reply, /javascript:/);
  assert.match(reply, /以上回复由拾间AI生成/);
  const image = renderWechatAssistantReplyImage(response);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("selects only persisted assistant-generated images for direct WeChat delivery", () => {
  const valid = "/uploads/assistant-generated/2026/08/123e4567-e89b-12d3-a456-426614174000.png";
  assert.equal(selectWechatGeneratedImageUrl({ images: [{ url: valid, alt: "生成图" }] }), valid);
  assert.equal(selectWechatGeneratedImageUrl({ images: [{ url: "https://example.com/image.png", alt: "外链" }] }), "");
  assert.equal(selectWechatGeneratedImageUrl({ images: [] }), "");
});

test("signs JS-SDK requests and builds one-time subscription payloads", () => {
  const ticket = "ticket";
  const nonce = "nonce";
  const timestamp = 1724550000;
  const url = "https://cputime.cn/messages?tab=settings";
  const expected = crypto.createHash("sha1").update(`jsapi_ticket=${ticket}&noncestr=${nonce}&timestamp=${timestamp}&url=${url}`).digest("hex");
  assert.equal(createWechatJsSdkSignature(ticket, nonce, timestamp, url), expected);
  assert.equal(normalizeAudioTranscriptionsUrl("https://api.example.com/v1/responses"), "https://api.example.com/v1/audio/transcriptions");
  const payload = buildWechatSubscriptionNotificationPayload({
    subscriptionTemplateId: "template-id",
    subscriptionTitleField: "thing1",
    subscriptionContentField: "thing2",
    subscriptionTimeField: "time3",
    subscriptionRemarkField: "thing4",
  }, "openid", {
    title: "课程提醒",
    content: "课程即将开始",
    createdAt: new Date("2026-08-30T08:00:00Z"),
    source: "拾小间",
  });
  assert.equal(payload.touser, "openid");
  assert.equal(payload.template_id, "template-id");
  assert.equal(payload.data.thing1.value, "课程提醒");
  assert.equal(payload.data.thing2.value, "课程即将开始");
});

test("renders a concise today-schedule image body", () => {
  const markdown = renderWechatTodayScheduleMarkdown({
    currentWeek: 3,
    teachingWeekActive: true,
    today: {
      date: "2026-09-16",
      courses: [{ startTime: "08:00", endTime: "09:40", name: "药物化学", location: "D313", teacher: "张老师" }],
    },
  });
  assert.match(markdown, /第 3 周/);
  assert.match(markdown, /08:00-09:40  药物化学/);
  assert.match(markdown, /地点：D313/);
});

test("parses day, week, numbered-week, and weekday schedule requests", () => {
  assert.deepEqual(parseWechatScheduleRequest("明天有什么课？"), {
    scope: "day",
    label: "明日课表",
    dayOffset: 1,
  });
  assert.deepEqual(parseWechatScheduleRequest("下周课表"), {
    scope: "week",
    label: "下周课表",
    weekOffset: 1,
  });
  assert.deepEqual(parseWechatScheduleRequest("第8教学周课表"), {
    scope: "week",
    label: "第 8 周课表",
    weekNumber: 8,
  });
  assert.deepEqual(parseWechatScheduleRequest("下周三有什么课"), {
    scope: "day",
    label: "下周三课表",
    weekOffset: 1,
    weekday: 3,
  });
  assert.equal(parseWechatScheduleRequest("帮我规划下学期课程"), null);
});

test("renders a complete weekly schedule image body", () => {
  const days = [
    { day: 1, label: "周一", date: "2026-09-14", courses: [{ startTime: "08:00", endTime: "09:40", name: "药剂学", location: "E104" }] },
    { day: 2, label: "周二", date: "2026-09-15", courses: [] },
    { day: 3, label: "周三", date: "2026-09-16", courses: [{ startTime: "13:30", endTime: "15:10", name: "药物化学", teacher: "张老师" }] },
  ];
  const markdown = renderWechatScheduleMarkdown({
    payload: { currentWeek: 3, teachingWeekActive: true, weekDays: days },
    cached: false,
    query: { scope: "week", label: "本周课表", weekOffset: 0 },
    week: 3,
    days,
    scopeDescription: "第 3 周 · 2026-09-14 至 2026-09-20",
  });
  assert.match(markdown, /本周课表/);
  assert.match(markdown, /周一 · 2026-09-14/);
  assert.match(markdown, /08:00-09:40  药剂学/);
  assert.match(markdown, /周三 · 2026-09-16/);
  assert.match(markdown, /13:30-15:10  药物化学/);
});

test("renders service-account schedules with the timetable image renderer", () => {
  const day = {
    day: 3,
    label: "周三",
    date: "2026-09-16",
    courses: [{ startSlot: 1, endSlot: 2, startTime: "08:00", endTime: "09:40", name: "药物化学", location: "D313", teacher: "张老师" }],
  };
  const image = renderWechatScheduleImage({
    payload: { currentWeek: 3, teachingWeekActive: true },
    cached: false,
    query: { scope: "day", label: "明日课表", dayOffset: 1 },
    week: 3,
    day,
    scopeDescription: "2026-09-16 · 第 3 周",
  });
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(image.length > 20_000);
});

test("recommends notification settings after the user follows the service account", () => {
  const tip = renderWechatFollowSettingsTip();
  assert.match(tip, /右上角进入设置/);
  assert.match(tip, /关闭“消息免打扰”/);
  assert.match(tip, /设为置顶/);
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
