import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import QRCode from "qrcode";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { askCampusAssistant, type CampusAssistantResponse } from "./campusAssistant";
import { normalizeAiImageDataUrl } from "./aiImageValidation";
import { transcribeAudioBuffer } from "./audioTranscription";
import { runWithDistributedLock } from "./cache";
import { prepareMediaLocalFileForProcessing } from "./mediaStorage";
import { appendQqBotAiDisclosure } from "./qqbot/dailyAssistant";
import { renderQqBotAiReplyImage } from "./qqbot/aiReplyImage";
import { getFeatures, getSiteOrigin } from "./siteSettings";
import {
  loadWechatSchedule,
  parseWechatScheduleRequest,
  type WechatScheduleQuery,
} from "./wechatSchedule";
import { renderWechatScheduleImage } from "./wechatScheduleImage";

const CONFIG_ID = 1;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_MESSAGE_WINDOW_MS = 48 * 60 * 60 * 1000;
const CUSTOMER_MESSAGE_LIMIT_PER_WINDOW = 5;
const CUSTOMER_EVENT_WINDOW_MS = 60_000;
const CUSTOMER_EVENT_LIMIT_PER_WINDOW = 3;
const NOTIFICATION_LOOKBACK_MS = CUSTOMER_MESSAGE_WINDOW_MS;
const NOTIFICATION_BATCH_MIN = 500;
const NOTIFICATION_BATCH_MAX = 5_000;
const WECHAT_API_TIMEOUT_MS = 12_000;
const WECHAT_TEMP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WECHAT_INBOUND_MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const WECHAT_BOUND_TAG_NAME = "拾间已绑定";
const WECHAT_SCHEDULE_EVENT_QUERIES = new Map<string, WechatScheduleQuery>([
  ["SHIJIAN_TODAY_SCHEDULE", { scope: "day", label: "今日课表", dayOffset: 0 }],
  ["SHIJIAN_TOMORROW_SCHEDULE", { scope: "day", label: "明日课表", dayOffset: 1 }],
  ["SHIJIAN_THIS_WEEK_SCHEDULE", { scope: "week", label: "本周课表", weekOffset: 0 }],
  ["SHIJIAN_NEXT_WEEK_SCHEDULE", { scope: "week", label: "下周课表", weekOffset: 1 }],
]);
const WECHAT_SCHEDULE_QUICK_COMMANDS = [
  { id: "SHIJIAN_QUERY_TODAY", content: "今日课表" },
  { id: "SHIJIAN_QUERY_TOMORROW", content: "明日课表" },
  { id: "SHIJIAN_QUERY_THIS_WEEK", content: "本周课表" },
  { id: "SHIJIAN_QUERY_NEXT_WEEK", content: "下周课表" },
  { id: "SHIJIAN_QUERY_WEEK_AFTER_NEXT", content: "下下周课表" },
];
const DEFAULT_NOTIFY_CATEGORIES = ["reply", "mention", "direct-message", "like", "system", "service-tool", "lost-found", "market", "school-feed"];
const NOTIFY_CATEGORY_OPTIONS = new Set(DEFAULT_NOTIFY_CATEGORIES);
const MAX_WECHAT_TEXT_LENGTH = 1800;
const WECHAT_AES_KEY_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

type WechatConfigRow = Awaited<ReturnType<typeof getWechatServiceConfigRaw>>;

export type WechatInboundMessage = {
  toUserName: string;
  fromUserName: string;
  createTime: string;
  msgType: string;
  content: string;
  msgId: string;
  event: string;
  eventKey: string;
  status: string;
  ticket: string;
  mediaId: string;
  picUrl: string;
  format: string;
  recognition: string;
  thumbMediaId: string;
};

type WechatPersistentDelivery = {
  channel: "subscription" | "template";
  response: Record<string, any>;
};

let accessTokenCache: { fingerprint: string; token: string; expiresAt: number } | null = null;
let jsapiTicketCache: { fingerprint: string; ticket: string; expiresAt: number } | null = null;
let notificationPollerStarted = false;
let notificationDispatchWakeTimer: NodeJS.Timeout | null = null;

export async function getWechatServiceConfigRaw() {
  return prisma.wechatServiceConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID },
    update: {},
  });
}

