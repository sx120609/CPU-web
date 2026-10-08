import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import zlib from "node:zlib";
import { normalizeConfig } from "../src/config.mjs";
import { escapeHtml, formatUptime, renderPage } from "../src/page.mjs";
import { httpRequest } from "../src/probe.mjs";
import { createStatusServer } from "../src/server.mjs";
import { applySample, createState, recordCertificates } from "../src/state.mjs";
import { buildView } from "../src/view.mjs";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 8, 6, 32, 5); // 北京时间 2026-10-08 14:32:05
const up = { outcome: "up", elapsedMs: 120, reason: "" };
const down = { outcome: "down", elapsedMs: 10000, reason: "HTTP 502" };

function fixture() {
  const config = normalizeConfig({
    corsOrigins: ["https://cputime.cn"],
    groups: [
      { name: "主站", checks: [
        { id: "web", name: "网站首页", url: "https://cputime.cn/", critical: true },
        { id: "forum", name: "论坛 <b>&", description: "板块列表", url: "https://cputime.cn/api/boards" },
      ] },
      { name: "子系统", checks: [{ id: "voicehub", name: "药苑之声", url: "https://cputime.cn/voicehub/" }] },
    ],
  });
  const state = createState();
  const sample = (id, outcome, now) => applySample(state, config.checks.find((check) => check.id === id), outcome, { now, timezone: config.timezone });
  return { config, state, sample };
}

