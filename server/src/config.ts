import dotenv from "dotenv";
dotenv.config();

function parseCsvEnv(value: string | undefined, fallback: string[] = []) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseStrictBooleanEnv(name: string, value: string | undefined, fallback: boolean) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function parseIntegerEnv(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export type SsoLoginNodeConfig = {
  id: string;
  name: string;
  url: string;
  auth: string;
  enabled: boolean;
  weight: number;
};

export type JwxtAgentConfig = {
  id: string;
  name: string;
  token: string;
  enabled: boolean;
  /** 登录、教务会话建立和后续查询是同一项不可拆分的能力。 */
  jwxtEnabled: boolean;
  crawlEnabled: boolean;
  weight: number;
  maxConcurrent: number;
  replicaPublicKey: string;
};

export type SsoLoginPoolConfig = {
  /** false means the existing JWXT_PROXY_URL/local transport selection remains authoritative. */
  dedicated: boolean;
  localEnabled: boolean;
  localWeight: number;
  nodes: SsoLoginNodeConfig[];
  agents: JwxtAgentConfig[];
  timeoutMs: number;
};

function parseSsoLoginNodes(value: string | undefined): SsoLoginNodeConfig[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`SSO_LOGIN_NODES must be a valid JSON array: ${reason}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("SSO_LOGIN_NODES must be a JSON array");
  }

  const ids = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`SSO_LOGIN_NODES[${index}] must be an object`);
    }
    const node = entry as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id.trim() : "";
    if (!id) throw new Error(`SSO_LOGIN_NODES[${index}].id is required`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new Error(`SSO_LOGIN_NODES[${index}].id must contain only letters, numbers, dot, underscore, or dash`);
    }
    if (ids.has(id)) throw new Error(`SSO_LOGIN_NODES contains duplicate id: ${id}`);
    ids.add(id);

    const rawUrl = typeof node.url === "string" ? node.url.trim() : "";
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`SSO_LOGIN_NODES[${index}].url must be a valid absolute URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`SSO_LOGIN_NODES[${index}].url must use http or https`);
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`SSO_LOGIN_NODES[${index}].url must not contain credentials, query, or hash`);
    }

    if (node.enabled !== undefined && typeof node.enabled !== "boolean") {
      throw new Error(`SSO_LOGIN_NODES[${index}].enabled must be a boolean`);
    }
    const weight = node.weight === undefined ? 1 : Number(node.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      throw new Error(`SSO_LOGIN_NODES[${index}].weight must be an integer between 1 and 100`);
    }
    if (node.name !== undefined && typeof node.name !== "string") {
      throw new Error(`SSO_LOGIN_NODES[${index}].name must be a string`);
    }
    if (node.auth !== undefined && typeof node.auth !== "string") {
      throw new Error(`SSO_LOGIN_NODES[${index}].auth must be a string`);
    }

    return {
      id,
      name: typeof node.name === "string" && node.name.trim() ? node.name.trim() : id,
      url: rawUrl.replace(/\/+$/, ""),
      auth: typeof node.auth === "string" ? node.auth : "",
      enabled: node.enabled === undefined ? true : node.enabled,
      weight,
    };
  });
}

