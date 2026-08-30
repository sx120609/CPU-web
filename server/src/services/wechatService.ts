import crypto from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { parseMessageBindToken } from "./bindToken";
import { runWithDistributedLock } from "./cache";
import { getSiteOrigin } from "./siteSettings";

const CONFIG_ID = 1;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const BIND_TOKEN_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_MESSAGE_WINDOW_MS = 48 * 60 * 60 * 1000;
const WECHAT_API_TIMEOUT_MS = 12_000;
const DEFAULT_NOTIFY_CATEGORIES = ["reply", "mention", "like", "system", "service-tool", "lost-found", "school-feed"];
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
  ticket: string;
};

let accessTokenCache: { fingerprint: string; token: string; expiresAt: number } | null = null;
let notificationPollerStarted = false;

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
    appId: config.appId,
    hasAppSecret: Boolean(config.appSecret),
    appSecretMasked: maskSecret(config.appSecret),
    token: config.token,
    encodingAesKey: config.encodingAesKey,
    messageMode: normalizeMessageMode(config.messageMode),
    notificationEnabled: config.notificationEnabled,
    assistantEnabled: false,
    notifyCategories: normalizeNotifyCategories(parseStringArray(config.notifyCategories)),
    notificationTemplateId: config.notificationTemplateId,
    templateTitleField: config.templateTitleField,
    templateContentField: config.templateContentField,
    templateTimeField: config.templateTimeField,
    templateRemarkField: config.templateRemarkField,
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
  appId?: string;
  appSecret?: string;
  clearAppSecret?: boolean;
  token?: string;
  encodingAesKey?: string;
  messageMode?: string;
  notificationEnabled?: boolean;
  notifyCategories?: string[];
  notificationTemplateId?: string;
  templateTitleField?: string;
  templateContentField?: string;
  templateTimeField?: string;
  templateRemarkField?: string;
}) {
  const current = await getWechatServiceConfigRaw();
  const data: Record<string, unknown> = { assistantEnabled: false };
  if (input.accountName !== undefined) data.accountName = input.accountName.trim().slice(0, 80);
  if (input.appId !== undefined) data.appId = input.appId.trim().slice(0, 80);
  if (input.clearAppSecret) data.appSecret = "";
  else if (input.appSecret?.trim()) data.appSecret = input.appSecret.trim().slice(0, 240);
  if (input.token !== undefined) data.token = input.token.trim().slice(0, 120);
  if (input.encodingAesKey !== undefined) data.encodingAesKey = input.encodingAesKey.trim().slice(0, 80);
  if (input.messageMode !== undefined) data.messageMode = normalizeMessageMode(input.messageMode);
  if (input.notificationEnabled !== undefined) data.notificationEnabled = input.notificationEnabled;
  if (input.notifyCategories !== undefined) data.notifyCategories = JSON.stringify(normalizeNotifyCategories(input.notifyCategories));
  if (input.notificationTemplateId !== undefined) data.notificationTemplateId = input.notificationTemplateId.trim().slice(0, 160);
  if (input.templateTitleField !== undefined) data.templateTitleField = normalizeTemplateField(input.templateTitleField);
  if (input.templateContentField !== undefined) data.templateContentField = normalizeTemplateField(input.templateContentField);
  if (input.templateTimeField !== undefined) data.templateTimeField = normalizeTemplateField(input.templateTimeField);
  if (input.templateRemarkField !== undefined) data.templateRemarkField = normalizeTemplateField(input.templateRemarkField);

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
  const view = (name: string, path: string) => ({ type: "view", name, url: new URL(path, `${origin}/`).toString() });
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
          view("绑定设置", "/messages?tab=settings"),
          view("个人中心", "/profile"),
        ],
      },
    ],
  };
}

export async function publishWechatDefaultMenu() {
  const menu = buildWechatDefaultMenu();
  await callWechatApi("/cgi-bin/menu/create", { method: "POST", body: menu });
  return { ok: true, menu };
}

