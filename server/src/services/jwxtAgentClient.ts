import { ZodError } from "zod";
import { HttpError } from "../utils/response";
import { dispatchJwxtAgentAction } from "./jwxtAgentDispatcher";
import {
  JWXT_AGENT_PROTOCOL_VERSION,
  jwxtActionSessionToken,
  type JwxtAgentAction,
  type JwxtAgentRequestMessage,
} from "./jwxtAgentProtocol";
import type { JwxtSessionSnapshot } from "./jwxtClient";
import {
  decryptSessionSnapshotReplica,
  decryptAgentLoginCredentials,
  encryptSessionSnapshotForRecipients,
  generateAgentReplicaIdentity,
  type AgentReplicaIdentity,
  type AgentReplicaRecipient,
} from "./jwxtAgentReplicaCrypto";

const { WebSocket } = require("ws") as { WebSocket: any };

export type JwxtAgentClientOptions = {
  serverUrl: string;
  agentId: string;
  token: string;
  reconnectMs?: number;
  dispatch?: (action: JwxtAgentAction, payload: unknown) => Promise<unknown>;
  log?: (message: string) => void;
  replicaIdentity?: AgentReplicaIdentity;
  buildCommit?: string;
};

export type JwxtAgentClient = {
  stop: () => void;
  waitUntilReady: (timeoutMs?: number) => Promise<void>;
  getState: () => { connected: boolean; ready: boolean; activeRequests: number };
};

