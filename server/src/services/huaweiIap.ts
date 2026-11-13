import { X509Certificate, createHmac, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { config } from "../config";

/**
 * 鸿蒙 App 的赞助走华为应用内支付（IAP Kit，消耗型商品）。App 把 IAP Kit 给的 jwsPurchaseOrder 原文交给服务端，
 * 服务端按华为文档「对返回结果验签」校验：ES256，x5c 证书链（叶子、中间、根）挂在 Huawei CBG Root CA G2 下，
 * 叶子证书带 IAP 的扩展 OID 1.3.6.1.4.1.2011.2.415.1.1；再核对应用 ID、商品、币种和下单账号，按商品档位记一笔赞助。
 *
 * 根证书是公开的 Huawei CBG Root CA G2（https://pki.consumer.huawei.com/ca/ 的 RootCaG2Ecdsa.cer），
 * SHA-256 指纹 DF:21:A3:C0:9F:79:54:57:93:05:F8:5C:64:F8:0C:AD:86:F7:98:53:EE:3A:88:7C:1D:EC:95:D2:18:DF:3A:37。
 */
const HUAWEI_CBG_ROOT_CA_G2_PEM = `-----BEGIN CERTIFICATE-----
MIICGjCCAaGgAwIBAgIIShhpn519jNAwCgYIKoZIzj0EAwMwUzELMAkGA1UEBhMC
Q04xDzANBgNVBAoMBkh1YXdlaTETMBEGA1UECwwKSHVhd2VpIENCRzEeMBwGA1UE
AwwVSHVhd2VpIENCRyBSb290IENBIEcyMB4XDTIwMDMxNjAzMDQzOVoXDTQ5MDMx
NjAzMDQzOVowUzELMAkGA1UEBhMCQ04xDzANBgNVBAoMBkh1YXdlaTETMBEGA1UE
CwwKSHVhd2VpIENCRzEeMBwGA1UEAwwVSHVhd2VpIENCRyBSb290IENBIEcyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEWidkGnDSOw3/HE2y2GHl+fpWBIa5S+IlnNrs
GUvwC1I2QWvtqCHWmwFlFK95zKXiM8s9yV3VVXh7ivN8ZJO3SC5N1TCrvB2lpHMB
wcz4DA0kgHCMm/wDec6kOHx1xvCRo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUo45a9Vq8cYwqaiVyfkiS4pLcIAAwCgYIKoZI
zj0EAwMDZwAwZAIwMypeB7P0IbY7c6gpWcClhRznOJFj8uavrNu2PIoz9KIqr3jn
BlBHJs0myI7ntYpEAjBbm8eDMZY5zq5iMZUC6H7UzYSix4Uy1YlsLVV738PtKP9h
FTjgDHctXJlC5L7+ZDY=
-----END CERTIFICATE-----`;

/** 叶子证书必须带的扩展 OID 1.3.6.1.4.1.2011.2.415.1.1 的 DER 编码（06 0C …）。 */
const IAP_LEAF_OID_DER = Buffer.from("060c2b060104018f5b02831f0101", "hex");

/** 华为抽成后到手的比例：鸿蒙赞助的 AI 点数按这个比例折算，其余权益（VIP、赞助墙、类别）与网页一致。 */
export const HUAWEI_IAP_POINTS_RATIO = 0.7;

export type HuaweiSponsorProduct = { productId: string; amountCents: number };

/** HarmonyOS 开发者中心「商品管理」里建的消耗型商品，价格是人民币。 */
export const HUAWEI_SPONSOR_PRODUCTS: readonly HuaweiSponsorProduct[] = [
  { productId: "sponsor_6", amountCents: 600 },
  { productId: "sponsor_18", amountCents: 1800 },
  { productId: "sponsor_30", amountCents: 3000 },
  { productId: "sponsor_68", amountCents: 6800 },
  { productId: "sponsor_128", amountCents: 12800 },
];

export function huaweiSponsorProduct(productId: string | undefined | null) {
  return HUAWEI_SPONSOR_PRODUCTS.find((product) => product.productId === productId);
}

/** 应用 cn.lizmt.cpuweb 在开发者中心的 APP ID。 */
export function huaweiIapApplicationId() {
  return String(process.env.HUAWEI_IAP_APP_ID || "6917615161427451076").trim();
}

/** 沙盒交易（审核、沙盒测试账号）默认接受，以便审核能看到权益到账；HUAWEI_IAP_ALLOW_SANDBOX=0 关闭。 */
export function huaweiIapAllowsSandbox() {
  return !["0", "false", "no", "off"].includes(String(process.env.HUAWEI_IAP_ALLOW_SANDBOX ?? "").trim().toLowerCase());
}

/** 鸿蒙内购的 AI 点数：先把金额按到手比例折算，再按网页的每元点数计。 */
export function huaweiIapPointsAmountCents(amountCents: number) {
  return Math.floor(Math.max(0, amountCents) * HUAWEI_IAP_POINTS_RATIO);
}

/**
 * 每个账号固定的 developerPayload。App 下单时带上，华为把它签进订单里，校验时比对：
 * 一笔购买只能记到下单的那个站内账号上，换号提交会被拒。
 */
export function huaweiDeveloperPayload(userId: number) {
  return createHmac("sha256", config.jwtSecret).update(`huawei-iap-account:${userId}`).digest("hex").slice(0, 32);
}

export class HuaweiIapError extends Error {}

const INVALID = "无法验证这笔华为应用内支付订单";

let rootCertificate: X509Certificate | null = null;

function huaweiRoot() {
  if (!rootCertificate) rootCertificate = new X509Certificate(HUAWEI_CBG_ROOT_CA_G2_PEM);
  return rootCertificate;
}

function withinValidity(certificate: X509Certificate, now: number) {
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo);
}

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * 校验华为 IAP 的 JWS 并返回负载。`options` 只给测试换根证书和时间用。
 */
