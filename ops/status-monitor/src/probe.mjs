import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const USER_AGENT = "CPUTimeStatusMonitor/1.0 (+https://cputime.cn)";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_ASSETS = 16;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const NETWORK_REASONS = {
  ENOTFOUND: "域名解析失败",
  EAI_AGAIN: "域名解析失败",
  ECONNREFUSED: "连接被拒绝",
  ECONNRESET: "连接被重置",
  EPIPE: "连接被重置",
  ETIMEDOUT: "连接超时",
  EHOSTUNREACH: "无法连接服务器",
  ENETUNREACH: "无法连接服务器",
  CERT_HAS_EXPIRED: "证书已过期",
  CERT_NOT_YET_VALID: "证书无效",
  ERR_TLS_CERT_ALTNAME_INVALID: "证书无效",
  DEPTH_ZERO_SELF_SIGNED_CERT: "证书无效",
  SELF_SIGNED_CERT_IN_CHAIN: "证书无效",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "证书无效",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "证书无效",
  EPROTO: "TLS 握手失败",
};

// reason 会原样显示在公开的状态页和告警里，只放不含内部细节的简短说明。
export class ProbeError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function describeError(error) {
  if (error instanceof ProbeError) return error.reason;
  const code = String(error?.code ?? "");
  if (NETWORK_REASONS[code]) return NETWORK_REASONS[code];
  if (code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS")) return "TLS 握手失败";
  if (/socket hang up|aborted/iu.test(String(error?.message ?? ""))) return "连接被重置";
  return "请求失败";
}

function readCertificate(target, socket) {
  if (target.protocol !== "https:" || typeof socket?.getPeerCertificate !== "function") return null;
  const expiresAt = Date.parse(socket.getPeerCertificate()?.valid_to ?? "");
  return Number.isFinite(expiresAt) ? { host: target.hostname, expiresAt } : null;
}

function requestOnce(target, { method, headers, body, headersOnly, maxBodyBytes }, remainingMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    // 每次都新建连接：既能读到完整握手后的证书，也和新访客的首次访问一致。
    const request = (target.protocol === "https:" ? https : http).request(target, { method, headers, agent: false }, (response) => {
      const head = {
        status: response.statusCode,
        headers: response.headers,
        certificate: readCertificate(target, response.socket),
      };
      if (headersOnly || method === "HEAD") {
        settle(resolve, { ...head, body: Buffer.alloc(0) });
        request.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          settle(reject, new ProbeError("响应内容过大"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => settle(resolve, { ...head, body: Buffer.concat(chunks) }));
      response.on("error", (error) => settle(reject, error));
      response.on("close", () => settle(reject, new ProbeError("连接被重置")));
    });
    timer = setTimeout(() => {
      settle(reject, new ProbeError("请求超时"));
      request.destroy();
    }, remainingMs);
    request.on("error", (error) => settle(reject, error));
    request.end(body);
  });
}

function decodeBody(buffer, headers) {
  const encoding = String(headers["content-encoding"] ?? "").trim().toLowerCase();
  if (!encoding || encoding === "identity") return buffer;
  const options = { maxOutputLength: MAX_DECODED_BYTES };
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return zlib.gunzipSync(buffer, options);
    if (encoding === "deflate") return zlib.inflateSync(buffer, options);
    if (encoding === "br") return zlib.brotliDecompressSync(buffer, options);
  } catch {
    throw new ProbeError("响应内容无法解码");
  }
  throw new ProbeError("响应内容无法解码");
}

/**
 * 发一次 HTTP(S) 请求，timeoutMs 覆盖解析、连接、握手、跳转和读取响应体的全过程。
 * headersOnly 为真时拿到响应头就断开，用来确认大文件可取而不下载它。
 */
