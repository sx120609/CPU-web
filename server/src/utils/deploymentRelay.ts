import type { RequestHandler } from "express";
import httpProxy from "http-proxy";
import { ownsBackgroundWork } from "./deploymentWorkers";

export function createDeploymentRelay(options = {
  port: process.env.CPU_WEB_PREVIOUS_PORT,
  marker: process.env.CPU_WEB_TRAFFIC_MARKER,
  release: process.env.CPU_WEB_RELEASE_ID,
}) {
  let inFlight = 0;
  if (!options.port) return { middleware: ((_req, _res, next) => next()) as RequestHandler, inFlight: () => 0 };
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !options.marker || !options.release) {
    throw new Error("Invalid deployment relay configuration");
  }
  const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${port}` });
  const middleware: RequestHandler = (req, res, next) => {
    if (!/^\/(?:api(?:\/|$)|qqbot\/|filestore(?:\/|$))/.test(req.url)
      || /^\/api\/(?:ready|health)(?:\?|$)/.test(req.url)
      || ownsBackgroundWork(options.marker, options.release)) return next();
    inFlight++;
    let completed = false;
    const done = () => { if (!completed) { completed = true; inFlight--; } };
    res.once("finish", done);
    res.once("close", done);
    // Keep the original method, body, cookies and Host. Never retry a POST:
    // the previous instance may have committed it before the connection failed.
    proxy.web(req, res, {}, () => {
      if (!res.headersSent) res.status(503).json({ code: 5030, data: null, message: "Previous release is unavailable" });
      else res.destroy();
    });
  };
  return { middleware, inFlight: () => inFlight };
}
