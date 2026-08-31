import test from "node:test";
import assert from "node:assert/strict";
import {
  amountCentsToMoney,
  buildEpayCheckoutErrorPage,
  moneyToAmountCents,
  signEpayParams,
  submitEpayCheckout,
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

const epayFixture = {
  submitUrl: "https://pay.example.test/submit.php",
  method: "POST" as const,
  params: {
    pid: "10001",
    out_trade_no: "SP-TEST-1",
  },
};

test("EasyPay checkout is submitted by the server and returns a safe checkout redirect", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(String(init?.body), "pid=10001&out_trade_no=SP-TEST-1");
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { Location: "https://checkout.example.test/session/123" },
      });
    },
  });
  assert.deepEqual(result, {
    ok: true,
    redirectUrl: "https://checkout.example.test/session/123",
  });
});

test("EasyPay checkout accepts the legacy HTTP 200 HTML redirect page", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async () => new Response(`<!DOCTYPE html>
      <html><head><title>正在跳转</title></head><body>
      <script>window.location.replace('/pay/qrcode/2026083119110679226/');</script>
      </body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    }),
  });
  assert.deepEqual(result, {
    ok: true,
    redirectUrl: "https://pay.example.test/pay/qrcode/2026083119110679226/",
  });
});

test("EasyPay checkout does not expose an unrecognized HTML response as an error message", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async () => new Response(`<!DOCTYPE html><html><body><h1>等待支付</h1></body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  });
  assert.deepEqual(result, {
    ok: false,
    message: "支付平台返回了无法识别的收银台页面",
    upstreamStatus: 200,
  });
});

test("EasyPay checkout surfaces a bounded plain-text gateway failure", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async () => new Response(
      `创建订单失败：当前无可用支付通道\n${"x".repeat(500)}`,
      { status: 400 },
    ),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.upstreamStatus, 400);
  assert.match(result.message, /^创建订单失败：当前无可用支付通道 x+/);
  assert.equal(result.message.length, 300);
});

test("EasyPay checkout strips markup from gateway failure messages", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async () => new Response(
      `<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><h1>创建订单失败</h1><script>alert(1)</script></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    ),
  });
  assert.deepEqual(result, {
    ok: false,
    message: "创建订单失败",
    upstreamStatus: 400,
  });
});

test("EasyPay checkout rejects an insecure upstream redirect", async () => {
  const result = await submitEpayCheckout(epayFixture, {
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { Location: "http://checkout.example.test/session/123" },
    }),
  });
  assert.deepEqual(result, {
    ok: false,
    message: "支付平台返回了不安全的收银台地址",
    upstreamStatus: 302,
  });
});

test("EasyPay failure page escapes gateway messages and has no executable script", () => {
  const page = buildEpayCheckoutErrorPage(`失败：\"><script>alert(1)</script>`, {
    fallbackUrl: "/profile",
    title: "支付失败",
  });

  assert.match(page.contentSecurityPolicy, /default-src 'none'/);
  assert.match(page.contentSecurityPolicy, /form-action 'none'/);
  assert.ok(page.html.includes("失败：&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.doesNotMatch(page.html, /<script/);
});
