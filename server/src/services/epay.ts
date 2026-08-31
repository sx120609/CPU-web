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

export type EpaySubmitPayload = {
  submitUrl: string;
  method: "POST";
  params: Record<string, string>;
};

export type EpayCheckoutErrorPage = {
  contentSecurityPolicy: string;
  html: string;
};

export type EpayCheckoutSubmission =
  | { ok: true; redirectUrl: string }
  | { ok: false; message: string; upstreamStatus: number | null };

type EpayStoredConfig = Awaited<ReturnType<typeof getStoredEpayConfig>>;

function escapeHtmlAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildEpayCheckoutErrorPage(
  message: string,
  options: { fallbackUrl: string; title?: string },
): EpayCheckoutErrorPage {
  const title = escapeHtmlAttribute(options.title || "暂时无法发起支付");
  const fallbackUrl = escapeHtmlAttribute(options.fallbackUrl || "/");
  const safeMessage = escapeHtmlAttribute(message || "支付平台暂时不可用，请稍后重试。");
  const contentSecurityPolicy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title}</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f4f8f7;color:#172033}
    main{width:min(88vw,360px);padding:28px;border:1px solid #dce6e2;border-radius:18px;background:#fff;text-align:center;box-shadow:0 18px 50px rgba(22,45,39,.12)}
    h1{margin:0 0 10px;font-size:20px}p{margin:0 0 20px;color:#667085;font-size:14px;line-height:1.65}
    a{display:inline-grid;min-height:46px;padding:0 24px;place-items:center;border-radius:12px;background:#168776;color:#fff;font:inherit;font-weight:700;text-decoration:none}
    @media(prefers-color-scheme:dark){body{background:#101c19;color:#eef8f5}main{border-color:#314b44;background:#1a2925}p{color:#abc5be}}
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${safeMessage}</p>
    <a href="${fallbackUrl}">返回本站</a>
  </main>
</body>
</html>`;
  return { contentSecurityPolicy, html };
}

function sanitizeGatewayMessage(value: string, status: number) {
  const withoutMarkup = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&amp;|&#38;/gi, "&");
  const message = withoutMarkup
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return message || `支付平台拒绝了本次请求（HTTP ${status}）`;
}

function decodeHtmlUrl(value: string) {
  return value
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .trim();
}

function resolveSafeCheckoutRedirect(value: string, submitUrl: URL) {
  try {
    const redirectUrl = new URL(decodeHtmlUrl(value), submitUrl);
    return redirectUrl.protocol === "https:" ? redirectUrl.toString() : "";
  } catch {
    return "";
  }
}

function extractHtmlCheckoutRedirect(html: string, submitUrl: URL) {
  const source = html.slice(0, 128_000);
  const scriptPatterns = [
    /(?:window\.)?location\.replace\s*\(\s*(["'])([^"']+)\1\s*\)/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*(["'])([^"']+)\1/i,
  ];
  for (const pattern of scriptPatterns) {
    const match = source.match(pattern);
    if (!match?.[2]) continue;
    const redirectUrl = resolveSafeCheckoutRedirect(match[2], submitUrl);
    if (redirectUrl) return redirectUrl;
  }

  const metaTag = source.match(/<meta\b[^>]*http-equiv\s*=\s*(["']?)refresh\1[^>]*>/i)?.[0]
    ?? source.match(/<meta\b[^>]*content\s*=\s*(["'])[^"']*url\s*=[^"']+\1[^>]*>/i)?.[0];
  const content = metaTag?.match(/content\s*=\s*(["'])(.*?)\1/i)?.[2];
  const metaUrl = content?.match(/(?:^|;)\s*url\s*=\s*(.+)\s*$/i)?.[1]
    ?.replace(/^(["'])(.*)\1$/, "$2");
  return metaUrl ? resolveSafeCheckoutRedirect(metaUrl, submitUrl) : "";
}

export async function submitEpayCheckout(
  epay: EpaySubmitPayload,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EpayCheckoutSubmission> {
  const submitUrl = new URL(epay.submitUrl);
  if (!["http:", "https:"].includes(submitUrl.protocol)) {
    throw new Error("易支付网关地址格式不正确");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  timeout.unref?.();
  try {
    const response = await (options.fetchImpl ?? fetch)(submitUrl, {
      method: epay.method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
      body: new URLSearchParams(epay.params),
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, message: "支付平台没有返回收银台地址", upstreamStatus: response.status };
      }
      const redirectUrl = new URL(location, submitUrl);
      if (redirectUrl.protocol !== "https:") {
        return { ok: false, message: "支付平台返回了不安全的收银台地址", upstreamStatus: response.status };
      }
      return { ok: true, redirectUrl: redirectUrl.toString() };
    }

    const body = await response.text();
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && (contentType.includes("text/html") || /^\s*<!doctype\s+html|^\s*<html\b/i.test(body))) {
      const redirectUrl = extractHtmlCheckoutRedirect(body, submitUrl);
      if (redirectUrl) return { ok: true, redirectUrl };
      return {
        ok: false,
        message: "支付平台返回了无法识别的收银台页面",
        upstreamStatus: response.status,
      };
    }
    return {
      ok: false,
      message: sanitizeGatewayMessage(body, response.status),
      upstreamStatus: response.status,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      message: timedOut ? "连接支付平台超时，请稍后重试" : "暂时无法连接支付平台，请稍后重试",
      upstreamStatus: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

export async function buildEpaySubmitPayload(order: EpayOrderInput): Promise<EpaySubmitPayload> {
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
