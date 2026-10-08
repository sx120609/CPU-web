import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertTimezone } from "./time.mjs";

const CHECK_DEFAULTS = {
  intervalSeconds: 60,
  timeoutMs: 10000,
  slowMs: 3000,
  failureThreshold: 2,
  retryDelayMs: 3000,
};
const CHECK_LIMITS = {
  intervalSeconds: [10, 86400],
  timeoutMs: [1000, 60000],
  slowMs: [0, 60000],
  failureThreshold: [1, 10],
  retryDelayMs: [0, 30000],
};
const CHECK_TYPES = new Set(["http", "assets"]);
const NOTIFY_FORMATS = new Set(["generic", "text", "feishu", "onebot"]);
const NOTIFY_EVENTS = ["down", "recovered", "certificate"];
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;

export class ConfigError extends Error {}

function fail(message) {
  throw new ConfigError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, label, { fallback, max = 200 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    fail(`${label} 不能为空`);
  }
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (fallback !== undefined) return fallback;
    fail(`${label} 不能为空`);
  }
  if (trimmed.length > max) fail(`${label} 不能超过 ${max} 个字符`);
  return trimmed;
}

function integer(value, label, [min, max], fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} 必须是 ${min} 到 ${max} 之间的整数`);
  return value;
}

function httpUrl(value, label) {
  const raw = text(value, label, { max: 2048 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${label} 不是有效的网址：${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(`${label} 只支持 http 和 https：${raw}`);
  return parsed.href;
}

function fromEnvironment(value, variable, label, env) {
  if (value !== undefined && variable !== undefined) fail(`${label} 和 ${label}Env 只能填一个`);
  if (variable === undefined) return value;
  const name = text(variable, `${label}Env`);
  const resolved = env[name];
  if (!resolved) fail(`环境变量 ${name} 未设置（${label}Env）`);
  return resolved;
}

function normalizeTimings(raw, label, fallback) {
  const timings = {};
  for (const [key, limits] of Object.entries(CHECK_LIMITS)) {
    timings[key] = integer(raw[key], `${label}.${key}`, limits, fallback[key]);
  }
  return timings;
}

function normalizeExpect(raw, label) {
  if (raw !== undefined && !isPlainObject(raw)) fail(`${label} 必须是对象`);
  const expect = raw ?? {};
  const statuses = expect.status === undefined ? [200] : [expect.status].flat();
  for (const status of statuses) {
    if (!Number.isInteger(status) || status < 100 || status > 599) fail(`${label}.status 必须是 HTTP 状态码`);
  }
  const json = expect.json ?? {};
  if (!isPlainObject(json)) fail(`${label}.json 必须是“路径: 期望值”的对象`);
  for (const [jsonPath, expected] of Object.entries(json)) {
    if (expected !== null && !["string", "number", "boolean"].includes(typeof expected)) {
      fail(`${label}.json["${jsonPath}"] 的期望值只能是字符串、数字、布尔值或 null`);
    }
  }
  return {
    status: statuses,
    contains: expect.contains === undefined ? "" : text(expect.contains, `${label}.contains`, { max: 500 }),
    json,
  };
}

function normalizeCheck(raw, label, defaults, seenIds) {
  if (!isPlainObject(raw)) fail(`${label} 必须是对象`);
  const id = text(raw.id, `${label}.id`);
  if (!CHECK_ID.test(id)) fail(`${label}.id 只能用小写字母、数字和连字符，且以字母或数字开头：${id}`);
  if (seenIds.has(id)) fail(`检查项 id 重复：${id}`);
  seenIds.add(id);

  const type = raw.type ?? "http";
  if (!CHECK_TYPES.has(type)) fail(`${label}.type 只支持 ${[...CHECK_TYPES].join("、")}`);
  const method = raw.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") fail(`${label}.method 只支持 GET 和 HEAD`);
  if (type === "assets" && method !== "GET") fail(`${label} 是 assets 类型，必须用 GET 取回页面`);
  const headers = raw.headers ?? {};
  if (!isPlainObject(headers) || Object.values(headers).some((value) => typeof value !== "string")) {
    fail(`${label}.headers 必须是“名称: 字符串”的对象`);
  }
  const expect = normalizeExpect(raw.expect, `${label}.expect`);
  if (method === "HEAD" && (expect.contains || Object.keys(expect.json).length)) {
    fail(`${label} 用 HEAD 请求时没有响应体，不能检查 contains 或 json`);
  }

  return {
    id,
    type,
    method,
    headers,
    expect,
    name: text(raw.name, `${label}.name`, { max: 40 }),
    description: text(raw.description, `${label}.description`, { fallback: "", max: 80 }),
    url: httpUrl(raw.url, `${label}.url`),
    critical: raw.critical === true,
    followRedirects: raw.followRedirects !== false,
    failureText: text(raw.failureText, `${label}.failureText`, { fallback: "", max: 40 }),
    versionFrom: text(raw.versionFrom, `${label}.versionFrom`, { fallback: "", max: 100 }),
    ...normalizeTimings(raw, label, defaults),
  };
}

function normalizeChannel(raw, label, env) {
  if (!isPlainObject(raw)) fail(`${label} 必须是对象`);
  const format = raw.format ?? "generic";
  if (!NOTIFY_FORMATS.has(format)) fail(`${label}.format 只支持 ${[...NOTIFY_FORMATS].join("、")}`);
  const events = raw.events ?? NOTIFY_EVENTS;
  if (!Array.isArray(events) || events.some((event) => !NOTIFY_EVENTS.includes(event))) {
    fail(`${label}.events 只能包含 ${NOTIFY_EVENTS.join("、")}`);
  }
  const channel = {
    format,
    events,
    name: text(raw.name, `${label}.name`, { fallback: format, max: 40 }),
    url: httpUrl(fromEnvironment(raw.url, raw.urlEnv, `${label}.url`, env), `${label}.url`),
    token: "",
  };
  if (format === "onebot") {
    const target = raw.groupId ?? raw.userId;
    if (!/^[1-9]\d{4,19}$/u.test(String(target ?? ""))) fail(`${label} 是 onebot 格式，需要填写 groupId 或 userId`);
    if (raw.groupId !== undefined && raw.userId !== undefined) fail(`${label} 的 groupId 和 userId 只能填一个`);
    channel.target = { [raw.groupId !== undefined ? "group_id" : "user_id"]: Number(target) };
    const token = fromEnvironment(raw.token, raw.tokenEnv, `${label}.token`, env);
    channel.token = token === undefined ? "" : text(token, `${label}.token`, { max: 500 });
  }
  return channel;
}

export function normalizeConfig(raw, { baseDir = process.cwd(), env = process.env } = {}) {
  if (!isPlainObject(raw)) fail("配置文件的最外层必须是对象");

  const timezone = text(raw.timezone, "timezone", { fallback: "Asia/Shanghai" });
  try {
    assertTimezone(timezone);
  } catch {
    fail(`timezone 不是有效的时区名：${timezone}`);
  }

  const listen = raw.listen ?? {};
  if (!isPlainObject(listen)) fail("listen 必须是对象");
  const defaults = raw.defaults ?? {};
  if (!isPlainObject(defaults)) fail("defaults 必须是对象");
  const checkDefaults = normalizeTimings(defaults, "defaults", CHECK_DEFAULTS);

  if (!Array.isArray(raw.groups) || !raw.groups.length) fail("groups 至少要有一个分组");
  const seenIds = new Set();
  const groups = raw.groups.map((group, groupIndex) => {
    const label = `groups[${groupIndex}]`;
    if (!isPlainObject(group)) fail(`${label} 必须是对象`);
    if (!Array.isArray(group.checks) || !group.checks.length) fail(`${label}.checks 至少要有一个检查项`);
    return {
      name: text(group.name, `${label}.name`, { max: 40 }),
      checks: group.checks.map((check, index) => normalizeCheck(check, `${label}.checks[${index}]`, checkDefaults, seenIds)),
    };
  });

  const connectivity = raw.connectivity ?? {};
  if (!isPlainObject(connectivity)) fail("connectivity 必须是对象");
  const connectivityUrls = connectivity.urls ?? ["https://www.baidu.com/", "https://www.qq.com/"];
  if (!Array.isArray(connectivityUrls)) fail("connectivity.urls 必须是数组");

  const corsOrigins = raw.corsOrigins ?? [];
  if (!Array.isArray(corsOrigins)) fail("corsOrigins 必须是数组");

  const notify = raw.notify ?? [];
  if (!Array.isArray(notify)) fail("notify 必须是数组");

  const certificate = raw.certificate ?? {};
  if (!isPlainObject(certificate)) fail("certificate 必须是对象");

  return {
    timezone,
    groups,
    checks: groups.flatMap((group) => group.checks),
    title: text(raw.title, "title", { fallback: "药大拾间服务状态", max: 60 }),
    siteName: text(raw.siteName, "siteName", { fallback: "药大拾间", max: 30 }),
    siteUrl: httpUrl(raw.siteUrl ?? "https://cputime.cn", "siteUrl"),
    publicUrl: raw.publicUrl ? httpUrl(raw.publicUrl, "publicUrl") : "",
    listen: {
      host: text(listen.host, "listen.host", { fallback: "127.0.0.1" }),
      port: integer(listen.port, "listen.port", [0, 65535], 8787),
    },
    dataDir: path.resolve(baseDir, text(raw.dataDir, "dataDir", { fallback: "data", max: 1000 })),
    corsOrigins: corsOrigins.map((origin, index) => new URL(httpUrl(origin, `corsOrigins[${index}]`)).origin),
    connectivityUrls: connectivityUrls.map((url, index) => httpUrl(url, `connectivity.urls[${index}]`)),
    certificateWarnDays: integer(certificate.warnDays, "certificate.warnDays", [1, 60], 14),
    notify: notify.map((channel, index) => normalizeChannel(channel, `notify[${index}]`, env)),
  };
}

export async function loadConfig(configPath, env = process.env) {
  const resolved = path.resolve(configPath);
  let content;
  try {
    content = await readFile(resolved, "utf8");
  } catch (error) {
    fail(`读不到配置文件 ${resolved}：${error.code || error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    fail(`配置文件不是有效的 JSON：${error.message}`);
  }
  return { ...normalizeConfig(raw, { baseDir: path.dirname(resolved), env }), configPath: resolved };
}

export function parseArguments(argv) {
  const options = { config: "config.json", once: false, testNotify: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--once") options.once = true;
    else if (argument === "--test-notify") options.testNotify = true;
    else if (argument === "--config") {
      index += 1;
      if (!argv[index]) fail("--config 后面要跟配置文件路径");
      options.config = argv[index];
    } else if (argument.startsWith("--config=")) options.config = argument.slice("--config=".length);
    else fail(`不认识的参数：${argument}`);
  }
  if (options.once && options.testNotify) fail("--once 和 --test-notify 不能同时使用");
  return options;
}
