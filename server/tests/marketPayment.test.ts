import test from "node:test";
import assert from "node:assert/strict";
import {
  amountCentsToMoney,
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

const checkoutPayload = {
  submitUrl: "https://api.kaipay.cn/epay/submit.php",
  method: "POST" as const,
  params: {
    pid: "10001",
    out_trade_no: "SP-TEST-1",
    money: "0.01",
    sign: "signed",
    sign_type: "MD5",
  },
};

test("EasyPay server relay extracts a trusted checkout from an HTML response", async () => {
  const result = await submitEpayCheckout(checkoutPayload, {
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "manual");
      assert.equal(String(init?.body), "pid=10001&out_trade_no=SP-TEST-1&money=0.01&sign=signed&sign_type=MD5");
      return new Response(`<!doctype html><html><head>
        <meta http-equiv="refresh" content="0;url=https://pay.kaipay.cn/checkout/cs_test?method=alipay">
      </head></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    redirectUrl: "https://pay.kaipay.cn/checkout/cs_test?method=alipay",
  });
});

test("EasyPay server relay accepts a trusted manual redirect", async () => {
  const result = await submitEpayCheckout(checkoutPayload, {
    fetchImpl: async () => new Response(null, {
      status: 303,
      headers: { location: "https://pay.kaipay.cn/checkout/cs_redirect" },
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    redirectUrl: "https://pay.kaipay.cn/checkout/cs_redirect",
  });
});

test("EasyPay server relay rejects an untrusted checkout host", async () => {
  const result = await submitEpayCheckout(checkoutPayload, {
    fetchImpl: async () => new Response(`<!doctype html><script>
      window.location.href="https://evil.example/collect";
    </script>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    message: "支付平台返回了无法识别的收银台页面",
    upstreamStatus: 200,
  });
});

test("EasyPay server relay does not expose upstream markup in errors", async () => {
  const result = await submitEpayCheckout(checkoutPayload, {
    fetchImpl: async () => new Response(`<!doctype html><style>body{}</style>
      <script>alert(1)</script><p>签名验证失败</p>`, {
      status: 400,
      headers: { "content-type": "text/html" },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    message: "签名验证失败",
    upstreamStatus: 400,
  });
});

test("EasyPay server relay requires an HTTPS gateway", async () => {
  await assert.rejects(() => submitEpayCheckout({
    submitUrl: "http://pay.example.test/submit.php",
    method: "POST",
    params: {},
  }), /必须使用 HTTPS/);
});
