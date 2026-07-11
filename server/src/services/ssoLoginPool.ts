import crypto from "node:crypto";
import { config, type JwxtAgentConfig, type SsoLoginNodeConfig } from "../config";
import { Errors, HttpError } from "../utils/response";
import * as local from "./jwxtFacade";
import * as queryRemote from "./jwxtRemote";
import * as queryAgentRemote from "./jwxtAgentRemote";
import type { LoginAttempt, LoginSessionHandoff } from "./jwxtClient";
import { getJwxtAgentState, isJwxtAgentAvailable, requestJwxtAgent } from "./jwxtAgentGateway";
import { getJwxtAgentRuntimeConfig } from "./jwxtAgentConfig";

type BeginResult = Awaited<ReturnType<typeof local.beginLogin>>;

type LoginNodeAttempt = Omit<LoginAttempt, "token"> & {
  handoff?: LoginSessionHandoff;
};

type ApiEnvelope<T> = {
  code: number;
  data: T;
  message: string;
};

type LocalNode = {
  kind: "local";
  key: "local";
  id: "local";
  name: string;
  enabled: boolean;
  weight: number;
};

type RemoteNode = {
  kind: "remote";
  key: string;
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
  config: SsoLoginNodeConfig;
};

type AgentNode = {
  kind: "agent";
  key: string;
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
  config: JwxtAgentConfig;
};

type LoginNode = LocalNode | RemoteNode | AgentNode;

type NodeRuntime = {
  node: LoginNode;
  currentWeight: number;
  inFlight: number;
  consecutiveFailures: number;
  lastError: string;
};

type PendingRoute = {
  version: 1;
  nodeKey: string;
  pendingId: string;
  issuedAt: number;
};

const PENDING_PREFIX = "slp1";
const MAX_PENDING_AGE_MS = 10 * 60 * 1000;
const MAX_INNER_PENDING_ID_LENGTH = 512;
const activeSubmits = new Set<string>();

const localNode: LocalNode = {
  kind: "local",
  key: "local",
  id: "local",
  name: "本机",
  enabled: config.ssoLoginPool.localEnabled,
  weight: config.ssoLoginPool.localWeight,
};

const remoteNodes: RemoteNode[] = config.ssoLoginPool.nodes.map((node) => ({
  kind: "remote",
  key: `remote:${node.id}`,
  id: node.id,
  name: node.name,
  enabled: node.enabled,
  weight: node.weight,
  config: node,
}));

const baseRuntimes = [localNode, ...remoteNodes].map<NodeRuntime>((node) => ({
  node,
  currentWeight: 0,
  inFlight: 0,
  consecutiveFailures: 0,
  lastError: "",
}));
const agentRuntimeById = new Map<string, NodeRuntime>();
const runtimeByKey = new Map(baseRuntimes.map((runtime) => [runtime.node.key, runtime]));

export function isDedicatedSsoLoginPool() {
  const managed = getJwxtAgentRuntimeConfig();
  return managed.localJwxtEnabled
    || remoteNodes.some((node) => node.enabled)
    || managed.agents.some((agent) => agent.enabled && agent.jwxtEnabled);
}

export function isPooledPendingId(pendingId: string) {
  return pendingId.startsWith(`${PENDING_PREFIX}.`);
}

export async function beginLogin(): Promise<BeginResult> {
  const excluded = new Set<string>();
  const failures: string[] = [];

  while (true) {
    const runtime = selectNode(excluded);
    if (!runtime) break;
    excluded.add(runtime.node.key);

    try {
      const result = validateBeginResult(await runNodeBegin(runtime));
      markSuccess(runtime);
      return {
        ...result,
        pendingId: encodePendingRoute(runtime.node.key, result.pendingId),
      };
    } catch (error) {
      markFailure(runtime, error);
      failures.push(`${runtime.node.name}: ${errorMessage(error)}`);
    }
  }

  const details = failures.length ? failures : unavailableNodeReasons();
  const suffix = details.length ? `（${details.join("；")}）` : "";
  throw new HttpError(503, 5000, `所有统一认证登录节点暂时不可用${suffix}`);
}