export function formatWechatServiceConfig(config: WechatConfigRow) {
  const origin = normalizedSiteOrigin();
  return {
    id: config.id,
    enabled: config.enabled,
    accountName: config.accountName,
    wechatId: config.wechatId,
    appId: config.appId,
    hasAppSecret: Boolean(config.appSecret),
    appSecretMasked: maskSecret(config.appSecret),
    token: config.token,
    encodingAesKey: config.encodingAesKey,
    messageMode: normalizeMessageMode(config.messageMode),
    notificationEnabled: config.notificationEnabled,
    assistantEnabled: config.assistantEnabled,
    notifyCategories: normalizeNotifyCategories(parseStringArray(config.notifyCategories)),
    notificationTemplateId: config.notificationTemplateId,
    workOrderTemplateId: config.workOrderTemplateId,
    paymentSuccessTemplateId: config.paymentSuccessTemplateId,
    templateTitleField: config.templateTitleField,
    templateContentField: config.templateContentField,
    templateTimeField: config.templateTimeField,
    templateRemarkField: config.templateRemarkField,
    subscriptionEnabled: config.subscriptionEnabled,
    subscriptionTemplateId: config.subscriptionTemplateId,
    subscriptionTitleField: config.subscriptionTitleField,
    subscriptionContentField: config.subscriptionContentField,
    subscriptionTimeField: config.subscriptionTimeField,
    subscriptionRemarkField: config.subscriptionRemarkField,
    callbackUrl: origin ? `${origin}/api/wechat/callback` : "/api/wechat/callback",
    oauthCallbackUrl: origin ? `${origin}/api/wechat/oauth/callback` : "/api/wechat/oauth/callback",
    oauthDomain: origin ? new URL(origin).hostname : "",
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function updateWechatServiceConfig(input: {
  enabled?: boolean;
  accountName?: string;
  wechatId?: string;
  appId?: string;
  appSecret?: string;
  clearAppSecret?: boolean;
  token?: string;
  encodingAesKey?: string;
  messageMode?: string;
  notificationEnabled?: boolean;
  assistantEnabled?: boolean;
  notifyCategories?: string[];
  notificationTemplateId?: string;
  workOrderTemplateId?: string;
  paymentSuccessTemplateId?: string;
  templateTitleField?: string;
  templateContentField?: string;
  templateTimeField?: string;
  templateRemarkField?: string;
  subscriptionEnabled?: boolean;
  subscriptionTemplateId?: string;
  subscriptionTitleField?: string;
  subscriptionContentField?: string;
  subscriptionTimeField?: string;
  subscriptionRemarkField?: string;
}) {
  const current = await getWechatServiceConfigRaw();
  const data: Record<string, unknown> = {};
  if (input.accountName !== undefined) data.accountName = input.accountName.trim().slice(0, 80);
  if (input.wechatId !== undefined) data.wechatId = input.wechatId.trim().slice(0, 80);
  if (input.appId !== undefined) data.appId = input.appId.trim().slice(0, 80);
  if (input.clearAppSecret) data.appSecret = "";
  else if (input.appSecret?.trim()) data.appSecret = input.appSecret.trim().slice(0, 240);
  if (input.token !== undefined) data.token = input.token.trim().slice(0, 120);
  if (input.encodingAesKey !== undefined) data.encodingAesKey = input.encodingAesKey.trim().slice(0, 80);
  if (input.messageMode !== undefined) data.messageMode = normalizeMessageMode(input.messageMode);
  if (input.notificationEnabled !== undefined) data.notificationEnabled = input.notificationEnabled;
  if (input.assistantEnabled !== undefined) data.assistantEnabled = input.assistantEnabled;
  if (input.notifyCategories !== undefined) data.notifyCategories = JSON.stringify(normalizeNotifyCategories(input.notifyCategories));
  if (input.notificationTemplateId !== undefined) data.notificationTemplateId = input.notificationTemplateId.trim().slice(0, 160);
  if (input.workOrderTemplateId !== undefined) data.workOrderTemplateId = input.workOrderTemplateId.trim().slice(0, 160);
  if (input.paymentSuccessTemplateId !== undefined) data.paymentSuccessTemplateId = input.paymentSuccessTemplateId.trim().slice(0, 160);
  if (input.templateTitleField !== undefined) data.templateTitleField = normalizeTemplateField(input.templateTitleField);
  if (input.templateContentField !== undefined) data.templateContentField = normalizeTemplateField(input.templateContentField);
  if (input.templateTimeField !== undefined) data.templateTimeField = normalizeTemplateField(input.templateTimeField);
  if (input.templateRemarkField !== undefined) data.templateRemarkField = normalizeTemplateField(input.templateRemarkField);
  if (input.subscriptionEnabled !== undefined) data.subscriptionEnabled = input.subscriptionEnabled;
  if (input.subscriptionTemplateId !== undefined) data.subscriptionTemplateId = input.subscriptionTemplateId.trim().slice(0, 160);
  if (input.subscriptionTitleField !== undefined) data.subscriptionTitleField = normalizeTemplateField(input.subscriptionTitleField);
  if (input.subscriptionContentField !== undefined) data.subscriptionContentField = normalizeTemplateField(input.subscriptionContentField);
  if (input.subscriptionTimeField !== undefined) data.subscriptionTimeField = normalizeTemplateField(input.subscriptionTimeField);
  if (input.subscriptionRemarkField !== undefined) data.subscriptionRemarkField = normalizeTemplateField(input.subscriptionRemarkField);

  const nextEnabled = input.enabled ?? current.enabled;
  const nextAppId = String(data.appId ?? current.appId).trim();
  const nextAppSecret = String(data.appSecret ?? current.appSecret).trim();
  const nextToken = String(data.token ?? current.token).trim();
  const nextEncodingAesKey = String(data.encodingAesKey ?? current.encodingAesKey).trim();
  const nextMessageMode = normalizeMessageMode(String(data.messageMode ?? current.messageMode));
  if (nextEnabled) {
    if (!nextAppId || !nextAppSecret || !nextToken) throw Errors.badRequest("启用服务号前请完整填写 AppID、AppSecret 和 Token");
    if (nextMessageMode !== "plaintext" && !isValidEncodingAesKey(nextEncodingAesKey)) {
      throw Errors.badRequest("安全或兼容模式需要填写 43 位 EncodingAESKey");
    }
  }
  if (input.enabled !== undefined) data.enabled = input.enabled;

  const updated = await prisma.wechatServiceConfig.update({
    where: { id: current.id },
    data,
  });
  accessTokenCache = null;
  jsapiTicketCache = null;
  return formatWechatServiceConfig(updated);
}

export function generateWechatToken() {
  return crypto.randomBytes(16).toString("hex");
}

export function generateWechatEncodingAesKey() {
  return Array.from({ length: 43 }, () => WECHAT_AES_KEY_CHARACTERS[crypto.randomInt(WECHAT_AES_KEY_CHARACTERS.length)]).join("");
}

export function buildWechatDefaultMenu(siteOrigin = normalizedSiteOrigin()) {
  const origin = normalizeWechatMenuOrigin(siteOrigin);
  const view = (name: string, path: string) => ({ type: "view", name, url: markWechatServiceClientUrl(path, origin) });
  return {
    button: [
      {
        name: "校园",
        sub_button: [
          view("我的课表", "/schedule"),
          view("教务中心", "/jwxt"),
          view("校园服务", "/services"),
        ],
      },
      {
        name: "社区",
        sub_button: [
          view("论坛首页", "/forum"),
          view("失物招领", "/lost-found"),
          view("发布内容", "/post"),
        ],
      },
      {
        name: "我的",
        sub_button: [
          view("消息中心", "/messages"),
          view("微信绑定", "/messages?tab=settings"),
          view("个人中心", "/profile"),
        ],
      },
    ],
  };
}

export function buildWechatBoundMenu(siteOrigin = normalizedSiteOrigin()) {
  const origin = normalizeWechatMenuOrigin(siteOrigin);
  const view = (name: string, path: string) => ({ type: "view", name, url: markWechatServiceClientUrl(path, origin) });
  const click = (name: string, key: string) => ({ type: "click", name, key });
  return {
    button: [
      {
        name: "校园",
        sub_button: [
          view("我的课表", "/schedule"),
          click("今日课表", "SHIJIAN_TODAY_SCHEDULE"),
          view("教务中心", "/jwxt"),
          view("校园服务", "/services"),
        ],
      },
      {
        name: "社区",
        sub_button: [
          view("论坛首页", "/forum"),
          view("失物招领", "/lost-found"),
          view("发布内容", "/post"),
        ],
      },
      {
        name: "我的",
        sub_button: [
          view("消息中心", "/messages"),
          view("通知订阅", "/messages?tab=settings"),
          view("个人中心", "/profile"),
        ],
      },
    ],
  };
}

export function markWechatServiceClientUrl(rawUrl: string, siteOrigin = normalizedSiteOrigin()) {
  const raw = String(rawUrl || "").trim();
  const origin = String(siteOrigin || "").trim().replace(/\/+$/, "");
  if (!raw || !origin) return raw;
  try {
    const site = new URL(origin);
    const target = new URL(raw, `${site.origin}/`);
    if (target.origin !== site.origin) return raw;
    target.searchParams.set("client", "wechat-service");
    return target.toString();
  } catch {
    return raw;
  }
}

export async function publishWechatDefaultMenu() {
  const menu = buildWechatDefaultMenu();
  const boundMenu = buildWechatBoundMenu();
  await callWechatApi("/cgi-bin/menu/delete", { method: "GET" }).catch(() => undefined);
  await callWechatApi("/cgi-bin/menu/create", { method: "POST", body: menu });
  const tagId = await ensureWechatBoundTagId();
  const bindings = await prisma.wechatBinding.findMany({
    where: { enabled: true, subscribed: true },
    select: { openId: true },
  });
  let taggedCount = 0;
  for (let index = 0; index < bindings.length; index += 50) {
    const openidList = bindings.slice(index, index + 50).map((binding) => binding.openId);
    if (!openidList.length) continue;
    await callWechatApi("/cgi-bin/tags/members/batchtagging", {
      method: "POST",
      body: { openid_list: openidList, tagid: tagId },
    });
    taggedCount += openidList.length;
  }
  const conditional = await callWechatApi("/cgi-bin/menu/addconditional", {
    method: "POST",
    body: { ...boundMenu, matchrule: { tag_id: String(tagId) } },
  });
  return {
    ok: true,
    menu,
    boundMenu,
    tagId,
    taggedCount,
    conditionalMenuId: String(conditional.menuid || ""),
  };
}

export async function getUserWechatProfile(userId: number, jwxtToken?: string | null) {
  const [config, binding] = await Promise.all([
    getWechatServiceConfigRaw(),
    prisma.wechatBinding.findUnique({ where: { userId } }),
  ]);
  const token = String(jwxtToken || "").trim();
  if (binding && token && token !== binding.jwxtToken) {
    await prisma.wechatBinding.update({
      where: { id: binding.id },
      data: { jwxtToken: token, jwxtTokenUpdatedAt: new Date() },
    });
  }
  return {
    enabled: config.enabled,
    accountName: config.accountName,
    wechatId: config.wechatId,
    notificationEnabled: config.notificationEnabled,
    assistantEnabled: config.assistantEnabled,
    persistentNotificationAvailable: canSendNotificationTemplate(config) || canSendSubscriptionNotification(config),
    subscriptionAvailable: Boolean(
      config.enabled
      && config.subscriptionEnabled
      && config.subscriptionTemplateId
      && config.appId
      && normalizedSiteOrigin()
    ),
    subscriptionTemplateId: config.subscriptionEnabled ? config.subscriptionTemplateId : "",
    ...getWechatBindingCapabilities(config),
    binding: binding ? {
      id: binding.id,
      enabled: binding.enabled,
      subscribed: binding.subscribed,
      subscribedAt: binding.subscribedAt,
      unsubscribedAt: binding.unsubscribedAt,
      lastInteractionAt: binding.lastInteractionAt,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    } : null,
    activeBindToken: null,
  };
}

export function getWechatBindingCapabilities(
  config: { enabled: boolean; appId: string; appSecret: string; token: string },
  siteOrigin = normalizedSiteOrigin(),
) {
  const apiReady = Boolean(config.enabled && config.appId && config.appSecret);
  return {
    oauthAvailable: Boolean(apiReady && siteOrigin),
    qrBindingAvailable: apiReady,
    messageBindingAvailable: false,
  };
}

export async function createWechatBindToken(_userId: number) {
  throw Errors.badRequest("微信绑定码已停用，请使用微信内绑定或扫码绑定");
}

export async function deleteUserWechatBinding(userId: number) {
  const binding = await prisma.wechatBinding.findUnique({ where: { userId }, select: { id: true, openId: true } });
  if (!binding) throw Errors.notFound("当前没有可解绑的微信服务号账号");
  await prisma.wechatBinding.delete({ where: { id: binding.id } });
  void syncWechatBoundTag(binding.openId, false).catch(() => undefined);
  return { ok: true };
}

export async function createWechatOauthBindUrl(userId: number) {
  const config = await getWechatServiceConfigRaw();
  ensureWechatOauthReady(config);
  const existing = await prisma.wechatBinding.findUnique({ where: { userId }, select: { id: true } });
  if (existing) throw Errors.badRequest("当前账号已经绑定微信服务号，如需更换请先解绑");
  const origin = normalizedSiteOrigin();
  const state = crypto.randomBytes(24).toString("base64url");
  await prisma.wechatOauthState.create({
    data: {
      userId,
      stateHash: hashToken(state),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });
  const redirectUri = `${origin}/api/wechat/oauth/callback`;
  const params = new URLSearchParams({
    appid: config.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snsapi_base",
    state,
  });
  return {
    url: `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  };
}

export async function completeWechatOauthBinding(code: string, state: string) {
  const config = await getWechatServiceConfigRaw();
  ensureWechatOauthReady(config);
  const stateHash = hashToken(state);
  const oauthState = await prisma.wechatOauthState.findUnique({ where: { stateHash } });
  if (!oauthState || oauthState.usedAt || oauthState.expiresAt <= new Date()) {
    throw Errors.badRequest("微信绑定请求已失效，请返回消息中心重新发起");
  }
  const response = await fetchWechatJson("https://api.weixin.qq.com/sns/oauth2/access_token", {
    appid: config.appId,
    secret: config.appSecret,
    code,
    grant_type: "authorization_code",
  });
  const openId = String(response.openid || "").trim();
  let unionId = String(response.unionid || "").trim() || null;
  if (!openId) throw new Error(`微信网页授权未返回 OpenID：${wechatApiErrorMessage(response)}`);
  let subscribed = false;
  try {
    const follower = await callWechatApi(`/cgi-bin/user/info?openid=${encodeURIComponent(openId)}&lang=zh_CN`, { method: "GET" });
    subscribed = Number(follower.subscribe || 0) === 1;
    unionId = String(follower.unionid || "").trim() || unionId;
  } catch {
    subscribed = false;
  }
  await bindWechatIdentity(oauthState.userId, openId, unionId, { oauthStateId: oauthState.id, subscribed });
  return { ok: true };
}

export async function createWechatBindQrCode(userId: number) {
  const oauth = await createWechatOauthBindUrl(userId);
  const imageUrl = await QRCode.toDataURL(oauth.url, {
    width: 360,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#172033", light: "#ffffffff" },
  });
  return { imageUrl, expiresAt: oauth.expiresAt };
}

export async function verifyWechatCallback(input: {
  signature?: string;
  msgSignature?: string;
  timestamp?: string;
  nonce?: string;
  echoStr?: string;
  encryptType?: string;
}) {
  const config = await getWechatServiceConfigRaw();
  if (!config.enabled || !config.token) throw Errors.forbidden("微信服务号未启用");
  const timestamp = String(input.timestamp || "");
  const nonce = String(input.nonce || "");
  const echoStr = String(input.echoStr || "");
  if (input.encryptType === "aes" || input.msgSignature) {
    if (!verifyWechatSignature(config.token, timestamp, nonce, echoStr, input.msgSignature)) {
      throw Errors.forbidden("微信回调签名校验失败");
    }
    return decryptWechatPayload(echoStr, config.encodingAesKey, config.appId);
  }
  if (!verifyWechatSignature(config.token, timestamp, nonce, undefined, input.signature)) {
    throw Errors.forbidden("微信回调签名校验失败");
  }
  return echoStr;
}

export async function decodeWechatCallback(input: {
  body: string;
  signature?: string;
  msgSignature?: string;
  timestamp?: string;
  nonce?: string;
  encryptType?: string;
}) {
  const config = await getWechatServiceConfigRaw();
  if (!config.enabled || !config.token) throw Errors.forbidden("微信服务号未启用");
  const outer = parseWechatXml(input.body);
  let xml = input.body;
  if (outer.encrypt) {
    if (!verifyWechatSignature(config.token, input.timestamp, input.nonce, outer.encrypt, input.msgSignature)) {
      throw Errors.forbidden("微信回调签名校验失败");
    }
    xml = decryptWechatPayload(outer.encrypt, config.encodingAesKey, config.appId);
  } else if (!verifyWechatSignature(config.token, input.timestamp, input.nonce, undefined, input.signature)) {
    throw Errors.forbidden("微信回调签名校验失败");
  }
  return parseWechatXml(xml);
}

export async function processWechatInbound(message: WechatInboundMessage, options?: { passiveReply?: boolean }) {
  const openId = message.fromUserName.trim();
  if (!openId) return { ignored: true };
  const eventType = message.msgType === "event" ? `event:${message.event.toLowerCase()}` : message.msgType;
  const templateDeliveryEvent = isWechatTemplateDeliveryEvent(message);
  const messageId = templateDeliveryEvent && message.msgId
    ? `callback:template:${message.msgId}`
    : message.msgId || [openId, message.createTime, eventType, message.eventKey].join(":");
  const existing = await prisma.wechatMessageLog.findUnique({ where: { messageId }, select: { id: true } }).catch(() => null);
  if (existing) return { duplicate: true };

  let binding = await prisma.wechatBinding.findUnique({ where: { openId } });
  const now = new Date();
  if (templateDeliveryEvent) {
    const delivery = wechatTemplateDeliveryResult(message.status);
    const outboundMessageId = wechatTemplateOutboundMessageId(message.msgId);
    const reconciled = outboundMessageId
      ? await prisma.wechatMessageLog.updateMany({
          where: { messageId: outboundMessageId, direction: "outbound" },
          data: {
            status: delivery.status,
            result: delivery.result,
            rawPayload: JSON.stringify(message).slice(0, 12_000),
          },
        })
      : { count: 0 };
    await logWechatMessage({
      direction: "inbound",
      eventType,
      status: "ok",
      openId,
      userId: binding?.userId,
      messageId,
      result: `${delivery.result}:reconciled=${reconciled.count}`,
      rawPayload: message,
    });
    return { ok: true, reconciled: reconciled.count };
  }
  if (message.msgType === "event" && message.event.toLowerCase() === "unsubscribe") {
    if (binding) {
      binding = await prisma.wechatBinding.update({
        where: { id: binding.id },
        data: { subscribed: false, unsubscribedAt: now },
      });
      void syncWechatBoundTag(openId, false).catch(() => undefined);
    }
    await logWechatMessage({ direction: "inbound", eventType, status: "ok", openId, userId: binding?.userId, messageId, rawPayload: message });
    return { ok: true };
  }

  if (message.msgType === "event" && ["subscribe", "scan"].includes(message.event.toLowerCase())) {
    const token = normalizeBindScene(message.eventKey);
    if (token) {
      binding = await consumeWechatBindToken(token, openId);
    }
    if (binding) {
      binding = await prisma.wechatBinding.update({
        where: { id: binding.id },
        data: {
          subscribed: true,
          subscribedAt: binding.subscribedAt || now,
          unsubscribedAt: null,
          lastInteractionAt: now,
          lastInteractionType: "scan",
        },
      });
      void syncWechatBoundTag(openId, true).catch(() => undefined);
    }
    await logWechatMessage({ direction: "inbound", eventType, status: "ok", openId, userId: binding?.userId, messageId, rawPayload: message });
    if (binding?.enabled && binding.subscribed) queueWechatNotificationDispatch();
    const replyText = binding
      ? [
          "微信服务号绑定成功，之后可在这里接收已开启的站内通知。",
          renderWechatFollowSettingsTip(),
          `通知设置：${wechatSettingsUrl()}`,
        ].join("\n")
      : message.event.toLowerCase() === "subscribe" ? renderWechatWelcome() : "";
    if (replyText) {
      if (options?.passiveReply) {
        await logWechatMessage({ direction: "outbound", eventType: "passive", status: "ok", openId, userId: binding?.userId, content: replyText });
      } else {
        await sendWechatCustomerText(openId, replyText);
      }
    }
    return { ok: true, replyText: options?.passiveReply ? replyText || undefined : undefined };
  }

  let replyText = "";
  if (binding) {
    const interactionType = message.msgType === "event" ? "event" : "message";
    binding = await prisma.wechatBinding.update({
      where: { id: binding.id },
      data: { subscribed: true, unsubscribedAt: null, lastInteractionAt: now, lastInteractionType: interactionType },
    });
  }
  await logWechatMessage({
    direction: "inbound",
    eventType,
    status: "ok",
    openId,
    userId: binding?.userId,
    messageId,
    content: message.content,
    rawPayload: message,
  });
  if (binding?.enabled && binding.subscribed) queueWechatNotificationDispatch();
  const scheduleEventQuery = message.msgType === "event" && message.event.toLowerCase() === "click"
    ? WECHAT_SCHEDULE_EVENT_QUERIES.get(message.eventKey)
    : undefined;
  if (scheduleEventQuery) {
    if (binding?.enabled) {
      queueWechatScheduleReply(openId, binding.userId, scheduleEventQuery, binding.jwxtToken);
    } else {
      replyText = `请先绑定微信服务号身份，再使用个人课表：\n${wechatSettingsUrl()}`;
    }
  } else if (message.msgType === "text") {
    if (!replyText) replyText = renderWechatAutomaticReply(message.content, Boolean(binding?.userId));
    if (!replyText) {
      const scheduleQuery = parseWechatScheduleRequest(message.content);
      if (scheduleQuery) {
        if (binding?.enabled) queueWechatScheduleReply(openId, binding.userId, scheduleQuery, binding.jwxtToken);
        else replyText = `请先绑定微信服务号身份，再查询个人课表：\n${wechatSettingsUrl()}`;
      } else {
        const config = await getWechatServiceConfigRaw();
        if (config.assistantEnabled) {
          queueWechatAssistantReply(openId, binding?.enabled ? binding.userId : null, {
            question: message.content,
          });
        } else {
          replyText = renderWechatHelp(Boolean(binding?.userId));
        }
      }
    }
  } else if (message.msgType === "image") {
    const config = await getWechatServiceConfigRaw();
    if (config.assistantEnabled && message.mediaId) {
      queueWechatInboundImageReply(openId, binding?.enabled ? binding.userId : null, message.mediaId);
    } else {
      replyText = config.assistantEnabled ? "没有收到可识别的图片，请重新发送。" : renderWechatHelp(Boolean(binding?.userId));
    }
  } else if (message.msgType === "voice") {
    const config = await getWechatServiceConfigRaw();
    if (config.assistantEnabled) {
      queueWechatInboundVoiceReply(openId, binding?.enabled ? binding.userId : null, message);
    } else {
      replyText = renderWechatHelp(Boolean(binding?.userId));
    }
  }
  if (replyText) {
    if (options?.passiveReply) {
      await logWechatMessage({ direction: "outbound", eventType: "passive", status: "ok", openId, userId: binding?.userId, content: replyText });
    } else {
      await sendWechatCustomerText(openId, replyText);
    }
  }
  return { ok: true, replyText: options?.passiveReply ? replyText || undefined : undefined };
}

export async function encodeWechatPassiveTextReply(message: WechatInboundMessage, content: string, encrypted: boolean) {
  const config = await getWechatServiceConfigRaw();
  const xml = buildWechatTextReplyXml(message.fromUserName, message.toUserName, content);
  if (!encrypted) return xml;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString("hex");
  const encrypt = encryptWechatPayload(xml, config.encodingAesKey, config.appId);
  const msgSignature = createWechatSignature(config.token, timestamp, nonce, encrypt);
  return `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt><MsgSignature><![CDATA[${msgSignature}]]></MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
}

export async function sendWechatCustomerText(openId: string, content: string) {
  const chunks = splitWechatText(content).slice(0, 3);
  let lastResult: Record<string, any> = {};
  for (const chunk of chunks) {
    lastResult = await callWechatApi("/cgi-bin/message/custom/send", {
      method: "POST",
      body: { touser: openId, msgtype: "text", text: { content: chunk } },
    });
  }
  return lastResult;
}

export function buildWechatScheduleCommandMenu(openId: string, currentLabel: string) {
  return {
    touser: openId,
    msgtype: "msgmenu",
    msgmenu: {
      head_content: "查询其他课表",
      list: WECHAT_SCHEDULE_QUICK_COMMANDS.filter((item) => item.content !== currentLabel),
      tail_content: "",
    },
  };
}

export async function sendWechatScheduleCommandMenu(openId: string, currentLabel: string) {
  return callWechatApi("/cgi-bin/message/custom/send", {
    method: "POST",
    body: buildWechatScheduleCommandMenu(openId, currentLabel),
  });
}

export async function sendWechatCustomerImage(openId: string, image: Buffer) {
  const mediaId = await uploadWechatTemporaryImage(image);
  await callWechatApi("/cgi-bin/message/custom/send", {
    method: "POST",
    body: { touser: openId, msgtype: "image", image: { media_id: mediaId } },
  });
  return { mediaId };
}

export async function sendWechatTyping(openId: string, active: boolean) {
  return callWechatApi("/cgi-bin/message/custom/typing", {
    method: "POST",
    body: { touser: openId, command: active ? "Typing" : "CancelTyping" },
  });
}

export async function sendWechatCustomerLink(
  openId: string,
  article: { title: string; description: string; url: string; picUrl?: string },
) {
  return callWechatApi("/cgi-bin/message/custom/send", {
    method: "POST",
    body: {
      touser: openId,
      msgtype: "news",
      news: {
        articles: [{
          title: limitText(article.title, 64),
          description: limitText(article.description, 120),
          url: article.url,
          picurl: article.picUrl || `${normalizedSiteOrigin() || "https://cputime.cn"}/icon-512-v3.png`,
        }],
      },
    },
  });
}

type WechatAssistantReplyInput = {
  question: string;
  images?: Array<{ dataUrl: string; detail?: "low" | "high" | "auto" | "original" }>;
};

function queueWechatAssistantReply(openId: string, userId: number | null, input: WechatAssistantReplyInput) {
  setImmediate(() => {
    void runWechatTypingTask(openId, () => sendWechatAssistantReply(openId, userId, input)).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[wechat] assistant image reply failed", message);
      await logWechatMessage({
        direction: "outbound",
        eventType: "assistant:image",
        status: "failed",
        openId,
        userId: userId || undefined,
        content: input.question,
        result: message,
      });
      try {
        await sendWechatCustomerText(openId, "拾间AI暂时不可用，请稍后再试。");
      } catch (fallbackError) {
        console.warn(
          "[wechat] assistant fallback text failed",
          fallbackError instanceof Error ? fallbackError.message : fallbackError,
        );
      }
    });
  });
}

function queueWechatInboundImageReply(openId: string, userId: number | null, mediaId: string) {
  setImmediate(() => {
    void runWechatTypingTask(openId, async () => {
      const media = await downloadWechatMedia(mediaId);
      const contentType = /^image\/(?:jpeg|jpg|png|webp|gif)/iu.test(media.contentType) ? media.contentType.split(";")[0] : "image/jpeg";
      const normalized = await normalizeAiImageDataUrl(`data:${contentType};base64,${media.buffer.toString("base64")}`);
      await sendWechatAssistantReply(openId, userId, {
        question: "请描述并分析这张图片中的内容。",
        images: [{ dataUrl: normalized.dataUrl, detail: "high" }],
      });
    }).catch((error) => handleWechatAsyncReplyFailure(openId, userId, "assistant:vision", "图片分析", error));
  });
}

function queueWechatInboundVoiceReply(openId: string, userId: number | null, message: WechatInboundMessage) {
  setImmediate(() => {
    void runWechatTypingTask(openId, async () => {
      let question = message.recognition.trim();
      if (!question) {
        if (!message.mediaId) throw new Error("没有收到可用的语音素材");
        const media = await downloadWechatMedia(message.mediaId);
        question = await transcribeAudioBuffer(media.buffer, {
          extension: message.format || extensionForContentType(media.contentType),
          language: "zh",
        });
      }
      await sendWechatAssistantReply(openId, userId, { question });
    }).catch((error) => handleWechatAsyncReplyFailure(openId, userId, "assistant:voice", "语音问答", error));
  });
}

function queueWechatScheduleReply(
  openId: string,
  userId: number,
  query: WechatScheduleQuery,
  jwxtToken?: string | null,
) {
  setImmediate(() => {
    void runWechatTypingTask(openId, async () => {
      const schedule = await loadWechatSchedule(userId, query, jwxtToken);
      const image = renderWechatScheduleImage(schedule);
      const result = await sendWechatCustomerImage(openId, image);
      await sendWechatCustomerLink(openId, {
        title: "打开完整课表",
        description: "切换日期与周次，并使用完整课表工具",
        url: markWechatServiceClientUrl("/schedule"),
      }).catch(() => undefined);
      await sendWechatScheduleCommandMenu(openId, schedule.query.label).catch(() => undefined);
      await logWechatMessage({
        direction: "outbound",
        eventType: `schedule:${schedule.query.scope}:${schedule.week}`,
        status: "ok",
        openId,
        userId,
        result: result.mediaId,
      });
    }).catch((error) => handleWechatAsyncReplyFailure(openId, userId, "schedule:query", query.label, error));
  });
}

async function sendWechatAssistantReply(openId: string, userId: number | null, input: WechatAssistantReplyInput) {
  const response = await askCampusAssistant({
    message: input.question.trim(),
    history: [],
    images: input.images,
    context: {
      features: getFeatures(),
      forumAccessEnabled: true,
      loggedIn: Boolean(userId),
    },
    usage: userId ? { createdById: userId } : undefined,
  });
  let result: { mediaId: string };
  const generatedImageUrl = selectWechatGeneratedImageUrl(response);
  if (generatedImageUrl) {
    result = await sendWechatCustomerImage(openId, await readWechatGeneratedImage(generatedImageUrl));
  } else {
    result = await sendWechatCustomerImage(openId, renderWechatAssistantReplyImage(response));
  }
  await sendWechatAssistantActions(openId, response).catch((error) => {
    console.warn("[wechat] assistant action links failed", error instanceof Error ? error.message : error);
  });
  await logWechatMessage({
    direction: "outbound",
    eventType: "assistant:image",
    status: "ok",
    openId,
    userId: userId || undefined,
    content: input.question,
    result: result.mediaId,
  });
}

export function selectWechatGeneratedImageUrl(response: Pick<CampusAssistantResponse, "images">) {
  const value = String(response.images?.[0]?.url || "").trim();
  if (!/^\/uploads\/assistant-generated\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg)$/iu.test(value)) return "";
  return value;
}

async function runWechatTypingTask(openId: string, task: () => Promise<void>) {
  await sendWechatTyping(openId, true).catch(() => undefined);
  try {
    await task();
  } finally {
    await sendWechatTyping(openId, false).catch(() => undefined);
  }
}

async function handleWechatAsyncReplyFailure(
  openId: string,
  userId: number | null,
  eventType: string,
  content: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[wechat] ${eventType} failed`, message);
  await logWechatMessage({
    direction: "outbound",
    eventType,
    status: "failed",
    openId,
    userId: userId || undefined,
    content,
    result: message,
  });
  await sendWechatCustomerText(openId, `${content}暂时无法完成：${limitText(message, 120)}。`).catch(() => undefined);
}

async function sendWechatAssistantActions(openId: string, response: CampusAssistantResponse) {
  const action = (response.actions || [])
    .map((item) => ({
      title: sanitizeWechatReplyLabel(item.label, "相关入口"),
      description: sanitizeWechatReplyLabel(item.description, "点击打开拾小间相关功能"),
      url: markWechatServiceClientUrl(absoluteWechatAssistantUrl(item.url)),
    }))
    .find((item) => Boolean(item.url)) || {
      title: "打开拾间AI",
      description: "进入网页继续提问，并使用完整的历史记录与站内功能",
      url: markWechatServiceClientUrl("/search"),
  };
  await sendWechatCustomerLink(openId, action);
}

async function readWechatGeneratedImage(value: string) {
  const raw = String(value || "").trim();
  let target: URL;
  try {
    target = new URL(raw, `${normalizedSiteOrigin() || "https://cputime.cn"}/`);
  } catch {
    throw new Error("AI 返回了无效的生成图片地址");
  }
  if (!/^\/uploads\/assistant-generated\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpg)$/iu.test(target.pathname)) {
    throw new Error("AI 返回的生成图片地址不在允许目录中");
  }
  const prepared = await prepareMediaLocalFileForProcessing(raw);
  try {
    let buffer = prepared.localPath ? await readFile(prepared.localPath).catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
    let contentType = target.pathname.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
    if (!buffer.length) {
      const response = await fetch(target, { signal: AbortSignal.timeout(WECHAT_API_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`生成图片下载失败：${response.status}`);
      contentType = String(response.headers.get("content-type") || contentType).split(";")[0];
      buffer = Buffer.from(await response.arrayBuffer());
    }
    if (!buffer.length || buffer.length > WECHAT_TEMP_IMAGE_MAX_BYTES) throw new Error("生成图片为空或超过微信限制");
    const normalized = await normalizeAiImageDataUrl(`data:${contentType};base64,${buffer.toString("base64")}`);
    return Buffer.from(normalized.dataUrl.slice(normalized.dataUrl.indexOf(",") + 1), "base64");
  } finally {
    if (prepared.temporary && prepared.localPath) await rm(prepared.localPath, { force: true }).catch(() => undefined);
  }
}

async function downloadWechatMedia(mediaId: string, retry = true): Promise<{ buffer: Buffer; contentType: string }> {
  const config = await getWechatServiceConfigRaw();
  ensureWechatApiReady(config);
  const accessToken = await getWechatAccessToken(config);
  const url = new URL("https://api.weixin.qq.com/cgi-bin/media/get");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("media_id", mediaId);
  const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_API_TIMEOUT_MS) });
  const contentType = String(response.headers.get("content-type") || "application/octet-stream").toLowerCase();
  if (contentType.includes("json") || contentType.includes("text")) {
    const payload = JSON.parse(await response.text().catch(() => "{}")) as Record<string, any>;
    if ([40001, 40014, 42001].includes(Number(payload.errcode)) && retry) {
      accessTokenCache = null;
      return downloadWechatMedia(mediaId, false);
    }
    throw new Error(wechatApiErrorMessage(payload));
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!response.ok || contentLength > WECHAT_INBOUND_MEDIA_MAX_BYTES) {
    throw new Error(response.ok ? "微信素材超过 15MB 限制" : `微信素材下载失败：${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > WECHAT_INBOUND_MEDIA_MAX_BYTES) throw new Error("微信素材为空或超过 15MB 限制");
  return { buffer, contentType };
}

function extensionForContentType(contentType: string) {
  if (/speex/iu.test(contentType)) return "speex";
  if (/mpeg|mp3/iu.test(contentType)) return "mp3";
  if (/wav/iu.test(contentType)) return "wav";
  if (/mp4|m4a/iu.test(contentType)) return "m4a";
  return "amr";
}

export function renderWechatAssistantReplyMarkdown(response: CampusAssistantResponse) {
  const lines = [String(response.answer || "").trim() || "我暂时没有找到合适的答案。"];
  const seenSourceUrls = new Set<string>();
  const sources = (response.sources || [])
    .map((source) => ({
      title: sanitizeWechatReplyLabel(source?.title, "网页来源"),
      url: normalizeWechatReplyUrl(source?.url),
    }))
    .filter((source) => {
      if (!source.url || seenSourceUrls.has(source.url)) return false;
      seenSourceUrls.add(source.url);
      return true;
    })
    .slice(0, 3);
  if (sources.length) {
    lines.push("", "参考来源：", ...sources.map((source) => `· ${source.title}：${source.url}`));
  }
  const actions = (response.actions || [])
    .map((action) => ({
      label: sanitizeWechatReplyLabel(action?.label, "相关入口"),
      url: absoluteWechatAssistantUrl(action?.url),
    }))
    .filter((action) => Boolean(action.url))
    .slice(0, 3);
  if (actions.length) {
    lines.push("", "相关入口：", ...actions.map((action) => `· ${action.label}：${action.url}`));
  }
  return appendQqBotAiDisclosure(lines.join("\n"));
}

export function renderWechatAssistantReplyImage(response: CampusAssistantResponse) {
  return renderQqBotAiReplyImage(renderWechatAssistantReplyMarkdown(response), { qrCodeEnabled: false });
}

export async function sendWechatTestMessage(openId: string, content: string) {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) throw Errors.badRequest("请填写接收人的 OpenID");
  try {
    const response = await sendWechatCustomerText(normalizedOpenId, content.trim());
    await logWechatMessage({
      direction: "outbound",
      eventType: "test",
      status: "ok",
      openId: normalizedOpenId,
      content,
      result: "customer",
      rawPayload: response,
    });
    return { ok: true };
  } catch (error) {
    const result = `customer:${error instanceof Error ? error.message : String(error)}`;
    await logWechatMessage({ direction: "outbound", eventType: "test", status: "error", openId: normalizedOpenId, content, result });
    if (isWechatCustomerWindowError(error)) {
      throw Errors.badRequest("客服消息窗口已关闭，请让用户先主动发消息，或改用模板测试");
    }
    throw error;
  }
}

