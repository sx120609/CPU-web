import crypto from "node:crypto";
import { config, type JwxtAgentConfig } from "../config";
import { prisma } from "../prisma";
import { broadcastJwxtAgentConfigReload } from "./runtimeBroadcast";

const SETTING_KEY = "jwxt.agent.config.v1";

export type JwxtAgentRuntimeConfig = {
  version: 2;
  localJwxtEnabled: boolean;
  localJwxtWeight: number;
  crawlAgentId: string;
  agents: JwxtAgentConfig[];
};

export type JwxtAgentConfigInput = {
  localJwxtEnabled?: boolean;
  localJwxtWeight?: number;
  /** 兼容旧版数据库配置。 */
  localLoginEnabled?: boolean;
  localLoginWeight?: number;
  crawlAgentId?: string;
  agents?: Array<{
    id: string;
    name?: string;
    token?: string;
    enabled?: boolean;
    jwxtEnabled?: boolean;
    /** 兼容旧版登录/查询分离配置，迁移时合并为 jwxtEnabled。 */
    loginEnabled?: boolean;
    queryEnabled?: boolean;
    crawlEnabled?: boolean;
    weight?: number;
    maxConcurrent?: number;
  }>;
};

const listeners = new Set<(next: JwxtAgentRuntimeConfig) => void>();
let source: "environment" | "database" = "environment";
let runtimeConfig = buildEnvironmentDefault();

export function getJwxtAgentRuntimeConfig() {
  return runtimeConfig;
}

export function getJwxtAgentConfigSource() {
  return source;
}

export function onJwxtAgentConfigChange(listener: (next: JwxtAgentRuntimeConfig) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadJwxtAgentRuntimeConfig() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row?.value) {
    source = "environment";
    applyRuntimeConfig(buildEnvironmentDefault());
    return runtimeConfig;
  }
  try {
    const parsed = JSON.parse(row.value) as JwxtAgentConfigInput;
    source = "database";
    applyRuntimeConfig(normalizeConfig(parsed, runtimeConfig));
  } catch (error) {
    console.warn("[jwxt-agent] 数据库 Agent 配置无效，继续使用环境变量配置", error);
    source = "environment";
    applyRuntimeConfig(buildEnvironmentDefault());
  }
  return runtimeConfig;
}

export async function updateJwxtAgentRuntimeConfig(input: JwxtAgentConfigInput) {
  const next = normalizeConfig(input, runtimeConfig);
  await prisma.siteSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  });
  source = "database";
  applyRuntimeConfig(next);
  await broadcastJwxtAgentConfigReload();
  return runtimeConfig;
}

export function generateJwxtAgentToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildEnvironmentDefault(): JwxtAgentRuntimeConfig {
  const agents = config.ssoLoginPool.agents.map((agent) => ({ ...agent }));
  const configuredCrawlId = String(process.env.JWXT_CRAWL_AGENT_ID ?? "").trim();
  const crawlCandidates = agents.filter((agent) => agent.enabled && agent.crawlEnabled);
  const crawlAgentId = configuredCrawlId
    || (crawlCandidates.length === 1 ? crawlCandidates[0].id : "");
  return normalizeConfig({
    localJwxtEnabled: config.ssoLoginPool.localEnabled,
    localJwxtWeight: config.ssoLoginPool.localWeight,
    crawlAgentId,
    agents,
  }, emptyRuntimeConfig());
}

function emptyRuntimeConfig(): JwxtAgentRuntimeConfig {
  return {
    version: 2,
    localJwxtEnabled: false,
    localJwxtWeight: 1,
    crawlAgentId: "",
    agents: [],
  };
}

function normalizeConfig(input: JwxtAgentConfigInput, previous: JwxtAgentRuntimeConfig): JwxtAgentRuntimeConfig {
  const previousById = new Map(previous.agents.map((agent) => [agent.id, agent]));
  const ids = new Set<string>();
  const tokens = new Set<string>();
  const rawAgents = Array.isArray(input.agents) ? input.agents.slice(0, 100) : previous.agents;
  const agents = rawAgents.map<JwxtAgentConfig>((raw, index) => {
    const id = String(raw.id || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new Error(`第 ${index + 1} 个 Agent ID 格式无效`);
    }
    if (ids.has(id)) throw new Error(`Agent ID 重复：${id}`);
    ids.add(id);

    const old = previousById.get(id);
    const token = String(raw.token || old?.token || "").trim();
    if (token.length < 32 || token.length > 512) throw new Error(`Agent ${id} 尚未配置有效密钥`);
    if (tokens.has(token)) throw new Error("每台 Agent 必须使用不同密钥");
    tokens.add(token);

    const legacyRaw = raw as typeof raw & { loginEnabled?: boolean; queryEnabled?: boolean };
    const legacyJwxtEnabled = legacyRaw.loginEnabled === true || legacyRaw.queryEnabled === true;
    return {
      id,
      name: normalizeName(raw.name, old?.name || id),
      token,
      enabled: normalizeBoolean(raw.enabled, old?.enabled ?? true),
      jwxtEnabled: normalizeBoolean(raw.jwxtEnabled, legacyJwxtEnabled || old?.jwxtEnabled || false),
      crawlEnabled: normalizeBoolean(raw.crawlEnabled, old?.crawlEnabled ?? false),
      weight: normalizeInteger(raw.weight, old?.weight ?? 1, 1, 100),
      maxConcurrent: normalizeInteger(raw.maxConcurrent, old?.maxConcurrent ?? 4, 1, 100),
    };
  });

  const crawlAgentId = String(input.crawlAgentId ?? previous.crawlAgentId ?? "").trim();
  if (crawlAgentId) {
    const crawlAgent = agents.find((agent) => agent.id === crawlAgentId);
    if (!crawlAgent || !crawlAgent.enabled || !crawlAgent.crawlEnabled) {
      throw new Error("公告抓取节点必须是已启用且具备公告抓取能力的 Agent");
    }
  }

  return {
    version: 2,
    localJwxtEnabled: normalizeBoolean(
      input.localJwxtEnabled,
      normalizeBoolean(input.localLoginEnabled, previous.localJwxtEnabled),
    ),
    localJwxtWeight: normalizeInteger(
      input.localJwxtWeight ?? input.localLoginWeight,
      previous.localJwxtWeight,
      1,
      100,
    ),
    crawlAgentId,
    agents,
  };
}

function applyRuntimeConfig(next: JwxtAgentRuntimeConfig) {
  runtimeConfig = next;
  for (const listener of listeners) {
    try { listener(next); } catch (error) { console.warn("[jwxt-agent] 配置监听器执行失败", error); }
  }
}

function normalizeName(value: unknown, fallback: string) {
  const name = String(value ?? fallback).trim().replace(/[\r\n\t]+/g, " ").slice(0, 80);
  return name || fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