export function verifyHuaweiJws(jws: string, options: { root?: X509Certificate; now?: number } = {}): Record<string, any> {
  const parts = String(jws || "").trim().split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new HuaweiIapError(INVALID);
  let header: any;
  let payload: any;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new HuaweiIapError(INVALID);
  }
  if (header?.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new HuaweiIapError(INVALID);
  if (!payload || typeof payload !== "object") throw new HuaweiIapError(INVALID);

  const root = options.root ?? huaweiRoot();
  const now = options.now ?? Date.now();
  let leaf: X509Certificate;
  let intermediate: X509Certificate;
  let presentedRoot: X509Certificate;
  try {
    [leaf, intermediate, presentedRoot] = (header.x5c as unknown[]).map((item) => new X509Certificate(Buffer.from(String(item), "base64")));
  } catch {
    throw new HuaweiIapError(INVALID);
  }
  // 链里带的根证书必须就是内置的那一张；之后的验证只用内置的。
  if (presentedRoot.raw.length !== root.raw.length || !timingSafeEqual(presentedRoot.raw, root.raw)) throw new HuaweiIapError(INVALID);
  if (!intermediate.ca || !intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) throw new HuaweiIapError(INVALID);
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) throw new HuaweiIapError(INVALID);
  if (![leaf, intermediate, root].every((certificate) => withinValidity(certificate, now))) throw new HuaweiIapError(INVALID);
  if (!leaf.raw.includes(IAP_LEAF_OID_DER)) throw new HuaweiIapError(INVALID);

  const key = leaf.publicKey;
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new HuaweiIapError(INVALID);
  const signature = Buffer.from(parts[2], "base64url");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  if (signature.length !== 64 || !verifySignature("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature)) {
    throw new HuaweiIapError(INVALID);
  }
  return payload;
}

export type VerifiedHuaweiPurchase = {
  purchaseOrderId: string;
  purchaseToken: string;
  product: HuaweiSponsorProduct;
  /** 实付金额（分）。 */
  amountCents: number;
  developerPayload: string;
  purchaseTime?: number;
  revoked: boolean;
  sandbox: boolean;
};

