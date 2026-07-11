import { ZodError } from "zod";
import { HttpError } from "../utils/response";
import { dispatchJwxtAgentAction } from "./jwxtAgentDispatcher";
import {
  JWXT_AGENT_PROTOCOL_VERSION,
  type JwxtAgentAction,
  type JwxtAgentRequestMessage,
} from "./jwxtAgentProtocol";

const { WebSocket } = require("ws") as { WebSocket: any };

export type JwxtAgentClientOptions = {
  serverUrl: string;
  agentId: string;
  token: string;
  reconnectMs?: number;
  dispatch?: (action: JwxtAgentAction, payload: unknown) => Promise<unknown>;
  log?: (message: string) => void;
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
  let socket: any = null;
  let stopped = false;
  let ready = false;
  let activeRequests = 0;
  let maxConcurrent = 1;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  const connect = () => {
    if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    ready = false;
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
      log(`[jwxt-agent] 已连接主服务，等待注册确认: ${options.agentId}`);
    });
    current.on("message", (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        current.close(4002, "仅支持 JSON 文本消息");
        return;
      }
      handleMessage(current, Buffer.isBuffer(data) ? data.toString("utf8") : String(data)).catch(() => undefined);
    });
    current.on("close", (code: number, reason: Buffer | string) => {
      if (socket === current) socket = null;
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
      maxConcurrent = normalizeConcurrent(message.agent?.maxConcurrent);
      ready = true;
      originSocket.send(JSON.stringify({ type: "ready", protocolVersion: JWXT_AGENT_PROTOCOL_VERSION }));
      log(`[jwxt-agent] 已注册上线: ${String(message.agent?.name || options.agentId)}`);
      resolveReadyWaiters();
      return;
    }

    if (message?.type !== "request" || typeof message.id !== "string" || typeof message.action !== "string") {
      originSocket.close(4002, "主服务消息类型无效");
      return;
    }
    if (!ready || originSocket !== socket) return;
    const request = message as JwxtAgentRequestMessage;
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
      const data = await dispatch(request.action, request.payload);
      sendResponse(originSocket, request.id, true, data);
    } catch (error) {
      sendResponse(originSocket, request.id, false, undefined, serializeError(error));
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
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
) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const message = JSON.stringify({ type: "response", id, ok, ...(ok ? { data } : { error }) });
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