export async function sendWechatTemplateTestMessage(openId: string, userId?: number | null) {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) throw Errors.badRequest("请填写接收人的 OpenID");
  const config = await getWechatServiceConfigRaw();
  if (!canSendNotificationTemplate(config)) throw Errors.badRequest("请先完整配置模板消息");
  const createdAt = new Date();
  const notification = {
    id: Number(String(createdAt.getTime()).slice(-8)),
    title: "微信通知通道正常",
    content: "这是一条来自药大拾间的模板通知测试。",
    createdAt,
    source: "药大拾间",
  };
  const link = wechatSettingsUrl();
  try {
    const response = await sendWechatTemplateNotification(config, normalizedOpenId, notification, link);
    const messageId = wechatTemplateOutboundMessageId(response?.msgid);
    await logWechatMessage({
      direction: "outbound",
      eventType: "template-test",
      status: "accepted",
      openId: normalizedOpenId,
      userId: userId || undefined,
      messageId: messageId || undefined,
      content: notification.content,
      result: "template",
      rawPayload: response,
    });
    return { ok: true, status: "accepted", callbackExpected: Boolean(messageId) };
  } catch (error) {
    const result = `template:${error instanceof Error ? error.message : String(error)}`;
    await logWechatMessage({
      direction: "outbound",
      eventType: "template-test",
      status: "error",
      openId: normalizedOpenId,
      userId: userId || undefined,
      content: notification.content,
      result,
    });
    throw error;
  }
}

