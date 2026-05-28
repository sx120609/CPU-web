import crypto from "crypto";
import { prisma } from "../prisma";
import { getSiteOrigin } from "./siteSettings";

const EPAY_CONFIG_ID = 1;
const PAY_TYPES = ["alipay", "wxpay", "qqpay", "bank", "jdpay"] as const;
export type EpayPayType = typeof PAY_TYPES[number];

export type EpayConfigInput = {
  enabled?: boolean;
  gatewayUrl?: string;
  pid?: string;
  merchantKey?: string;
  clearMerchantKey?: boolean;
  signType?: string;
  defaultType?: string;
  enabledTypes?: string[];
};

export type EpayOrderInput = {
  outTradeNo: string;
  name: string;
  money: string;
  type?: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
  device?: string;
  param?: string;
};

type EpayStoredConfig = Awaited<ReturnType<typeof getStoredEpayConfig>>;

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 8) return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function normalizeGatewayUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export function amountCentsToMoney(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

export function moneyToAmountCents(value: string | number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("支付金额不正确");
  }
  return Math.round(n * 100);
}

function normalizeMoney(value: string | number) {
  return amountCentsToMoney(moneyToAmountCents(value));
}

function normalizeAbsoluteUrl(url: string, message: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(message);
    return trimmed;
  } catch {
    throw new Error(message);
  }
}

function submitUrlFromGateway(gatewayUrl: string) {
  const normalized = normalizeGatewayUrl(gatewayUrl);
  if (!normalized) return "";
  if (/\.php(?:\?|$)/i.test(normalized)) return normalized;
  return `${normalized}/submit.php`;
}

function normalizePayTypes(input: unknown, fallback: EpayPayType[] = ["alipay", "wxpay"]): EpayPayType[] {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      raw = input.split(",");
    }
  }
  if (!Array.isArray(raw)) raw = fallback;
  const normalized = Array.from(new Set(
    (raw as unknown[])
      .map((item: unknown) => String(item).trim())
      .filter((item: string): item is EpayPayType => (PAY_TYPES as readonly string[]).includes(item))
  ));
  return normalized.length ? normalized : fallback;
}

function normalizeDefaultType(input: string, enabledTypes: EpayPayType[]) {
  const value = String(input || "").trim();
  return enabledTypes.includes(value as EpayPayType) ? value : enabledTypes[0] || "alipay";
}

async function getStoredEpayConfig() {
  const existing = await prisma.epayConfig.findUnique({ where: { id: EPAY_CONFIG_ID } });
  if (existing) return existing;
  return prisma.epayConfig.create({ data: { id: EPAY_CONFIG_ID } });
}

export function resolvePaymentOrigin(requestOrigin = "") {
  return getSiteOrigin() || requestOrigin.trim().replace(/\/+$/, "");
}

export function buildEpayCallbackUrls(origin: string) {
  const normalized = origin.trim().replace(/\/+$/, "");
  return {
    notifyUrl: normalized ? `${normalized}/api/payments/epay/notify` : "",
    returnUrl: normalized ? `${normalized}/api/payments/epay/return` : "",
  };
}

