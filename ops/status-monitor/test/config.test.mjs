import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, normalizeConfig, parseArguments } from "../src/config.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(directory, "../config.example.json");
const minimal = (check = {}, extra = {}) => ({
  groups: [{ name: "主站", checks: [{ id: "web", name: "网站首页", url: "https://cputime.cn/", ...check }] }],
  ...extra,
});

test("the example config is valid and resolves the data directory next to the config file", async () => {
  const config = await loadConfig(examplePath);
  assert.equal(config.dataDir, path.join(path.dirname(examplePath), "data"));
  assert.equal(config.listen.host, "127.0.0.1");
  assert.deepEqual(config.corsOrigins, ["https://cputime.cn"]);
  assert.equal(config.checks.length, new Set(config.checks.map((check) => check.id)).size);
  assert.deepEqual(config.checks.filter((check) => check.critical).map((check) => check.id), ["web", "api", "ready"]);
  assert.equal(config.checks.find((check) => check.id === "assets").type, "assets");
});

test("checks inherit defaults and can override them one by one", () => {
  const config = normalizeConfig(minimal({ timeoutMs: 5000 }, { defaults: { intervalSeconds: 120 } }));
  const [check] = config.checks;
  assert.equal(check.intervalSeconds, 120);
  assert.equal(check.timeoutMs, 5000);
  assert.equal(check.failureThreshold, 2);
  assert.deepEqual(check.expect, { status: [200], contains: "", json: {} });
  assert.equal(config.timezone, "Asia/Shanghai");
  assert.equal(config.siteUrl, "https://cputime.cn/");
  assert.deepEqual(config.notify, []);
});

test("mistakes are rejected with a message that names the field", () => {
  const rejects = (raw, pattern) => assert.throws(() => normalizeConfig(raw), (error) => error instanceof ConfigError && pattern.test(error.message));
  rejects({}, /groups/u);
  rejects(minimal({ id: "Web" }), /checks\[0\]\.id/u);
  rejects(minimal({ url: "ftp://cputime.cn/" }), /只支持 http 和 https/u);
  rejects(minimal({ timeoutMs: 10 }), /timeoutMs 必须是 1000 到 60000/u);
  rejects(minimal({ type: "tcp" }), /type/u);
  rejects(minimal({ method: "HEAD", expect: { contains: "x" } }), /HEAD/u);
  rejects(minimal({ expect: { json: { "data.ok": {} } } }), /期望值/u);
  rejects(minimal({}, { timezone: "Mars/Olympus" }), /timezone/u);
  rejects({ groups: [{ name: "a", checks: [minimal().groups[0].checks[0], minimal().groups[0].checks[0]] }] }, /id 重复：web/u);
});

test("notification secrets can come from the environment and are required when referenced", () => {
  const withChannel = (channel) => minimal({}, { notify: [channel] });
  const env = { STATUS_NOTIFY_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret", BOT_TOKEN: "t0ken" };

  const [wecom] = normalizeConfig(withChannel({ format: "text", urlEnv: "STATUS_NOTIFY_URL" }), { env }).notify;
  assert.equal(wecom.url, env.STATUS_NOTIFY_URL);
  assert.equal(wecom.name, "text");
  assert.deepEqual(wecom.events, ["down", "recovered", "certificate"]);

  const [qq] = normalizeConfig(withChannel({ name: "QQ 群", format: "onebot", url: "http://127.0.0.1:3000/send_group_msg", groupId: "123456789", tokenEnv: "BOT_TOKEN" }), { env }).notify;
  assert.deepEqual(qq.target, { group_id: 123456789 });
  assert.equal(qq.token, "t0ken");

  assert.throws(() => normalizeConfig(withChannel({ format: "text", urlEnv: "MISSING" }), { env }), /环境变量 MISSING 未设置/u);
  assert.throws(() => normalizeConfig(withChannel({ format: "text", url: "https://a.example/", urlEnv: "STATUS_NOTIFY_URL" }), { env }), /只能填一个/u);
  assert.throws(() => normalizeConfig(withChannel({ format: "onebot", url: "http://127.0.0.1:3000/send_group_msg" }), { env }), /groupId 或 userId/u);
  assert.throws(() => normalizeConfig(withChannel({ format: "slack", url: "https://a.example/" }), { env }), /format/u);
});

test("the example config never carries a notification secret", async () => {
  const example = JSON.parse(await readFile(examplePath, "utf8"));
  assert.deepEqual(example.notify, []);
});

test("command-line arguments", () => {
  assert.deepEqual(parseArguments([]), { config: "config.json", once: false, testNotify: false, help: false });
  assert.deepEqual(parseArguments(["--config", "/etc/status.json", "--once"]), { config: "/etc/status.json", once: true, testNotify: false, help: false });
  assert.equal(parseArguments(["--config=a.json"]).config, "a.json");
  assert.throws(() => parseArguments(["--once", "--test-notify"]), ConfigError);
  assert.throws(() => parseArguments(["--verbose"]), /不认识的参数/u);
});
