import test from "node:test";
import assert from "node:assert/strict";
import {
  amountCentsToMoney,
  buildEpayCheckoutPage,
  moneyToAmountCents,
  signEpayParams,
  verifyEpayParams,
} from "../src/services/epay";
import { calculateMarketOrderAmounts } from "../src/services/marketFinance";

test("market EasyPay callbacks use deterministic signing and reject tampering", () => {
  const key = "market-test-merchant-key";
  const params: Record<string, string> = {
    pid: "10001",
    out_trade_no: "MKT202607120001",
    trade_no: "EPAY-1001",
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    money: "12.34",
    param: "market:42",
  };
  params.sign = signEpayParams(params, key);
  params.sign_type = "MD5";
  assert.equal(verifyEpayParams(params, key), true);
  assert.equal(verifyEpayParams({ ...params, money: "0.01" }, key), false);
  assert.equal(verifyEpayParams({ ...params, out_trade_no: "OTHER" }, key), false);
});

test("market payment amounts round-trip in integer cents", () => {
  assert.equal(moneyToAmountCents("12.34"), 1234);
  assert.equal(moneyToAmountCents(0.01), 1);
  assert.equal(amountCentsToMoney(1234), "12.34");
  assert.throws(() => moneyToAmountCents("0"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("not-a-number"), /支付金额不正确/);
});

test("market commission is locked in integer cents for each order", () => {
  assert.deepEqual(calculateMarketOrderAmounts(10_000, 500), {
    amountCents: 10_000,
    commissionBps: 500,
    platformFeeCents: 500,
    sellerAmountCents: 9_500,
  });
  assert.equal(calculateMarketOrderAmounts(1, 500).sellerAmountCents, 1);
  assert.equal(calculateMarketOrderAmounts(10_000, 0).platformFeeCents, 0);
  assert.equal(calculateMarketOrderAmounts(10_000, 90_000).platformFeeCents, 5_000);
});

test("EasyPay checkout page only permits the configured gateway form target", () => {
  const page = buildEpayCheckoutPage({
    submitUrl: "https://pay.example.test/submit.php",
    method: "POST",
    params: {
      pid: "10001",
      out_trade_no: "SP-TEST-1",
      message: "\"><script>alert(1)</script>",
    },
  }, {
    fallbackUrl: "/profile",
    title: "Checkout",
  });

  assert.equal(
    page.contentSecurityPolicy.split("; ").find((item) => item.startsWith("form-action ")),
    "form-action https://pay.example.test",
  );
  const nonce = page.contentSecurityPolicy.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(page.html, new RegExp(`<script nonce="${nonce}"`));
  assert.match(page.html, /method="post" action="https:\/\/pay\.example\.test\/submit\.php"/);
  assert.match(page.html, /name="out_trade_no" value="SP-TEST-1"/);
  assert.ok(page.html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.doesNotMatch(page.html, /value=""><script>alert/);
});
