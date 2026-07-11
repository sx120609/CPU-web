import crypto from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { config, type JwxtAgentConfig } from "../config";
import { Errors, HttpError } from "../utils/response";
import {
  JWXT_AGENT_PROTOCOL_VERSION,
  type JwxtAgentAction,
  type JwxtAgentInput,
  type JwxtAgentOutput,
  type JwxtAgentResponseMessage,
} from "./jwxtAgentProtocol";
import { getJwxtAgentRuntimeConfig, onJwxtAgentConfigChange } from "./jwxtAgentConfig";

const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (options: Record<string, unknown>) => any;
};

type PendingAgentRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  action: JwxtAgentAction;
};

type AgentSession = {
  config: JwxtAgentConfig;
  socket: any;
  ready: boolean;
  connectedAt: number;
  lastPongAt: number;
  pending: Map<string, PendingAgentRequest>;
};

const sessions = new Map<string, AgentSession>();
let attachedServer: HttpServer | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export function attachJwxtAgentGateway(server: HttpServer) {
  if (attachedServer) {
    if (attachedServer !== server) throw new Error("JWXT Agent gateway has already been attached to another server");
    return;
  }
  attachedServer = server;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
    perMessageDeflate: false,
  });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = safePathname(request.url);
    if (pathname !== config.jwxtAgentPath) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const agent = authenticateAgent(request);
    if (!agent) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket: any) => {
      wss.emit("connection", webSocket, request, agent);
    });
  });

  wss.on("connection", (socket: any, _request: IncomingMessage, agent: JwxtAgentConfig) => {
    registerAgentSocket(agent, socket);
  });

  heartbeatTimer = setInterval(runHeartbeat, config.jwxtAgentHeartbeatMs);
  heartbeatTimer.unref?.();
  const unsubscribeConfig = onJwxtAgentConfigChange(reconcileAgentSessions);
  server.once("close", () => {
    unsubscribeConfig();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    for (const session of sessions.values()) closeSession(session, 1012, "主服务停止");
    sessions.clear();
    attachedServer = null;
    try { wss.close(); } catch { /* already closed */ }
  });

  if (getJwxtAgentRuntimeConfig().agents.length) {
    console.log(`[jwxt-agent] 等待 Agent 主动连接: ${config.jwxtAgentPath}`);
  }
}

export function getJwxtAgentState(agentId: string) {
  const agent = getJwxtAgentRuntimeConfig().agents.find((item) => item.id === agentId);
  const session = sessions.get(agentId);
  const online = Boolean(session && session.socket.readyState === WebSocket.OPEN);
  return {
    configured: Boolean(agent),
    online,
    ready: Boolean(online && session?.ready),
    inFlight: session?.pending.size ?? 0,
    maxConcurrent: agent?.maxConcurrent ?? 0,
    connectedAt: session?.connectedAt ?? null,
    lastPongAt: session?.lastPongAt ?? null,
    jwxtEnabled: Boolean(agent?.enabled && agent.jwxtEnabled),
    crawlEnabled: Boolean(agent?.enabled && agent.crawlEnabled),
  };
}

export function isJwxtAgentAvailable(agentId: string, capability: "jwxt" | "crawl") {
  const state = getJwxtAgentState(agentId);
  return state.ready
    && state.inFlight < state.maxConcurrent
    && (capability === "crawl" ? state.crawlEnabled : state.jwxtEnabled);
}

export async function requestJwxtAgent<A extends JwxtAgentAction>(
  agentId: string,
  action: A,
  payload: JwxtAgentInput<A>,
  timeoutMs = config.proxyTimeoutMs,
): Promise<JwxtAgentOutput<A>> {
  const agent = getJwxtAgentRuntimeConfig().agents.find((item) => item.id === agentId);
  if (!agent || !agent.enabled) throw new HttpError(503, 5000, `教务 Agent ${agentId} 未配置或已禁用`);
  const capability = action === "school-feed.crawl" ? "crawl" : "jwxt";
  if (capability === "jwxt" && !agent.jwxtEnabled) throw Errors.forbidden(`教务 Agent ${agent.name} 未启用教务服务能力`);
  if (capability === "crawl" && !agent.crawlEnabled) throw Errors.forbidden(`教务 Agent ${agent.name} 未启用公告抓取能力`);

  const session = sessions.get(agentId);
  if (!session || session.socket.readyState !== WebSocket.OPEN || !session.ready) {
    throw new HttpError(503, 5000, `教务 Agent ${agent.name} 当前离线`);
  }
  if (session.pending.size >= agent.maxConcurrent) {
    throw new HttpError(503, 5000, `教务 Agent ${agent.name} 当前繁忙`);
  }

  const requestId = crypto.randomUUID();
  const message = JSON.stringify({ type: "request", id: requestId, action, payload });
  if (Buffer.byteLength(message, "utf8") > 2 * 1024 * 1024) {
    throw new HttpError(413, 4013, "教务 Agent 请求内容过大");
  }

  return new Promise<JwxtAgentOutput<A>>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(requestId);
      reject(new HttpError(504, 5000, `教务 Agent ${agent.name} 请求超时`));
    }, Math.max(1, timeoutMs));

    session.pending.set(requestId, {
      resolve: (value) => resolve(value as JwxtAgentOutput<A>),
      reject,
      timer,
      action,
    });

    session.socket.send(message, (error?: Error) => {
      if (!error) return;
      const pending = session.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      session.pending.delete(requestId);
      pending.reject(new HttpError(502, 5000, `教务 Agent ${agent.name} 发送失败`));
    });
  });
}

