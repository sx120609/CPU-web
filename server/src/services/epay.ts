import crypto from "crypto";
import { prisma } from "../prisma";

const EPAY_CONFIG_ID = 1;

export type EpayConfigInput = {
  enabled?: boolean;
  gatewayUrl?: string;
  pid?: string;
  merchantKey?: string;
  clearMerchantKey?: boolean;
  signType?: string;
  defaultType?: string;
  notifyUrl?: string;
  returnUrl?: string;
};

export type EpayOrderInput = {
  outTradeNo: string;
  name: string;
  money: string;
  type?: string;
  notifyUrl?: string;
  returnUrl?: string;
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

function normalizeMoney(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("支付金额不正确");
  }
  return n.toFixed(2);
}

function ensureUrlOrEmpty(url: string, message: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
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

async function getStoredEpayConfig() {
  const existing = await prisma.epayConfig.findUnique({ where: { id: EPAY_CONFIG_ID } });
  if (existing) return existing;
  return prisma.epayConfig.create({ data: { id: EPAY_CONFIG_ID } });
}

export async function getEpayConfig() {
  const config = await getStoredEpayConfig();
  return {
    id: config.id,
    enabled: config.enabled,
    gatewayUrl: config.gatewayUrl,
    submitUrl: submitUrlFromGateway(config.gatewayUrl),
    pid: config.pid,
    hasMerchantKey: Boolean(config.merchantKey),
    merchantKeyMasked: maskSecret(config.merchantKey),
    signType: config.signType,
    defaultType: config.defaultType,
    notifyUrl: config.notifyUrl,
    returnUrl: config.returnUrl,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function updateEpayConfig(input: EpayConfigInput) {
  const data: Record<string, unknown> = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.gatewayUrl !== undefined) data.gatewayUrl = ensureUrlOrEmpty(input.gatewayUrl, "易支付网关地址格式不正确");
  if (input.pid !== undefined) data.pid = input.pid.trim();
  if (input.clearMerchantKey) data.merchantKey = "";
  else if (input.merchantKey !== undefined && input.merchantKey.trim()) data.merchantKey = input.merchantKey.trim();
  if (input.signType !== undefined) data.signType = input.signType.trim().toUpperCase() || "MD5";
  if (input.defaultType !== undefined) data.defaultType = input.defaultType.trim() || "alipay";
  if (input.notifyUrl !== undefined) data.notifyUrl = ensureUrlOrEmpty(input.notifyUrl, "异步通知地址格式不正确");
  if (input.returnUrl !== undefined) data.returnUrl = ensureUrlOrEmpty(input.returnUrl, "同步跳转地址格式不正确");

  await getStoredEpayConfig();
  await prisma.epayConfig.update({ where: { id: EPAY_CONFIG_ID }, data });
  return getEpayConfig();
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
  const params: Record<string, string> = {
    pid: config.pid,
    type: order.type || config.defaultType || "alipay",
    out_trade_no: order.outTradeNo.trim(),
    notify_url: order.notifyUrl?.trim() || config.notifyUrl,
    return_url: order.returnUrl?.trim() || config.returnUrl,
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
