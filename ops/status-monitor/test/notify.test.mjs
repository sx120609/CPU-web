import assert from "node:assert/strict";
import test from "node:test";
import { buildPayload, createNotifier, formatMessage } from "../src/notify.mjs";

const context = { siteName: "药大拾间", publicUrl: "https://status.cputime.cn/", timezone: "Asia/Shanghai" };
const at = (hour, minute) => Date.UTC(2026, 9, 8, hour - 8, minute);
const down = (name, reason = "HTTP 502") => ({ type: "down", checkId: name, name, critical: true, reason, startedAt: at(14, 32) });
const recovered = (name) => ({ type: "recovered", checkId: name, name, startedAt: at(14, 32), resolvedAt: at(14, 38) });
const certificate = { type: "certificate", host: "cputime.cn", expiresAt: Date.UTC(2026, 10, 26, 18, 59, 59), daysLeft: 13 };

function harness(channels, respond = () => ({ status: 200, body: "{\"errcode\":0}" })) {
  const requests = [];
  const logs = [];
  const logger = {
    info: (event, fields) => logs.push({ level: "info", event, ...fields }),
    error: (event, fields) => logs.push({ level: "error", event, ...fields }),
  };
  const request = async (url, options) => {
    requests.push({ url, ...options, payload: JSON.parse(options.body) });
    return respond(requests.length);
  };
  const notifier = createNotifier({ channels, context, logger, request, delayMs: 5, sleep: async () => {} });
  return { notifier, requests, logs };
}

const channel = (overrides = {}) => ({ name: "企业微信", format: "text", url: "https://hook.example/send?key=SECRET", events: ["down", "recovered", "certificate"], token: "", ...overrides });

test("messages read like a short incident note", () => {
  assert.equal(formatMessage([down("接口服务")], context).text, "【药大拾间】接口服务中断\n接口服务：HTTP 502（14:32 起）\n状态页：https://status.cputime.cn/");
  assert.equal(formatMessage([down("接口服务"), down("论坛", "请求超时")], context).title, "【药大拾间】2 项服务中断");
  assert.equal(formatMessage([recovered("接口服务")], { ...context, publicUrl: "" }).text, "【药大拾间】接口服务已恢复\n接口服务：中断 6 分钟（14:32–14:38）");
  assert.equal(formatMessage([certificate], { ...context, publicUrl: "" }).text, "【药大拾间】证书即将到期\ncputime.cn：证书还有 13 天到期（11月27日）");
  assert.equal(formatMessage([{ type: "test", sentAt: at(9, 5) }], { ...context, publicUrl: "" }).text, "【药大拾间】通知测试\n这是一条测试消息，发送于 09:05，无需处理。");

  const degraded = { type: "degraded", checkId: "jwxt-agent", name: "教务 Agent", reason: "部分节点离线", detail: "在线 1/2 台", startedAt: at(14, 32) };
  assert.equal(formatMessage([degraded], { ...context, publicUrl: "" }).text, "【药大拾间】教务 Agent 降级\n教务 Agent：部分节点离线，在线 1/2 台（14:32 起）");
  assert.equal(
    formatMessage([{ ...recovered("教务 Agent"), kind: "degraded" }], { ...context, publicUrl: "" }).text,
    "【药大拾间】教务 Agent 已恢复\n教务 Agent：降级 6 分钟（14:32–14:38）",
  );
  assert.equal(formatMessage([degraded, down("论坛")], { ...context, publicUrl: "" }).text.split("\n")[1], "降级｜教务 Agent：部分节点离线，在线 1/2 台（14:32 起）");
  assert.equal(
    formatMessage([recovered("接口服务"), down("论坛", "请求超时")], { ...context, publicUrl: "" }).text,
    "【药大拾间】服务状态变化\n恢复｜接口服务：中断 6 分钟（14:32–14:38）\n中断｜论坛：请求超时（14:32 起）",
  );
});

