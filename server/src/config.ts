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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "cpu-web-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs: Number(process.env.JWXT_PROXY_TIMEOUT_MS ?? 15000),
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
};

export const isDev = config.nodeEnv !== "production";
