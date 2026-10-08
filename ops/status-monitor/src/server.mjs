import http from "node:http";
import zlib from "node:zlib";
import { CONTENT_SECURITY_POLICY, renderPage } from "./page.mjs";
import { buildView } from "./view.mjs";

const VIEW_TTL_MS = 5000;
const STARTUP_GRACE_MS = 3 * 60 * 1000;

export function createStatusServer({ config, state, monitor, logger, now = Date.now }) {
  const startedAt = now();
  const intervalMs = Math.min(...config.checks.map((check) => check.intervalSeconds)) * 1000;
  let cached = null;

  // 同一份状态 5 秒内只渲染一次，页面被大量刷新时不重复计算。
  function current() {
    const key = `${monitor.revision()}:${Math.floor(now() / VIEW_TTL_MS)}`;
    if (cached?.key !== key) {
      const view = buildView(state, config, now());
      cached = { key, view, bodies: new Map() };
    }
    return cached;
  }

  function body(kind) {
    const { view, bodies } = current();
    if (!bodies.has(kind)) {
      const raw = Buffer.from(kind === "page" ? renderPage(view) : JSON.stringify({ ...view, generatedAt: now() }));
      bodies.set(kind, { raw, gzip: zlib.gzipSync(raw) });
    }
    return bodies.get(kind);
  }

  function send(request, response, status, headers, payload) {
    const gzip = payload.gzip && /\bgzip\b/u.test(String(request.headers["accept-encoding"] ?? ""));
    const content = gzip ? payload.gzip : payload.raw;
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Length": content.length,
      Vary: "Accept-Encoding",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      ...headers,
    });
    response.end(request.method === "HEAD" ? undefined : content);
  }

  const sendJson = (request, response, status, value, headers = {}) => send(request, response, status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  }, { raw: Buffer.from(JSON.stringify(value)) });

  // 探测循环卡死时让 /healthz 变红，方便用外部工具或面板看住监控自己。
  function health() {
    const lastSampleAt = Math.max(0, ...config.checks.map((check) => state.checks[check.id]?.lastSampleAt ?? 0));
    const reference = Math.max(lastSampleAt, startedAt + STARTUP_GRACE_MS - intervalMs * 3);
    return { ok: now() - reference <= intervalMs * 3, lastSampleAt: lastSampleAt || null };
  }

  return http.createServer((request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(request, response, 405, { message: "Method Not Allowed" }, { Allow: "GET, HEAD" });
        return;
      }
      let pathname;
      try {
        ({ pathname } = new URL(request.url, "http://status.invalid"));
      } catch {
        sendJson(request, response, 400, { message: "Bad Request" });
        return;
      }
      if (pathname === "/" || pathname === "/index.html") {
        send(request, response, 200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "X-Frame-Options": "DENY",
        }, body("page"));
      } else if (pathname === "/api/status") {
        const origin = request.headers.origin;
        send(request, response, 200, {
          "Content-Type": "application/json; charset=utf-8",
          ...(config.corsOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
          Vary: "Accept-Encoding, Origin",
        }, body("json"));
      } else if (pathname === "/healthz") {
        const status = health();
        sendJson(request, response, status.ok ? 200 : 503, status);
      } else {
        sendJson(request, response, 404, { message: "Not Found" });
      }
    } catch (error) {
      logger.error("request_failed", { message: error.message });
      if (response.headersSent) response.destroy();
      else sendJson(request, response, 500, { message: "Internal Server Error" });
    }
  });
}
