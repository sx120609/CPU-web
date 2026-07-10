import crypto from "node:crypto";
import { config, type SsoLoginNodeConfig } from "../config";
import { Errors, HttpError } from "../utils/response";
import * as local from "./jwxtFacade";
import * as queryRemote from "./jwxtRemote";
import type { LoginAttempt, LoginSessionHandoff } from "./jwxtClient";

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

type LoginNode = LocalNode | RemoteNode;

type NodeRuntime = {
  node: LoginNode;
  currentWeight: number;
  inFlight: number;
  consecutiveFailures: number;
  cooldownUntil: number;
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

const runtimes = [localNode, ...remoteNodes].map<NodeRuntime>((node) => ({
  node,
  currentWeight: 0,
  inFlight: 0,
  consecutiveFailures: 0,
  cooldownUntil: 0,
  lastError: "",
}));

const runtimeByKey = new Map(runtimes.map((runtime) => [runtime.node.key, runtime]));

export const isDedicatedSsoLoginPool = config.ssoLoginPool.dedicated;

if (isDedicatedSsoLoginPool) {
  const enabled = runtimes.filter((runtime) => runtime.node.enabled).map((runtime) => runtime.node.name);
  console.log(`[sso-login] 独立登录池已启用: ${enabled.length ? enabled.join(", ") : "无可用节点"}`);
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

  const cooled = nextCooldownDelay();
  const suffix = cooled > 0
    ? `，请约 ${Math.max(1, Math.ceil(cooled / 1000))} 秒后重试`
    : failures.length
      ? `（${failures.join("；")}）`
      : "";
  throw new HttpError(503, 5000, `所有统一认证登录节点暂时不可用${suffix}`);
}

export async function submitLogin(args: Parameters<typeof local.submitLogin>[0]): Promise<LoginAttempt> {
  const route = decodePendingRoute(args.pendingId);
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

    const token = await consumeAtQueryTransport(result.handoff);
    return { ok: true, token };
  } finally {
    runtime.inFlight = Math.max(0, runtime.inFlight - 1);
    activeSubmits.delete(submitKey);
  }
}

export function getSsoLoginPoolSnapshot() {
  const now = Date.now();
  return {
    dedicated: isDedicatedSsoLoginPool,
    queryTransport: config.jwxtProxyUrl ? "remote" as const : "local" as const,
    nodes: runtimes.map((runtime) => ({
      id: runtime.node.id,
      name: runtime.node.name,
      kind: runtime.node.kind,
      enabled: runtime.node.enabled,
      weight: runtime.node.weight,
      inFlight: runtime.inFlight,
      available: runtime.node.enabled && runtime.cooldownUntil <= now,
      cooldownRemainingMs: Math.max(0, runtime.cooldownUntil - now),
      consecutiveFailures: runtime.consecutiveFailures,
      lastError: runtime.lastError,
    })),
  };
}

function selectNode(excluded: Set<string>) {
  const now = Date.now();
  const candidates = runtimes.filter((runtime) => (
    runtime.node.enabled
    && runtime.cooldownUntil <= now
    && !(runtime.consecutiveFailures > 0 && runtime.inFlight > 0)
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

async function consumeAtQueryTransport(handoff: LoginSessionHandoff) {
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
  runtime.cooldownUntil = 0;
  runtime.lastError = "";
}

function markFailure(runtime: NodeRuntime, error: unknown) {
  runtime.consecutiveFailures += 1;
  runtime.lastError = errorMessage(error);
  const multiplier = Math.min(4, runtime.consecutiveFailures);
  runtime.cooldownUntil = Date.now() + config.ssoLoginPool.failureCooldownMs * multiplier;
  console.warn(`[sso-login] 节点 ${runtime.node.name} 暂时不可用: ${runtime.lastError}`);
}

function nextCooldownDelay() {
  const now = Date.now();
  const remaining = runtimes
    .filter((runtime) => runtime.node.enabled && runtime.cooldownUntil > now)
    .map((runtime) => runtime.cooldownUntil - now);
  return remaining.length ? Math.min(...remaining) : 0;
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
