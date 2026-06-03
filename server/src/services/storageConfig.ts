import { prisma } from "../prisma";
import { config } from "../config";
import { broadcastStorageConfigReload } from "./runtimeBroadcast";

export type MediaStorageProvider = "local" | "onedrive-cn";

export type MediaStorageStoredConfig = {
  mediaStorageProvider: MediaStorageProvider;
  mediaStorageRemotePrefixes: string[];
  oneDriveChinaClientId: string;
  oneDriveChinaClientSecret: string;
  oneDriveChinaSharepointUrl: string;
  oneDriveChinaSharepointHost: string;
  oneDriveChinaSharepointPath: string;
  oneDriveChinaSiteId: string;
  oneDriveChinaSiteName: string;
  oneDriveChinaDriveId: string;
  oneDriveChinaDriveName: string;
  oneDriveChinaRootPath: string;
  oneDriveChinaRefreshToken: string;
  oneDriveChinaAuthorizedAt: string;
  oneDriveChinaLastError: string;
};

export type MediaStorageAdminConfig = Omit<MediaStorageStoredConfig, "oneDriveChinaClientSecret" | "oneDriveChinaRefreshToken"> & {
  oneDriveChinaClientSecretConfigured: boolean;
  oneDriveChinaRefreshTokenConfigured: boolean;
};

export type MediaStorageRuntimeConfig = MediaStorageStoredConfig & {
  effectiveProvider: MediaStorageProvider;
  effectiveRemotePrefixes: string[];
  legacyTenantId: string;
  legacyClientId: string;
  legacyClientSecret: string;
  legacyDriveId: string;
  legacyRootPath: string;
};

const MEDIA_STORAGE_PROVIDER_KEY = "storage.media.provider";
const MEDIA_STORAGE_REMOTE_PREFIXES_KEY = "storage.media.remotePrefixes";
const ONEDRIVE_CN_CLIENT_ID_KEY = "storage.onedriveCn.clientId";
const ONEDRIVE_CN_CLIENT_SECRET_KEY = "storage.onedriveCn.clientSecret";
const ONEDRIVE_CN_SHAREPOINT_URL_KEY = "storage.onedriveCn.sharepointUrl";
const ONEDRIVE_CN_SHAREPOINT_HOST_KEY = "storage.onedriveCn.sharepointHost";
const ONEDRIVE_CN_SHAREPOINT_PATH_KEY = "storage.onedriveCn.sharepointPath";
const ONEDRIVE_CN_SITE_ID_KEY = "storage.onedriveCn.siteId";
const ONEDRIVE_CN_SITE_NAME_KEY = "storage.onedriveCn.siteName";
const ONEDRIVE_CN_DRIVE_ID_KEY = "storage.onedriveCn.driveId";
const ONEDRIVE_CN_DRIVE_NAME_KEY = "storage.onedriveCn.driveName";
const ONEDRIVE_CN_ROOT_PATH_KEY = "storage.onedriveCn.rootPath";
const ONEDRIVE_CN_REFRESH_TOKEN_KEY = "storage.onedriveCn.refreshToken";
const ONEDRIVE_CN_AUTHORIZED_AT_KEY = "storage.onedriveCn.authorizedAt";
const ONEDRIVE_CN_LAST_ERROR_KEY = "storage.onedriveCn.lastError";

const STORAGE_KEYS = [
  MEDIA_STORAGE_PROVIDER_KEY,
  MEDIA_STORAGE_REMOTE_PREFIXES_KEY,
  ONEDRIVE_CN_CLIENT_ID_KEY,
  ONEDRIVE_CN_CLIENT_SECRET_KEY,
  ONEDRIVE_CN_SHAREPOINT_URL_KEY,
  ONEDRIVE_CN_SHAREPOINT_HOST_KEY,
  ONEDRIVE_CN_SHAREPOINT_PATH_KEY,
  ONEDRIVE_CN_SITE_ID_KEY,
  ONEDRIVE_CN_SITE_NAME_KEY,
  ONEDRIVE_CN_DRIVE_ID_KEY,
  ONEDRIVE_CN_DRIVE_NAME_KEY,
  ONEDRIVE_CN_ROOT_PATH_KEY,
  ONEDRIVE_CN_REFRESH_TOKEN_KEY,
  ONEDRIVE_CN_AUTHORIZED_AT_KEY,
  ONEDRIVE_CN_LAST_ERROR_KEY,
] as const;

let loaded = false;