export async function submitLogin(args: Parameters<typeof local.submitLogin>[0]): Promise<LoginAttempt> {
  const route = decodePendingRoute(args.pendingId);
  syncRuntimes();
  const runtime = runtimeByKey.get(route.nodeKey);
  if (!runtime) {
    throw Errors.badRequest("该登录节点已被移除，请刷新页面重新登录");
  }

  const submitKey = crypto.createHash("sha256").update(args.pendingId).digest("hex");
  if (activeSubmits.has(submitKey)) {
    throw Errors.conflict("这个登录会话正在处理中，请勿重复提交");
  }
  activeSubmits.add(submitKey);

  runtime.inFlight += 1;
  try {
    let result: LoginNodeAttempt;
    try {
      result = validateLoginNodeAttempt(await submitOnNode(runtime.node, {
        ...args,
        pendingId: route.pendingId,
      }), args.username);
      markSuccess(runtime);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) markFailure(runtime, error);
      throw error;
    }

    if (!result.ok) {
      if (result.captcha?.pendingId) {
        result.captcha = {
          ...result.captcha,
          pendingId: encodePendingRoute(runtime.node.key, result.captcha.pendingId),
        };
      }
      return result;
    }

    if (!result.handoff) {
      throw Errors.server("登录节点未返回可移交的教务会话");
    }

    const token = await consumeAtQueryTransport(result.handoff, runtime.node);
    return { ok: true, token };
  } finally {
    runtime.inFlight = Math.max(0, runtime.inFlight - 1);
    activeSubmits.delete(submitKey);
  }
}

export function getSsoLoginPoolSnapshot() {
  return {
    dedicated: isDedicatedSsoLoginPool(),
    queryTransport: queryAgentRemote.hasRemoteJwxtAgent()
      ? "agent" as const
      : config.jwxtProxyUrl
        ? "remote" as const
        : "local" as const,
    nodes: syncRuntimes().map((runtime) => ({
      id: runtime.node.id,
      name: runtime.node.name,
      kind: runtime.node.kind,
      enabled: runtime.node.enabled,
      weight: runtime.node.weight,
      inFlight: runtime.inFlight,
      available: runtime.node.enabled
        && (runtime.node.kind !== "agent" || isJwxtAgentAvailable(runtime.node.id, "jwxt")),
      consecutiveFailures: runtime.consecutiveFailures,
      lastError: runtime.lastError,
      ...(runtime.node.kind === "agent" ? { agent: getJwxtAgentState(runtime.node.id) } : {}),
    })),
  };
}

function selectNode(excluded: Set<string>) {
  const candidates = syncRuntimes().filter((runtime) => (
    runtime.node.enabled
    && (runtime.node.kind !== "agent" || isJwxtAgentAvailable(runtime.node.id, "jwxt"))
    && !excluded.has(runtime.node.key)
  ));
  if (!candidates.length) return null;

  const totalWeight = candidates.reduce((total, runtime) => total + runtime.node.weight, 0);
  for (const runtime of candidates) runtime.currentWeight += runtime.node.weight;
  candidates.sort((a, b) => {
    const aScore = a.currentWeight - (a.inFlight / a.node.weight) * totalWeight;
    const bScore = b.currentWeight - (b.inFlight / b.node.weight) * totalWeight;
    if (bScore !== aScore) return bScore - aScore;
    if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
    return a.node.key.localeCompare(b.node.key);
  });
  const selected = candidates[0];
  selected.currentWeight -= totalWeight;
  return selected;
}

async function runNodeBegin(runtime: NodeRuntime): Promise<BeginResult> {
  runtime.inFlight += 1;
  try {
    if (runtime.node.kind === "local") {
      return await withLocalNodeTimeout(local.beginLogin());
    }
    if (runtime.node.kind === "agent") {
      return await requestJwxtAgent(
        runtime.node.id,
        "login.begin",
        {},
        config.ssoLoginPool.timeoutMs,
      );
    }
    return await callRemoteNode<BeginResult>(runtime.node, "/v1/login-pool/begin", {});
  } finally {
    runtime.inFlight = Math.max(0, runtime.inFlight - 1);
  }
}

async function submitOnNode(
  node: LoginNode,
  args: Parameters<typeof local.submitLogin>[0],
): Promise<LoginNodeAttempt> {
  if (node.kind === "local") return withLocalNodeTimeout(local.submitLoginForHandoff(args));
  if (node.kind === "agent") {
    return requestJwxtAgent(
      node.id,
      "login.submit-handoff",
      args,
      config.ssoLoginPool.timeoutMs,
    );
  }
  return callRemoteNode<LoginNodeAttempt>(node, "/v1/login-pool/submit", args);
}

