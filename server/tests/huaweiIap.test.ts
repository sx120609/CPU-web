import assert from "node:assert/strict";
import { X509Certificate, createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { calculateSponsorAssistantPoints } from "../src/services/campusAssistantPoints";
import {
  HUAWEI_SPONSOR_PRODUCTS,
  HuaweiIapError,
  decodeHuaweiRefundNotification,
  huaweiDeveloperPayload,
  huaweiIapApplicationId,
  huaweiIapPointsAmountCents,
  huaweiSponsorProduct,
  verifyHuaweiJws,
  verifyHuaweiSponsorPurchase,
} from "../src/services/huaweiIap";

const root = path.resolve(__dirname, "../..");
/** 只给测试用的证书链，形状和华为 IAP 的 x5c 一样：根、中间、带 IAP 扩展 OID 的叶子，另有一张不带 OID 的叶子。 */
const chain = JSON.parse(readFileSync(path.join(__dirname, "fixtures/huaweiIapTestChain.json"), "utf8"));
const testRoot = new X509Certificate(Buffer.from(chain.root, "base64"));
const options = { root: testRoot };

function jws(payload: unknown, leaf: "leaf" | "plain" = "leaf", header: Record<string, unknown> = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", x5c: [chain[leaf], chain.intermediate, chain.root], ...header })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createPrivateKey({ key: Buffer.from(chain[`${leaf}Key`], "base64"), format: "der", type: "pkcs8" });
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${signature}`;
}

function order(patch: Record<string, unknown> = {}) {
  return {
    environment: "NORMAL",
    purchaseOrderId: "1702607152698.ABCDEF01.4732",
    purchaseToken: "000001.token.4732",
    applicationId: huaweiIapApplicationId(),
    productId: "sponsor_18",
    productType: "0",
    purchaseTime: 1702607152698,
    finishStatus: "2",
    price: 1800,
    currency: "CNY",
    developerPayload: huaweiDeveloperPayload(42),
    countryCode: "CN",
    signedTime: 1702607153000,
    ...patch,
  };
}

test("每个账号的 developerPayload 固定，换账号就不同", () => {
  assert.equal(huaweiDeveloperPayload(42), huaweiDeveloperPayload(42));
  assert.notEqual(huaweiDeveloperPayload(42), huaweiDeveloperPayload(43));
  assert.match(huaweiDeveloperPayload(42), /^[0-9a-f]{32}$/);
});

test("鸿蒙赞助的 AI 点数是网页的 70%，档位和 iOS 一样", () => {
  const six = huaweiSponsorProduct("sponsor_6")!;
  assert.equal(calculateSponsorAssistantPoints(huaweiIapPointsAmountCents(six.amountCents), 200), 840);
  assert.deepEqual(HUAWEI_SPONSOR_PRODUCTS.map((product) => product.amountCents), [600, 1800, 3000, 6800, 12800]);
  assert.equal(huaweiSponsorProduct("vip_month"), undefined);
});

test("验签通过的订单按商品档位和实付金额记账", () => {
  const purchase = verifyHuaweiSponsorPurchase(JSON.stringify({ type: 0, jwsPurchaseOrder: jws(order()) }), options);
  assert.equal(purchase.product.productId, "sponsor_18");
  assert.equal(purchase.amountCents, 1800);
  assert.equal(purchase.purchaseOrderId, "1702607152698.ABCDEF01.4732");
  assert.equal(purchase.purchaseToken, "000001.token.4732");
  assert.equal(purchase.developerPayload, huaweiDeveloperPayload(42));
  assert.equal(purchase.sandbox, false);
  assert.equal(purchase.revoked, false);
  // 直接交 jwsPurchaseOrder 也行。
  assert.equal(verifyHuaweiSponsorPurchase(jws(order({ environment: "SANDBOX" })), options).sandbox, true);
  assert.equal(verifyHuaweiSponsorPurchase(jws(order({ purchaseOrderRevocationReasonCode: "1" })), options).revoked, true);
  // 实付低于档位（促销）时记实付，高于档位时不多记。
  assert.equal(verifyHuaweiSponsorPurchase(jws(order({ price: 900 })), options).amountCents, 900);
  assert.equal(verifyHuaweiSponsorPurchase(jws(order({ price: 9900 })), options).amountCents, 1800);
});

test("别的应用、别的商品、外币、批量购买的订单不能记成赞助", () => {
  const rejected = (patch: Record<string, unknown>) =>
    assert.throws(() => verifyHuaweiSponsorPurchase(jws(order(patch)), options), HuaweiIapError);
  rejected({ applicationId: "1" });
  rejected({ productId: "vip_month" });
  rejected({ productType: "2" });
  rejected({ currency: "USD" });
  rejected({ price: 0 });
  rejected({ quantity: 3 });
  rejected({ purchaseOrderId: "" });
  rejected({ environment: "DEV" });
});

test("签名、证书链或证书用途不对的 JWS 都不接受", () => {
  const good = jws(order());
  assert.equal(verifyHuaweiJws(good, options).productId, "sponsor_18");
  // 内置的是华为根证书：测试链在正式配置下必须被拒。
  assert.throws(() => verifyHuaweiJws(good), HuaweiIapError);
  // 改了负载，签名就对不上。
  const [head, , signature] = good.split(".");
  const forged = Buffer.from(JSON.stringify(order({ productId: "sponsor_128", price: 12800 }))).toString("base64url");
  assert.throws(() => verifyHuaweiJws(`${head}.${forged}.${signature}`, options), HuaweiIapError);
  // 同一个中间证书签的、但不带 IAP 扩展 OID 的叶子证书。
  assert.throws(() => verifyHuaweiJws(jws(order(), "plain"), options), HuaweiIapError);
  assert.throws(() => verifyHuaweiJws(jws(order(), "leaf", { alg: "HS256" }), options), HuaweiIapError);
  assert.throws(() => verifyHuaweiJws(jws(order(), "leaf", { x5c: [chain.leaf, chain.root] }), options), HuaweiIapError);
  assert.throws(() => verifyHuaweiJws(jws(order(), "leaf", { x5c: [chain.leaf, chain.leaf, chain.root] }), options), HuaweiIapError);
  // 证书过期之后。
  assert.throws(() => verifyHuaweiJws(good, { root: testRoot, now: Date.parse("2200-01-01T00:00:00Z") }), HuaweiIapError);
  assert.throws(() => verifyHuaweiJws("not-a-jws", options), HuaweiIapError);
  assert.throws(() => verifyHuaweiJws("", options), HuaweiIapError);
});

test("退款通知只认本应用消耗型商品的 REVOKE", () => {
  const notice = (patch: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => jws({
    notificationType: "REVOKE",
    notificationSubtype: "REFUND_TRANSACTION",
    notificationRequestId: "r1",
    notificationVersion: "v3",
    signedTime: 1702607152698,
    notificationMetaData: {
      environment: "NORMAL",
      applicationId: huaweiIapApplicationId(),
      packageName: "cn.lizmt.cpuweb",
      type: 0,
      purchaseToken: "000001.token.4732",
      purchaseOrderId: "1702607152698.ABCDEF01.4732",
      ...meta,
    },
    ...patch,
  });
  assert.deepEqual(decodeHuaweiRefundNotification(notice(), options), { purchaseOrderId: "1702607152698.ABCDEF01.4732", sandbox: false });
  assert.equal(decodeHuaweiRefundNotification(notice({}, { environment: "SANDBOX" }), options)?.sandbox, true);
  assert.equal(decodeHuaweiRefundNotification(notice({ notificationType: "DID_NEW_TRANSACTION", notificationSubtype: "INITIAL_BUY" }), options), null);
  assert.equal(decodeHuaweiRefundNotification(notice({ notificationType: "TEST", notificationSubtype: undefined }), options), null);
  assert.equal(decodeHuaweiRefundNotification(notice({}, { applicationId: "1" }), options), null);
  assert.equal(decodeHuaweiRefundNotification(notice({}, { type: 2 }), options), null);
  assert.throws(() => decodeHuaweiRefundNotification(notice()), HuaweiIapError);
});

test("根证书是 Huawei CBG Root CA G2", () => {
  const source = readFileSync(path.join(root, "server/src/services/huaweiIap.ts"), "utf8");
  const pem = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(source)![1].replace(/\s+/g, "");
  const fingerprint = createHash("sha256").update(Buffer.from(pem, "base64")).digest("hex").toUpperCase();
  assert.equal(fingerprint, "DF21A3C09F7954579305F85C64F80CAD86F79853EE3A887C1DEC95D218DF3A37");
});
