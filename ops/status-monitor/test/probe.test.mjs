import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import zlib from "node:zlib";
import { normalizeConfig } from "../src/config.mjs";
import { createConnectivityGuard, extractAssets, getPath, httpRequest, runCheck } from "../src/probe.mjs";

const PAGE = `<!doctype html><html><head>
<script src="/boot.js?v=1"></script>
<link href="/assets/app.css" rel="stylesheet" crossorigin>
<link rel='modulepreload' href='/assets/vendor.js'>
<link rel="icon" href="/favicon.svg">
<script type="module" src="/assets/app.js"></script>
<script>inline()</script>
</head><body><div id="app"></div></body></html>`;

async function startServer(context, routes) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, headers: request.headers });
    const handler = routes[request.url.split("?")[0]];
    if (handler) handler(request, response);
    else response.writeHead(404).end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return { requests, origin: `http://127.0.0.1:${server.address().port}` };
}

const reply = (status, headers, body) => (_request, response) => response.writeHead(status, headers).end(body);
const json = (value, status = 200) => reply(status, { "Content-Type": "application/json" }, JSON.stringify(value));

function checkOf(origin, overrides) {
  const config = normalizeConfig({
    defaults: { timeoutMs: 1000, retryDelayMs: 0 },
    groups: [{ name: "g", checks: [{ id: "c", name: "检查", url: `${origin}/`, ...overrides, ...(overrides.path ? { url: `${origin}${overrides.path}` } : {}) }] }],
  });
  return config.checks[0];
}