export async function httpRequest(url, {
  method = "GET",
  headers = {},
  body,
  timeoutMs = 10000,
  headersOnly = false,
  followRedirects = true,
  maxBodyBytes = MAX_BODY_BYTES,
} = {}) {
  const startedAt = performance.now();
  const certificates = [];
  let target = new URL(url);
  for (let hop = 0; ; hop += 1) {
    const remainingMs = timeoutMs - (performance.now() - startedAt);
    if (remainingMs <= 0) throw new ProbeError("请求超时");
    const response = await requestOnce(target, {
      method,
      body,
      headersOnly,
      maxBodyBytes,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Encoding": "gzip, deflate, br", ...headers },
    }, remainingMs);
    if (response.certificate) certificates.push(response.certificate);

    if (followRedirects && REDIRECT_STATUSES.has(response.status) && response.headers.location) {
      if (hop >= MAX_REDIRECTS) throw new ProbeError("重定向次数过多");
      let next;
      try {
        next = new URL(response.headers.location, target);
      } catch {
        throw new ProbeError("重定向目标无效");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") throw new ProbeError("重定向目标无效");
      target = next;
      continue;
    }

    return {
      certificates,
      status: response.status,
      headers: response.headers,
      url: target.href,
      // headersOnly 和 HEAD 没有响应体，带着 Content-Encoding 也不能去解压。
      body: response.body.length ? decodeBody(response.body, response.headers).toString("utf8") : "",
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}

export function getPath(value, path) {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return attributes;
}

// 找出页面首屏依赖的脚本和样式：<script src>、<link rel="stylesheet">、<link rel="modulepreload">。
export function extractAssets(html, baseUrl) {
  const assets = new Map();
  const add = (reference, kind) => {
    if (!reference) return;
    let resolved;
    try {
      resolved = new URL(reference, baseUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (!assets.has(resolved.href)) assets.set(resolved.href, { kind, url: resolved.href });
  };
  for (const [tag] of html.matchAll(/<script\b[^>]*>/giu)) add(parseAttributes(tag).src, "script");
  for (const [tag] of html.matchAll(/<link\b[^>]*>/giu)) {
    const attributes = parseAttributes(tag);
    const relations = String(attributes.rel ?? "").toLowerCase().split(/\s+/u);
    if (relations.includes("stylesheet")) add(attributes.href, "style");
    else if (relations.includes("modulepreload")) add(attributes.href, "script");
  }
  return [...assets.values()].slice(0, MAX_ASSETS);
}

const ASSET_TYPES = { script: /javascript|ecmascript/iu, style: /css/iu };

async function findBrokenAsset(asset, check, request, certificates) {
  const name = decodeURIComponent(new URL(asset.url).pathname.split("/").pop() || asset.url).slice(0, 60);
  try {
    const response = await request(asset.url, { headersOnly: true, timeoutMs: check.timeoutMs });
    certificates.push(...response.certificates);
    if (response.status !== 200) return `${name}（HTTP ${response.status}）`;
    if (!ASSET_TYPES[asset.kind].test(String(response.headers["content-type"] ?? ""))) return `${name}（类型不对）`;
    return null;
  } catch (error) {
    return `${name}（${describeError(error)}）`;
  }
}

const MISSING_DATA = "未取得状态数据";

// 逐条核对 JSON 规则，返回第一条不满足的。字段不存在和取值不符分开报告：前者说明对方没给数据，不能套用检查项自己的失败说明。
function findJsonMismatch(parsed, rules) {
  for (const [jsonPath, expected] of Object.entries(rules.json)) {
    const actual = getPath(parsed, jsonPath);
    if (actual === undefined) return { path: jsonPath, missing: true };
    if (actual !== expected) return { path: jsonPath, missing: false };
  }
  for (const [jsonPath, minimum] of Object.entries(rules.jsonMin)) {
    const actual = getPath(parsed, jsonPath);
    if (typeof actual !== "number") return { path: jsonPath, missing: true };
    if (actual < minimum) return { path: jsonPath, missing: false };
  }
  return null;
}

const hasJsonRules = (rules) => Boolean(rules) && Object.keys(rules.json).length + Object.keys(rules.jsonMin).length > 0;

// 把 "在线 {data.jwxtAgents.online}/{data.jwxtAgents.total} 台" 里的路径换成响应里的值；任何一个取不到就整条不显示。
function renderDetail(template, parsed) {
  if (!template) return "";
  let complete = true;
  const text = template.replace(/\{([^{}]+)\}/gu, (_match, jsonPath) => {
    const value = getPath(parsed, jsonPath.trim());
    if (!["number", "string", "boolean"].includes(typeof value)) complete = false;
    return String(value);
  });
  return complete ? text.slice(0, 80) : "";
}

function readVersion(check, parsed) {
  if (!check.versionFrom) return null;
  const value = getPath(parsed, check.versionFrom);
  return typeof value === "string" && /^[\w.-]{1,64}$/u.test(value) ? value : null;
}

// 判定一次响应：failure 非空即失败；warning 非空表示可用但降级（如部分节点离线）。
function evaluate(check, response) {
  if (!check.expect.status.includes(response.status)) return { failure: `HTTP ${response.status}` };
  if (check.expect.contains && !response.body.includes(check.expect.contains)) return { failure: check.failureText || "页面内容异常" };

  const judged = hasJsonRules(check.expect) || hasJsonRules(check.degraded);
  if (!judged && !check.detail && !check.versionFrom) return {};
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return judged ? { failure: "返回内容不是 JSON" } : {};
  }

  const facts = { version: readVersion(check, parsed), detail: renderDetail(check.detail, parsed) };
  const mismatch = findJsonMismatch(parsed, check.expect);
  if (mismatch) return { ...facts, failure: mismatch.missing ? MISSING_DATA : (check.failureText || `检查未通过（${mismatch.path}）`) };
  const degraded = check.degraded ? findJsonMismatch(parsed, check.degraded) : null;
  if (degraded?.missing) return { ...facts, failure: MISSING_DATA };
  return { ...facts, warning: degraded ? check.degraded.text : "" };
}

/**
 * 执行一个检查项，返回 { outcome: "up" | "slow" | "down", reason, detail, elapsedMs, httpStatus, certificates, version }。
 * slow 表示可用但不理想：reason 为空是响应慢，非空是降级规则给出的说明。
 * 不抛异常：任何失败都归为 down 并给出可公开的原因。
 */
export async function runCheck(check, { request = httpRequest } = {}) {
  const startedAt = performance.now();
  const certificates = [];
  const finish = ({ failure = "", warning = "", ...extra }) => {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const latest = new Map(certificates.map((certificate) => [certificate.host, certificate]));
    return {
      elapsedMs,
      reason: failure || warning,
      outcome: failure ? "down" : (warning || (check.slowMs > 0 && elapsedMs > check.slowMs) ? "slow" : "up"),
      httpStatus: null,
      version: null,
      detail: "",
      certificates: [...latest.values()],
      ...extra,
    };
  };

  try {
    const response = await request(check.url, {
      method: check.method,
      headers: check.headers,
      timeoutMs: check.timeoutMs,
      followRedirects: check.followRedirects,
    });
    certificates.push(...response.certificates);
    const { failure = "", warning = "", version = null, detail = "" } = evaluate(check, response);
    const extra = { version, detail, httpStatus: response.status };
    if (failure) return finish({ failure, ...extra });

    if (check.type === "assets") {
      const assets = extractAssets(response.body, response.url);
      if (!assets.length) return finish({ failure: "页面没有引用脚本或样式", ...extra });
      const broken = (await Promise.all(assets.map((asset) => findBrokenAsset(asset, check, request, certificates)))).filter(Boolean);
      if (broken.length) {
        return finish({ failure: `资源加载失败：${broken[0]}${broken.length > 1 ? ` 等 ${broken.length} 个` : ""}`, ...extra });
      }
    }
    return finish({ warning, ...extra });
  } catch (error) {
    return finish({ failure: describeError(error) });
  }
}

// 探测失败时用它区分“目标挂了”和“监控机自己断网”：任意一个参考站点有 HTTP 响应就算在线。
export function createConnectivityGuard({ urls, request = httpRequest, now = Date.now, ttlMs = 30000, timeoutMs = 8000 }) {
  let cached = null;
  return {
    isOnline() {
      if (!urls.length) return Promise.resolve(true);
      if (cached && now() - cached.at < ttlMs) return cached.result;
      const result = Promise.any(urls.map((url) => request(url, { headersOnly: true, timeoutMs }))).then(() => true, () => false);
      cached = { result, at: now() };
      return result;
    },
  };
}