async function withLocalNodeTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, 5000, "本机登录节点请求超时")), config.ssoLoginPool.timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function consumeAtQueryTransport(handoff: LoginSessionHandoff, loginNode: LoginNode) {
  // 登录、教务会话建立和后续查询必须固定在同一完整教务服务节点。
  if (loginNode.kind === "local" || loginNode.kind === "agent") {
    return queryAgentRemote.consumeLoginHandoffAt(loginNode.id, handoff);
  }
  if (queryAgentRemote.isJwxtAgentQueryMode()) {
    try {
      return await queryAgentRemote.consumeLoginHandoff(handoff);
    } catch (error) {
      if (!(error instanceof HttpError) || (error.status < 500 && error.status !== 409)) throw error;
      return queryAgentRemote.consumeLoginHandoff(handoff);
    }
  }
  if (!config.jwxtProxyUrl) return local.consumeLoginHandoff(handoff);
  try {
    return await queryRemote.consumeLoginHandoff(handoff);
  } catch (error) {
    // ticket 消费接口按 handoff id 幂等；代理超时或 5xx 时可安全重试一次，
    // 不会再次提交用户凭据，也不会创建第二份教务会话。
    if (!(error instanceof HttpError) || (error.status < 500 && error.status !== 409)) throw error;
    return queryRemote.consumeLoginHandoff(handoff);
  }
}

