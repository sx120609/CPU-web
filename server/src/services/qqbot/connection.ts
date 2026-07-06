import { Errors } from "../../utils/response";

export type QqBotConnectionStatus = "disabled" | "http" | "idle" | "connecting" | "connected" | "error";

export interface QqBotConnectionConfig {
  enabled: boolean;
  napcatBaseUrl: string;
  accessToken?: string | null;
  webhookSecret?: string | null;
}

type PendingWebSocketAction = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

type QqBotConnectionLogInput = {
  direction: string;
  eventType: string;
  status?: string;
  qqId?: string;
  groupId?: string;
  messageId?: string;
  userId?: number | null;
  topicId?: number | null;
  notificationId?: number | null;
  command?: string;
  content?: string;
  result?: string;
  rawPayload?: unknown;
};

type QqBotConnectionDeps = {
  getConfig: () => Promise<QqBotConnectionConfig>;
  handleWebhook: (payload: any, secret?: string | null) => Promise<unknown>;
  logMessage: (input: QqBotConnectionLogInput) => Promise<unknown>;
};

let connectionDeps: QqBotConnectionDeps | null = null;
let wsClient: any = null;
let wsConnecting = false;
let wsReconnectTimer: NodeJS.Timeout | null = null;
let wsLastError = "";
const wsPendingActions = new Map<string, PendingWebSocketAction>();

export function configureQqBotConnection(deps: QqBotConnectionDeps) {
  connectionDeps = deps;
}

export function isWebSocketUrl(value: string) {
  return /^wss?:\/\//i.test(value.trim());
}

export function getQqBotConnectionStatus(config: QqBotConnectionConfig): QqBotConnectionStatus {
  if (!config.enabled) return "disabled";
  if (!isWebSocketUrl(config.napcatBaseUrl)) return "http";
  if (wsClient?.readyState === 1) return "connected";
  if (wsConnecting || wsClient?.readyState === 0) return "connecting";
  if (wsLastError) return "error";
  return "idle";
}

export function getQqBotConnectionError(config: QqBotConnectionConfig) {
  if (!config.enabled || !isWebSocketUrl(config.napcatBaseUrl)) return "";
  return wsLastError;
}

export async function connectQqBotWebSocket() {
  const deps = requireConnectionDeps();
  const config = await deps.getConfig();
  if (!config.enabled || !isWebSocketUrl(config.napcatBaseUrl)) return;
  if (wsClient && (wsClient.readyState === 0 || wsClient.readyState === 1)) return;
  if (wsConnecting) return;
  const WebSocketCtor = getQqBotWebSocketCtor();
  if (!WebSocketCtor) {
    setWebSocketError("当前 Node.js 运行环境不支持 WebSocket（缺少全局 WebSocket，且 ws 兼容包未加载成功）");
    console.warn("[qqbot] current Node.js runtime has no usable WebSocket implementation");
    return;
  }
  wsConnecting = true;
  try {
    const socket = new WebSocketCtor(buildWebSocketUrl(config));
    wsClient = socket;
    bindWebSocketEvent(socket, "open", () => {
      wsConnecting = false;
      wsLastError = "";
      deps.logMessage({ direction: "outbound", eventType: "websocket", status: "ok", result: "connected" });
    });
    bindWebSocketEvent(socket, "message", (event: any) => {
      const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      handleWebSocketPayload(text).catch((error) => {
        console.warn("[qqbot] websocket message failed", error);
      });
    });
    bindWebSocketEvent(socket, "close", (event: any) => {
      wsConnecting = false;
      if (wsClient === socket) wsClient = null;
      const message = event?.code === 1000
        ? "连接已关闭"
        : `连接已关闭（code ${event?.code ?? "unknown"}${event?.reason ? `, ${String(event.reason)}` : ""}）`;
      if (event?.code === 1000) wsLastError = "";
      else if (!wsLastError) setWebSocketError(message);
      rejectPendingWebSocketActions(message);
      scheduleWebSocketReconnect();
    });
    bindWebSocketEvent(socket, "error", (event: any) => {
      wsConnecting = false;
      if (wsClient === socket) wsClient = null;
      const message = `WebSocket 握手失败：${describeWebSocketError(event)}`;
      setWebSocketError(message);
      rejectPendingWebSocketActions(message);
      scheduleWebSocketReconnect();
    });
  } catch (error) {
    wsConnecting = false;
    setWebSocketError(`创建 WebSocket 失败：${describeWebSocketError(error)}`);
    rejectPendingWebSocketActions(wsLastError);
    scheduleWebSocketReconnect();
    throw error;
  }
}

export function resetQqBotWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsClient) {
    try { wsClient.close(); } catch { /* ignore */ }
    wsClient = null;
  }
  wsConnecting = false;
  wsLastError = "";
  rejectPendingWebSocketActions("QQBot WebSocket 已重置");
}