function parseJwxtAgents(value: string | undefined): JwxtAgentConfig[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`JWXT_AGENTS must be a valid JSON array: ${reason}`);
  }
  if (!Array.isArray(parsed)) throw new Error("JWXT_AGENTS must be a JSON array");

  const ids = new Set<string>();
  const tokens = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`JWXT_AGENTS[${index}] must be an object`);
    }
    const agent = entry as Record<string, unknown>;
    const id = typeof agent.id === "string" ? agent.id.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new Error(`JWXT_AGENTS[${index}].id must contain only letters, numbers, dot, underscore, or dash`);
    }
    if (ids.has(id)) throw new Error(`JWXT_AGENTS contains duplicate id: ${id}`);
    ids.add(id);

    const token = typeof agent.token === "string" ? agent.token.trim() : "";
    if (token.length < 32 || token.length > 512) {
      throw new Error(`JWXT_AGENTS[${index}].token must contain between 32 and 512 characters`);
    }
    if (tokens.has(token)) throw new Error("JWXT_AGENTS tokens must be unique per agent");
    tokens.add(token);

    const readBoolean = (field: "enabled" | "loginEnabled" | "queryEnabled" | "jwxtEnabled" | "crawlEnabled", fallback: boolean) => {
      const value = agent[field];
      if (value === undefined) return fallback;
      if (typeof value !== "boolean") throw new Error(`JWXT_AGENTS[${index}].${field} must be a boolean`);
      return value;
    };
    const readInteger = (field: "weight" | "maxConcurrent", fallback: number, min: number, max: number) => {
      const value = agent[field];
      if (value === undefined) return fallback;
      const parsedValue = Number(value);
      if (!Number.isInteger(parsedValue) || parsedValue < min || parsedValue > max) {
        throw new Error(`JWXT_AGENTS[${index}].${field} must be an integer between ${min} and ${max}`);
      }
      return parsedValue;
    };
    if (agent.name !== undefined && typeof agent.name !== "string") {
      throw new Error(`JWXT_AGENTS[${index}].name must be a string`);
    }

    const legacyLoginEnabled = readBoolean("loginEnabled", true);
    const legacyQueryEnabled = readBoolean("queryEnabled", true);
    const jwxtEnabled = agent.jwxtEnabled === undefined
      ? legacyLoginEnabled || legacyQueryEnabled
      : readBoolean("jwxtEnabled", true);

    return {
      id,
      name: typeof agent.name === "string" && agent.name.trim() ? agent.name.trim().slice(0, 80) : id,
      token,
      enabled: readBoolean("enabled", true),
      jwxtEnabled,
      crawlEnabled: readBoolean("crawlEnabled", false),
      weight: readInteger("weight", 1, 1, 100),
      maxConcurrent: readInteger("maxConcurrent", 4, 1, 100),
      replicaPublicKey: typeof agent.replicaPublicKey === "string" ? agent.replicaPublicKey.trim() : "",
    };
  });
}

function parseAgentPath(value: string | undefined) {
  const raw = String(value ?? "/api/internal/jwxt-agent/connect").trim();
  if (!/^\/[A-Za-z0-9/_-]{1,200}$/.test(raw) || raw.includes("//")) {
    throw new Error("JWXT_AGENT_PATH must be a plain absolute path without query or hash");
  }
  return raw.replace(/\/+$/, "") || "/api/internal/jwxt-agent/connect";
}

const proxyTimeoutMs = parseIntegerEnv("JWXT_PROXY_TIMEOUT_MS", process.env.JWXT_PROXY_TIMEOUT_MS, 15000, 1);
const ssoLoginNodes = parseSsoLoginNodes(process.env.SSO_LOGIN_NODES);
const jwxtAgents = parseJwxtAgents(process.env.JWXT_AGENTS);
const ssoLoginLocalEnabled = parseStrictBooleanEnv(
  "SSO_LOGIN_LOCAL_ENABLED",
  process.env.SSO_LOGIN_LOCAL_ENABLED,
  false,
);
const ssoLoginPool: SsoLoginPoolConfig = {
  dedicated: ssoLoginLocalEnabled
    || ssoLoginNodes.length > 0
    || jwxtAgents.some((agent) => agent.enabled && agent.jwxtEnabled),
  localEnabled: ssoLoginLocalEnabled,
  localWeight: parseIntegerEnv("SSO_LOGIN_LOCAL_WEIGHT", process.env.SSO_LOGIN_LOCAL_WEIGHT, 1, 1, 100),
  nodes: ssoLoginNodes,
  agents: jwxtAgents,
  timeoutMs: parseIntegerEnv(
    "SSO_LOGIN_TIMEOUT_MS",
    process.env.SSO_LOGIN_TIMEOUT_MS,
    // Login includes several cross-school redirects. Do not cut off a normal
    // user on a slow mobile or campus connection.
    Math.max(proxyTimeoutMs, 90_000),
    1,
    300_000,
  ),
};