export async function getEpayConfig(requestOrigin = "") {
  const config = await getStoredEpayConfig();
  const enabledTypes = normalizePayTypes(config.enabledTypes);
  const origin = resolvePaymentOrigin(requestOrigin);
  const callbacks = buildEpayCallbackUrls(origin);
  return {
    id: config.id,
    enabled: config.enabled,
    gatewayUrl: config.gatewayUrl,
    submitUrl: submitUrlFromGateway(config.gatewayUrl),
    pid: config.pid,
    hasMerchantKey: Boolean(config.merchantKey),
    merchantKeyMasked: maskSecret(config.merchantKey),
    signType: config.signType,
    defaultType: normalizeDefaultType(config.defaultType, enabledTypes),
    enabledTypes,
    notifyUrl: callbacks.notifyUrl,
    returnUrl: callbacks.returnUrl,
    siteOrigin: origin,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function updateEpayConfig(input: EpayConfigInput, requestOrigin = "") {
  const data: Record<string, unknown> = {};
  const current = await getStoredEpayConfig();
  const nextEnabledTypes = input.enabledTypes !== undefined
    ? normalizePayTypes(input.enabledTypes)
    : normalizePayTypes(current.enabledTypes);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.gatewayUrl !== undefined) data.gatewayUrl = input.gatewayUrl.trim() ? normalizeAbsoluteUrl(input.gatewayUrl, "易支付网关地址格式不正确") : "";
  if (input.pid !== undefined) data.pid = input.pid.trim();
  if (input.clearMerchantKey) data.merchantKey = "";
  else if (input.merchantKey !== undefined && input.merchantKey.trim()) data.merchantKey = input.merchantKey.trim();
  if (input.signType !== undefined) data.signType = input.signType.trim().toUpperCase() || "MD5";
  if (input.enabledTypes !== undefined) data.enabledTypes = JSON.stringify(nextEnabledTypes);
  if (input.defaultType !== undefined || input.enabledTypes !== undefined) {
    data.defaultType = normalizeDefaultType(input.defaultType ?? current.defaultType, nextEnabledTypes);
  }

  await prisma.epayConfig.update({ where: { id: EPAY_CONFIG_ID }, data });
  return getEpayConfig(requestOrigin);
}

export function signEpayParams(params: Record<string, string | number | boolean | null | undefined>, merchantKey: string) {
  const query = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type")
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("md5").update(`${query}${merchantKey}`).digest("hex");
}

export function verifyEpayParams(params: Record<string, string | number | boolean | null | undefined>, merchantKey: string) {
  const sign = String(params.sign ?? "").toLowerCase();
  if (!sign) return false;
  return signEpayParams(params, merchantKey) === sign;
}

function ensureReady(config: EpayStoredConfig) {
  if (!config.enabled) throw new Error("易支付尚未启用");
  if (!config.gatewayUrl) throw new Error("易支付网关地址未配置");
  if (!config.pid) throw new Error("易支付商户 ID 未配置");
  if (!config.merchantKey) throw new Error("易支付商户密钥未配置");
}

export async function buildEpaySubmitPayload(order: EpayOrderInput) {
  const config = await getStoredEpayConfig();
  ensureReady(config);
  const enabledTypes = normalizePayTypes(config.enabledTypes);
  const payType = normalizeDefaultType(order.type || config.defaultType, enabledTypes);
  if (!enabledTypes.includes(payType as EpayPayType)) throw new Error("该支付方式未启用");
  const params: Record<string, string> = {
    pid: config.pid,
    type: payType,
    out_trade_no: order.outTradeNo.trim(),
    notify_url: order.notifyUrl.trim(),
    return_url: order.returnUrl.trim(),
    name: order.name.trim(),
    money: normalizeMoney(order.money),
  };
  if (order.clientIp?.trim()) params.clientip = order.clientIp.trim();
  if (order.device?.trim()) params.device = order.device.trim();
  if (order.param?.trim()) params.param = order.param.trim();

  if (!params.out_trade_no) throw new Error("商户订单号不能为空");
  if (!params.name) throw new Error("商品名称不能为空");
  if (!params.notify_url) throw new Error("异步通知地址未配置");
  if (!params.return_url) throw new Error("同步跳转地址未配置");

  params.sign = signEpayParams(params, config.merchantKey);
  params.sign_type = config.signType || "MD5";

  return {
    submitUrl: submitUrlFromGateway(config.gatewayUrl),
    method: "POST",
    params,
  };
}

export async function getEpayMerchantKey() {
  const config = await getStoredEpayConfig();
  return config.merchantKey;
}

export async function getEnabledEpayTypes() {
  const config = await getStoredEpayConfig();
  if (!config.enabled || !config.gatewayUrl || !config.pid || !config.merchantKey) return [];
  return normalizePayTypes(config.enabledTypes);
}