export async function callQqBotAction(action: string, params: Record<string, unknown>) {
  const deps = requireConnectionDeps();
  const config = await deps.getConfig();
  if (!config.enabled || !config.napcatBaseUrl) throw Errors.badRequest("QQBot 未启用或 NapCat 地址未配置");
  if (!isWebSocketUrl(config.napcatBaseUrl)) {
    const response = await fetch(`${config.napcatBaseUrl.replace(/\/+$/, "")}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
      },
      body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Errors.server(`NapCat 动作失败：${response.status}`);
    if (data && typeof data === "object") {
      const status = String((data as any).status || "").trim().toLowerCase();
      const retcode = Number((data as any).retcode ?? 0);
      if ((status && status !== "ok") || retcode !== 0) {
        const message = String((data as any).wording || (data as any).message || (data as any).msg || `${action} failed`).trim();
        throw Errors.badRequest(message || `NapCat 动作失败：${action}`);
      }
    }
    return data;
  }
  await connectQqBotWebSocket();
  await waitWebSocketOpen();
  const echo = `cpu-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      wsPendingActions.delete(echo);
      reject(Errors.badRequest(`NapCat 动作超时：${action}`));
    }, 8000);
    wsPendingActions.set(echo, { resolve, reject, timer });
    wsClient.send(JSON.stringify({ action, params, echo }));
  });
  return result;
}

export async function sendQqMessageByWebSocket(
  action: "send_private_msg" | "send_group_msg",
  params: Record<string, unknown>,
  target: { qqId?: string; groupId?: string; tempGroupId?: string },
  message: string,
) {
  const deps = requireConnectionDeps();
  await connectQqBotWebSocket();
  await waitWebSocketOpen();
  const echo = `cpu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  wsClient.send(JSON.stringify({ action, params, echo }));
  await deps.logMessage({
    direction: "outbound",
    eventType: target.groupId ? "group-message" : "private-message",
    status: "ok",
    qqId: target.qqId,
    groupId: target.groupId || target.tempGroupId,
    content: message.slice(0, 1000),
    result: `queued:${echo}`,
  });
}

function requireConnectionDeps() {
  if (!connectionDeps) throw new Error("QQBot connection deps are not configured");
  return connectionDeps;
}

function buildWebSocketUrl(config: QqBotConnectionConfig) {
  let url = config.napcatBaseUrl.trim();
  if (!config.accessToken || /[?&]access_token=/.test(url)) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}access_token=${encodeURIComponent(config.accessToken)}`;
}

function describeWebSocketError(error: unknown) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  const maybeError = error as { message?: string; error?: unknown; cause?: unknown };
  if (typeof maybeError.message === "string" && maybeError.message.trim()) return maybeError.message.trim();
  if (maybeError.error) return describeWebSocketError(maybeError.error);
  if (maybeError.cause) return describeWebSocketError(maybeError.cause);
  return String(error);
}

function setWebSocketError(message: string) {
  wsLastError = message;
}

function rejectPendingWebSocketActions(reason: string) {
  for (const [echo, pending] of wsPendingActions.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    wsPendingActions.delete(echo);
  }
}

function getQqBotWebSocketCtor() {
  const globalCtor = (globalThis as any).WebSocket;
  if (typeof globalCtor === "function") return globalCtor;
  try {
    const wsModule = require("ws");
    return wsModule?.WebSocket ?? wsModule?.default ?? wsModule;
  } catch (error) {
    console.warn("[qqbot] failed to load ws fallback", error);
    return null;
  }
}

function bindWebSocketEvent(socket: any, event: "open" | "message" | "close" | "error", handler: (payload?: any) => void) {
  if (typeof socket?.addEventListener === "function") {
    socket.addEventListener(event, handler);
    return;
  }
  if (typeof socket?.on !== "function") {
    throw new Error("当前 WebSocket 实例不支持事件监听");
  }
  if (event === "open") {
    socket.on("open", () => handler());
    return;
  }
  if (event === "message") {
    socket.on("message", (data: any) => handler({ data }));
    return;
  }
  if (event === "close") {
    socket.on("close", (code: number, reason: Buffer | string) => {
      handler({
        code,
        reason: Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || ""),
      });
    });
    return;
  }
  socket.on("error", (error: any) => handler(error));
}

function scheduleWebSocketReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectQqBotWebSocket().catch(() => undefined);
  }, 5000);
}

async function handleWebSocketPayload(text: string) {
  const deps = requireConnectionDeps();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    await deps.logMessage({ direction: "inbound", eventType: "websocket", status: "error", result: "JSON 解析失败", content: text.slice(0, 1000) });
    return;
  }
  if (payload?.echo) {
    const pending = wsPendingActions.get(String(payload.echo));
    if (pending) {
      clearTimeout(pending.timer);
      wsPendingActions.delete(String(payload.echo));
      if (payload.status === "ok") pending.resolve(payload);
      else pending.reject(new Error(String(payload?.wording || payload?.msg || payload?.message || "NapCat 动作失败")));
    }
    await deps.logMessage({
      direction: "inbound",
      eventType: "websocket-response",
      status: payload.status === "ok" ? "ok" : "error",
      result: JSON.stringify(payload).slice(0, 1000),
      rawPayload: payload,
    });
    return;
  }
  await deps.handleWebhook(payload, (await deps.getConfig()).webhookSecret);
}

function waitWebSocketOpen() {
  if (wsClient?.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (wsClient?.readyState === 1) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 3000) {
        clearInterval(timer);
        const reason = wsLastError ? `：${wsLastError}` : "";
        reject(Errors.badRequest(`NapCat WebSocket 尚未连接${reason}`));
      }
    }, 100);
  });
}
