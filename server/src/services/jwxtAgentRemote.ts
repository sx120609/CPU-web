import crypto from "node:crypto";
import { config } from "../config";
import { Errors, HttpError } from "../utils/response";
import type * as local from "./jwxtFacade";
import type { LoginAttempt, LoginSessionHandoff } from "./jwxtClient";
import { getJwxtAgentState, isJwxtAgentAvailable, requestJwxtAgent } from "./jwxtAgentGateway";
import type { JwxtAgentAction, JwxtAgentInput, JwxtAgentOutput } from "./jwxtAgentProtocol";
import { getJwxtAgentRuntimeConfig } from "./jwxtAgentConfig";
import { dispatchJwxtAgentAction } from "./jwxtAgentDispatcher";

type QueryRuntime = {
  kind: "local" | "agent";
  id: string;
  name: string;
  weight: number;
  currentWeight: number;
  inFlight: number;
  consecutiveFailures: number;
  cooldownUntil: number;
};

type TokenRoute = { version: 1; agentId: string; innerToken: string; issuedAt: number };
type PendingRoute = { version: 1; agentId: string; innerPendingId: string; issuedAt: number };

const TOKEN_PREFIX = "jqa1";
const PENDING_PREFIX = "jqap1";
const MAX_TOKEN_ROUTE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_ROUTE_AGE_MS = 10 * 60 * 1000;

const runtimeById = new Map<string, QueryRuntime>();

export function isJwxtAgentQueryMode() {
  return syncQueryRuntimes().length > 0;
}

export function hasRemoteJwxtAgent() {
  return syncQueryRuntimes().some((runtime) => runtime.kind === "agent");
}

export function beginLogin(): ReturnType<typeof local.beginLogin> {
  return beginLegacyLogin() as ReturnType<typeof local.beginLogin>;
}

export function submitLogin(args: Parameters<typeof local.submitLogin>[0]): Promise<LoginAttempt> {
  return submitLegacyLogin(args);
}

export async function consumeLoginHandoff(handoff: LoginSessionHandoff): Promise<string> {
  const runtime = selectQueryAgent(new Set());
  if (!runtime) throw noQueryAgentError();
  const innerToken = await callRuntime(runtime, "session.consume-handoff", { handoff });
  if (typeof innerToken !== "string" || !innerToken) throw protocolError(runtime.name);
  return encodeTokenRoute(runtime.id, innerToken);
}

/** 在发起登录的同一教务节点上建立会话，保证登录与后续查询绑定。 */
export async function consumeLoginHandoffAt(serviceId: string, handoff: LoginSessionHandoff): Promise<string> {
  syncQueryRuntimes();
  const runtime = runtimeById.get(serviceId);
  if (!runtime) throw new HttpError(503, 5000, "发起登录的教务服务节点已被移除");
  const innerToken = await callRuntime(runtime, "session.consume-handoff", { handoff });
  if (typeof innerToken !== "string" || !innerToken) throw protocolError(runtime.name);
  return encodeTokenRoute(runtime.id, innerToken);
}

export async function logout(token: string): Promise<boolean> {
  const route = resolveTokenRoute(token);
  return callSticky(route.agentId, "session.logout", { token: route.innerToken });
}

export function getStatus(token: string | undefined | null): ReturnType<typeof local.getStatus> {
  if (!token) return Promise.resolve({ active: false }) as ReturnType<typeof local.getStatus>;
  return requestWithToken(token, "session.status", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.getStatus>;
}

export async function sessionStats(): ReturnType<typeof local.sessionStats> {
  const available = syncQueryRuntimes().filter((runtime) => isRuntimeAvailable(runtime));
  if (!available.length) throw noQueryAgentError();
  const settled = await Promise.allSettled(available.map((runtime) => callRuntime(runtime, "session.stats", {})));
  let sessions = 0;
  let pendings = 0;
  let successes = 0;
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    sessions += Number(result.value?.sessions || 0);
    pendings += Number(result.value?.pendings || 0);
    successes += 1;
  }
  if (!successes) throw noQueryAgentError();
  return { sessions, pendings };
}

