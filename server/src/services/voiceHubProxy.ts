import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import httpProxy from "http-proxy";

const VOICE_HUB_PATH = "/voicehub";
const DEFAULT_VOICE_HUB_ORIGIN = "http://127.0.0.1:3001";

function normalizeVoiceHubOrigin(value: string | undefined) {
  const raw = String(value || DEFAULT_VOICE_HUB_ORIGIN).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("VOICEHUB_ORIGIN must be a valid absolute URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("VOICEHUB_ORIGIN must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("VOICEHUB_ORIGIN must not contain credentials, query, or hash");
  }
  return parsed.toString().replace(/\/$/, "");
}

const voiceHubOrigin = normalizeVoiceHubOrigin(process.env.VOICEHUB_ORIGIN);
const proxy = httpProxy.createProxyServer({
  target: voiceHubOrigin,
  changeOrigin: true,
  xfwd: true,
  ws: true,
});

function isVoiceHubRequest(url: string | undefined) {
  if (!url) return false;
  return url === VOICE_HUB_PATH || url.startsWith(`${VOICE_HUB_PATH}/`);
}

proxy.on("error", (error, _req, res) => {
  console.error("[voicehub] reverse proxy failed", error);
  if (!res || "destroyed" in res && res.destroyed) return;
  if ("writeHead" in res) {
    const response = res as ServerResponse;
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify({
      code: 5502,
      data: null,
      message: "药苑之声服务暂时不可用",
    }));
    return;
  }
  (res as Socket).destroy();
});

export function voiceHubProxyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (!isVoiceHubRequest(req.url)) return next();
  proxy.web(req, res);
}

export function attachVoiceHubGateway(server: HttpServer) {
  server.on("upgrade", (req, socket, head) => {
    if (!isVoiceHubRequest(req.url)) return;
    proxy.ws(req, socket, head);
  });
}

export const voiceHubProxyConfig = {
  path: `${VOICE_HUB_PATH}/`,
  origin: voiceHubOrigin,
};