export function startJwxtAgentClient(options: JwxtAgentClientOptions): JwxtAgentClient {
  validateOptions(options);
  const dispatch = options.dispatch ?? dispatchJwxtAgentAction;
  const log = options.log ?? ((message: string) => console.log(message));
  const reconnectBaseMs = Math.max(500, Math.min(60_000, options.reconnectMs ?? 3_000));
  const replicaIdentity = options.replicaIdentity ?? generateAgentReplicaIdentity();
  const replicaRecipients = new Map<string, AgentReplicaRecipient>();
  replicaRecipients.set(options.agentId, { agentId: options.agentId, publicKey: replicaIdentity.publicKey });
  let socket: any = null;
  let stopped = false;
  let ready = false;
  let activeRequests = 0;
  let maxConcurrent = 1;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let serverHeartbeatMs = 10_000;
  let lastServerActivityAt = 0;
  const readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  const connect = () => {
    if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    ready = false;
    serverHeartbeatMs = 10_000;
    lastServerActivityAt = Date.now();
    const current = new WebSocket(options.serverUrl, {
      headers: {
        Authorization: `Bearer ${options.token}`,
        "X-JWXT-Agent-Id": options.agentId,
      },
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
      handshakeTimeout: 15_000,
    });
    socket = current;

    current.on("open", () => {
      reconnectAttempt = 0;
      markServerActivity(current);
      log(`[jwxt-agent] 已连接主服务，等待注册确认: ${options.agentId}`);
    });
    current.on("ping", () => markServerActivity(current));
    current.on("pong", () => markServerActivity(current));
    current.on("message", (data: Buffer | string, isBinary: boolean) => {
      markServerActivity(current);
      if (isBinary) {
        current.close(4002, "仅支持 JSON 文本消息");
        return;
      }
      handleMessage(current, Buffer.isBuffer(data) ? data.toString("utf8") : String(data)).catch(() => undefined);
    });
    current.on("close", (code: number, reason: Buffer | string) => {
      if (socket === current) {
        socket = null;
        clearHeartbeatWatchdog();
      }
      ready = false;
      if (stopped) return;
      const detail = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
      log(`[jwxt-agent] 连接已断开 (${code}${detail ? `: ${detail}` : ""})，准备重连`);
      scheduleReconnect();
    });
    current.on("error", (error: Error) => {
      if (!stopped) log(`[jwxt-agent] 连接异常: ${String(error?.message || "unknown error").slice(0, 300)}`);
    });
  };

  const handleMessage = async (originSocket: any, text: string) => {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      originSocket.close(4002, "JSON 格式无效");
      return;
    }

    if (message?.type === "welcome") {
      if (message.protocolVersion !== JWXT_AGENT_PROTOCOL_VERSION || message.agent?.id !== options.agentId) {
        originSocket.close(4003, "Agent 协议或身份不匹配");
        return;
      }
      serverHeartbeatMs = normalizeHeartbeatMs(message.heartbeatMs);
      armHeartbeatWatchdog(originSocket);
      maxConcurrent = normalizeConcurrent(message.agent?.maxConcurrent);
      ready = true;
      originSocket.send(JSON.stringify({
        type: "ready",
        protocolVersion: JWXT_AGENT_PROTOCOL_VERSION,
        replicaPublicKey: replicaIdentity.publicKey,
        buildCommit: options.buildCommit,
        platform: process.platform,
      }));
      log(`[jwxt-agent] 已注册上线: ${String(message.agent?.name || options.agentId)}`);
      resolveReadyWaiters();
      return;
    }

    if (message?.type === "replica-targets" && Array.isArray(message.targets)) {
      replicaRecipients.clear();
      replicaRecipients.set(options.agentId, { agentId: options.agentId, publicKey: replicaIdentity.publicKey });
      for (const target of message.targets.slice(0, 32)) {
        if (
          target && typeof target.agentId === "string" && typeof target.publicKey === "string"
          && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(target.agentId)
          && target.publicKey.length <= 4096
        ) replicaRecipients.set(target.agentId, target);
      }
      return;
    }

    if (message?.type !== "request" || typeof message.id !== "string" || typeof message.action !== "string") {
      originSocket.close(4002, "主服务消息类型无效");
      return;
    }
    if (!ready || originSocket !== socket) return;
    const request = message as JwxtAgentRequestMessage;
    if (request.action === "session.export-snapshot" || request.action === "session.import-snapshot") {
      sendResponse(originSocket, request.id, false, undefined, {
        status: 403,
        code: 4003,
        message: "主服务无权读取或写入明文教务会话快照",
      });
      return;
    }
    if (activeRequests >= maxConcurrent) {
      sendResponse(originSocket, request.id, false, undefined, {
        status: 503,
        code: 5000,
        message: "Agent 当前繁忙",
      });
      return;
    }

    activeRequests += 1;
    try {
      const data = request.action === "session.import-encrypted-snapshot"
        ? await importEncryptedSnapshot(request.payload)
        : request.action === "login.submit-handoff-encrypted" || request.action === "login.submit-legacy-encrypted"
          ? await submitEncryptedLogin(request.action, request.payload)
          : await dispatch(request.action, request.payload);
      const encryptedSessionReplicas = await collectEncryptedSessionReplicas(request.action, request.payload, data);
      sendResponse(originSocket, request.id, true, data, undefined, encryptedSessionReplicas);
    } catch (error) {
      const encryptedSessionReplicas = await collectEncryptedSessionReplicas(request.action, request.payload, undefined);
      sendResponse(originSocket, request.id, false, undefined, serializeError(error), encryptedSessionReplicas);
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
    }
  };

  const importEncryptedSnapshot = async (payload: unknown) => {
    const input = payload as { token?: unknown; replica?: unknown };
    if (typeof input?.token !== "string" || !input.token || !input.replica) throw new Error("加密会话快照参数无效");
    const snapshot = decryptSessionSnapshotReplica(input.replica as any, input.token, options.agentId, replicaIdentity);
    return dispatch("session.import-snapshot", { token: input.token, snapshot });
  };

  const submitEncryptedLogin = async (
    action: "login.submit-handoff-encrypted" | "login.submit-legacy-encrypted",
    payload: unknown,
  ) => {
    const input = payload as { pendingId?: unknown; credentials?: any };
    if (typeof input?.pendingId !== "string" || !input.pendingId || !input.credentials) throw new Error("加密登录参数无效");
    const credentials = decryptAgentLoginCredentials(input.credentials, replicaIdentity);
    const plainAction = action === "login.submit-handoff-encrypted" ? "login.submit-handoff" : "login.submit-legacy";
    const result = await dispatch(plainAction, { pendingId: input.pendingId, ...credentials }) as Record<string, unknown>;
    return { ...result, authenticatedUsername: credentials.username };
  };

  const collectEncryptedSessionReplicas = async (
    action: JwxtAgentAction,
    payload: unknown,
    output: unknown,
  ) => {
    if (action === "session.export-snapshot") return undefined;
    const sessionToken = jwxtActionSessionToken(action, payload, output);
    if (!sessionToken) return undefined;
    try {
      const snapshot = await dispatch("session.export-snapshot", { token: sessionToken }) as JwxtSessionSnapshot | null;
      if (!snapshot) return action === "session.logout" ? [] : undefined;
      return encryptSessionSnapshotForRecipients(snapshot, sessionToken, [...replicaRecipients.values()]);
    } catch {
      return undefined;
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30_000, reconnectBaseMs * Math.max(1, 2 ** reconnectAttempt));
    reconnectAttempt = Math.min(reconnectAttempt + 1, 8);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const markServerActivity = (originSocket: any) => {
    if (stopped || originSocket !== socket) return;
    lastServerActivityAt = Date.now();
    armHeartbeatWatchdog(originSocket);
  };

  const armHeartbeatWatchdog = (originSocket: any) => {
    if (stopped || originSocket !== socket) return;
    clearHeartbeatWatchdog();
    const timeoutMs = heartbeatTimeoutMs(serverHeartbeatMs);
    const elapsedMs = Math.max(0, Date.now() - lastServerActivityAt);
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      if (stopped || originSocket !== socket) return;
      log(`[jwxt-agent] ${timeoutMs}ms 未收到主服务心跳，强制重连`);
      try {
        originSocket.terminate();
      } catch {
        if (socket === originSocket) socket = null;
        ready = false;
        scheduleReconnect();
      }
    }, Math.max(100, timeoutMs - elapsedMs));
    heartbeatTimer.unref?.();
  };

  const clearHeartbeatWatchdog = () => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  };

  const resolveReadyWaiters = () => {
    for (const waiter of readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    readyWaiters.clear();
  };

  connect();

  return {
    stop() {
      stopped = true;
      ready = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearHeartbeatWatchdog();
      for (const waiter of readyWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Agent 已停止"));
      }
      readyWaiters.clear();
      try { socket?.close(1000, "Agent 停止"); } catch { /* disconnected */ }
      socket = null;
    },
    waitUntilReady(timeoutMs = 10_000) {
      if (ready) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            readyWaiters.delete(waiter);
            reject(new Error("等待 Agent 上线超时"));
          }, timeoutMs),
        };
        readyWaiters.add(waiter);
      });
    },
    getState() {
      return {
        connected: socket?.readyState === WebSocket.OPEN,
        ready,
        activeRequests,
      };
    },
  };
}