const storageConfigCache: MediaStorageStoredConfig = {
  mediaStorageProvider: normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
  mediaStorageRemotePrefixes: normalizeRemotePrefixes(config.mediaStorageRemotePrefixes, ["forum"]),
  oneDriveChinaClientId: "",
  oneDriveChinaClientSecret: "",
  oneDriveChinaSharepointUrl: "",
  oneDriveChinaSharepointHost: "",
  oneDriveChinaSharepointPath: "",
  oneDriveChinaSiteId: "",
  oneDriveChinaSiteName: "",
  oneDriveChinaDriveId: "",
  oneDriveChinaDriveName: "",
  oneDriveChinaRootPath: "",
  oneDriveChinaRefreshToken: "",
  oneDriveChinaAuthorizedAt: "",
  oneDriveChinaLastError: "",
};

export async function loadStorageConfig(): Promise<void> {
  const rows = await prisma.siteSetting.findMany({
    where: {
      key: { in: [...STORAGE_KEYS] },
    },
  });
  for (const row of rows) {
    if (row.key === MEDIA_STORAGE_PROVIDER_KEY) {
      storageConfigCache.mediaStorageProvider = normalizeMediaStorageProvider(row.value, "local");
      continue;
    }
    if (row.key === MEDIA_STORAGE_REMOTE_PREFIXES_KEY) {
      storageConfigCache.mediaStorageRemotePrefixes = normalizeRemotePrefixes(row.value, ["forum"]);
      continue;
    }
    if (row.key === ONEDRIVE_CN_CLIENT_ID_KEY) {
      storageConfigCache.oneDriveChinaClientId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_CLIENT_SECRET_KEY) {
      storageConfigCache.oneDriveChinaClientSecret = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_URL_KEY) {
      storageConfigCache.oneDriveChinaSharepointUrl = normalizeOptionalUrl(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_HOST_KEY) {
      storageConfigCache.oneDriveChinaSharepointHost = String(row.value || "").trim().toLowerCase();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_PATH_KEY) {
      storageConfigCache.oneDriveChinaSharepointPath = normalizeSharePointPath(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_SITE_ID_KEY) {
      storageConfigCache.oneDriveChinaSiteId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SITE_NAME_KEY) {
      storageConfigCache.oneDriveChinaSiteName = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_DRIVE_ID_KEY) {
      storageConfigCache.oneDriveChinaDriveId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_DRIVE_NAME_KEY) {
      storageConfigCache.oneDriveChinaDriveName = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_ROOT_PATH_KEY) {
      storageConfigCache.oneDriveChinaRootPath = normalizeRootPath(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_REFRESH_TOKEN_KEY) {
      storageConfigCache.oneDriveChinaRefreshToken = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_AUTHORIZED_AT_KEY) {
      storageConfigCache.oneDriveChinaAuthorizedAt = normalizeIsoDate(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_LAST_ERROR_KEY) {
      storageConfigCache.oneDriveChinaLastError = String(row.value || "").trim();
    }
  }
  sanitizeStorageConfig(storageConfigCache);
  loaded = true;
}

export async function getMediaStorageAdminConfig(): Promise<MediaStorageAdminConfig> {
  await ensureLoaded();
  return {
    ...cloneStorageConfig(storageConfigCache),
    oneDriveChinaClientSecretConfigured: Boolean(storageConfigCache.oneDriveChinaClientSecret),
    oneDriveChinaRefreshTokenConfigured: Boolean(storageConfigCache.oneDriveChinaRefreshToken),
  };
}

export async function getMediaStorageRuntimeConfig(): Promise<MediaStorageRuntimeConfig> {
  await ensureLoaded();
  return getMediaStorageRuntimeConfigSync();
}

export function getMediaStorageRuntimeConfigSync(): MediaStorageRuntimeConfig {
  const current = cloneStorageConfig(storageConfigCache);
  return {
    ...current,
    effectiveProvider: current.mediaStorageProvider || normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
    effectiveRemotePrefixes: current.mediaStorageRemotePrefixes.length
      ? [...current.mediaStorageRemotePrefixes]
      : normalizeRemotePrefixes(config.mediaStorageRemotePrefixes, ["forum"]),
    legacyTenantId: String(config.oneDriveChinaTenantId || "").trim(),
    legacyClientId: String(config.oneDriveChinaClientId || "").trim(),
    legacyClientSecret: String(config.oneDriveChinaClientSecret || "").trim(),
    legacyDriveId: String(config.oneDriveChinaDriveId || "").trim(),
    legacyRootPath: normalizeRootPath(config.oneDriveChinaRootPath),
  };
}

export async function updateMediaStorageAdminConfig(input: {
  mediaStorageProvider?: string;
  mediaStorageRemotePrefixes?: string[] | string;
  oneDriveChinaClientId?: string;
  oneDriveChinaClientSecret?: string;
  clearOneDriveChinaClientSecret?: boolean;
  oneDriveChinaSharepointUrl?: string;
  oneDriveChinaRootPath?: string;
}): Promise<MediaStorageAdminConfig> {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  const previousClientId = next.oneDriveChinaClientId;
  const previousClientSecret = next.oneDriveChinaClientSecret;
  const previousSharepointUrl = next.oneDriveChinaSharepointUrl;

  if (input.mediaStorageProvider !== undefined) {
    next.mediaStorageProvider = normalizeMediaStorageProvider(input.mediaStorageProvider, next.mediaStorageProvider);
  }
  if (input.mediaStorageRemotePrefixes !== undefined) {
    next.mediaStorageRemotePrefixes = normalizeRemotePrefixes(input.mediaStorageRemotePrefixes, next.mediaStorageRemotePrefixes);
  }
  if (input.oneDriveChinaClientId !== undefined) {
    next.oneDriveChinaClientId = String(input.oneDriveChinaClientId || "").trim();
  }
  if (input.clearOneDriveChinaClientSecret) {
    next.oneDriveChinaClientSecret = "";
  } else if (input.oneDriveChinaClientSecret !== undefined) {
    const raw = String(input.oneDriveChinaClientSecret || "").trim();
    if (raw) next.oneDriveChinaClientSecret = raw;
  }
  if (input.oneDriveChinaSharepointUrl !== undefined) {
    next.oneDriveChinaSharepointUrl = normalizeOptionalUrl(input.oneDriveChinaSharepointUrl);
  }
  if (input.oneDriveChinaRootPath !== undefined) {
    next.oneDriveChinaRootPath = normalizeRootPath(input.oneDriveChinaRootPath);
  }

  const credentialsChanged = previousClientId !== next.oneDriveChinaClientId || previousClientSecret !== next.oneDriveChinaClientSecret;
  const siteChanged = previousSharepointUrl !== next.oneDriveChinaSharepointUrl;
  if (credentialsChanged) {
    next.oneDriveChinaRefreshToken = "";
    next.oneDriveChinaAuthorizedAt = "";
    next.oneDriveChinaLastError = "";
  }
  if (siteChanged || credentialsChanged) {
    clearResolvedSharePointState(next);
  }

  sanitizeStorageConfig(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
  return getMediaStorageAdminConfig();
}

export async function setOneDriveChinaResolvedSite(input: {
  sharepointUrl: string;
  sharepointHost: string;
  sharepointPath: string;
  siteId: string;
  siteName?: string;
  driveId?: string;
  driveName?: string;
  lastError?: string;
}) {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  next.oneDriveChinaSharepointUrl = normalizeOptionalUrl(input.sharepointUrl);
  next.oneDriveChinaSharepointHost = String(input.sharepointHost || "").trim().toLowerCase();
  next.oneDriveChinaSharepointPath = normalizeSharePointPath(input.sharepointPath);
  next.oneDriveChinaSiteId = String(input.siteId || "").trim();
  next.oneDriveChinaSiteName = String(input.siteName || "").trim();
  next.oneDriveChinaDriveId = String(input.driveId || "").trim();
  next.oneDriveChinaDriveName = String(input.driveName || "").trim();
  next.oneDriveChinaLastError = String(input.lastError || "").trim();
  sanitizeStorageConfig(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
}

export async function setOneDriveChinaDriveSelection(driveId: string, driveName?: string) {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  next.oneDriveChinaDriveId = String(driveId || "").trim();
  next.oneDriveChinaDriveName = String(driveName || "").trim();
  sanitizeStorageConfig(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
}

export async function setOneDriveChinaRefreshTokenState(input: {
  refreshToken: string;
  authorizedAt?: string | Date | null;
  lastError?: string | null;
}) {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  next.oneDriveChinaRefreshToken = String(input.refreshToken || "").trim();
  next.oneDriveChinaAuthorizedAt = normalizeIsoDate(input.authorizedAt) || new Date().toISOString();
  next.oneDriveChinaLastError = String(input.lastError || "").trim();
  sanitizeStorageConfig(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
}

export async function setOneDriveChinaLastError(message: string) {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  next.oneDriveChinaLastError = String(message || "").trim().slice(0, 500);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
}

export async function clearOneDriveChinaAuthorization() {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  next.oneDriveChinaRefreshToken = "";
  next.oneDriveChinaAuthorizedAt = "";
  next.oneDriveChinaLastError = "";
  clearResolvedSharePointState(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
}

async function ensureLoaded() {
  if (loaded) return;
  await loadStorageConfig();
}

function cloneStorageConfig(source: MediaStorageStoredConfig): MediaStorageStoredConfig {
  return {
    ...source,
    mediaStorageRemotePrefixes: [...source.mediaStorageRemotePrefixes],
  };
}

function sanitizeStorageConfig(target: MediaStorageStoredConfig) {
  target.mediaStorageProvider = normalizeMediaStorageProvider(target.mediaStorageProvider, "local");
  target.mediaStorageRemotePrefixes = normalizeRemotePrefixes(target.mediaStorageRemotePrefixes, ["forum"]);
  target.oneDriveChinaSharepointUrl = normalizeOptionalUrl(target.oneDriveChinaSharepointUrl);
  target.oneDriveChinaSharepointHost = String(target.oneDriveChinaSharepointHost || "").trim().toLowerCase();
  target.oneDriveChinaSharepointPath = normalizeSharePointPath(target.oneDriveChinaSharepointPath);
  target.oneDriveChinaRootPath = normalizeRootPath(target.oneDriveChinaRootPath);
  target.oneDriveChinaAuthorizedAt = normalizeIsoDate(target.oneDriveChinaAuthorizedAt);
  target.oneDriveChinaLastError = String(target.oneDriveChinaLastError || "").trim().slice(0, 500);
}

function clearResolvedSharePointState(target: MediaStorageStoredConfig) {
  target.oneDriveChinaSharepointHost = "";
  target.oneDriveChinaSharepointPath = "";
  target.oneDriveChinaSiteId = "";
  target.oneDriveChinaSiteName = "";
  target.oneDriveChinaDriveId = "";
  target.oneDriveChinaDriveName = "";
}

async function persistStorageConfig(next: MediaStorageStoredConfig) {
  const entries: Array<[string, string]> = [
    [MEDIA_STORAGE_PROVIDER_KEY, next.mediaStorageProvider],
    [MEDIA_STORAGE_REMOTE_PREFIXES_KEY, next.mediaStorageRemotePrefixes.join(",")],
    [ONEDRIVE_CN_CLIENT_ID_KEY, next.oneDriveChinaClientId],
    [ONEDRIVE_CN_CLIENT_SECRET_KEY, next.oneDriveChinaClientSecret],
    [ONEDRIVE_CN_SHAREPOINT_URL_KEY, next.oneDriveChinaSharepointUrl],
    [ONEDRIVE_CN_SHAREPOINT_HOST_KEY, next.oneDriveChinaSharepointHost],
    [ONEDRIVE_CN_SHAREPOINT_PATH_KEY, next.oneDriveChinaSharepointPath],
    [ONEDRIVE_CN_SITE_ID_KEY, next.oneDriveChinaSiteId],
    [ONEDRIVE_CN_SITE_NAME_KEY, next.oneDriveChinaSiteName],
    [ONEDRIVE_CN_DRIVE_ID_KEY, next.oneDriveChinaDriveId],
    [ONEDRIVE_CN_DRIVE_NAME_KEY, next.oneDriveChinaDriveName],
    [ONEDRIVE_CN_ROOT_PATH_KEY, next.oneDriveChinaRootPath],
    [ONEDRIVE_CN_REFRESH_TOKEN_KEY, next.oneDriveChinaRefreshToken],
    [ONEDRIVE_CN_AUTHORIZED_AT_KEY, next.oneDriveChinaAuthorizedAt],
    [ONEDRIVE_CN_LAST_ERROR_KEY, next.oneDriveChinaLastError],
  ];
  await prisma.$transaction(entries.map(([key, value]) => prisma.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })));
  await broadcastStorageConfigReload();
}

function normalizeMediaStorageProvider(input: unknown, fallback: MediaStorageProvider): MediaStorageProvider {
  const raw = String(input || "").trim().toLowerCase();
  return raw === "onedrive-cn" ? "onedrive-cn" : fallback;
}

function normalizeRemotePrefixes(input: string[] | string | unknown, fallback: string[]) {
  const rawList = Array.isArray(input) ? input : String(input || "").split(",");
  const normalized = rawList
    .map((item) => String(item || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : [...fallback];
}

function normalizeOptionalUrl(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("SharePoint 地址格式不正确");
  }
  if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) {
    throw new Error("SharePoint 地址仅支持 http 或 https");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
}

function normalizeSharePointPath(input: unknown) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw || raw === "/") return "/";
  return `/${raw.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).join("/")}`;
}

function normalizeRootPath(input: unknown) {
  return String(input || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function normalizeIsoDate(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}