function registerAgentSocket(agent: JwxtAgentConfig, socket: any) {
  const previous = sessions.get(agent.id);
  if (previous && previous.socket.readyState === WebSocket.OPEN) {
    // 同 ID 的两个进程若轮流抢占连接，会导致登录在 A 建立、查询却落到 B，
    // 表现为“刚登录教务会话就失效”。保留现有连接，让重复进程持续报错便于定位。
    try { socket.close(4006, "同 ID Agent 已在线，请停止重复进程"); } catch { /* disconnected */ }
    console.warn(`[jwxt-agent] 拒绝重复连接: ${agent.name} (${agent.id})`);
    return;
  }
  if (previous) closeSession(previous, 4001, "同 ID Agent 已重新连接");

  const now = Date.now();
  const session: AgentSession = {
    config: agent,
    socket,
    ready: false,
    connectedAt: now,
    lastPongAt: now,
    pending: new Map(),
  };
  sessions.set(agent.id, session);

  socket.on("pong", () => {
    session.lastPongAt = Date.now();
  });
  socket.on("message", (data: Buffer | string, isBinary: boolean) => {
    session.lastPongAt = Date.now();
    if (isBinary) {
      socket.close(4002, "仅支持 JSON 文本消息");
      return;
    }
    handleAgentMessage(session, Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  socket.on("close", () => {
    if (sessions.get(agent.id) === session) sessions.delete(agent.id);
    rejectSessionRequests(session, new HttpError(503, 5000, `教务 Agent ${agent.name} 已断开`));
    console.warn(`[jwxt-agent] ${agent.name} 已离线`);
  });
  socket.on("error", () => undefined);

  socket.send(JSON.stringify({
    type: "welcome",
    protocolVersion: JWXT_AGENT_PROTOCOL_VERSION,
    heartbeatMs: config.jwxtAgentHeartbeatMs,
    agent: {
      id: agent.id,
      name: agent.name,
      maxConcurrent: agent.maxConcurrent,
      jwxtEnabled: agent.jwxtEnabled,
      crawlEnabled: agent.crawlEnabled,
    },
  }));
}

function handleAgentMessage(session: AgentSession, text: string) {
  let message: any;
  try {
    message = JSON.parse(text);
  } catch {
    session.socket.close(4002, "JSON 格式无效");
    return;
  }

  if (message?.type === "ready") {
    if (message.protocolVersion !== JWXT_AGENT_PROTOCOL_VERSION) {
      session.socket.close(4003, "Agent 协议版本不兼容");
      return;
    }
    if (!session.ready) console.log(`[jwxt-agent] ${session.config.name} 已上线`);
    session.ready = true;
    return;
  }

  if (message?.type !== "response" || typeof message.id !== "string") {
    session.socket.close(4002, "Agent 消息类型无效");
    return;
  }
  const pending = session.pending.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  session.pending.delete(message.id);

  const response = message as JwxtAgentResponseMessage;
  if (response.ok) {
    pending.resolve(response.data);
    return;
  }
  const status = normalizeStatus(response.error?.status);
  const code = Number.isFinite(response.error?.code) ? Number(response.error?.code) : 5000;
  const errorMessage = String(response.error?.message || "教务 Agent 请求失败").slice(0, 500);
  pending.reject(new HttpError(status, code, errorMessage));
}

function authenticateAgent(request: IncomingMessage) {
  const id = String(request.headers["x-jwxt-agent-id"] ?? "").trim();
  const authorization = String(request.headers.authorization ?? "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const agent = getJwxtAgentRuntimeConfig().agents.find((item) => item.id === id);
  if (!agent || !agent.enabled || !safeEqual(token, agent.token)) return null;
  return agent;
}

function reconcileAgentSessions() {
  const configured = new Map(getJwxtAgentRuntimeConfig().agents.map((agent) => [agent.id, agent]));
  for (const [agentId, session] of sessions.entries()) {
    const next = configured.get(agentId);
    if (!next || !next.enabled || next.token !== session.config.token) {
      closeSession(session, 4005, "Agent 配置已变更，请重新连接");
      sessions.delete(agentId);
      continue;
    }
    session.config = next;
  }
}

function runHeartbeat() {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.lastPongAt > config.jwxtAgentOfflineMs) {
      closeSession(session, 4004, "Agent 心跳超时");
      continue;
    }
    if (session.socket.readyState === WebSocket.OPEN) {
      try { session.socket.ping(); } catch { closeSession(session, 4004, "Agent 心跳失败"); }
    }
  }
}

function closeSession(session: AgentSession, code: number, reason: string) {
  rejectSessionRequests(session, new HttpError(503, 5000, reason));
  try { session.socket.close(code, reason.slice(0, 120)); } catch { /* disconnected */ }
}

function rejectSessionRequests(session: AgentSession, error: unknown) {
  for (const pending of session.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  session.pending.clear();
}

function safePathname(rawUrl: string | undefined) {
  try { return new URL(rawUrl || "/", "http://localhost").pathname.replace(/\/+$/, "") || "/"; }
  catch { return ""; }
}

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

function normalizeStatus(value: unknown) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
