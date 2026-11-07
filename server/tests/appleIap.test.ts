import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { calculateSponsorAssistantPoints } from "../src/services/campusAssistantPoints";
import {
  APPLE_SPONSOR_PRODUCTS,
  AppleIapError,
  appleAppAccountToken,
  appleIapPointsAmountCents,
  appleSponsorProduct,
  verifyAppleSponsorTransaction,
} from "../src/services/appleIap";
import { iosCommerceUnavailable } from "../src/middleware/iosCommerce";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

test("每个账号的 appAccountToken 固定，是 StoreKit 接受的 UUID，换账号就不同", () => {
  const first = appleAppAccountToken(42);
  assert.equal(first, appleAppAccountToken(42));
  assert.notEqual(first, appleAppAccountToken(43));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("iOS 赞助的 AI 点数是网页的 70%", () => {
  const six = appleSponsorProduct("cn.cputime.mobile.sponsor.6")!;
  assert.equal(six.amountCents, 600);
  assert.equal(calculateSponsorAssistantPoints(six.amountCents, 200), 1200);
  assert.equal(calculateSponsorAssistantPoints(appleIapPointsAmountCents(six.amountCents), 200), 840);
  assert.equal(appleSponsorProduct("cn.cputime.mobile.vip"), undefined);
});

test("伪造或损坏的交易原文不能记成赞助", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", x5c: ["AAAA", "BBBB", "CCCC"] })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ productId: "cn.cputime.mobile.sponsor.128", transactionId: "1" })).toString("base64url");
  await assert.rejects(verifyAppleSponsorTransaction(`${header}.${payload}.c2ln`), AppleIapError);
  await assert.rejects(verifyAppleSponsorTransaction("not-a-jws"), AppleIapError);
});

test("App 的 StoreKit 配置和服务端是同一组商品", () => {
  const storekit = JSON.parse(readFileSync(path.join(root, "ios_next/CpuTime/StoreKit/Sponsor.storekit"), "utf8"));
  const local = (storekit.products as any[]).map((product) => [product.productID, Math.round(Number(product.displayPrice) * 100)]);
  assert.deepEqual(local.sort(), APPLE_SPONSOR_PRODUCTS.map((product) => [product.productId, product.amountCents]).sort());
});

test("根证书是 Apple Root CA - G3", () => {
  const source = readFileSync(path.join(root, "server/src/services/appleIap.ts"), "utf8");
  const pem = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(source)![1].replace(/\s+/g, "");
  const fingerprint = createHash("sha256").update(Buffer.from(pem, "base64")).digest("hex").toUpperCase();
  assert.equal(fingerprint, "63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179");
});

test("iOS 客户端能读赞助墙和赞助榜，但下不了网页赞助订单", () => {
  const ua = "Mozilla/5.0 (iPhone) CPUTimeNative/1";
  const run = (method: string, p: string) => {
    let result: unknown = "unset";
    iosCommerceUnavailable({ method, path: p, headers: { "user-agent": ua } } as any, {} as any, (error?: unknown) => { result = error; });
    return result;
  };
  assert.equal(run("GET", "/wall"), undefined);
  assert.equal(run("GET", "/ranking"), undefined);
  assert.ok(run("POST", "/orders"));
  assert.ok(run("GET", "/options"));
});