test("the view summarises current status, 90 days of history, incidents and certificates", () => {
  const { config, state, sample } = fixture();
  // 论坛三天前中断 6 分钟后恢复；首页一直正常；药苑之声从未探测过。
  for (let minute = 0; minute < 40; minute += 1) sample("forum", minute >= 10 && minute < 16 ? down : up, NOW - 3 * DAY + minute * MINUTE);
  sample("forum", up, NOW - MINUTE);
  sample("web", up, NOW - MINUTE);
  state.release = { value: "d42fb307258d29cfc68fb750cc750a2668680a4c", seenAt: NOW };
  recordCertificates(state, [{ host: "cputime.cn", expiresAt: NOW + 50 * DAY + MINUTE }, { host: "static.cputime.cn", expiresAt: NOW + 9 * DAY + MINUTE }], { now: NOW, warnDays: 14 });

  const view = buildView(state, config, NOW);
  assert.deepEqual(view.overall, { status: "up", label: "所有服务运行正常" });
  assert.equal(view.updatedAt, NOW - MINUTE);

  const [web, forum] = view.groups[0].checks;
  assert.equal(web.status, "up");
  assert.equal(web.responseMs, 120);
  assert.equal(web.uptime, 1);
  assert.equal(forum.days.length, 90);
  assert.deepEqual(forum.days.at(-1), { date: "2026-10-08", level: "up", uptime: 1, failed: 0, total: 1 });
  assert.deepEqual(forum.days.at(-4), { date: "2026-10-05", level: "down", uptime: 34 / 40, failed: 6, total: 40 });
  assert.equal(forum.days.at(-2).level, "none");
  assert.equal(forum.uptime, 35 / 41);
  assert.equal(view.groups[1].checks[0].status, "unknown");

  assert.deepEqual(view.incidents, [{ name: "论坛 <b>&", reason: "HTTP 502", startedAt: NOW - 3 * DAY + 10 * MINUTE, resolvedAt: NOW - 3 * DAY + 16 * MINUTE, durationMs: 6 * MINUTE }]);
  assert.deepEqual(view.certificates.map(({ host, daysLeft, level }) => [host, daysLeft, level]), [["static.cputime.cn", 9, "partial"], ["cputime.cn", 50, "up"]]);
  assert.doesNotMatch(JSON.stringify(view), /api\/boards|voicehub\//u);
});

test("the overall headline reflects how serious the worst open problem is", () => {
  const { config, state, sample } = fixture();
  const headline = () => buildView(state, config, NOW).overall.label;
  assert.equal(headline(), "暂无监测数据");

  for (const id of ["web", "forum", "voicehub"]) sample(id, up, NOW - 3 * MINUTE);
  for (const minute of [2, 1]) sample("forum", down, NOW - minute * MINUTE);
  assert.equal(headline(), "部分服务异常");
  for (const minute of [2, 1]) sample("web", down, NOW - minute * MINUTE);
  assert.equal(headline(), "主要服务中断");

  // 监控停了一阵再回来时，旧状态不再当作现状。
  const later = buildView(state, config, NOW + 2 * 60 * MINUTE);
  assert.deepEqual(later.groups[0].checks.map((check) => check.status), ["unknown", "unknown"]);
  assert.equal(later.incidents.length, 2);
});

test("the page escapes everything it prints and matches its own content security policy", async (context) => {
  const { config, state, sample } = fixture();
  for (const minute of [3, 2, 1]) sample("forum", down, NOW - minute * MINUTE);
  sample("web", up, NOW - MINUTE);
  const html = renderPage(buildView(state, config, NOW));

  assert.match(html, /<title>部分服务异常 · 药大拾间服务状态<\/title>/u);
  assert.match(html, /论坛 &lt;b&gt;&amp;<span>板块列表<\/span>/u);
  assert.doesNotMatch(html, /论坛 <b>/u);
  assert.match(html, /<p class="reason">HTTP 502 · 10月8日 14:29 起<\/p>/u);
  assert.match(html, /<span class="tag">进行中<\/span>/u);
  assert.match(html, /更新于 10月8日 14:31:05/u);
  assert.equal(html.match(/<i class="b /gu).length, 3 * 90);
  assert.match(html, /data-tip="10月8日 · 可用率 0\.00%，3 次探测失败"/u);
  assert.doesNotMatch(html, / style="/u);

  const server = createStatusServer({ config, state, monitor: { revision: () => 1 }, logger: { error: () => {} }, now: () => NOW });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await httpRequest(`http://127.0.0.1:${server.address().port}/`);
  const policy = response.headers["content-security-policy"];
  const hashOf = (tag) => `'sha256-${createHash("sha256").update(response.body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u"))[1]).digest("base64")}'`;
  assert.ok(policy.includes(`style-src ${hashOf("style")}`));
  assert.ok(policy.includes(`script-src ${hashOf("script")}`));
  assert.ok(policy.startsWith("default-src 'none'"));
});

test("uptime never rounds a day with failures up to 100%", () => {
  assert.equal(formatUptime(1), "100%");
  assert.equal(formatUptime(0.99999), "99.99%");
  assert.equal(formatUptime(1439 / 1440), "99.93%");
  assert.equal(formatUptime(null), "暂无数据");
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("the HTTP server serves the page, the JSON API and a health probe, and nothing else", async (context) => {
  const { config, state, sample } = fixture();
  sample("web", up, NOW - MINUTE);
  let clock = NOW;
  const server = createStatusServer({ config, state, monitor: { revision: () => 1 }, logger: { error: () => {} }, now: () => clock });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const page = await httpRequest(`${origin}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(page.headers["content-encoding"], "gzip");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.match(page.body, /所有服务运行正常|暂无监测数据/u);

  const plain = await httpRequest(`${origin}/`, { headers: { "Accept-Encoding": "identity" } });
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.equal(plain.body, page.body);

  const api = await httpRequest(`${origin}/api/status`, { headers: { Origin: "https://cputime.cn" } });
  assert.equal(api.headers["access-control-allow-origin"], "https://cputime.cn");
  const payload = JSON.parse(api.body);
  assert.equal(payload.groups[0].checks[0].status, "up");
  assert.equal(payload.generatedAt, NOW);
  const foreign = await httpRequest(`${origin}/api/status`, { headers: { Origin: "https://evil.example" } });
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);

  const head = await httpRequest(`${origin}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), zlib.gzipSync(Buffer.from(page.body)).length);

  assert.equal((await httpRequest(`${origin}/admin`)).status, 404);
  assert.equal((await httpRequest(`${origin}/../state.json`)).status, 404);
  const post = await httpRequest(`${origin}/`, { method: "POST", body: "{}" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");

  assert.equal((await httpRequest(`${origin}/healthz`)).status, 200);
  clock = NOW + 30 * MINUTE;
  const stalled = await httpRequest(`${origin}/healthz`);
  assert.equal(stalled.status, 503);
  assert.deepEqual(JSON.parse(stalled.body), { ok: false, lastSampleAt: NOW - MINUTE });
});
