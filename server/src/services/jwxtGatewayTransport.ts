import crypto from "node:crypto";
import express from "express";
import { readFileSync } from "node:fs";
import { HttpError } from "../utils/response";
import type { AgentReplicaRecipient } from "./jwxtAgentReplicaCrypto";

export type GatewayState = {
  configured: boolean; online: boolean; ready: boolean; inFlight: number;
  maxConcurrent: number; connectedAt: number | null; lastPongAt: number | null;
  buildCommit: string; platform: string; jwxtEnabled: boolean; crawlEnabled: boolean;
};
export type GatewaySnapshot = {
  protocol: 1; instance: string;
  agents: Record<string, GatewayState>;
  recipients: AgentReplicaRecipient[];
};
export function gatewayCredentials() {
  const port = Number(process.env.CPU_WEB_AGENT_GATEWAY_PORT);
  const file = process.env.CPU_WEB_AGENT_GATEWAY_SECRET_FILE;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !file) throw new Error("Invalid Agent gateway configuration");
  const secret = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid Agent gateway secret");
  return { port, secret };
}

export function createGatewayRpc(secret: string, handlers: {
  snapshot: () => GatewaySnapshot;
  request: (agent: string, action: string, payload: any, timeout: number) => Promise<unknown>;
}) {
  const app = express();
  app.use((req, res, next) => {
    const received = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      res.status(401).end(); return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.get("/snapshot", (_req, res) => res.json(handlers.snapshot()));
  app.post("/request", async (req, res) => {
    const { agentId, action, payload, timeoutMs } = req.body || {};
    if (typeof agentId !== "string" || typeof action !== "string" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
      res.status(400).json({ code: 4000, message: "Invalid gateway request" }); return;
    }
    try { res.json({ data: await handlers.request(agentId, action, payload, timeoutMs) }); }
    catch (error) {
      const known = error instanceof HttpError;
      res.status(known ? error.status : 502).json({ code: known ? error.code : 5002, message: known ? error.message : "Agent gateway request failed" });
    }
  });
  return app;
}

export class GatewayClient {
  private snapshot: GatewaySnapshot | null = null;
  private refreshedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly port: number, private readonly secret: string) {}
  private async call(route: string, body?: unknown, timeout = 3000) {
    const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { authorization: `Bearer ${this.secret}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout),
    });
    const result = await response.json() as any;
    if (!response.ok) throw new HttpError(response.status, result.code || 5002, result.message || "Agent gateway unavailable");
    return result;
  }
  async refresh() {
    const snapshot = await this.call("/snapshot") as GatewaySnapshot;
    if (snapshot.protocol !== 1 || !snapshot.instance || !snapshot.agents || !Array.isArray(snapshot.recipients)) throw new Error("Agent gateway protocol mismatch");
    this.snapshot = snapshot; this.refreshedAt = Date.now();
    return snapshot;
  }
  async start() {
    await this.refresh();
    const poll = async () => {
      try { await this.refresh(); } catch { this.refreshedAt = 0; }
      if (this.timer) { this.timer = setTimeout(poll, 500); this.timer.unref(); }
    };
    this.timer = setTimeout(poll, 500); this.timer.unref();
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  current() { return Date.now() - this.refreshedAt <= 3000 ? this.snapshot : null; }
  async request(agentId: string, action: string, payload: unknown, timeoutMs: number) {
    // No retry: the Agent may already have completed a login or mutation.
    try { return (await this.call("/request", { agentId, action, payload, timeoutMs }, timeoutMs + 3000)).data; }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 5000, "教务网关暂时不可用"); }
  }
}

export const remoteGateway = process.env.CPU_WEB_AGENT_GATEWAY_PORT && process.env.CPU_WEB_AGENT_GATEWAY_ROLE !== "owner"
  ? (() => { const { port, secret } = gatewayCredentials(); return new GatewayClient(port, secret); })() : null;