export async function dispatchRecentWechatNotifications() {
  const config = await getWechatServiceConfigRaw();
  if (!config.enabled || !config.notificationEnabled) return { sent: 0, skipped: 0 };
  const categories = normalizeNotifyCategories(parseStringArray(config.notifyCategories));
  if (!categories.length) return { sent: 0, skipped: 0 };
  const since = new Date(Date.now() - NOTIFICATION_LOOKBACK_MS);
  const bindings = await prisma.wechatBinding.findMany({
    where: { enabled: true, subscribed: true },
    include: {
      user: {
        select: {
          messageSetting: {
            select: {
              wechatNotifyEnabled: true,
              subscribeReply: true,
              subscribeLike: true,
              subscribeSchool: true,
              subscribeSystem: true,
            },
          },
        },
      },
    },
  });
  if (!bindings.length) return { sent: 0, skipped: 0 };

  const bindingUserIds = bindings.map((binding) => binding.userId);
  const audience = wechatNotificationAudienceWhere(bindingUserIds);
  const batchSize = Math.min(
    NOTIFICATION_BATCH_MAX,
    Math.max(NOTIFICATION_BATCH_MIN, bindings.length * 100),
  );
  const importantPayloadMarkers = [
    "submission-published",
    "submission-blocked",
    "submission-review",
    "ai-blocked",
    "ai-recovered",
    "review-outage",
    "review-failed",
  ];
  const [recentNotifications, importantNotifications] = await Promise.all([
    prisma.notification.findMany({
      where: {
        createdAt: { gte: since },
        category: { in: categories },
        AND: [audience],
      },
      orderBy: { createdAt: "desc" },
      take: batchSize,
    }),
    prisma.notification.findMany({
      where: {
        createdAt: { gte: since },
        category: { in: categories },
        AND: [
          audience,
          { OR: importantPayloadMarkers.map((marker) => ({ payload: { contains: marker } })) },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_BATCH_MIN,
    }),
  ]);
  const notifications = Array.from(new Map(
    [...recentNotifications, ...importantNotifications].map((notification) => [notification.id, notification]),
  ).values());
  if (!notifications.length) return { sent: 0, skipped: 0 };

  const notificationIds = notifications.map((notification) => notification.id);
  const [deliveryLogs, recentCustomerDeliveries] = await Promise.all([
    prisma.wechatMessageLog.findMany({
      where: {
        eventType: "notification",
        userId: { in: bindingUserIds },
        notificationId: { in: notificationIds },
        createdAt: { gte: since },
      },
      select: { userId: true, notificationId: true, status: true, result: true, createdAt: true },
    }),
    prisma.wechatMessageLog.findMany({
      where: {
        eventType: "notification",
        status: "ok",
        result: "customer",
        userId: { in: bindingUserIds },
        createdAt: { gte: new Date(Date.now() - CUSTOMER_MESSAGE_WINDOW_MS) },
      },
      select: { userId: true, createdAt: true },
    }),
  ]);
  notifications.sort((a, b) => (
    wechatNotificationPriority(b) - wechatNotificationPriority(a)
    || a.createdAt.getTime() - b.createdAt.getTime()
  ));
  const bindingByUserId = new Map(bindings.map((binding) => [binding.userId, binding]));
  const deliveredKeys = new Set<string>();
  const skippedKeys = new Set<string>();
  const failedLogsByKey = new Map<string, typeof deliveryLogs>();
  deliveryLogs.forEach((delivery) => {
    if (!delivery.userId || !delivery.notificationId) return;
    const key = wechatNotificationDeliveryKey(delivery.notificationId, delivery.userId);
    if (delivery.status === "ok" || delivery.status === "accepted") deliveredKeys.add(key);
    else if (delivery.status === "skipped") skippedKeys.add(key);
    else if (delivery.status === "error") {
      const current = failedLogsByKey.get(key) || [];
      current.push(delivery);
      failedLogsByKey.set(key, current);
    }
  });
  const customerDeliveriesByUserId = new Map<number, number>();
  recentCustomerDeliveries.forEach((delivery) => {
    if (!delivery.userId) return;
    const binding = bindingByUserId.get(delivery.userId);
    if (!binding?.lastInteractionAt || delivery.createdAt < binding.lastInteractionAt) return;
    customerDeliveriesByUserId.set(delivery.userId, (customerDeliveriesByUserId.get(delivery.userId) || 0) + 1);
  });
  const unavailableCustomerWindows = new Set<number>();
  let sent = 0;
  let skipped = 0;
  for (const notification of notifications) {
    const targets = notification.userId ? [bindingByUserId.get(notification.userId)].filter(Boolean) : bindings;
    for (const binding of targets) {
      if (!binding || !shouldDeliverWechatNotification(notification, binding.user.messageSetting)) continue;
      const deliveryKey = wechatNotificationDeliveryKey(notification.id, binding.userId);
      if (deliveredKeys.has(deliveryKey)) continue;
      const attemptSince = wechatNotificationAttemptSince(notification.createdAt, binding.lastInteractionAt);
      const failedCustomerAttempts = (failedLogsByKey.get(deliveryKey) || []).filter((entry) => (
        entry.createdAt >= attemptSince && isWechatCustomerDeliveryFailure(entry.result)
      )).length;
      const persistentFailures = (failedLogsByKey.get(deliveryKey) || []).filter((entry) => (
        isWechatPersistentDeliveryFailure(entry.result)
      ));
      const persistentRetryBlocked = persistentFailures.length >= 3
        || persistentFailures.some((entry) => isWechatPermanentPersistentDeliveryFailure(entry.result));
      let attemptedChannel = "";
      try {
        const link = resolveNotificationLink(notification.link, notification.payload);
        const sponsorTemplateOnly = isWechatSponsorTemplateNotification(notification);
        const customerPolicy = wechatCustomerMessagePolicy(binding.lastInteractionType);
        const interactionAge = binding.lastInteractionAt ? Date.now() - binding.lastInteractionAt.getTime() : Number.POSITIVE_INFINITY;
        const withinCustomerWindow = interactionAge >= 0 && interactionAge <= customerPolicy.windowMs;
        const customerDeliveries = customerDeliveriesByUserId.get(binding.userId) || 0;
        const canTryCustomer = !sponsorTemplateOnly
          && withinCustomerWindow
          && customerDeliveries < customerPolicy.limit
          && failedCustomerAttempts < 3
          && wechatNotificationPriority(notification) >= 60
          && !unavailableCustomerWindows.has(binding.userId);
        let deliveryChannel = "";
        let deliveryResponse: Record<string, any> | null = null;
        let customerError: unknown = null;
        if (canTryCustomer) {
          attemptedChannel = "customer";
          try {
            deliveryResponse = await sendWechatCustomerText(binding.openId, renderNotificationText(notification, link));
            customerDeliveriesByUserId.set(binding.userId, customerDeliveries + 1);
            deliveryChannel = "customer";
          } catch (error) {
            customerError = error;
            if (!isWechatCustomerWindowError(error)) throw error;
            unavailableCustomerWindows.add(binding.userId);
          }
        }
        if (!deliveryChannel && !persistentRetryBlocked) {
          if (sponsorTemplateOnly) {
            attemptedChannel = "template";
            if (canSendNotificationTemplate(config)) {
              deliveryResponse = await sendWechatTemplateNotification(config, binding.openId, notification, link);
              deliveryChannel = "template";
            }
          } else {
            attemptedChannel = canSendSubscriptionNotification(config) ? "subscription" : canSendNotificationTemplate(config) ? "template" : attemptedChannel;
            const persistentDelivery = await sendWechatPersistentNotification(config, binding.openId, notification, link);
            deliveryChannel = persistentDelivery?.channel || "";
            deliveryResponse = persistentDelivery?.response || null;
          }
        }
        if (!deliveryChannel && customerError) throw customerError;
        if (!deliveryChannel) {
          skipped += 1;
          if (!skippedKeys.has(deliveryKey)) {
            await logWechatMessage({
              direction: "outbound",
              eventType: "notification",
              status: "skipped",
              openId: binding.openId,
              userId: binding.userId,
              notificationId: notification.id,
              content: notification.content,
              result: wechatNotificationSkipReason({
                withinCustomerWindow,
                customerDeliveries,
                customerLimit: customerPolicy.limit,
                failedCustomerAttempts,
                priority: wechatNotificationPriority(notification),
                customerWindowUnavailable: unavailableCustomerWindows.has(binding.userId),
                persistentRetryBlocked,
              }),
            });
            skippedKeys.add(deliveryKey);
          }
          continue;
        }
        await logWechatMessage({
          direction: "outbound",
          eventType: "notification",
          status: deliveryChannel === "template" ? "accepted" : "ok",
          openId: binding.openId,
          userId: binding.userId,
          messageId: deliveryChannel === "template"
            ? wechatTemplateOutboundMessageId(deliveryResponse?.msgid)
            : undefined,
          notificationId: notification.id,
          content: notification.content,
          result: deliveryChannel,
          rawPayload: deliveryResponse || undefined,
        });
        deliveredKeys.add(deliveryKey);
        sent += 1;
      } catch (error) {
        const result = `${attemptedChannel || "unknown"}:${error instanceof Error ? error.message : String(error)}`;
        await logWechatMessage({
          direction: "outbound",
          eventType: "notification",
          status: "error",
          openId: binding.openId,
          userId: binding.userId,
          notificationId: notification.id,
          content: notification.content,
          result,
        });
        const current = failedLogsByKey.get(deliveryKey) || [];
        current.push({
          userId: binding.userId,
          notificationId: notification.id,
          status: "error",
          result,
          createdAt: new Date(),
        });
        failedLogsByKey.set(deliveryKey, current);
      }
    }
  }
  return { sent, skipped };
}

export function wechatNotificationAudienceWhere(userIds: readonly number[]) {
  const ids = Array.from(new Set(userIds.filter((userId) => Number.isInteger(userId) && userId > 0)));
  return { OR: [{ userId: null }, { userId: { in: ids } }] };
}

export function wechatNotificationAttemptSince(notificationCreatedAt: Date, lastInteractionAt?: Date | null) {
  if (!lastInteractionAt || lastInteractionAt <= notificationCreatedAt) return notificationCreatedAt;
  return lastInteractionAt;
}

export function wechatCustomerMessagePolicy(lastInteractionType?: string | null) {
  return lastInteractionType === "message"
    ? { windowMs: CUSTOMER_MESSAGE_WINDOW_MS, limit: CUSTOMER_MESSAGE_LIMIT_PER_WINDOW }
    : { windowMs: CUSTOMER_EVENT_WINDOW_MS, limit: CUSTOMER_EVENT_LIMIT_PER_WINDOW };
}

export function isWechatCustomerWindowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(?:\(|\b)(?:45015|45047)(?:\)|\b)|response out of time limit|response count is limited/iu.test(message);
}

export function isWechatCustomerDeliveryFailure(result?: string | null) {
  const value = String(result || "");
  return value.startsWith("customer:") || isWechatCustomerWindowError(value);
}

export function isWechatPersistentDeliveryFailure(result?: string | null) {
  return /^(?:template|subscription):/i.test(String(result || ""));
}

export function isWechatPermanentPersistentDeliveryFailure(result?: string | null) {
  return /^(?:template|subscription):.*(?:user block|user reject|user refuse|account is not followed)/i.test(String(result || ""));
}

function wechatNotificationDeliveryKey(notificationId: number, userId: number) {
  return `${notificationId}:${userId}`;
}

function wechatNotificationSkipReason(input: {
  withinCustomerWindow: boolean;
  customerDeliveries: number;
  customerLimit: number;
  failedCustomerAttempts: number;
  priority: number;
  customerWindowUnavailable: boolean;
  persistentRetryBlocked: boolean;
}) {
  if (input.persistentRetryBlocked) return "persistent-delivery-retry-limit-reached";
  if (!input.withinCustomerWindow) return "no-persistent-delivery-channel";
  if (input.customerWindowUnavailable) return "customer-window-unavailable";
  if (input.customerDeliveries >= input.customerLimit) return "customer-message-quota-exhausted";
  if (input.failedCustomerAttempts >= 3) return "customer-window-retry-limit-reached";
  if (input.priority < 60) return "customer-quota-reserved-for-important-notifications";
  return "no-available-delivery-channel";
}

async function sendWechatPersistentNotification(
  config: WechatConfigRow,
  openId: string,
  notification: any,
  link: string,
): Promise<WechatPersistentDelivery | null> {
  if (canSendSubscriptionNotification(config)) {
    try {
      const response = await sendWechatSubscriptionNotification(config, openId, notification);
      return { channel: "subscription", response };
    } catch (error) {
      if (!canSendNotificationTemplate(config)) throw error;
    }
  }
  if (canSendNotificationTemplate(config)) {
    const response = await sendWechatTemplateNotification(config, openId, notification, link);
    return { channel: "template", response };
  }
  return null;
}

export function wechatNotificationPriority(notification: { category?: string | null; payload?: string | null }) {
  const payload = parseNotificationPayload(notification.payload);
  const type = String(payload.type || "");
  if (/submission-(?:published|blocked|review)|ai-(?:blocked|recovered)|review-(?:outage|failed)/.test(type)) return 100;
  if (type === "direct-message" || notification.category === "direct-message") return 90;
  if (/payment|sponsor|order/.test(type)) return 85;
  if (notification.category === "reply" || notification.category === "mention" || notification.category === "lost-found") return 75;
  if (notification.category === "system" || notification.category === "service-tool") return 65;
  if (notification.category === "school-feed") return 40;
  if (notification.category === "like") return 10;
  return 30;
}

function parseNotificationPayload(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* invalid payload falls back to notification metadata */ }
  return {};
}