function sendResponse(
  socket: any,
  id: string,
  ok: boolean,
  data?: unknown,
  error?: { status: number; code: number; message: string },
  encryptedSessionReplicas?: ReturnType<typeof encryptSessionSnapshotForRecipients>,
) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const message = JSON.stringify({
    type: "response",
    id,
    ok,
    ...(ok ? { data } : { error }),
    ...(encryptedSessionReplicas !== undefined ? { encryptedSessionReplicas } : {}),
  });
  if (Buffer.byteLength(message, "utf8") > 2 * 1024 * 1024) {
    socket.send(JSON.stringify({
      type: "response",
      id,
      ok: false,
      error: { status: 413, code: 4013, message: "Agent 响应内容过大" },
    }));
    return;
  }
  socket.send(message);
}

function serializeError(error: unknown) {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message.slice(0, 500) };
  }
  if (error instanceof ZodError) {
    return { status: 400, code: 4000, message: "Agent 请求参数错误" };
  }
  const message = error instanceof Error ? error.message : String(error || "Agent 内部错误");
  return { status: 500, code: 5000, message: message.slice(0, 500) };
}

function normalizeConcurrent(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 1;
}

function normalizeHeartbeatMs(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 500 && parsed <= 60_000 ? parsed : 10_000;
}

function heartbeatTimeoutMs(heartbeatMs: number) {
  return Math.max(2_000, Math.min(180_000, heartbeatMs * 3));
}

function validateOptions(options: JwxtAgentClientOptions) {
  let url: URL;
  try { url = new URL(options.serverUrl); }
  catch { throw new Error("JWXT_AGENT_SERVER 必须是有效的 ws:// 或 wss:// 地址"); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("JWXT_AGENT_SERVER 必须是不含账号和 hash 的 ws:// 或 wss:// 地址");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.agentId)) {
    throw new Error("JWXT_AGENT_ID 格式无效");
  }
  if (options.token.length < 32 || options.token.length > 512) {
    throw new Error("JWXT_AGENT_TOKEN 长度必须在 32 到 512 个字符之间");
  }
}