test("each channel format gets the body its receiver expects", () => {
  const message = { title: "标题", text: "标题\n正文" };
  assert.deepEqual(buildPayload(channel(), message, [], context), { msgtype: "text", text: { content: "标题\n正文" } });
  assert.deepEqual(buildPayload(channel({ format: "feishu" }), message, [], context), { msg_type: "text", content: { text: "标题\n正文" } });
  assert.deepEqual(buildPayload(channel({ format: "onebot", target: { group_id: 123456789 } }), message, [], context), { group_id: 123456789, message: "标题\n正文" });
  assert.deepEqual(buildPayload(channel({ format: "generic" }), message, [down("论坛")], context), {
    title: "标题",
    text: "标题\n正文",
    site: "药大拾间",
    statusPage: "https://status.cputime.cn/",
    events: [down("论坛")],
  });
});

test("events pushed close together go out as one message per channel", async () => {
  const { notifier, requests } = harness([channel(), channel({ name: "QQ 群", format: "onebot", target: { group_id: 123456789 }, token: "t0ken", events: ["down"] })]);
  notifier.push([down("接口服务")]);
  notifier.push([down("论坛", "请求超时"), certificate]);
  notifier.push([]);
  const results = await notifier.flush();

  assert.deepEqual(results, [{ channel: "企业微信", ok: true, reason: "" }, { channel: "QQ 群", ok: true, reason: "" }]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].payload.text.content, /^【药大拾间】服务状态变化\n中断｜接口服务.*\n中断｜论坛.*\n证书｜cputime\.cn/u);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].followRedirects, false);
  assert.equal(requests[0].headers["Content-Length"], String(Buffer.byteLength(requests[0].body)));
  // 只订阅中断的渠道收不到证书提醒。
  assert.equal(requests[1].payload.message, "【药大拾间】2 项服务中断\n接口服务：HTTP 502（14:32 起）\n论坛：请求超时（14:32 起）\n状态页：https://status.cputime.cn/");
  assert.equal(requests[1].headers.Authorization, "Bearer t0ken");
  assert.equal(requests[0].headers.Authorization, undefined);
});

test("the debounce timer sends without an explicit flush", async () => {
  const { notifier, requests } = harness([channel()]);
  notifier.push([down("接口服务")]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(requests.length, 1);
});

test("server errors are retried, rejections in a 200 body are reported, and the webhook URL stays out of the logs", async () => {
  const flaky = harness([channel()], (attempt) => (attempt < 3 ? { status: 502, body: "" } : { status: 200, body: "{\"errcode\":0}" }));
  assert.deepEqual(await flaky.notifier.send([down("接口服务")]), [{ channel: "企业微信", ok: true, reason: "" }]);
  assert.equal(flaky.requests.length, 3);

  const rejected = harness([channel()], () => ({ status: 200, body: "{\"errcode\":93000,\"errmsg\":\"invalid webhook url\"}" }));
  assert.deepEqual(await rejected.notifier.send([down("接口服务")]), [{ channel: "企业微信", ok: false, reason: "invalid webhook url" }]);
  assert.equal(rejected.requests.length, 1);

  const generic = harness([channel({ format: "generic" })], () => ({ status: 200, body: "{\"code\":200}" }));
  assert.equal((await generic.notifier.send([down("接口服务")]))[0].ok, true);

  const unreachable = harness([channel()], () => {
    throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" });
  });
  assert.deepEqual(await unreachable.notifier.send([down("接口服务")]), [{ channel: "企业微信", ok: false, reason: "ECONNREFUSED" }]);
  assert.equal(unreachable.requests.length, 3);

  for (const { logs } of [flaky, rejected, unreachable]) assert.doesNotMatch(JSON.stringify(logs), /SECRET|hook\.example/u);
  assert.deepEqual(rejected.logs, [{ level: "error", event: "notify_failed", channel: "企业微信", reason: "invalid webhook url" }]);
});

test("nothing is scheduled when no channel is configured", async () => {
  const { notifier, requests } = harness([]);
  notifier.push([down("接口服务")]);
  assert.deepEqual(await notifier.flush(), undefined);
  assert.equal(requests.length, 0);
});