function isWechatPaymentSuccessNotification(notification: { payload?: string | null }) {
  const type = String(parseNotificationPayload(notification.payload).type || "");
  return /^(?:sponsor-paid|sponsor-admin|market-paid|market-paid-seller|payment-success|order-paid)$/.test(type);
}

export function isWechatSponsorTemplateNotification(notification: { payload?: string | null }) {
  const type = String(parseNotificationPayload(notification.payload).type || "");
  return type === "sponsor-paid" || type === "sponsor-admin";
}

function wechatWorkOrderType(notification: { category?: string | null; payload?: string | null }) {
  const type = String(parseNotificationPayload(notification.payload).type || "");
  if (type.includes("submission") || type.includes("review") || type.includes("ai-blocked") || type.includes("ai-recovered")) return "内容审核";
  if (notification.category === "direct-message") return "私信通知";
  if (notification.category === "reply") return "回复通知";
  if (notification.category === "mention") return "提及通知";
  if (notification.category === "like") return "点赞通知";
  if (notification.category === "lost-found") return "失物招领";
  if (notification.category === "service-tool") return "校园服务";
  if (notification.category === "market") return "校园商城";
  if (notification.category === "school-feed") return "校园公告";
  return "系统通知";
}

function runWechatNotificationDispatchTick() {
  return runWithDistributedLock("wechat-notification-dispatch:tick", 25_000, async () => {
    await dispatchRecentWechatNotifications();
  });
}

