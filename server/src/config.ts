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

export type SsoLoginPoolConfig = {
  /** false means the existing JWXT_PROXY_URL/local transport selection remains authoritative. */
  dedicated: boolean;
  localEnabled: boolean;
  localWeight: number;
  nodes: SsoLoginNodeConfig[];
  timeoutMs: number;
  failureCooldownMs: number;
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

const proxyTimeoutMs = parseIntegerEnv("JWXT_PROXY_TIMEOUT_MS", process.env.JWXT_PROXY_TIMEOUT_MS, 15000, 1);
const ssoLoginNodes = parseSsoLoginNodes(process.env.SSO_LOGIN_NODES);
const ssoLoginLocalEnabled = parseStrictBooleanEnv(
  "SSO_LOGIN_LOCAL_ENABLED",
  process.env.SSO_LOGIN_LOCAL_ENABLED,
  false,
);
const ssoLoginPool: SsoLoginPoolConfig = {
  dedicated: ssoLoginLocalEnabled || ssoLoginNodes.length > 0,
  localEnabled: ssoLoginLocalEnabled,
  localWeight: parseIntegerEnv("SSO_LOGIN_LOCAL_WEIGHT", process.env.SSO_LOGIN_LOCAL_WEIGHT, 1, 1, 100),
  nodes: ssoLoginNodes,
  timeoutMs: parseIntegerEnv(
    "SSO_LOGIN_TIMEOUT_MS",
    process.env.SSO_LOGIN_TIMEOUT_MS,
    Math.min(proxyTimeoutMs, 300_000),
    1,
    300_000,
  ),
  failureCooldownMs: parseIntegerEnv(
    "SSO_LOGIN_FAILURE_COOLDOWN_MS",
    process.env.SSO_LOGIN_FAILURE_COOLDOWN_MS,
    30000,
    0,
    3_600_000,
  ),
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "cpu-web-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs,
  ssoLoginPool,
  filestoreEnabled: process.env.FILESTORE_ENABLED !== "false",
  filestorePort: Number(process.env.FILESTORE_PORT ?? 8974),
  filestorePython: process.env.FILESTORE_PYTHON ?? "",
  mediaStorageProvider: (process.env.MEDIA_STORAGE_PROVIDER ?? "local").trim().toLowerCase(),
  mediaStorageImageProvider: (process.env.MEDIA_STORAGE_IMAGE_PROVIDER ?? "").trim().toLowerCase(),
  mediaStorageVideoProvider: (process.env.MEDIA_STORAGE_VIDEO_PROVIDER ?? "").trim().toLowerCase(),
  mediaStorageRemotePrefixes: parseCsvEnv(process.env.MEDIA_STORAGE_REMOTE_PREFIXES, ["forum"]),
  oneDriveChinaTenantId: process.env.ONEDRIVE_CN_TENANT_ID ?? "",
  oneDriveChinaClientId: process.env.ONEDRIVE_CN_CLIENT_ID ?? "",
  oneDriveChinaClientSecret: process.env.ONEDRIVE_CN_CLIENT_SECRET ?? "",
  oneDriveChinaDriveId: process.env.ONEDRIVE_CN_DRIVE_ID ?? "",
  oneDriveChinaRootPath: process.env.ONEDRIVE_CN_ROOT_PATH ?? "",
  redisEnabled: parseBooleanEnv(process.env.REDIS_ENABLED, true),
  redisUrl: process.env.REDIS_URL ?? "",
  redisPrefix: (process.env.REDIS_PREFIX ?? "cpu-web").trim() || "cpu-web",
  androidAppDownloadUrl: (
    process.env.ANDROID_APP_DOWNLOAD_URL
    ?? "https://download.lizmt.cn/Android/CPU-Web-Android-V4.apk"
  ).trim(),
};

export const isDev = config.nodeEnv !== "production";