export function getSchedule(token: string, args: Parameters<typeof local.getSchedule>[1] = {}): ReturnType<typeof local.getSchedule> {
  return requestWithToken(token, "jwxt.schedule", (innerToken) => ({ token: innerToken, ...args })) as ReturnType<typeof local.getSchedule>;
}

export function getGrades(token: string, args: Parameters<typeof local.getGrades>[1] = {}): ReturnType<typeof local.getGrades> {
  return requestWithToken(token, "jwxt.grades", (innerToken) => ({ token: innerToken, ...args })) as ReturnType<typeof local.getGrades>;
}

export function getMidtermGrades(token: string, args: Parameters<typeof local.getMidtermGrades>[1] = {}): ReturnType<typeof local.getMidtermGrades> {
  return requestWithToken(token, "jwxt.midterm-grades", (innerToken) => ({ token: innerToken, ...args })) as ReturnType<typeof local.getMidtermGrades>;
}

export function getExams(token: string, args: Parameters<typeof local.getExams>[1] = {}): ReturnType<typeof local.getExams> {
  return requestWithToken(token, "jwxt.exams", (innerToken) => ({ token: innerToken, ...args })) as ReturnType<typeof local.getExams>;
}

export function getCalendar(token: string): ReturnType<typeof local.getCalendar> {
  return requestWithToken(token, "jwxt.calendar", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.getCalendar>;
}

export function getProgress(token: string): ReturnType<typeof local.getProgress> {
  return requestWithToken(token, "jwxt.progress", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.getProgress>;
}

export function getPyfa(token: string): ReturnType<typeof local.getPyfa> {
  return requestWithToken(token, "jwxt.pyfa", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.getPyfa>;
}

export function getIApps(token: string): ReturnType<typeof local.getIApps> {
  return requestWithToken(token, "jwxt.iapps", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.getIApps>;
}

export function getGraduateSchedule(
  token: string,
  args: Parameters<typeof local.getGraduateSchedule>[1] = {},
): ReturnType<typeof local.getGraduateSchedule> {
  return requestWithToken(
    token,
    "jwxt.graduate-schedule",
    (innerToken) => ({ token: innerToken, ...args }),
  ) as ReturnType<typeof local.getGraduateSchedule>;
}

export function debugSnapshot(token: string): ReturnType<typeof local.debugSnapshot> {
  return requestWithToken(token, "jwxt.debug-snapshot", (innerToken) => ({ token: innerToken })) as ReturnType<typeof local.debugSnapshot>;
}

export async function requestAnyQueryAgent<A extends JwxtAgentAction>(
  action: A,
  payload: JwxtAgentInput<A>,
): Promise<JwxtAgentOutput<A>> {
  const excluded = new Set<string>();
  let lastError: unknown = null;
  while (true) {
    const runtime = selectQueryAgent(excluded);
    if (!runtime) break;
    excluded.add(runtime.id);
    try {
      return await callRuntime(runtime, action, payload);
    } catch (error) {
      lastError = error;
      if (!(error instanceof HttpError) || error.status < 500) throw error;
    }
  }
  if (lastError) throw lastError;
  throw noQueryAgentError();
}

export function getQueryAgentPoolSnapshot() {
  return syncQueryRuntimes().map((runtime) => ({
    id: runtime.id,
    name: runtime.name,
    weight: runtime.weight,
    inFlight: runtime.inFlight,
    cooldownRemainingMs: Math.max(0, runtime.cooldownUntil - Date.now()),
    consecutiveFailures: runtime.consecutiveFailures,
    kind: runtime.kind,
    connection: runtime.kind === "agent" ? getJwxtAgentState(runtime.id) : {
      configured: true,
      online: true,
      ready: true,
      inFlight: runtime.inFlight,
      maxConcurrent: null,
      connectedAt: null,
      lastPongAt: null,
      jwxtEnabled: true,
      crawlEnabled: false,
    },
  }));
}

async function beginLegacyLogin() {
  const excluded = new Set<string>();
  let lastError: unknown = null;
  while (true) {
    const runtime = selectQueryAgent(excluded);
    if (!runtime) break;
    excluded.add(runtime.id);
    try {
      const result = await callRuntime(runtime, "login.begin", {});
      if (!result || typeof result.pendingId !== "string") throw protocolError(runtime.name);
      return { ...result, pendingId: encodePendingRoute(runtime.id, result.pendingId) };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw noQueryAgentError();
}

async function submitLegacyLogin(args: Parameters<typeof local.submitLogin>[0]): Promise<LoginAttempt> {
  const route = decodePendingRoute(args.pendingId);
  const result = await callSticky(route.agentId, "login.submit-legacy", {
    ...args,
    pendingId: route.innerPendingId,
  });
  if (!result.ok) {
    if (result.captcha?.pendingId) {
      result.captcha = {
        ...result.captcha,
        pendingId: encodePendingRoute(route.agentId, result.captcha.pendingId),
      };
    }
    return result;
  }
  if (!result.token) throw protocolError(route.agentId);
  return { ...result, token: encodeTokenRoute(route.agentId, result.token) };
}

async function requestWithToken<A extends JwxtAgentAction>(
  token: string,
  action: A,
  buildPayload: (innerToken: string) => JwxtAgentInput<A>,
): Promise<JwxtAgentOutput<A>> {
  const route = resolveTokenRoute(token);
  return callSticky(route.agentId, action, buildPayload(route.innerToken));
}

async function callSticky<A extends JwxtAgentAction>(
  agentId: string,
  action: A,
  payload: JwxtAgentInput<A>,
): Promise<JwxtAgentOutput<A>> {
  syncQueryRuntimes();
  const runtime = runtimeById.get(agentId);
  if (!runtime) throw Errors.unauthorized("该教务会话所属 Agent 已移除，请重新登录");
  return callRuntime(runtime, action, payload);
}

async function callRuntime<A extends JwxtAgentAction>(
  runtime: QueryRuntime,
  action: A,
  payload: JwxtAgentInput<A>,
): Promise<JwxtAgentOutput<A>> {
  runtime.inFlight += 1;
  try {
    const result = runtime.kind === "local"
      ? await dispatchJwxtAgentAction(action, payload) as JwxtAgentOutput<A>
      : await requestJwxtAgent(runtime.id, action, payload, config.proxyTimeoutMs);
    markSuccess(runtime);
    return result;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) markFailure(runtime);
    throw error;
  } finally {
    runtime.inFlight = Math.max(0, runtime.inFlight - 1);
  }
}

function selectQueryAgent(excluded: Set<string>) {
  const candidates = syncQueryRuntimes().filter((runtime) => (
    !excluded.has(runtime.id)
    && isRuntimeAvailable(runtime)
    && !(runtime.consecutiveFailures > 0 && runtime.inFlight > 0)
  ));
  if (!candidates.length) return null;
  const totalWeight = candidates.reduce((total, runtime) => total + runtime.weight, 0);
  for (const runtime of candidates) runtime.currentWeight += runtime.weight;
  candidates.sort((a, b) => {
    const aLoad = a.inFlight + (a.kind === "agent" ? getJwxtAgentState(a.id).inFlight : 0);
    const bLoad = b.inFlight + (b.kind === "agent" ? getJwxtAgentState(b.id).inFlight : 0);
    const aScore = a.currentWeight - (aLoad / a.weight) * totalWeight;
    const bScore = b.currentWeight - (bLoad / b.weight) * totalWeight;
    if (bScore !== aScore) return bScore - aScore;
    return a.id.localeCompare(b.id);
  });
  const selected = candidates[0];
  selected.currentWeight -= totalWeight;
  return selected;
}

function isRuntimeAvailable(runtime: QueryRuntime) {
  return runtime.cooldownUntil <= Date.now()
    && (runtime.kind === "local" || isJwxtAgentAvailable(runtime.id, "jwxt"));
}

function resolveTokenRoute(token: string): TokenRoute {
  if (token.startsWith(`${TOKEN_PREFIX}.`)) return decodeSignedRoute<TokenRoute>(token, TOKEN_PREFIX, MAX_TOKEN_ROUTE_AGE_MS);
  const primary = syncQueryRuntimes()[0];
  if (!primary) throw noQueryAgentError();
  return { version: 1, agentId: primary.id, innerToken: token, issuedAt: Date.now() };
}

function encodeTokenRoute(agentId: string, innerToken: string) {
  return encodeSignedRoute(TOKEN_PREFIX, { version: 1, agentId, innerToken, issuedAt: Date.now() });
}

function encodePendingRoute(agentId: string, innerPendingId: string) {
  return encodeSignedRoute(PENDING_PREFIX, { version: 1, agentId, innerPendingId, issuedAt: Date.now() });
}

function decodePendingRoute(value: string): PendingRoute {
  return decodeSignedRoute<PendingRoute>(value, PENDING_PREFIX, MAX_PENDING_ROUTE_AGE_MS);
}

function encodeSignedRoute(prefix: string, payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${prefix}.${encoded}.${sign(encoded)}`;
}

function decodeSignedRoute<T extends { version: number; agentId: string; issuedAt: number }>(
  value: string,
  prefix: string,
  maxAgeMs: number,
): T {
  syncQueryRuntimes();
  const [actualPrefix, encoded, signature, ...rest] = value.split(".");
  if (actualPrefix !== prefix || !encoded || !signature || rest.length || !safeEqual(signature, sign(encoded))) {
    throw Errors.unauthorized("教务会话路由标识无效，请重新登录");
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (
      parsed.version !== 1
      || typeof parsed.agentId !== "string"
      || !runtimeById.has(parsed.agentId)
      || !Number.isFinite(parsed.issuedAt)
      || parsed.issuedAt > Date.now() + 30_000
      || Date.now() - parsed.issuedAt > maxAgeMs
    ) {
      throw new Error("invalid route");
    }
    if (prefix === TOKEN_PREFIX) {
      const token = (parsed as unknown as TokenRoute).innerToken;
      if (typeof token !== "string" || token.length < 1 || token.length > 512) throw new Error("invalid token");
    } else {
      const pendingId = (parsed as unknown as PendingRoute).innerPendingId;
      if (typeof pendingId !== "string" || pendingId.length < 8 || pendingId.length > 512) throw new Error("invalid pending");
    }
    return parsed;
  } catch {
    throw Errors.unauthorized("教务会话路由标识已失效，请重新登录");
  }
}

function syncQueryRuntimes() {
  const managed = getJwxtAgentRuntimeConfig();
  const agents = managed.agents.filter((agent) => agent.enabled && agent.jwxtEnabled);
  const configuredIds = new Set(agents.map((agent) => agent.id));
  if (managed.localJwxtEnabled) configuredIds.add("local");

  if (managed.localJwxtEnabled) {
    const existing = runtimeById.get("local");
    if (existing) {
      existing.name = "本机";
      existing.weight = managed.localJwxtWeight;
    } else {
      runtimeById.set("local", createRuntime("local", "local", "本机", managed.localJwxtWeight));
    }
  }
  for (const agent of agents) {
    const existing = runtimeById.get(agent.id);
    if (existing) {
      existing.name = agent.name;
      existing.weight = agent.weight;
      continue;
    }
    runtimeById.set(agent.id, createRuntime("agent", agent.id, agent.name, agent.weight));
  }
  for (const id of runtimeById.keys()) {
    if (!configuredIds.has(id)) runtimeById.delete(id);
  }
  return [
    ...(managed.localJwxtEnabled ? [runtimeById.get("local")!] : []),
    ...agents.map((agent) => runtimeById.get(agent.id)!),
  ];
}

function createRuntime(kind: QueryRuntime["kind"], id: string, name: string, weight: number): QueryRuntime {
  return {
    kind,
    id,
    name,
    weight,
    currentWeight: 0,
    inFlight: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
  };
}

function markSuccess(runtime: QueryRuntime) {
  runtime.consecutiveFailures = 0;
  runtime.cooldownUntil = 0;
}

function markFailure(runtime: QueryRuntime) {
  runtime.consecutiveFailures += 1;
  runtime.cooldownUntil = Date.now()
    + config.ssoLoginPool.failureCooldownMs * Math.min(4, runtime.consecutiveFailures);
}

function noQueryAgentError() {
  return new HttpError(503, 5000, "当前没有可用的教务查询 Agent");
}

function protocolError(name: string) {
  return new HttpError(502, 5000, `教务 Agent ${name} 返回了不兼容的响应`);
}

function sign(encoded: string) {
  return crypto.createHmac("sha256", config.jwtSecret).update(encoded).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