function queueWechatNotificationDispatch() {
  if (notificationDispatchWakeTimer) return;
  notificationDispatchWakeTimer = setTimeout(() => {
    notificationDispatchWakeTimer = null;
    void runWechatNotificationDispatchTick().catch((error) => {
      console.warn("[wechat] notification dispatch failed", error instanceof Error ? error.message : error);
    });
  }, 250);
}

export function startWechatNotificationPoller() {
  if (notificationPollerStarted) return;
  notificationPollerStarted = true;
  const tick = () => runWechatNotificationDispatchTick().catch((error) => {
    console.warn("[wechat] notification dispatch failed", error instanceof Error ? error.message : error);
  });
  setTimeout(tick, 7_000);
  setInterval(tick, 30_000);
}

export function verifyWechatSignature(
  token: string,
  timestamp?: string,
  nonce?: string,
  encryptedPayload?: string,
  providedSignature?: string,
) {
  const parts = [token, String(timestamp || ""), String(nonce || "")];
  if (encryptedPayload !== undefined) parts.push(encryptedPayload);
  const expected = crypto.createHash("sha1").update(parts.sort().join("")).digest("hex");
  const actual = String(providedSignature || "").toLowerCase();
  return safeEqual(expected, actual);
}

export function decryptWechatPayload(encryptedPayload: string, encodingAesKey: string, expectedAppId: string) {
  if (!isValidEncodingAesKey(encodingAesKey)) throw Errors.badRequest("EncodingAESKey 配置无效");
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(encryptedPayload, "base64"), decipher.final()]);
  const plain = removeWechatPkcs7Padding(padded);
  if (plain.length < 20) throw Errors.badRequest("微信加密消息长度无效");
  const messageLength = plain.readUInt32BE(16);
  const messageEnd = 20 + messageLength;
  if (messageEnd > plain.length) throw Errors.badRequest("微信加密消息内容无效");
  const message = plain.subarray(20, messageEnd).toString("utf8");
  const appId = plain.subarray(messageEnd).toString("utf8");
  if (expectedAppId && appId && appId !== expectedAppId) throw Errors.forbidden("微信加密消息 AppID 不匹配");
  return message;
}