test("a JSON expectation passes on matching values and reports the failing path otherwise", async (context) => {
  const { origin, requests } = await startServer(context, {
    "/ready": json({ code: 0, data: { ready: true, commit: "d42fb307258d29cfc68fb750cc750a2668680a4c", qqbot: { connected: false } } }),
  });

  const ready = await runCheck(checkOf(origin, { path: "/ready", expect: { json: { "data.ready": true } }, versionFrom: "data.commit" }));
  assert.equal(ready.outcome, "up");
  assert.equal(ready.httpStatus, 200);
  assert.equal(ready.version, "d42fb307258d29cfc68fb750cc750a2668680a4c");
  assert.match(requests[0].headers["user-agent"], /^CPUTimeStatusMonitor\//u);

  const bot = await runCheck(checkOf(origin, { path: "/ready", expect: { json: { "data.qqbot.connected": true } } }));
  assert.equal(bot.outcome, "down");
  assert.equal(bot.reason, "检查未通过（data.qqbot.connected）");

  const named = await runCheck(checkOf(origin, { path: "/ready", expect: { json: { "data.qqbot.connected": true } }, failureText: "机器人未连接" }));
  assert.equal(named.reason, "机器人未连接");
});

test("unexpected status codes, missing text and non-JSON bodies are failures with public reasons", async (context) => {
  const { origin } = await startServer(context, {
    "/bad-gateway": reply(502, {}, "upstream"),
    "/page": reply(200, { "Content-Type": "text/html" }, "<h1>维护中</h1>"),
    "/unready": json({ code: 5030, data: { ready: false } }, 503),
  });

  assert.equal((await runCheck(checkOf(origin, { path: "/bad-gateway" }))).reason, "HTTP 502");
  assert.equal((await runCheck(checkOf(origin, { path: "/page", expect: { contains: 'id="app"' } }))).reason, "页面内容异常");
  assert.equal((await runCheck(checkOf(origin, { path: "/page", expect: { json: { code: 0 } } }))).reason, "返回内容不是 JSON");

  const unready = checkOf(origin, { path: "/unready", expect: { status: [200, 503], json: { "data.ready": true } }, failureText: "就绪检查未通过" });
  assert.equal((await runCheck(unready)).reason, "就绪检查未通过");
});

test("compressed bodies are decoded and redirects are followed within one time budget", async (context) => {
  const { origin } = await startServer(context, {
    "/old": reply(301, { Location: "/gzip" }, ""),
    "/gzip": reply(200, { "Content-Encoding": "gzip" }, zlib.gzipSync("药苑之声 gzip")),
    "/br": reply(200, { "Content-Encoding": "br" }, zlib.brotliCompressSync("药苑之声 br")),
    "/loop": reply(302, { Location: "/loop" }, ""),
  });

  const followed = await httpRequest(`${origin}/old`);
  assert.equal(followed.status, 200);
  assert.equal(followed.body, "药苑之声 gzip");
  assert.equal(followed.url, `${origin}/gzip`);
  assert.equal((await httpRequest(`${origin}/br`)).body, "药苑之声 br");
  assert.equal((await httpRequest(`${origin}/old`, { followRedirects: false })).status, 301);
  await assert.rejects(httpRequest(`${origin}/loop`), { reason: "重定向次数过多" });
});

test("timeouts, refused connections and oversized bodies become failures instead of exceptions", async (context) => {
  const { origin } = await startServer(context, {
    "/hang": () => {},
    "/huge": reply(200, {}, Buffer.alloc(64 * 1024, "a")),
  });

  const timedOut = await runCheck(checkOf(origin, { path: "/hang", timeoutMs: 1000 }));
  assert.equal(timedOut.outcome, "down");
  assert.equal(timedOut.reason, "请求超时");
  assert.ok(timedOut.elapsedMs >= 900 && timedOut.elapsedMs < 3000);

  await assert.rejects(httpRequest(`${origin}/huge`, { maxBodyBytes: 1024 }), { reason: "响应内容过大" });
  assert.equal((await httpRequest(`${origin}/huge`, { maxBodyBytes: 1024, headersOnly: true })).status, 200);
  assert.equal((await runCheck(checkOf("http://127.0.0.1:1", {}))).reason, "连接被拒绝");
});

test("a response slower than slowMs is reported as slow, not down", async (context) => {
  const { origin } = await startServer(context, {
    "/slow": (_request, response) => setTimeout(() => response.end("ok"), 150),
  });
  const sample = await runCheck(checkOf(origin, { path: "/slow", slowMs: 100 }));
  assert.equal(sample.outcome, "slow");
  assert.equal(sample.reason, "");
});

test("asset extraction keeps scripts, stylesheets and module preloads, resolved against the page", () => {
  assert.deepEqual(extractAssets(PAGE, "https://cputime.cn/"), [
    { kind: "script", url: "https://cputime.cn/boot.js?v=1" },
    { kind: "script", url: "https://cputime.cn/assets/app.js" },
    { kind: "style", url: "https://cputime.cn/assets/app.css" },
    { kind: "script", url: "https://cputime.cn/assets/vendor.js" },
  ]);
  assert.deepEqual(extractAssets('<script src="javascript:void(0)"></script><link rel="stylesheet" href="https://static.cputime.cn/a.css">', "https://cputime.cn/"), [
    { kind: "style", url: "https://static.cputime.cn/a.css" },
  ]);
});

test("an assets check verifies every referenced file and names the broken one", async (context) => {
  const javascript = reply(200, { "Content-Type": "application/javascript; charset=utf-8", "Content-Encoding": "gzip" }, zlib.gzipSync("export {}"));
  const routes = {
    "/": reply(200, { "Content-Type": "text/html" }, PAGE),
    "/boot.js": javascript,
    "/assets/app.js": javascript,
    "/assets/vendor.js": javascript,
    "/assets/app.css": reply(200, { "Content-Type": "text/css" }, "body{}"),
  };
  const { origin, requests } = await startServer(context, routes);
  const check = checkOf(origin, { type: "assets" });

  assert.equal((await runCheck(check)).outcome, "up");
  assert.deepEqual(requests.map((request) => request.url).sort(), ["/", "/assets/app.css", "/assets/app.js", "/assets/vendor.js", "/boot.js?v=1"]);

  // 部署出错的典型现象：哈希文件名不存在，入口把请求回退成了 HTML。
  routes["/assets/app.js"] = reply(200, { "Content-Type": "text/html" }, PAGE);
  assert.equal((await runCheck(check)).reason, "资源加载失败：app.js（类型不对）");
  delete routes["/assets/app.css"];
  assert.equal((await runCheck(check)).reason, "资源加载失败：app.js（类型不对） 等 2 个");

  routes["/"] = reply(200, { "Content-Type": "text/html" }, "<html><body>empty</body></html>");
  assert.equal((await runCheck(check)).reason, "页面没有引用脚本或样式");
});

test("getPath only walks own properties", () => {
  assert.equal(getPath({ data: { qqbot: { connected: true } } }, "data.qqbot.connected"), true);
  assert.equal(getPath({ data: null }, "data.ready"), undefined);
  assert.equal(getPath({}, "constructor.name"), undefined);
});

test("the connectivity guard is online when any reference answers, and caches its verdict", async () => {
  let clock = 0;
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.includes("down")) throw new Error("offline");
    return { status: 403 };
  };

  const online = createConnectivityGuard({ urls: ["https://down.example/", "https://up.example/"], request, now: () => clock });
  assert.equal(await online.isOnline(), true);
  assert.equal(await online.isOnline(), true);
  assert.equal(calls.length, 2);
  clock = 31000;
  await online.isOnline();
  assert.equal(calls.length, 4);

  assert.equal(await createConnectivityGuard({ urls: ["https://down.example/"], request }).isOnline(), false);
  assert.equal(await createConnectivityGuard({ urls: [], request }).isOnline(), true);
});