export async function getUserWechatProfile(userId: number) {
  const [config, binding, activeToken] = await Promise.all([
    getWechatServiceConfigRaw(),
    prisma.wechatBinding.findUnique({ where: { userId } }),
    prisma.wechatBindToken.findFirst({
      where: {
        userId,
        token: { not: null },
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    enabled: config.enabled,
    accountName: config.accountName,
    notificationEnabled: config.notificationEnabled,
    assistantEnabled: false,
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
    activeBindToken: !binding && activeToken?.token ? {
      token: activeToken.token,
      expiresAt: activeToken.expiresAt,
    } : null,
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
    messageBindingAvailable: Boolean(config.enabled && config.token),
  };
}

export async function createWechatBindToken(userId: number) {
  const config = await getWechatServiceConfigRaw();
  if (!config.enabled || !config.token) throw Errors.badRequest("微信服务号尚未启用");
  const existingBinding = await prisma.wechatBinding.findUnique({ where: { userId }, select: { id: true } });
  if (existingBinding) throw Errors.badRequest("当前账号已经绑定微信服务号，如需更换请先解绑");
  const activeToken = await prisma.wechatBindToken.findFirst({
    where: {
      userId,
      token: { not: null },
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (activeToken?.token) return { token: activeToken.token, expiresAt: activeToken.expiresAt };
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + BIND_TOKEN_TTL_MS);
  await prisma.wechatBindToken.create({
    data: { userId, token, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function deleteUserWechatBinding(userId: number) {
  const binding = await prisma.wechatBinding.findUnique({ where: { userId }, select: { id: true } });
  if (!binding) throw Errors.notFound("当前没有可解绑的微信服务号账号");
  await prisma.wechatBinding.delete({ where: { id: binding.id } });
  return { ok: true };
}

export async function createWechatOauthBindUrl(userId: number) {
  const config = await getWechatServiceConfigRaw();
  ensureWechatOauthReady(config);
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
  const config = await getWechatServiceConfigRaw();
  ensureWechatApiReady(config);
  const existing = await prisma.wechatBinding.findUnique({ where: { userId }, select: { id: true } });
  if (existing) throw Errors.badRequest("当前账号已经绑定微信服务号，如需更换请先解绑");
  const rawToken = crypto.randomBytes(16).toString("base64url");
  const scene = `bind_${rawToken}`;
  const expiresAt = new Date(Date.now() + BIND_TOKEN_TTL_MS);
  await prisma.wechatBindToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });
  const result = await callWechatApi("/cgi-bin/qrcode/create", {
    method: "POST",
    body: {
      expire_seconds: Math.floor(BIND_TOKEN_TTL_MS / 1000),
      action_name: "QR_STR_SCENE",
      action_info: { scene: { scene_str: scene } },
    },
  });
  const ticket = String(result.ticket || "").trim();
  if (!ticket) throw new Error(`生成微信绑定二维码失败：${wechatApiErrorMessage(result)}`);
  return {
    imageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(ticket)}`,
    expiresAt,
  };
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
  const messageId = message.msgId || [openId, message.createTime, eventType, message.eventKey].join(":");
  const existing = await prisma.wechatMessageLog.findUnique({ where: { messageId }, select: { id: true } }).catch(() => null);
  if (existing) return { duplicate: true };

  let binding = await prisma.wechatBinding.findUnique({ where: { openId } });
  const now = new Date();
  if (message.msgType === "event" && message.event.toLowerCase() === "unsubscribe") {
    if (binding) {
      binding = await prisma.wechatBinding.update({
        where: { id: binding.id },
        data: { subscribed: false, unsubscribedAt: now },
      });
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
    }
    await logWechatMessage({ direction: "inbound", eventType, status: "ok", openId, userId: binding?.userId, messageId, rawPayload: message });
    const replyText = binding
      ? `微信服务号绑定成功，之后可在这里接收已开启的站内通知。\n通知设置：${normalizedSiteOrigin()}/messages?tab=settings`
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
  if (message.msgType === "text") {
    const bindCode = parseWechatBindCommand(message.content);
    if (bindCode) {
      if (binding) {
        replyText = "当前微信已经绑定药大拾间账号，如需更换请先在站内解绑。";
      } else {
        const result = await consumeWechatMessageBindToken(bindCode, openId);
        binding = result.binding;
        replyText = result.message;
      }
    }
  }
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
  if (message.msgType === "text") {
    if (!replyText) replyText = renderWechatAutomaticReply(message.content, Boolean(binding?.userId));
    if (replyText) {
      if (options?.passiveReply) {
        await logWechatMessage({ direction: "outbound", eventType: "passive", status: "ok", openId, userId: binding?.userId, content: replyText });
      } else {
        await sendWechatCustomerText(openId, replyText);
      }
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

export async function sendWechatTestMessage(openId: string, content: string) {
  const normalizedOpenId = openId.trim();
  if (!normalizedOpenId) throw Errors.badRequest("请填写接收人的 OpenID");
  await sendWechatCustomerText(normalizedOpenId, content.trim());
  await logWechatMessage({ direction: "outbound", eventType: "test", status: "ok", openId: normalizedOpenId, content });
  return { ok: true };
}

export async function dispatchRecentWechatNotifications() {
  const config = await getWechatServiceConfigRaw();
  if (!config.enabled || !config.notificationEnabled) return { sent: 0, skipped: 0 };
  const categories = normalizeNotifyCategories(parseStringArray(config.notifyCategories));
  if (!categories.length) return { sent: 0, skipped: 0 };
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const [notifications, bindings] = await Promise.all([
    prisma.notification.findMany({
      where: {
        createdAt: { gte: since },
        category: { in: categories },
        OR: [{ userId: { not: null }, readAt: null }, { userId: null }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.wechatBinding.findMany({
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
    }),
  ]);
  const bindingByUserId = new Map(bindings.map((binding) => [binding.userId, binding]));
  let sent = 0;
  let skipped = 0;
  for (const notification of notifications) {
    const targets = notification.userId ? [bindingByUserId.get(notification.userId)].filter(Boolean) : bindings;
    for (const binding of targets) {
      if (!binding || !shouldDeliverWechatNotification(notification, binding.user.messageSetting)) continue;
      const delivered = await prisma.wechatMessageLog.findFirst({
        where: { notificationId: notification.id, userId: binding.userId, status: "ok" },
        select: { id: true },
      });
      if (delivered) continue;
      const failedAttempts = await prisma.wechatMessageLog.count({
        where: { notificationId: notification.id, userId: binding.userId, status: "error" },
      });
      if (failedAttempts >= 3) {
        skipped += 1;
        continue;
      }
      try {
        const link = resolveNotificationLink(notification.link, notification.payload);
        const customerWindow = binding.lastInteractionType === "message" ? CUSTOMER_MESSAGE_WINDOW_MS : 60_000;
        const withinCustomerWindow = Boolean(binding.lastInteractionAt && Date.now() - binding.lastInteractionAt.getTime() <= customerWindow);
        if (withinCustomerWindow) {
          await sendWechatCustomerText(binding.openId, renderNotificationText(notification, link));
        } else if (canSendNotificationTemplate(config)) {
          await sendWechatTemplateNotification(config, binding.openId, notification, link);
        } else {
          skipped += 1;
          continue;
        }
        await logWechatMessage({
          direction: "outbound",
          eventType: "notification",
          status: "ok",
          openId: binding.openId,
          userId: binding.userId,
          notificationId: notification.id,
          content: notification.content,
        });
        sent += 1;
      } catch (error) {
        await logWechatMessage({
          direction: "outbound",
          eventType: "notification",
          status: "error",
          openId: binding.openId,
          userId: binding.userId,
          notificationId: notification.id,
          content: notification.content,
          result: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { sent, skipped };
}

export function startWechatNotificationPoller() {
  if (notificationPollerStarted) return;
  notificationPollerStarted = true;
  const tick = () => runWithDistributedLock("wechat-notification-dispatch:tick", 25_000, async () => {
    await dispatchRecentWechatNotifications();
  }).catch((error) => {
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
    msgId: readXmlTag(xml, "MsgId"),
    event: readXmlTag(xml, "Event"),
    eventKey: readXmlTag(xml, "EventKey"),
    ticket: readXmlTag(xml, "Ticket"),
    encrypt: readXmlTag(xml, "Encrypt"),
  };
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
  if (/^绑定(?:\s|$)/iu.test(content)) {
    return bound
      ? "当前微信已经绑定药大拾间账号，如需更换请先在站内解绑。"
      : `绑定需要使用站内生成的绑定码。\n请打开：${siteOrigin}/messages?tab=settings\n然后发送：绑定 绑定码`;
  }
  if (/^(状态|我的)$/u.test(content)) {
    return bound
      ? `当前微信已绑定药大拾间账号。\n通知设置：${siteOrigin}/messages?tab=settings`
      : `当前微信尚未绑定。\n绑定入口：${siteOrigin}/messages?tab=settings`;
  }
  return bound
    ? `本服务号当前仅用于接收站内通知，不提供对话查询。\n通知设置：${siteOrigin}/messages?tab=settings`
    : `本服务号当前仅用于账号绑定和接收站内通知，不提供对话查询。\n绑定入口：${siteOrigin}/messages?tab=settings`;
}

async function consumeWechatBindToken(rawToken: string, openId: string) {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.wechatBindToken.findUnique({ where: { tokenHash } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) return null;
  await bindWechatIdentity(token.userId, openId, null, { bindTokenId: token.id, subscribed: true, interactionType: "scan" });
  return prisma.wechatBinding.findUnique({ where: { openId } });
}

async function consumeWechatMessageBindToken(rawToken: string, openId: string) {
  const tokenHash = hashToken(rawToken.toUpperCase());
  const token = await prisma.wechatBindToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { nickname: true, status: true } } },
  });
  if (!token || !token.token || token.usedAt || token.expiresAt <= new Date()) {
    return { binding: null, message: "绑定码不存在或已过期，请在站内重新生成。" };
  }
  if (token.user.status === "banned") {
    return { binding: null, message: "这个站内账号已被封禁，不能绑定微信。" };
  }
  const existingBinding = await prisma.wechatBinding.findUnique({ where: { userId: token.userId } });
  if (existingBinding && existingBinding.openId !== openId) {
    return { binding: null, message: "该站内账号已经绑定其他微信，如需更换请先在站内解绑。" };
  }
  const conflictingBinding = await prisma.wechatBinding.findUnique({ where: { openId } });
  if (conflictingBinding && conflictingBinding.userId !== token.userId) {
    return { binding: conflictingBinding, message: "当前微信已经绑定其他药大拾间账号，如需更换请先在站内解绑。" };
  }
  await bindWechatIdentity(token.userId, openId, null, {
    bindTokenId: token.id,
    subscribed: true,
    interactionType: "message",
  });
  const binding = await prisma.wechatBinding.findUnique({ where: { openId } });
  return {
    binding,
    message: [
      `绑定成功：${token.user.nickname}`,
      "之后可通过本服务号接收已开启的站内通知。",
      `通知设置：${normalizedSiteOrigin()}/messages?tab=settings`,
    ].join("\n"),
  };
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
}

async function sendWechatTemplateNotification(config: WechatConfigRow, openId: string, notification: any, link: string) {
  const data: Record<string, { value: string }> = {};
  if (config.templateTitleField) data[config.templateTitleField] = { value: limitText(notification.title, 20) };
  if (config.templateContentField) data[config.templateContentField] = { value: limitText(notification.content, 60) };
  if (config.templateTimeField) data[config.templateTimeField] = { value: formatWechatTime(notification.createdAt) };
  if (config.templateRemarkField) data[config.templateRemarkField] = { value: limitText(notification.source || "药大拾间", 20) };
  return callWechatApi("/cgi-bin/message/template/send", {
    method: "POST",
    body: { touser: openId, template_id: config.notificationTemplateId, url: link || undefined, data },
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
    const payload = await response.json() as Record<string, any>;
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
    "欢迎关注药里拾间。",
    "本服务号当前仅用于账号绑定和接收站内通知。",
    `绑定账号：${normalizedSiteOrigin()}/messages?tab=settings`,
    "生成绑定码后发送：绑定 绑定码",
  ].join("\n");
}

function renderWechatHelp(bound: boolean, siteOrigin = normalizedSiteOrigin()) {
  return [
    "药里拾间服务号",
    "当前仅用于账号绑定和接收站内通知。",
    "发送“状态”可查看绑定状态。",
    "",
    bound ? `通知设置：${siteOrigin}/messages?tab=settings` : `绑定入口：${siteOrigin}/messages?tab=settings\n生成绑定码后发送：绑定 绑定码`,
  ].join("\n");
}

export function parseWechatBindCommand(content: string) {
  return parseMessageBindToken(content);
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
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return absoluteSiteUrl(raw);
  const payload = parseJsonObject(payloadValue);
  const topicId = positiveInt(payload.topicId);
  const replyId = positiveInt(payload.replyId);
  if (!topicId) return "";
  return `${normalizedSiteOrigin()}/forum/topic/${topicId}${replyId ? `#reply-${replyId}` : ""}`;
}

function canSendNotificationTemplate(config: WechatConfigRow) {
  return Boolean(config.notificationTemplateId && config.templateTitleField && config.templateContentField);
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
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
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

function absoluteSiteUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const origin = normalizedSiteOrigin();
  return value.startsWith("/") ? `${origin}${value}` : `${origin}/${value}`;
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
