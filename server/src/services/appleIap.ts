import { createHmac } from "node:crypto";
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { config } from "../config";

/**
 * iOS 赞助走 Apple 内购（消耗型商品）。App 把 StoreKit 2 给的 JWS 交易原文交给服务端，
 * 服务端用 Apple 根证书校验签名链、包名和 App ID，再按商品档位记一笔赞助。
 *
 * 根证书是公开的 Apple Root CA - G3（https://www.apple.com/certificateauthority/），
 * SHA-256 指纹 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79。
 */
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

/** 苹果抽成后到手的比例：iOS 赞助的 AI 点数按这个比例折算，其余权益（VIP、赞助墙、类别）与网页一致。 */
export const APPLE_IAP_POINTS_RATIO = 0.7;

export type AppleSponsorProduct = { productId: string; amountCents: number };

/** App Store Connect 里建的消耗型商品，价格是人民币档位。ID 改了要同步 App 里的 StoreKit 配置文件。 */
export const APPLE_SPONSOR_PRODUCTS: readonly AppleSponsorProduct[] = [
  { productId: "cn.cputime.mobile.sponsor.6", amountCents: 600 },
  { productId: "cn.cputime.mobile.sponsor.18", amountCents: 1800 },
  { productId: "cn.cputime.mobile.sponsor.30", amountCents: 3000 },
  { productId: "cn.cputime.mobile.sponsor.68", amountCents: 6800 },
  { productId: "cn.cputime.mobile.sponsor.128", amountCents: 12800 },
];

export function appleSponsorProduct(productId: string | undefined | null) {
  return APPLE_SPONSOR_PRODUCTS.find((product) => product.productId === productId);
}

export function appleIapBundleId() {
  return String(process.env.APPLE_IAP_BUNDLE_ID || "cn.cputime.mobile").trim();
}

export function appleIapAppAppleId() {
  const value = Number(String(process.env.APPLE_IAP_APP_APPLE_ID || "6811073406").trim());
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 沙盒交易（App 审核、TestFlight、开发机）默认接受，以便审核能看到权益到账；APPLE_IAP_ALLOW_SANDBOX=0 关闭。 */
export function appleIapAllowsSandbox() {
  return !["0", "false", "no", "off"].includes(String(process.env.APPLE_IAP_ALLOW_SANDBOX ?? "").trim().toLowerCase());
}

/** iOS 内购的 AI 点数：先把金额按到手比例折算，再按网页的每元点数计。 */
export function appleIapPointsAmountCents(amountCents: number) {
  return Math.floor(Math.max(0, amountCents) * APPLE_IAP_POINTS_RATIO);
}

/**
 * 每个账号固定的 appAccountToken（UUID 形式）。App 下单时带上，校验交易时比对，
 * 这样一笔交易只能记到下单的那个站内账号上，换号提交会被拒。
 */
export function appleAppAccountToken(userId: number) {
  const hex = createHmac("sha256", config.jwtSecret).update(`apple-iap-account:${userId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

let verifiers: { production: SignedDataVerifier; sandbox: SignedDataVerifier } | null = null;

function rootCertificates() {
  const base64 = APPLE_ROOT_CA_G3_PEM.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return [Buffer.from(base64, "base64")];
}

function getVerifiers() {
  if (!verifiers) {
    const roots = rootCertificates();
    verifiers = {
      production: new SignedDataVerifier(roots, true, Environment.PRODUCTION, appleIapBundleId(), appleIapAppAppleId()),
      sandbox: new SignedDataVerifier(roots, true, Environment.SANDBOX, appleIapBundleId()),
    };
  }
  return verifiers;
}

export class AppleIapError extends Error {}

function isEnvironmentMismatch(error: unknown) {
  return error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT;
}

async function verifyEither<T>(run: (verifier: SignedDataVerifier) => Promise<T>): Promise<{ value: T; sandbox: boolean }> {
  const { production, sandbox } = getVerifiers();
  try {
    return { value: await run(production), sandbox: false };
  } catch (error) {
    if (!isEnvironmentMismatch(error)) throw new AppleIapError("无法验证这笔 App Store 交易");
  }
  if (!appleIapAllowsSandbox()) throw new AppleIapError("不接受沙盒交易");
  try {
    return { value: await run(sandbox), sandbox: true };
  } catch {
    throw new AppleIapError("无法验证这笔 App Store 交易");
  }
}

export type VerifiedAppleTransaction = {
  transaction: JWSTransactionDecodedPayload;
  product: AppleSponsorProduct;
  sandbox: boolean;
};

export async function verifyAppleSponsorTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction> {
  const { value: transaction, sandbox } = await verifyEither((verifier) => verifier.verifyAndDecodeTransaction(signedTransaction));
  const product = appleSponsorProduct(transaction.productId);
  if (!product) throw new AppleIapError("这不是赞助商品");
  if (!transaction.transactionId) throw new AppleIapError("交易缺少编号");
  return { transaction, product, sandbox };
}

export type AppleRefundNotice = { transactionId: string; sandbox: boolean; type: string };

/** App Store 服务器通知 V2：只关心退款和撤销，其他类型返回 null。 */
export async function decodeAppleRefundNotification(signedPayload: string): Promise<AppleRefundNotice | null> {
  const { value: notification, sandbox } = await verifyEither((verifier) => verifier.verifyAndDecodeNotification(signedPayload));
  const type = String(notification.notificationType ?? "");
  if (type !== NotificationTypeV2.REFUND && type !== NotificationTypeV2.REVOKE) return null;
  const signedTransaction = notification.data?.signedTransactionInfo;
  if (!signedTransaction) return null;
  const { value: transaction } = await verifyEither((verifier) => verifier.verifyAndDecodeTransaction(signedTransaction));
  if (!transaction.transactionId || !appleSponsorProduct(transaction.productId)) return null;
  return { transactionId: transaction.transactionId, sandbox, type };
}