async function callRemoteNode<T>(node: RemoteNode, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ssoLoginPool.timeoutMs);
  const url = new URL(path.replace(/^\/+/, ""), `${node.config.url}/`).toString();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Auth": node.config.auth,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const envelope = await parseEnvelope<T>(response);
    if (!response.ok || envelope.code !== 0) {
      const code = Number.isFinite(envelope.code) ? envelope.code : 5000;
      throw new HttpError(response.status || 502, code, envelope.message || `登录节点请求失败 (${response.status})`);
    }
    return envelope.data;
  } catch (error: any) {
    if (error instanceof HttpError) throw error;
    if (error?.name === "AbortError") {
      throw new HttpError(504, 5000, `登录节点 ${node.name} 请求超时`);
    }
    throw new HttpError(502, 5000, `登录节点 ${node.name} 不可达: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function validateBeginResult(value: unknown): BeginResult {
  if (!value || typeof value !== "object") throw protocolError();
  const result = value as Partial<BeginResult>;
  if (
    typeof result.pendingId !== "string"
    || result.pendingId.length < 8
    || result.pendingId.length > MAX_INNER_PENDING_ID_LENGTH
    || typeof result.needCaptcha !== "boolean"
    || (result.captchaImage !== undefined && typeof result.captchaImage !== "string")
  ) {
    throw protocolError();
  }
  return result as BeginResult;
}

function validateLoginNodeAttempt(value: unknown, expectedUsername: string): LoginNodeAttempt {
  if (!value || typeof value !== "object") throw protocolError();
  const result = value as LoginNodeAttempt;
  if (typeof result.ok !== "boolean") throw protocolError();

  if (result.ok) {
    const handoff = result.handoff;
    if (
      !handoff
      || typeof handoff !== "object"
      || typeof handoff.id !== "string"
      || !/^[a-f0-9]{32,128}$/i.test(handoff.id)
      || typeof handoff.callbackUrl !== "string"
      || handoff.callbackUrl.length > 4096
      || typeof handoff.cookies !== "object"
      || handoff.cookies === null
      || Array.isArray(handoff.cookies)
      || typeof handoff.username !== "string"
      || handoff.username.length < 1
      || handoff.username.length > 128
      || handoff.username !== expectedUsername
      || !Number.isFinite(handoff.issuedAt)
      || handoff.issuedAt > Date.now() + 30_000
      || Date.now() - handoff.issuedAt > 5 * 60 * 1000
    ) {
      throw protocolError();
    }
    let callback: URL;
    try {
      callback = new URL(handoff.callbackUrl);
    } catch {
      throw protocolError();
    }
    if (
      !["http:", "https:"].includes(callback.protocol)
      || callback.host.toLowerCase() !== "jsxsd.cpu.edu.cn"
      || !callback.pathname.startsWith("/zgykdx/")
      || !callback.searchParams.get("ticket")
      || Object.keys(handoff.cookies).some((host) => host.toLowerCase() !== "jsxsd.cpu.edu.cn")
    ) {
      throw protocolError();
    }
    return result;
  }

  if (result.error !== undefined && typeof result.error !== "string") throw protocolError();
  if (result.needCaptcha !== undefined && typeof result.needCaptcha !== "boolean") throw protocolError();
  if (result.captcha !== undefined) {
    if (
      !result.captcha
      || typeof result.captcha.image !== "string"
      || typeof result.captcha.pendingId !== "string"
      || result.captcha.pendingId.length < 8
      || result.captcha.pendingId.length > MAX_INNER_PENDING_ID_LENGTH
    ) {
      throw protocolError();
    }
  }
  return result;
}

function protocolError() {
  return new HttpError(502, 5000, "登录节点返回了不兼容的响应");
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const text = await response.text();
  if (!text) {
    return {
      code: response.ok ? 0 : response.status,
      data: undefined as T,
      message: "",
    };
  }
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new HttpError(response.status || 502, 5000, "登录节点返回了非 JSON 响应");
  }
}

function markSuccess(runtime: NodeRuntime) {
  runtime.consecutiveFailures = 0;
  runtime.lastError = "";
}

function markFailure(runtime: NodeRuntime, error: unknown) {
  runtime.consecutiveFailures += 1;
  runtime.lastError = errorMessage(error);
  console.warn(`[sso-login] 节点 ${runtime.node.name} 本次请求失败: ${runtime.lastError}`);
}

function unavailableNodeReasons() {
  return syncRuntimes()
    .filter((runtime) => runtime.node.enabled)
    .map((runtime) => {
      if (runtime.node.kind === "agent") {
        const state = getJwxtAgentState(runtime.node.id);
        if (!state.ready) return `${runtime.node.name}: Agent 当前离线`;
        if (state.inFlight >= runtime.node.config.maxConcurrent) return `${runtime.node.name}: Agent 当前繁忙`;
      }
      return "";
    })
    .filter(Boolean);
}

function syncRuntimes() {
  const managed = getJwxtAgentRuntimeConfig();
  localNode.enabled = managed.localJwxtEnabled;
  localNode.weight = managed.localJwxtWeight;

  const configuredIds = new Set<string>();
  for (const agent of managed.agents) {
    configuredIds.add(agent.id);
    const node: AgentNode = {
      kind: "agent",
      key: `agent:${agent.id}`,
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled && agent.jwxtEnabled,
      weight: agent.weight,
      config: agent,
    };
    const existing = agentRuntimeById.get(agent.id);
    if (existing) {
      existing.node = node;
      runtimeByKey.set(node.key, existing);
    } else {
      const runtime: NodeRuntime = {
        node,
        currentWeight: 0,
        inFlight: 0,
        consecutiveFailures: 0,
        lastError: "",
      };
      agentRuntimeById.set(agent.id, runtime);
      runtimeByKey.set(node.key, runtime);
    }
  }
  for (const [agentId, runtime] of agentRuntimeById.entries()) {
    if (configuredIds.has(agentId)) continue;
    agentRuntimeById.delete(agentId);
    runtimeByKey.delete(runtime.node.key);
  }
  const managedServiceEnabled = managed.localJwxtEnabled
    || managed.agents.some((agent) => agent.enabled && agent.jwxtEnabled);
  // 一旦启用完整教务服务节点，就不再把旧 HTTP “仅登录节点”混入新池；
  // 旧 pending 仍保留在 runtimeByKey 中，可在迁移窗口内正常提交。
  return managedServiceEnabled
    ? [baseRuntimes[0], ...agentRuntimeById.values()]
    : [...baseRuntimes, ...agentRuntimeById.values()];
}

function encodePendingRoute(nodeKey: string, pendingId: string) {
  const payload: PendingRoute = {
    version: 1,
    nodeKey,
    pendingId,
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${PENDING_PREFIX}.${encoded}.${sign(encoded)}`;
}

function decodePendingRoute(value: string): PendingRoute {
  const [prefix, encoded, signature, ...rest] = value.split(".");
  if (prefix !== PENDING_PREFIX || !encoded || !signature || rest.length || !safeEqual(signature, sign(encoded))) {
    throw Errors.badRequest("登录会话标识无效，请刷新页面重试");
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PendingRoute;
    if (
      parsed.version !== 1
      || typeof parsed.nodeKey !== "string"
      || typeof parsed.pendingId !== "string"
      || parsed.pendingId.length < 8
      || parsed.pendingId.length > MAX_INNER_PENDING_ID_LENGTH
      || !Number.isFinite(parsed.issuedAt)
      || parsed.issuedAt > Date.now() + 30_000
      || Date.now() - parsed.issuedAt > MAX_PENDING_AGE_MS
    ) {
      throw new Error("invalid payload");
    }
    return parsed;
  } catch {
    throw Errors.badRequest("登录会话标识已失效，请刷新页面重试");
  }
}

function sign(encoded: string) {
  return crypto.createHmac("sha256", config.jwtSecret).update(encoded).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}