/** App 交来的可以是整个 purchaseData（JSON，含 jwsPurchaseOrder），也可以直接是 jwsPurchaseOrder。 */
export function extractJwsPurchaseOrder(purchaseData: string) {
  const text = String(purchaseData || "").trim();
  if (!text.startsWith("{")) return text;
  try {
    return String(JSON.parse(text)?.jwsPurchaseOrder || "");
  } catch {
    return "";
  }
}

export function verifyHuaweiSponsorPurchase(purchaseData: string, options: { root?: X509Certificate; now?: number } = {}): VerifiedHuaweiPurchase {
  const payload = verifyHuaweiJws(extractJwsPurchaseOrder(purchaseData), options);
  if (String(payload.applicationId ?? "") !== huaweiIapApplicationId()) throw new HuaweiIapError("这笔订单不属于本应用");
  const environment = String(payload.environment ?? "NORMAL").toUpperCase();
  if (environment !== "NORMAL" && environment !== "SANDBOX") throw new HuaweiIapError(INVALID);
  const sandbox = environment === "SANDBOX";
  if (sandbox && !huaweiIapAllowsSandbox()) throw new HuaweiIapError("不接受沙盒订单");
  const product = huaweiSponsorProduct(payload.productId);
  if (!product || String(payload.productType ?? "") !== "0") throw new HuaweiIapError("这不是赞助商品");
  const purchaseOrderId = String(payload.purchaseOrderId ?? "");
  const purchaseToken = String(payload.purchaseToken ?? "");
  if (!purchaseOrderId || !purchaseToken || purchaseOrderId.length > 256 || purchaseToken.length > 256) throw new HuaweiIapError("订单缺少编号");
  if (payload.quantity !== undefined && Number(payload.quantity) !== 1) throw new HuaweiIapError("不支持一次购买多份");
  const price = Number(payload.price);
  if (String(payload.currency ?? "") !== "CNY" || !Number.isInteger(price) || price <= 0) throw new HuaweiIapError("订单金额无效");
  return {
    purchaseOrderId,
    purchaseToken,
    product,
    // 记实付金额；商品涨价前不会高于档位，取小的那个，避免记多。
    amountCents: Math.min(price, product.amountCents),
    developerPayload: String(payload.developerPayload ?? ""),
    purchaseTime: Number.isFinite(Number(payload.purchaseTime)) && Number(payload.purchaseTime) > 0 ? Number(payload.purchaseTime) : undefined,
    revoked: payload.purchaseOrderRevocationReasonCode !== undefined && payload.purchaseOrderRevocationReasonCode !== null
      && String(payload.purchaseOrderRevocationReasonCode) !== "",
    sandbox,
  };
}

export type HuaweiRefundNotice = { purchaseOrderId: string; sandbox: boolean };

/** 服务端关键事件通知 v3：只关心消耗型商品的退款（REVOKE / REFUND_TRANSACTION），其他类型返回 null。 */
export function decodeHuaweiRefundNotification(jwsNotification: string, options: { root?: X509Certificate; now?: number } = {}): HuaweiRefundNotice | null {
  const payload = verifyHuaweiJws(jwsNotification, options);
  if (payload.notificationType !== "REVOKE") return null;
  if (payload.notificationSubtype !== undefined && payload.notificationSubtype !== "REFUND_TRANSACTION") return null;
  const meta = payload.notificationMetaData;
  if (!meta || typeof meta !== "object") return null;
  if (String(meta.applicationId ?? "") !== huaweiIapApplicationId() || Number(meta.type) !== 0) return null;
  const purchaseOrderId = String(meta.purchaseOrderId ?? "");
  if (!purchaseOrderId) return null;
  return { purchaseOrderId, sandbox: String(meta.environment ?? "").toUpperCase() === "SANDBOX" };
}