export function encryptWechatPayload(payload: string, encodingAesKey: string, appId: string) {
  if (!isValidEncodingAesKey(encodingAesKey)) throw Errors.badRequest("EncodingAESKey 配置无效");
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const message = Buffer.from(payload, "utf8");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(message.length, 0);
  const plain = Buffer.concat([crypto.randomBytes(16), messageLength, message, Buffer.from(appId, "utf8")]);
  const padding = 32 - (plain.length % 32);
  const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function parseWechatXml(xml: string): WechatInboundMessage & { encrypt: string } {
  return {
    toUserName: readXmlTag(xml, "ToUserName"),
    fromUserName: readXmlTag(xml, "FromUserName"),
    createTime: readXmlTag(xml, "CreateTime"),
    msgType: readXmlTag(xml, "MsgType").toLowerCase(),
    content: readXmlTag(xml, "Content"),
    msgId: readXmlTag(xml, "MsgId") || readXmlTag(xml, "MsgID"),
    event: readXmlTag(xml, "Event"),
    eventKey: readXmlTag(xml, "EventKey"),
    status: readXmlTag(xml, "Status"),
    ticket: readXmlTag(xml, "Ticket"),
    mediaId: readXmlTag(xml, "MediaId"),
    picUrl: readXmlTag(xml, "PicUrl"),
    format: readXmlTag(xml, "Format"),
    recognition: readXmlTag(xml, "Recognition"),
    thumbMediaId: readXmlTag(xml, "ThumbMediaId"),
    encrypt: readXmlTag(xml, "Encrypt"),
  };
}

export function isWechatTemplateDeliveryEvent(message: Pick<WechatInboundMessage, "msgType" | "event">) {
  return message.msgType.toLowerCase() === "event" && message.event.toLowerCase() === "templatesendjobfinish";
}

export function wechatTemplateOutboundMessageId(value?: string | number | null) {
  const messageId = String(value ?? "").trim();
  return messageId ? `outbound:template:${messageId}` : "";
}

export function wechatTemplateDeliveryResult(rawStatus?: string | null) {
  const callbackStatus = String(rawStatus || "unknown").trim().toLowerCase() || "unknown";
  return callbackStatus === "success"
    ? { status: "ok", result: "template" }
    : { status: "error", result: `template:${callbackStatus}` };
}

export function shouldDeliverWechatNotification(
  notification: { category?: string | null; targetClient?: string | null },
  setting?: {
    wechatNotifyEnabled?: boolean;
    subscribeReply?: boolean;
    subscribeLike?: boolean;
    subscribeSchool?: boolean;
    subscribeSystem?: boolean;
  } | null,
) {
  if (notification.targetClient && notification.targetClient !== "all") return false;
  if (setting?.wechatNotifyEnabled === false) return false;
  if (notification.category === "reply") return setting?.subscribeReply !== false;
  if (notification.category === "like") return setting?.subscribeLike !== false;
  if (notification.category === "school-feed") return setting?.subscribeSchool !== false;
  if (notification.category === "system") return setting?.subscribeSystem !== false;
  return true;
}

export function renderWechatAutomaticReply(rawContent: string, bound: boolean, siteOrigin = normalizedSiteOrigin()) {
  const content = rawContent.trim();
  if (!content) return "";
  if (/^(帮助|help|菜单)$/iu.test(content)) {
    return renderWechatHelp(bound, siteOrigin);
  }
  if (/^(绑定|绑定码)/iu.test(content)) {
    return bound
      ? "当前微信已经绑定拾小间账号，如需更换请先在站内解绑。"
      : `微信不再使用手动绑定码。请登录后选择“微信内绑定”或“扫码绑定”：\n${wechatSettingsUrl(siteOrigin)}`;
  }
  if (/^(状态|我的)$/u.test(content)) {
    return bound
      ? `当前微信已绑定拾小间账号。\n通知设置：${wechatSettingsUrl(siteOrigin)}`
      : `当前微信尚未绑定。\n绑定入口：${wechatSettingsUrl(siteOrigin)}`;
  }
  return "";
}

export function renderWechatFollowSettingsTip() {
  return "为避免错过通知，请点击服务号右上角进入设置，关闭“消息免打扰”，并建议设为置顶。";
}

async function consumeWechatBindToken(rawToken: string, openId: string) {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.wechatBindToken.findUnique({ where: { tokenHash } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) return null;
  await bindWechatIdentity(token.userId, openId, null, { bindTokenId: token.id, subscribed: true, interactionType: "scan" });
  return prisma.wechatBinding.findUnique({ where: { openId } });
}

async function bindWechatIdentity(
  userId: number,
  openId: string,
  unionId: string | null,
  options: { oauthStateId?: number; bindTokenId?: number; subscribed: boolean; interactionType?: string },
) {
  await prisma.$transaction(async (tx) => {
    if (options.oauthStateId) {
      const state = await tx.wechatOauthState.findUnique({ where: { id: options.oauthStateId } });
      if (!state || state.usedAt || state.expiresAt <= new Date()) throw Errors.badRequest("微信绑定请求已失效");
    }
    if (options.bindTokenId) {
      const token = await tx.wechatBindToken.findUnique({ where: { id: options.bindTokenId } });
      if (!token || token.usedAt || token.expiresAt <= new Date()) throw Errors.badRequest("微信绑定二维码已失效");
    }
    const conflicting = await tx.wechatBinding.findUnique({ where: { openId } });
    if (conflicting && conflicting.userId !== userId) throw Errors.conflict("该微信已经绑定其他药大拾间账号");
    const current = await tx.wechatBinding.findUnique({ where: { userId } });
    if (current) {
      await tx.wechatBinding.update({
        where: { id: current.id },
        data: {
          openId,
          unionId: unionId || current.unionId,
          enabled: true,
          subscribed: options.subscribed,
          subscribedAt: options.subscribed ? current.subscribedAt || new Date() : current.subscribedAt,
          unsubscribedAt: options.subscribed ? null : current.unsubscribedAt,
          lastInteractionAt: options.interactionType ? new Date() : current.lastInteractionAt,
          lastInteractionType: options.interactionType || current.lastInteractionType,
        },
      });
    } else {
      await tx.wechatBinding.create({
        data: {
          userId,
          openId,
          unionId,
          subscribed: options.subscribed,
          subscribedAt: options.subscribed ? new Date() : null,
          lastInteractionAt: options.interactionType ? new Date() : null,
          lastInteractionType: options.interactionType || "",
        },
      });
    }
    if (options.oauthStateId) await tx.wechatOauthState.update({ where: { id: options.oauthStateId }, data: { usedAt: new Date() } });
    if (options.bindTokenId) await tx.wechatBindToken.update({ where: { id: options.bindTokenId }, data: { usedAt: new Date() } });
  });
  if (options.subscribed) void syncWechatBoundTag(openId, true).catch(() => undefined);
}

async function ensureWechatBoundTagId() {
  const existing = await callWechatApi("/cgi-bin/tags/get", { method: "GET" });
  const tag = Array.isArray(existing.tags)
    ? existing.tags.find((item: any) => String(item?.name || "").trim() === WECHAT_BOUND_TAG_NAME)
    : null;
  const currentId = Number(tag?.id || 0);
  if (currentId > 0) return currentId;
  const created = await callWechatApi("/cgi-bin/tags/create", {
    method: "POST",
    body: { tag: { name: WECHAT_BOUND_TAG_NAME } },
  });
  const tagId = Number(created?.tag?.id || 0);
  if (!tagId) throw new Error("微信未返回已绑定用户标签 ID");
  return tagId;
}

export async function syncWechatBoundTag(openId: string, bound: boolean) {
  const tagId = await ensureWechatBoundTagId();
  return callWechatApi(bound ? "/cgi-bin/tags/members/batchtagging" : "/cgi-bin/tags/members/batchuntagging", {
    method: "POST",
    body: { openid_list: [openId], tagid: tagId },
  });
}

export async function createWechatJsSdkConfig(rawUrl: string) {
  const config = await getWechatServiceConfigRaw();
  ensureWechatApiReady(config);
  const siteOrigin = normalizeWechatMenuOrigin(normalizedSiteOrigin());
  let url: URL;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw Errors.badRequest("微信 JS-SDK 页面地址无效");
  }
  if (url.origin !== siteOrigin) throw Errors.badRequest("微信 JS-SDK 只能为本站页面签名");
  url.hash = "";
  const ticket = await getWechatJsapiTicket(config);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = crypto.randomBytes(16).toString("hex");
  return {
    appId: config.appId,
    timestamp,
    nonceStr,
    signature: createWechatJsSdkSignature(ticket, nonceStr, timestamp, url.toString()),
  };
}

export function createWechatJsSdkSignature(ticket: string, nonceStr: string, timestamp: number, url: string) {
  return crypto.createHash("sha1").update([
    `jsapi_ticket=${ticket}`,
    `noncestr=${nonceStr}`,
    `timestamp=${timestamp}`,
    `url=${url}`,
  ].join("&")).digest("hex");
}

async function getWechatJsapiTicket(config: WechatConfigRow) {
  const fingerprint = hashToken(`${config.appId}:${config.appSecret}`);
  if (jsapiTicketCache && jsapiTicketCache.fingerprint === fingerprint && jsapiTicketCache.expiresAt > Date.now()) {
    return jsapiTicketCache.ticket;
  }
  const payload = await callWechatApi("/cgi-bin/ticket/getticket?type=jsapi", { method: "GET" });
  const ticket = String(payload.ticket || "").trim();
  if (!ticket) throw new Error(`获取微信 jsapi_ticket 失败：${wechatApiErrorMessage(payload)}`);
  const expiresIn = Math.max(300, Number(payload.expires_in || 7200));
  jsapiTicketCache = { fingerprint, ticket, expiresAt: Date.now() + (expiresIn - 300) * 1000 };
  return ticket;
}

async function sendWechatTemplateNotification(config: WechatConfigRow, openId: string, notification: any, link: string) {
  const body = buildWechatRoutedTemplateNotificationPayload(config, openId, notification, link);
  if (!body) throw new Error("当前通知没有可用的微信模板消息配置");
  return callWechatApi("/cgi-bin/message/template/send", {
    method: "POST",
    body,
  });
}

export function buildWechatRoutedTemplateNotificationPayload(
  config: Pick<WechatConfigRow,
    "workOrderTemplateId"
    | "paymentSuccessTemplateId"
    | "notificationTemplateId"
    | "templateTitleField"
    | "templateContentField"
    | "templateTimeField"
    | "templateRemarkField">,
  openId: string,
  notification: any,
  link: string,
) {
  if (config.paymentSuccessTemplateId && isWechatPaymentSuccessNotification(notification)) {
    const payload = parseNotificationPayload(notification.payload);
    const type = String(payload.type || "");
    const orderType = type.startsWith("sponsor") ? "赞助订单" : type.startsWith("market") ? "校园商城订单" : "支付订单";
    const amount = String(payload.amount || "").trim();
    const item = String(payload.categoryTitle || payload.itemTitle || notification.content || notification.title || "平台服务");
    return {
      touser: openId,
      template_id: config.paymentSuccessTemplateId,
      url: link || undefined,
      data: {
        thing9: { value: "药大拾间" },
        thing10: { value: orderType },
        thing11: { value: limitText(amount ? `${item} ¥${amount}` : item, 20) },
        thing12: { value: limitText(notification.title || "订单支付成功", 20) },
        thing13: { value: "药大拾间用户" },
      },
    };
  }
  if (config.workOrderTemplateId) {
    return {
      touser: openId,
      template_id: config.workOrderTemplateId,
      url: link || undefined,
      data: {
        thing2: { value: "药大拾间" },
        thing3: { value: wechatWorkOrderType(notification) },
        thing4: { value: limitText(notification.title || "站内通知", 20) },
        character_string5: { value: `SJ${Math.max(0, Number(notification.id) || 0)}` },
        time6: { value: formatWechatTime(notification.createdAt) },
      },
    };
  }
  if (config.notificationTemplateId && config.templateTitleField && config.templateContentField) {
    return buildWechatTemplateNotificationPayload(config, openId, notification, link);
  }
  return null;
}

export function buildWechatTemplateNotificationPayload(
  config: Pick<WechatConfigRow,
    "notificationTemplateId"
    | "templateTitleField"
    | "templateContentField"
    | "templateTimeField"
    | "templateRemarkField">,
  openId: string,
  notification: any,
  link: string,
) {
  const data: Record<string, { value: string }> = {};
  if (config.templateTitleField) data[config.templateTitleField] = { value: limitText(notification.title, 20) };
  if (config.templateContentField) {
    const contentValue = /^character_string\d+$/i.test(config.templateContentField)
      ? `SJ${Math.max(0, Number(notification.id) || 0)}`
      : limitText(notification.content, 60);
    data[config.templateContentField] = { value: contentValue };
  }
  if (config.templateTimeField) data[config.templateTimeField] = { value: formatWechatTime(notification.createdAt) };
  if (config.templateRemarkField) data[config.templateRemarkField] = { value: limitText(notification.source || "药大拾间", 20) };
  return { touser: openId, template_id: config.notificationTemplateId, url: link || undefined, data };
}

export function buildWechatSubscriptionNotificationPayload(
  config: Pick<WechatConfigRow,
    "subscriptionTemplateId"
    | "subscriptionTitleField"
    | "subscriptionContentField"
    | "subscriptionTimeField"
    | "subscriptionRemarkField">,
  openId: string,
  notification: any,
) {
  const data: Record<string, { value: string }> = {};
  if (config.subscriptionTitleField) data[config.subscriptionTitleField] = { value: limitText(notification.title, 20) };
  if (config.subscriptionContentField) data[config.subscriptionContentField] = { value: limitText(notification.content, 60) };
  if (config.subscriptionTimeField) data[config.subscriptionTimeField] = { value: formatWechatTime(notification.createdAt) };
  if (config.subscriptionRemarkField) data[config.subscriptionRemarkField] = { value: limitText(notification.source || "拾小间", 20) };
  return {
    touser: openId,
    template_id: config.subscriptionTemplateId,
    data,
  };
}

async function sendWechatSubscriptionNotification(config: WechatConfigRow, openId: string, notification: any) {
  return callWechatApi("/cgi-bin/message/subscribe/bizsend", {
    method: "POST",
    body: buildWechatSubscriptionNotificationPayload(config, openId, notification),
  });
}

async function callWechatApi(pathname: string, options: { method: "GET" | "POST"; body?: unknown }, retry = true) {
  const config = await getWechatServiceConfigRaw();
  ensureWechatApiReady(config);
  const accessToken = await getWechatAccessToken(config);
  const url = new URL(`https://api.weixin.qq.com${pathname}`);
  url.searchParams.set("access_token", accessToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = parseWechatApiResponseText(await response.text());
    if ([40001, 40014, 42001].includes(Number(payload.errcode)) && retry) {
      accessTokenCache = null;
      return callWechatApi(pathname, options, false);
    }
    if (!response.ok || Number(payload.errcode || 0) !== 0) throw new Error(wechatApiErrorMessage(payload));
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadWechatTemporaryImage(image: Buffer, retry = true): Promise<string> {
  if (!image.length) throw new Error("微信客服图片内容为空");
  if (image.length > WECHAT_TEMP_IMAGE_MAX_BYTES) throw new Error("微信客服图片超过临时素材大小限制");
  const config = await getWechatServiceConfigRaw();
  ensureWechatApiReady(config);
  const accessToken = await getWechatAccessToken(config);
  const url = new URL("https://api.weixin.qq.com/cgi-bin/media/upload");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", "image");
  const form = new FormData();
  const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  form.append(
    "media",
    new Blob([new Uint8Array(image)], { type: jpeg ? "image/jpeg" : "image/png" }),
    jpeg ? "shijian-ai.jpg" : "shijian-ai.png",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    const payload = await response.json() as Record<string, any>;
    if ([40001, 40014, 42001].includes(Number(payload.errcode)) && retry) {
      accessTokenCache = null;
      return uploadWechatTemporaryImage(image, false);
    }
    const mediaId = String(payload.media_id || "").trim();
    if (!response.ok || Number(payload.errcode || 0) !== 0 || !mediaId) {
      throw new Error(wechatApiErrorMessage(payload));
    }
    return mediaId;
  } finally {
    clearTimeout(timer);
  }
}

async function getWechatAccessToken(config: WechatConfigRow) {
  const fingerprint = hashToken(`${config.appId}:${config.appSecret}`);
  if (accessTokenCache && accessTokenCache.fingerprint === fingerprint && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }
  const payload = await fetchWechatJson("https://api.weixin.qq.com/cgi-bin/token", {
    grant_type: "client_credential",
    appid: config.appId,
    secret: config.appSecret,
  });
  const token = String(payload.access_token || "").trim();
  if (!token) throw new Error(`获取微信 access_token 失败：${wechatApiErrorMessage(payload)}`);
  const expiresIn = Math.max(300, Number(payload.expires_in || 7200));
  accessTokenCache = { fingerprint, token, expiresAt: Date.now() + (expiresIn - 300) * 1000 };
  return token;
}

async function fetchWechatJson(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json() as Record<string, any>;
    if (!response.ok || Number(payload.errcode || 0) !== 0) throw new Error(wechatApiErrorMessage(payload));
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function logWechatMessage(input: {
  direction: string;
  eventType: string;
  status: string;
  openId?: string;
  userId?: number;
  messageId?: string;
  notificationId?: number;
  content?: string;
  result?: string;
  rawPayload?: unknown;
}) {
  await prisma.wechatMessageLog.create({
    data: {
      direction: input.direction,
      eventType: input.eventType,
      status: input.status,
      openId: input.openId || null,
      userId: input.userId || null,
      messageId: input.messageId || null,
      notificationId: input.notificationId || null,
      content: input.content ? input.content.slice(0, 4000) : null,
      result: input.result ? input.result.slice(0, 2000) : null,
      rawPayload: input.rawPayload ? JSON.stringify(input.rawPayload).slice(0, 12_000) : null,
    },
  }).catch((error: any) => {
    if (error?.code !== "P2002") throw error;
  });
}

function renderWechatWelcome() {
  return [
    "欢迎关注拾小间。",
    "可直接发送文字、语音或图片向拾间AI提问；需要生图时会直接发送生成图片。",
    "绑定后可从菜单进入课表、教务中心和校园服务，并接收已开启的站内通知。",
    renderWechatFollowSettingsTip(),
    `绑定账号：${wechatSettingsUrl()}`,
  ].join("\n");
}

function renderWechatHelp(bound: boolean, siteOrigin = normalizedSiteOrigin()) {
  return [
    "拾小间服务号",
    "直接发送文字、语音或图片即可向拾间AI提问；需要生图时会直接发送生成图片。",
    "发送“今日课表”“明日课表”“本周课表”或“下周课表”可获取对应课程卡片。",
    "发送“状态”可查看绑定状态。",
    "",
    bound ? `通知设置：${wechatSettingsUrl(siteOrigin)}` : `绑定入口：${wechatSettingsUrl(siteOrigin)}`,
  ].join("\n");
}

function renderNotificationText(notification: any, link: string) {
  return [
    `【${notification.source || "药大拾间"}】${notification.title}`,
    notification.content,
    link ? `查看：${link}` : null,
  ].filter(Boolean).join("\n\n");
}

function buildWechatTextReplyXml(toUserName: string, fromUserName: string, content: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `<xml><ToUserName><![CDATA[${safeWechatCdata(toUserName)}]]></ToUserName><FromUserName><![CDATA[${safeWechatCdata(fromUserName)}]]></FromUserName><CreateTime>${timestamp}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${safeWechatCdata(content)}]]></Content></xml>`;
}

function safeWechatCdata(value: string) {
  return String(value).replace(/]]>/g, "]]]]><![CDATA[>");
}

function createWechatSignature(token: string, timestamp: string, nonce: string, encryptedPayload?: string) {
  const parts = [token, timestamp, nonce];
  if (encryptedPayload !== undefined) parts.push(encryptedPayload);
  return crypto.createHash("sha1").update(parts.sort().join("")).digest("hex");
}

function resolveNotificationLink(rawLink: string | null | undefined, payloadValue: unknown) {
  const raw = String(rawLink || "").trim();
  if (/^https?:\/\//i.test(raw)) return markWechatServiceClientUrl(raw);
  if (raw.startsWith("/")) return markWechatServiceClientUrl(raw);
  const payload = parseJsonObject(payloadValue);
  const topicId = positiveInt(payload.topicId);
  const replyId = positiveInt(payload.replyId);
  if (!topicId) return "";
  return markWechatServiceClientUrl(`/forum/topic/${topicId}${replyId ? `#reply-${replyId}` : ""}`);
}

function wechatSettingsUrl(siteOrigin = normalizedSiteOrigin()) {
  return markWechatServiceClientUrl("/messages?tab=settings", siteOrigin);
}

function canSendNotificationTemplate(config: WechatConfigRow) {
  return Boolean(
    config.workOrderTemplateId
    || config.paymentSuccessTemplateId
    || (config.notificationTemplateId && config.templateTitleField && config.templateContentField),
  );
}

function canSendSubscriptionNotification(config: WechatConfigRow) {
  return Boolean(
    config.subscriptionEnabled
    && config.subscriptionTemplateId
    && config.subscriptionTitleField
    && config.subscriptionContentField
  );
}

function ensureWechatOauthReady(config: WechatConfigRow) {
  ensureWechatApiReady(config);
  if (!normalizedSiteOrigin()) throw Errors.badRequest("请先在站点设置中配置站点域名");
}

function ensureWechatApiReady(config: WechatConfigRow) {
  if (!config.enabled) throw Errors.badRequest("微信服务号尚未启用");
  if (!config.appId || !config.appSecret) throw Errors.badRequest("微信服务号 AppID 或 AppSecret 未配置");
}

function normalizeNotifyCategories(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter((value) => NOTIFY_CATEGORY_OPTIONS.has(value))));
}

function normalizeMessageMode(value: string) {
  return value === "plaintext" || value === "compatible" || value === "safe" ? value : "safe";
}

function normalizeTemplateField(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(normalized)) throw Errors.badRequest("模板字段名只能包含字母、数字和下划线");
  return normalized;
}

function normalizeBindScene(eventKey: string) {
  const normalized = eventKey.replace(/^qrscene_/i, "").trim();
  return normalized.startsWith("bind_") ? normalized.slice(5) : "";
}

function isValidEncodingAesKey(value: string) {
  return /^[A-Za-z0-9]{43}$/.test(value);
}

function removeWechatPkcs7Padding(buffer: Buffer) {
  const padding = buffer[buffer.length - 1];
  if (!padding || padding > 32 || padding > buffer.length) throw Errors.badRequest("微信加密消息填充无效");
  for (let index = buffer.length - padding; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) throw Errors.badRequest("微信加密消息填充无效");
  }
  return buffer.subarray(0, buffer.length - padding);
}

function readXmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "i"));
  return decodeXmlEntities((match?.[1] ?? match?.[2] ?? "").trim());
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function splitWechatText(value: string) {
  const normalized = value.trim();
  if (!normalized) return ["消息内容为空"];
  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > MAX_WECHAT_TEXT_LENGTH) {
    let splitAt = rest.lastIndexOf("\n", MAX_WECHAT_TEXT_LENGTH);
    if (splitAt < MAX_WECHAT_TEXT_LENGTH * 0.6) splitAt = MAX_WECHAT_TEXT_LENGTH;
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function formatWechatTime(value: Date | string) {
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  return formatted.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1年$2月$3日");
}

function limitText(value: unknown, length: number) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, Math.max(1, length - 1))}…` : normalized;
}

function parseStringArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function positiveInt(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizedSiteOrigin() {
  return String(getSiteOrigin() || "").trim().replace(/\/+$/, "");
}

function absoluteWechatAssistantUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, `${normalizedSiteOrigin() || "https://cputime.cn"}/`).toString();
  } catch {
    return "";
  }
}

function normalizeWechatReplyUrl(value: unknown) {
  const raw = String(value || "").trim();
  return /^https?:\/\/[^\s<>"']+$/iu.test(raw) ? raw : "";
}

function sanitizeWechatReplyLabel(value: unknown, fallback: string) {
  return String(value || fallback)
    .trim()
    .replace(/[\[\]()`]/gu, " ")
    .replace(/\s+/gu, " ")
    .slice(0, 80) || fallback;
}

function normalizeWechatMenuOrigin(value: string) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw Errors.badRequest("请先在站点设置中配置有效的 HTTPS 站点域名");
  }
  if (url.protocol !== "https:" || url.origin !== normalized) {
    throw Errors.badRequest("服务号菜单需要使用站点的 HTTPS 根域名");
  }
  return url.origin;
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function maskSecret(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length <= 8) return "*".repeat(normalized.length);
  return `${normalized.slice(0, 4)}${"*".repeat(Math.min(12, normalized.length - 8))}${normalized.slice(-4)}`;
}

function wechatApiErrorMessage(payload: Record<string, any>) {
  const code = Number(payload.errcode || 0);
  const message = String(payload.errmsg || payload.message || "微信接口返回异常");
  return code ? `${message} (${code})` : message;
}

export function parseWechatApiResponseText(rawText: string) {
  const preserved = rawText.replace(/("msgid"\s*:\s*)(\d{16,})(?=\s*[,}])/g, '$1"$2"');
  return JSON.parse(preserved) as Record<string, any>;
}