const legacyJwxtProxyAgentId = String(process.env.JWXT_PROXY_AGENT_ID ?? "").trim();
const jwxtProxyAgentIds = Array.from(new Set(parseCsvEnv(
  process.env.JWXT_PROXY_AGENT_IDS,
  legacyJwxtProxyAgentId ? [legacyJwxtProxyAgentId] : [],
)));
for (const agentId of jwxtProxyAgentIds) {
  const agent = jwxtAgents.find((item) => item.id === agentId);
  if (!agent) throw new Error(`JWXT_PROXY_AGENT_IDS contains an unknown JWXT_AGENTS id: ${agentId}`);
  if (!agent.enabled || !agent.jwxtEnabled) {
    throw new Error(`JWXT_PROXY_AGENT_IDS must reference enabled query agents: ${agentId}`);
  }
}
const jwxtAgentHeartbeatMs = parseIntegerEnv(
  "JWXT_AGENT_HEARTBEAT_MS",
  process.env.JWXT_AGENT_HEARTBEAT_MS,
  10_000,
  2_000,
  60_000,
);
const jwxtAgentOfflineMs = parseIntegerEnv(
  "JWXT_AGENT_OFFLINE_MS",
  process.env.JWXT_AGENT_OFFLINE_MS,
  30_000,
  jwxtAgentHeartbeatMs * 2,
  300_000,
);
const jwxtSessionSyncKey = String(process.env.JWXT_SESSION_SYNC_KEY ?? "").trim();
if (jwxtSessionSyncKey && jwxtSessionSyncKey.length < 32) {
  throw new Error("JWXT_SESSION_SYNC_KEY must contain at least 32 characters");
}
const jwxtSessionSyncKeys = parseCsvEnv(process.env.JWXT_SESSION_SYNC_KEYS);
for (const [index, key] of jwxtSessionSyncKeys.entries()) {
  if (key.length < 32) throw new Error(`JWXT_SESSION_SYNC_KEYS item ${index + 1} must contain at least 32 characters`);
}
const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? "cpu-web-dev-secret";
if (nodeEnv === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}
const browserSessionIdleMs = parseIntegerEnv(
  "BROWSER_SESSION_IDLE_MS",
  process.env.BROWSER_SESSION_IDLE_MS,
  30 * 60 * 1000,
  5 * 60 * 1000,
  24 * 60 * 60 * 1000,
);
const browserSessionAbsoluteMs = parseIntegerEnv(
  "BROWSER_SESSION_ABSOLUTE_MS",
  process.env.BROWSER_SESSION_ABSOLUTE_MS,
  365 * 24 * 60 * 60 * 1000,
  browserSessionIdleMs,
  2 * 365 * 24 * 60 * 60 * 1000,
);
const jwxtSessionIdleMs = parseIntegerEnv(
  "JWXT_SESSION_IDLE_MS",
  process.env.JWXT_SESSION_IDLE_MS,
  browserSessionAbsoluteMs,
  browserSessionIdleMs,
  2 * 365 * 24 * 60 * 60 * 1000,
);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  voiceHubIntegrationSecret: String(process.env.VOICEHUB_INTEGRATION_SECRET ?? "").trim(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv,
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  jwxtProxyAgentId: jwxtProxyAgentIds[0] ?? "",
  jwxtProxyAgentIds,
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs,
  ssoLoginPool,
  jwxtAgentPath: parseAgentPath(process.env.JWXT_AGENT_PATH),
  jwxtAgentHeartbeatMs,
  jwxtAgentOfflineMs,
  jwxtAgentServer: String(process.env.JWXT_AGENT_SERVER ?? process.env.LOGIN_AGENT_SERVER ?? "").trim(),
  jwxtAgentId: String(process.env.JWXT_AGENT_ID ?? process.env.LOGIN_AGENT_ID ?? "").trim(),
  jwxtAgentToken: String(process.env.JWXT_AGENT_TOKEN ?? process.env.LOGIN_AGENT_TOKEN ?? "").trim(),
  jwxtAgentKeyFile: String(process.env.JWXT_AGENT_KEY_FILE ?? ".jwxt-agent-identity.json").trim(),
  jwxtLocalAgentKeyFile: String(process.env.JWXT_LOCAL_AGENT_KEY_FILE ?? ".jwxt-local-agent-identity.json").trim(),
  jwxtAgentReconnectMs: parseIntegerEnv(
    "JWXT_AGENT_RECONNECT_MS",
    process.env.JWXT_AGENT_RECONNECT_MS ?? process.env.LOGIN_AGENT_RECONNECT_MS,
    3_000,
    500,
    60_000,
  ),
  jwxtSessionSyncKey,
  jwxtSessionSyncKeys,
  browserSessionIdleMs,
  browserSessionAbsoluteMs,
  jwxtSessionIdleMs,
  corsAllowedOrigins: parseCsvEnv(
    process.env.CORS_ALLOWED_ORIGINS,
    nodeEnv === "production" ? ["https://cputime.cn"] : [],
  ),
  mediaStorageProvider: (process.env.MEDIA_STORAGE_PROVIDER ?? "local").trim().toLowerCase(),
  mediaStorageImageProvider: (process.env.MEDIA_STORAGE_IMAGE_PROVIDER ?? "").trim().toLowerCase(),
  mediaStorageVideoProvider: (process.env.MEDIA_STORAGE_VIDEO_PROVIDER ?? "").trim().toLowerCase(),
  mediaStorageRemotePrefixes: parseCsvEnv(process.env.MEDIA_STORAGE_REMOTE_PREFIXES, ["forum"]),
  oneDriveChinaTenantId: process.env.ONEDRIVE_CN_TENANT_ID ?? "",
  oneDriveChinaClientId: process.env.ONEDRIVE_CN_CLIENT_ID ?? "",
  oneDriveChinaClientSecret: process.env.ONEDRIVE_CN_CLIENT_SECRET ?? "",
  oneDriveChinaDriveId: process.env.ONEDRIVE_CN_DRIVE_ID ?? "",
  oneDriveChinaRootPath: process.env.ONEDRIVE_CN_ROOT_PATH ?? "",
  tencentCosSecretId: process.env.TENCENT_COS_SECRET_ID ?? "",
  tencentCosSecretKey: process.env.TENCENT_COS_SECRET_KEY ?? "",
  tencentCosBucket: process.env.TENCENT_COS_BUCKET ?? "",
  tencentCosRegion: process.env.TENCENT_COS_REGION ?? "",
  tencentCosRootPath: process.env.TENCENT_COS_ROOT_PATH ?? "cpu-web-media",
  tencentCosPublicBaseUrl: process.env.TENCENT_COS_PUBLIC_BASE_URL ?? "",
  redisEnabled: parseBooleanEnv(process.env.REDIS_ENABLED, true),
  redisUrl: process.env.REDIS_URL ?? "",
  redisPrefix: (process.env.REDIS_PREFIX ?? "cpu-web").trim() || "cpu-web",
  // 固定执行 deploy.sh update，且只允许站点超级管理员触发。生产默认开启，
  // 紧急情况下可通过环境变量显式关闭，而无需修改代码。
  adminDeployEnabled: parseBooleanEnv(process.env.ADMIN_DEPLOY_ENABLED, nodeEnv === "production"),
  androidAppDownloadUrl: (
    process.env.ANDROID_APP_DOWNLOAD_URL
    ?? ""
  ).trim(),
  androidAppPdsShareUrl: (process.env.ANDROID_APP_PDS_SHARE_URL ?? "").trim(),
  androidAppPdsSharePassword: (process.env.ANDROID_APP_PDS_SHARE_PASSWORD ?? "").trim(),
  // 桌面端安装包。留空表示尚未发布，前端会显示"正在打包中"而不是给一个死链接。
  // 仅作为 PDS 不可用时的可选回退；不再内置旧蓝奏云地址。
  desktopAppDownloadUrl: (process.env.DESKTOP_APP_DOWNLOAD_URL ?? "").trim(),
  // 网盘分享页的提取码。不是直链时必须下发，否则用户点过去只能卡在输码页面。
  desktopAppDownloadPassword: (process.env.DESKTOP_APP_DOWNLOAD_PASSWORD ?? "").trim(),
  // 阿里云盘企业版（PDS）的分享链接。配了就走直链：服务端每次现取一个临时地址再
  // 302 过去，用户看到的是我们自己域名下的稳定链接，不用输提取码。
  // 默认使用长期不变的 Windows 文件夹分享；以后只需替换文件夹内的安装包。
  // 显式配置环境变量仍可覆盖，留空则回落到上面那套可选网盘地址。
  desktopPdsShareUrl: (
    process.env.DESKTOP_PDS_SHARE_URL?.trim()
    || "https://bj37249.apps.aliyunfile.com/disk/s/TunDZWtpXk5?domainId=bj37249"
  ).trim(),
  desktopPdsSharePassword: (process.env.DESKTOP_PDS_SHARE_PASSWORD ?? "").trim(),
  desktopAppVersion: (process.env.DESKTOP_APP_VERSION ?? "").trim(),
  // 校园地图的查看与下载都由服务端解析 PDS 分享并跳转到短期直链，
  // 避免在仓库和前端包内保存图片，也不占用本站传输带宽。
  campusMapPdsShareUrl: (
    process.env.CAMPUS_MAP_PDS_SHARE_URL?.trim()
    || "https://bj37249.apps.aliyunfile.com/disk/s/RnrWbjgJ9U4?domainId=bj37249"
  ).trim(),
  campusMapPdsSharePassword: (process.env.CAMPUS_MAP_PDS_SHARE_PASSWORD ?? "").trim(),
  oauthClientId: String(process.env.OAUTH_CLIENT_ID ?? "cpu-electron").trim(),
  oauthAllowedRedirectUris: parseCsvEnv(process.env.OAUTH_ALLOWED_REDIRECT_URIS, ["http://127.0.0.1", "http://localhost"]),
};

export const isDev = config.nodeEnv !== "production";
