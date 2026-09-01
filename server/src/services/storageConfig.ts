import { prisma } from "../prisma";
import { config } from "../config";
import { broadcastStorageConfigReload } from "./runtimeBroadcast";

export type MediaStorageProvider = "local" | "onedrive-cn" | "cos" | "oss";
export type MediaStorageKind = "image" | "video";

export type MediaStorageStoredConfig = {
  mediaStorageProvider: MediaStorageProvider;
  mediaStorageImageProvider: MediaStorageProvider;
  mediaStorageVideoProvider: MediaStorageProvider;
  mediaStorageRemotePrefixes: string[];
  filestoreRemoteStorageEnabled: boolean;
  filestoreRemoteMinSizeMb: number;
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
  tencentCosSecretId: string;
  tencentCosSecretKey: string;
  tencentCosBucket: string;
  tencentCosRegion: string;
  tencentCosRootPath: string;
  tencentCosPublicBaseUrl: string;
  aliyunOssAccessKeyId: string;
  aliyunOssAccessKeySecret: string;
  aliyunOssBucket: string;
  aliyunOssRegion: string;
  aliyunOssRootPath: string;
  aliyunOssPublicBaseUrl: string;
};

export type MediaStorageAdminConfig = Omit<MediaStorageStoredConfig, "oneDriveChinaClientSecret" | "oneDriveChinaRefreshToken" | "tencentCosSecretKey" | "aliyunOssAccessKeySecret"> & {
  oneDriveChinaClientSecretConfigured: boolean;
  oneDriveChinaRefreshTokenConfigured: boolean;
  tencentCosSecretKeyConfigured: boolean;
  aliyunOssAccessKeySecretConfigured: boolean;
};

export type MediaStorageRuntimeConfig = MediaStorageStoredConfig & {
  effectiveProvider: MediaStorageProvider;
  effectiveImageProvider: MediaStorageProvider;
  effectiveVideoProvider: MediaStorageProvider;
  effectiveRemotePrefixes: string[];
  legacyTenantId: string;
  legacyClientId: string;
  legacyClientSecret: string;
  legacyDriveId: string;
  legacyRootPath: string;
  legacyTencentCosSecretId: string;
  legacyTencentCosSecretKey: string;
  legacyTencentCosBucket: string;
  legacyTencentCosRegion: string;
  legacyTencentCosRootPath: string;
  legacyTencentCosPublicBaseUrl: string;
  legacyAliyunOssAccessKeyId: string;
  legacyAliyunOssAccessKeySecret: string;
  legacyAliyunOssBucket: string;
  legacyAliyunOssRegion: string;
  legacyAliyunOssRootPath: string;
  legacyAliyunOssPublicBaseUrl: string;
};

const MEDIA_STORAGE_PROVIDER_KEY = "storage.media.provider";
const MEDIA_STORAGE_IMAGE_PROVIDER_KEY = "storage.media.imageProvider";
const MEDIA_STORAGE_VIDEO_PROVIDER_KEY = "storage.media.videoProvider";
const MEDIA_STORAGE_REMOTE_PREFIXES_KEY = "storage.media.remotePrefixes";
const FILESTORE_REMOTE_STORAGE_ENABLED_KEY = "filestore.remoteStorageEnabled";
const FILESTORE_REMOTE_MIN_SIZE_MB_KEY = "filestore.remoteMinSizeMb";
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
const TENCENT_COS_SECRET_ID_KEY = "storage.tencentCos.secretId";
const TENCENT_COS_SECRET_KEY_KEY = "storage.tencentCos.secretKey";
const TENCENT_COS_BUCKET_KEY = "storage.tencentCos.bucket";
const TENCENT_COS_REGION_KEY = "storage.tencentCos.region";
const TENCENT_COS_ROOT_PATH_KEY = "storage.tencentCos.rootPath";
const TENCENT_COS_PUBLIC_BASE_URL_KEY = "storage.tencentCos.publicBaseUrl";
const ALIYUN_OSS_ACCESS_KEY_ID_KEY = "storage.aliyunOss.accessKeyId";
const ALIYUN_OSS_ACCESS_KEY_SECRET_KEY = "storage.aliyunOss.accessKeySecret";
const ALIYUN_OSS_BUCKET_KEY = "storage.aliyunOss.bucket";
const ALIYUN_OSS_REGION_KEY = "storage.aliyunOss.region";
const ALIYUN_OSS_ROOT_PATH_KEY = "storage.aliyunOss.rootPath";
const ALIYUN_OSS_PUBLIC_BASE_URL_KEY = "storage.aliyunOss.publicBaseUrl";

const STORAGE_KEYS = [
  MEDIA_STORAGE_PROVIDER_KEY,
  MEDIA_STORAGE_IMAGE_PROVIDER_KEY,
  MEDIA_STORAGE_VIDEO_PROVIDER_KEY,
  MEDIA_STORAGE_REMOTE_PREFIXES_KEY,
  FILESTORE_REMOTE_STORAGE_ENABLED_KEY,
  FILESTORE_REMOTE_MIN_SIZE_MB_KEY,
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
  TENCENT_COS_SECRET_ID_KEY,
  TENCENT_COS_SECRET_KEY_KEY,
  TENCENT_COS_BUCKET_KEY,
  TENCENT_COS_REGION_KEY,
  TENCENT_COS_ROOT_PATH_KEY,
  TENCENT_COS_PUBLIC_BASE_URL_KEY,
  ALIYUN_OSS_ACCESS_KEY_ID_KEY,
  ALIYUN_OSS_ACCESS_KEY_SECRET_KEY,
  ALIYUN_OSS_BUCKET_KEY,
  ALIYUN_OSS_REGION_KEY,
  ALIYUN_OSS_ROOT_PATH_KEY,
  ALIYUN_OSS_PUBLIC_BASE_URL_KEY,
] as const;

let loaded = false;

const storageConfigCache: MediaStorageStoredConfig = {
  mediaStorageProvider: normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
  mediaStorageImageProvider: normalizeMediaStorageProvider(
    config.mediaStorageImageProvider,
    normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
  ),
  mediaStorageVideoProvider: normalizeMediaStorageProvider(
    config.mediaStorageVideoProvider,
    normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
  ),
  mediaStorageRemotePrefixes: normalizeRemotePrefixes(config.mediaStorageRemotePrefixes, ["forum"]),
  filestoreRemoteStorageEnabled: false,
  filestoreRemoteMinSizeMb: 0,
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
  tencentCosSecretId: "",
  tencentCosSecretKey: "",
  tencentCosBucket: "",
  tencentCosRegion: "",
  tencentCosRootPath: "",
  tencentCosPublicBaseUrl: "",
  aliyunOssAccessKeyId: "",
  aliyunOssAccessKeySecret: "",
  aliyunOssBucket: "",
  aliyunOssRegion: "",
  aliyunOssRootPath: "",
  aliyunOssPublicBaseUrl: "",
};

export async function loadStorageConfig(): Promise<void> {
  const next = cloneStorageConfig({
    mediaStorageProvider: normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
    mediaStorageImageProvider: normalizeMediaStorageProvider(
      config.mediaStorageImageProvider,
      normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
    ),
    mediaStorageVideoProvider: normalizeMediaStorageProvider(
      config.mediaStorageVideoProvider,
      normalizeMediaStorageProvider(config.mediaStorageProvider, "local"),
    ),
    mediaStorageRemotePrefixes: normalizeRemotePrefixes(config.mediaStorageRemotePrefixes, ["forum"]),
    filestoreRemoteStorageEnabled: false,
    filestoreRemoteMinSizeMb: 0,
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
    tencentCosSecretId: "",
    tencentCosSecretKey: "",
    tencentCosBucket: "",
    tencentCosRegion: "",
    tencentCosRootPath: "",
    tencentCosPublicBaseUrl: "",
    aliyunOssAccessKeyId: "",
    aliyunOssAccessKeySecret: "",
    aliyunOssBucket: "",
    aliyunOssRegion: "",
    aliyunOssRootPath: "",
    aliyunOssPublicBaseUrl: "",
  });
  const rows = await prisma.siteSetting.findMany({
    where: {
      key: { in: [...STORAGE_KEYS] },
    },
  });
  for (const row of rows) {
    if (row.key === MEDIA_STORAGE_PROVIDER_KEY) {
      next.mediaStorageProvider = normalizeMediaStorageProvider(row.value, "local");
      continue;
    }
    if (row.key === MEDIA_STORAGE_IMAGE_PROVIDER_KEY) {
      next.mediaStorageImageProvider = normalizeMediaStorageProvider(row.value, next.mediaStorageProvider);
      continue;
    }
    if (row.key === MEDIA_STORAGE_VIDEO_PROVIDER_KEY) {
      next.mediaStorageVideoProvider = normalizeMediaStorageProvider(row.value, next.mediaStorageProvider);
      continue;
    }
    if (row.key === MEDIA_STORAGE_REMOTE_PREFIXES_KEY) {
      next.mediaStorageRemotePrefixes = normalizeRemotePrefixes(row.value, ["forum"]);
      continue;
    }
    if (row.key === FILESTORE_REMOTE_STORAGE_ENABLED_KEY) {
      next.filestoreRemoteStorageEnabled = parseBooleanSetting(row.value, false);
      continue;
    }
    if (row.key === FILESTORE_REMOTE_MIN_SIZE_MB_KEY) {
      next.filestoreRemoteMinSizeMb = normalizeFileSizeThresholdMb(row.value, 0);
      continue;
    }
    if (row.key === ONEDRIVE_CN_CLIENT_ID_KEY) {
      next.oneDriveChinaClientId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_CLIENT_SECRET_KEY) {
      next.oneDriveChinaClientSecret = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_URL_KEY) {
      next.oneDriveChinaSharepointUrl = normalizeOptionalUrl(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_HOST_KEY) {
      next.oneDriveChinaSharepointHost = String(row.value || "").trim().toLowerCase();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SHAREPOINT_PATH_KEY) {
      next.oneDriveChinaSharepointPath = normalizeSharePointPath(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_SITE_ID_KEY) {
      next.oneDriveChinaSiteId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_SITE_NAME_KEY) {
      next.oneDriveChinaSiteName = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_DRIVE_ID_KEY) {
      next.oneDriveChinaDriveId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_DRIVE_NAME_KEY) {
      next.oneDriveChinaDriveName = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_ROOT_PATH_KEY) {
      next.oneDriveChinaRootPath = normalizeRootPath(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_REFRESH_TOKEN_KEY) {
      next.oneDriveChinaRefreshToken = String(row.value || "").trim();
      continue;
    }
    if (row.key === ONEDRIVE_CN_AUTHORIZED_AT_KEY) {
      next.oneDriveChinaAuthorizedAt = normalizeIsoDate(row.value);
      continue;
    }
    if (row.key === ONEDRIVE_CN_LAST_ERROR_KEY) {
      next.oneDriveChinaLastError = String(row.value || "").trim();
      continue;
    }
    if (row.key === TENCENT_COS_SECRET_ID_KEY) {
      next.tencentCosSecretId = String(row.value || "").trim();
      continue;
    }
    if (row.key === TENCENT_COS_SECRET_KEY_KEY) {
      next.tencentCosSecretKey = String(row.value || "").trim();
      continue;
    }
    if (row.key === TENCENT_COS_BUCKET_KEY) {
      next.tencentCosBucket = normalizeCosBucket(row.value);
      continue;
    }
    if (row.key === TENCENT_COS_REGION_KEY) {
      next.tencentCosRegion = normalizeCosRegion(row.value);
      continue;
    }
    if (row.key === TENCENT_COS_ROOT_PATH_KEY) {
      next.tencentCosRootPath = normalizeRootPath(row.value);
      continue;
    }
    if (row.key === TENCENT_COS_PUBLIC_BASE_URL_KEY) {
      next.tencentCosPublicBaseUrl = normalizePublicBaseUrl(row.value);
      continue;
    }
    if (row.key === ALIYUN_OSS_ACCESS_KEY_ID_KEY) {
      next.aliyunOssAccessKeyId = String(row.value || "").trim();
      continue;
    }
    if (row.key === ALIYUN_OSS_ACCESS_KEY_SECRET_KEY) {
      next.aliyunOssAccessKeySecret = String(row.value || "").trim();
      continue;
    }
    if (row.key === ALIYUN_OSS_BUCKET_KEY) {
      next.aliyunOssBucket = normalizeOssBucket(row.value);
      continue;
    }
    if (row.key === ALIYUN_OSS_REGION_KEY) {
      next.aliyunOssRegion = normalizeOssRegion(row.value);
      continue;
    }
    if (row.key === ALIYUN_OSS_ROOT_PATH_KEY) {
      next.aliyunOssRootPath = normalizeRootPath(row.value);
      continue;
    }
    if (row.key === ALIYUN_OSS_PUBLIC_BASE_URL_KEY) {
      next.aliyunOssPublicBaseUrl = normalizePublicBaseUrl(row.value);
    }
  }
  sanitizeStorageConfig(next);
  Object.assign(storageConfigCache, next);
  loaded = true;
}

export async function getMediaStorageAdminConfig(): Promise<MediaStorageAdminConfig> {
  await ensureLoaded();
  const normalizedProvider = storageConfigCache.mediaStorageImageProvider === storageConfigCache.mediaStorageVideoProvider
    ? storageConfigCache.mediaStorageImageProvider
    : storageConfigCache.mediaStorageProvider;
  const legacyClientId = String(config.oneDriveChinaClientId || "").trim();
  const legacyClientSecret = String(config.oneDriveChinaClientSecret || "").trim();
  const legacyDriveId = String(config.oneDriveChinaDriveId || "").trim();
  const legacyRootPath = normalizeRootPath(config.oneDriveChinaRootPath);
  return {
    ...cloneStorageConfig({
      ...storageConfigCache,
      mediaStorageProvider: normalizedProvider,
    }),
    oneDriveChinaClientId: storageConfigCache.oneDriveChinaClientId || legacyClientId,
    oneDriveChinaDriveId: storageConfigCache.oneDriveChinaDriveId || legacyDriveId,
    oneDriveChinaDriveName: storageConfigCache.oneDriveChinaDriveName || legacyDriveId,
    oneDriveChinaRootPath: storageConfigCache.oneDriveChinaRootPath || legacyRootPath,
    tencentCosSecretId: storageConfigCache.tencentCosSecretId || String(config.tencentCosSecretId || "").trim(),
    tencentCosBucket: storageConfigCache.tencentCosBucket || normalizeCosBucket(config.tencentCosBucket),
    tencentCosRegion: storageConfigCache.tencentCosRegion || normalizeCosRegion(config.tencentCosRegion),
    tencentCosRootPath: storageConfigCache.tencentCosRootPath || normalizeRootPath(config.tencentCosRootPath),
    tencentCosPublicBaseUrl: storageConfigCache.tencentCosPublicBaseUrl || normalizePublicBaseUrl(config.tencentCosPublicBaseUrl),
    aliyunOssAccessKeyId: storageConfigCache.aliyunOssAccessKeyId || String(config.aliyunOssAccessKeyId || "").trim(),
    aliyunOssBucket: storageConfigCache.aliyunOssBucket || normalizeOssBucket(config.aliyunOssBucket),
    aliyunOssRegion: storageConfigCache.aliyunOssRegion || normalizeOssRegion(config.aliyunOssRegion),
    aliyunOssRootPath: storageConfigCache.aliyunOssRootPath || normalizeRootPath(config.aliyunOssRootPath),
    aliyunOssPublicBaseUrl: storageConfigCache.aliyunOssPublicBaseUrl || normalizePublicBaseUrl(config.aliyunOssPublicBaseUrl),
    oneDriveChinaClientSecretConfigured: Boolean(storageConfigCache.oneDriveChinaClientSecret || legacyClientSecret),
    oneDriveChinaRefreshTokenConfigured: Boolean(storageConfigCache.oneDriveChinaRefreshToken),
    tencentCosSecretKeyConfigured: Boolean(storageConfigCache.tencentCosSecretKey || String(config.tencentCosSecretKey || "").trim()),
    aliyunOssAccessKeySecretConfigured: Boolean(storageConfigCache.aliyunOssAccessKeySecret || String(config.aliyunOssAccessKeySecret || "").trim()),
  };
}

export async function getMediaStorageRuntimeConfig(): Promise<MediaStorageRuntimeConfig> {
  await ensureLoaded();
  return getMediaStorageRuntimeConfigSync();
}

export function getMediaStorageRuntimeConfigSync(): MediaStorageRuntimeConfig {
  const current = cloneStorageConfig(storageConfigCache);
  const fallbackProvider = current.mediaStorageProvider || normalizeMediaStorageProvider(config.mediaStorageProvider, "local");
  const effectiveRemotePrefixes = current.mediaStorageRemotePrefixes.length
    ? [...current.mediaStorageRemotePrefixes]
    : normalizeRemotePrefixes(config.mediaStorageRemotePrefixes, ["forum"]);
  if (current.filestoreRemoteStorageEnabled && !effectiveRemotePrefixes.includes("file-collect")) {
    effectiveRemotePrefixes.push("file-collect");
  }
  return {
    ...current,
    effectiveProvider: fallbackProvider,
    effectiveImageProvider: current.mediaStorageImageProvider || normalizeMediaStorageProvider(config.mediaStorageImageProvider, fallbackProvider),
    effectiveVideoProvider: current.mediaStorageVideoProvider || normalizeMediaStorageProvider(config.mediaStorageVideoProvider, fallbackProvider),
    effectiveRemotePrefixes,
    legacyTenantId: String(config.oneDriveChinaTenantId || "").trim(),
    legacyClientId: String(config.oneDriveChinaClientId || "").trim(),
    legacyClientSecret: String(config.oneDriveChinaClientSecret || "").trim(),
    legacyDriveId: String(config.oneDriveChinaDriveId || "").trim(),
    legacyRootPath: normalizeRootPath(config.oneDriveChinaRootPath),
    legacyTencentCosSecretId: String(config.tencentCosSecretId || "").trim(),
    legacyTencentCosSecretKey: String(config.tencentCosSecretKey || "").trim(),
    legacyTencentCosBucket: normalizeCosBucket(config.tencentCosBucket),
    legacyTencentCosRegion: normalizeCosRegion(config.tencentCosRegion),
    legacyTencentCosRootPath: normalizeRootPath(config.tencentCosRootPath),
    legacyTencentCosPublicBaseUrl: normalizePublicBaseUrl(config.tencentCosPublicBaseUrl),
    legacyAliyunOssAccessKeyId: String(config.aliyunOssAccessKeyId || "").trim(),
    legacyAliyunOssAccessKeySecret: String(config.aliyunOssAccessKeySecret || "").trim(),
    legacyAliyunOssBucket: normalizeOssBucket(config.aliyunOssBucket),
    legacyAliyunOssRegion: normalizeOssRegion(config.aliyunOssRegion),
    legacyAliyunOssRootPath: normalizeRootPath(config.aliyunOssRootPath),
    legacyAliyunOssPublicBaseUrl: normalizePublicBaseUrl(config.aliyunOssPublicBaseUrl),
  };
}

export async function updateMediaStorageAdminConfig(input: {
  mediaStorageProvider?: string;
  mediaStorageImageProvider?: string;
  mediaStorageVideoProvider?: string;
  mediaStorageRemotePrefixes?: string[] | string;
  oneDriveChinaClientId?: string;
  oneDriveChinaClientSecret?: string;
  clearOneDriveChinaClientSecret?: boolean;
  oneDriveChinaSharepointUrl?: string;
  oneDriveChinaRootPath?: string;
  tencentCosSecretId?: string;
  tencentCosSecretKey?: string;
  clearTencentCosSecretKey?: boolean;
  tencentCosBucket?: string;
  tencentCosRegion?: string;
  tencentCosRootPath?: string;
  tencentCosPublicBaseUrl?: string;
  aliyunOssAccessKeyId?: string;
  aliyunOssAccessKeySecret?: string;
  clearAliyunOssAccessKeySecret?: boolean;
  aliyunOssBucket?: string;
  aliyunOssRegion?: string;
  aliyunOssRootPath?: string;
  aliyunOssPublicBaseUrl?: string;
}): Promise<MediaStorageAdminConfig> {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  const legacyClientId = String(config.oneDriveChinaClientId || "").trim();
  const legacyClientSecret = String(config.oneDriveChinaClientSecret || "").trim();
  const previousClientId = next.oneDriveChinaClientId || legacyClientId;
  const previousClientSecret = next.oneDriveChinaClientSecret || legacyClientSecret;
  const previousSharepointUrl = next.oneDriveChinaSharepointUrl;

  if (input.mediaStorageProvider !== undefined) {
    const normalized = normalizeMediaStorageProvider(input.mediaStorageProvider, next.mediaStorageProvider);
    next.mediaStorageProvider = normalized;
    next.mediaStorageImageProvider = normalized;
    next.mediaStorageVideoProvider = normalized;
  }
  if (input.mediaStorageImageProvider !== undefined) {
    next.mediaStorageImageProvider = normalizeMediaStorageProvider(input.mediaStorageImageProvider, next.mediaStorageImageProvider);
  }
  if (input.mediaStorageVideoProvider !== undefined) {
    next.mediaStorageVideoProvider = normalizeMediaStorageProvider(input.mediaStorageVideoProvider, next.mediaStorageVideoProvider);
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
  if (input.tencentCosSecretId !== undefined) {
    next.tencentCosSecretId = String(input.tencentCosSecretId || "").trim();
  }
  if (input.clearTencentCosSecretKey) {
    next.tencentCosSecretKey = "";
  } else if (input.tencentCosSecretKey !== undefined) {
    const raw = String(input.tencentCosSecretKey || "").trim();
    if (raw) next.tencentCosSecretKey = raw;
  }
  if (input.tencentCosBucket !== undefined) next.tencentCosBucket = normalizeCosBucket(input.tencentCosBucket);
  if (input.tencentCosRegion !== undefined) next.tencentCosRegion = normalizeCosRegion(input.tencentCosRegion);
  if (input.tencentCosRootPath !== undefined) next.tencentCosRootPath = normalizeRootPath(input.tencentCosRootPath);
  if (input.tencentCosPublicBaseUrl !== undefined) next.tencentCosPublicBaseUrl = normalizePublicBaseUrl(input.tencentCosPublicBaseUrl);
  if (input.aliyunOssAccessKeyId !== undefined) next.aliyunOssAccessKeyId = String(input.aliyunOssAccessKeyId || "").trim();
  if (input.clearAliyunOssAccessKeySecret) {
    next.aliyunOssAccessKeySecret = "";
  } else if (input.aliyunOssAccessKeySecret !== undefined) {
    const raw = String(input.aliyunOssAccessKeySecret || "").trim();
    if (raw) next.aliyunOssAccessKeySecret = raw;
  }
  if (input.aliyunOssBucket !== undefined) next.aliyunOssBucket = normalizeOssBucket(input.aliyunOssBucket);
  if (input.aliyunOssRegion !== undefined) next.aliyunOssRegion = normalizeOssRegion(input.aliyunOssRegion);
  if (input.aliyunOssRootPath !== undefined) next.aliyunOssRootPath = normalizeRootPath(input.aliyunOssRootPath);
  if (input.aliyunOssPublicBaseUrl !== undefined) next.aliyunOssPublicBaseUrl = normalizePublicBaseUrl(input.aliyunOssPublicBaseUrl);

  const nextClientId = next.oneDriveChinaClientId || legacyClientId;
  const nextClientSecret = next.oneDriveChinaClientSecret || legacyClientSecret;
  const credentialsChanged = previousClientId !== nextClientId || previousClientSecret !== nextClientSecret;
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
  if (next.mediaStorageImageProvider === next.mediaStorageVideoProvider) {
    next.mediaStorageProvider = next.mediaStorageImageProvider;
  }
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
  return getMediaStorageAdminConfig();
}

export async function getFilestoreStorageAdminConfig() {
  await ensureLoaded();
  const runtime = getMediaStorageRuntimeConfigSync();
  const remoteReady = Boolean(
    (runtime.oneDriveChinaRefreshToken.trim() || runtime.legacyClientSecret.trim())
    && (runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim()),
  );
  return {
    enabled: runtime.filestoreRemoteStorageEnabled,
    minSizeMb: runtime.filestoreRemoteMinSizeMb,
    minSizeBytes: Math.round(runtime.filestoreRemoteMinSizeMb * 1024 * 1024),
    remoteReady,
    remoteConfigured: Boolean(runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim()),
    mediaStorageProvider: runtime.effectiveProvider,
    imageProvider: runtime.effectiveImageProvider,
    videoProvider: runtime.effectiveVideoProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    fileCollectPrefix: "file-collect",
    oneDriveChinaSiteName: runtime.oneDriveChinaSiteName,
    oneDriveChinaDriveName: runtime.oneDriveChinaDriveName || runtime.oneDriveChinaDriveId || runtime.legacyDriveId,
    oneDriveChinaRootPath: runtime.oneDriveChinaRootPath || runtime.legacyRootPath,
    oneDriveChinaAuthorizedAt: runtime.oneDriveChinaAuthorizedAt,
    oneDriveChinaLastError: runtime.oneDriveChinaLastError,
  };
}

export async function updateFilestoreStorageAdminConfig(input: { enabled?: boolean; minSizeMb?: number }) {
  await ensureLoaded();
  const next = cloneStorageConfig(storageConfigCache);
  if (input.enabled !== undefined) {
    if (input.enabled) {
      const runtime = getMediaStorageRuntimeConfigSync();
      const remoteReady = Boolean(
        (runtime.oneDriveChinaRefreshToken.trim() || runtime.legacyClientSecret.trim())
        && (runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim()),
      );
      if (!remoteReady) throw new Error("请先在媒体存储页完成世纪互联授权并选择文档库");
    }
    next.filestoreRemoteStorageEnabled = Boolean(input.enabled);
  }
  if (input.minSizeMb !== undefined) {
    next.filestoreRemoteMinSizeMb = normalizeFileSizeThresholdMb(input.minSizeMb, next.filestoreRemoteMinSizeMb);
  }
  sanitizeStorageConfig(next);
  await persistStorageConfig(next);
  Object.assign(storageConfigCache, next);
  return getFilestoreStorageAdminConfig();
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
  target.mediaStorageImageProvider = normalizeMediaStorageProvider(target.mediaStorageImageProvider, target.mediaStorageProvider);
  target.mediaStorageVideoProvider = normalizeMediaStorageProvider(target.mediaStorageVideoProvider, target.mediaStorageProvider);
  target.mediaStorageRemotePrefixes = normalizeRemotePrefixes(target.mediaStorageRemotePrefixes, ["forum"]);
  target.filestoreRemoteStorageEnabled = Boolean(target.filestoreRemoteStorageEnabled);
  target.filestoreRemoteMinSizeMb = normalizeFileSizeThresholdMb(target.filestoreRemoteMinSizeMb, 0);
  target.oneDriveChinaSharepointUrl = normalizeOptionalUrl(target.oneDriveChinaSharepointUrl);
  target.oneDriveChinaSharepointHost = String(target.oneDriveChinaSharepointHost || "").trim().toLowerCase();
  target.oneDriveChinaSharepointPath = normalizeSharePointPath(target.oneDriveChinaSharepointPath);
  target.oneDriveChinaRootPath = normalizeRootPath(target.oneDriveChinaRootPath);
  target.oneDriveChinaAuthorizedAt = normalizeIsoDate(target.oneDriveChinaAuthorizedAt);
  target.oneDriveChinaLastError = String(target.oneDriveChinaLastError || "").trim().slice(0, 500);
  target.tencentCosSecretId = String(target.tencentCosSecretId || "").trim();
  target.tencentCosSecretKey = String(target.tencentCosSecretKey || "").trim();
  target.tencentCosBucket = normalizeCosBucket(target.tencentCosBucket);
  target.tencentCosRegion = normalizeCosRegion(target.tencentCosRegion);
  target.tencentCosRootPath = normalizeRootPath(target.tencentCosRootPath);
  target.tencentCosPublicBaseUrl = normalizePublicBaseUrl(target.tencentCosPublicBaseUrl);
  target.aliyunOssAccessKeyId = String(target.aliyunOssAccessKeyId || "").trim();
  target.aliyunOssAccessKeySecret = String(target.aliyunOssAccessKeySecret || "").trim();
  target.aliyunOssBucket = normalizeOssBucket(target.aliyunOssBucket);
  target.aliyunOssRegion = normalizeOssRegion(target.aliyunOssRegion);
  target.aliyunOssRootPath = normalizeRootPath(target.aliyunOssRootPath);
  target.aliyunOssPublicBaseUrl = normalizePublicBaseUrl(target.aliyunOssPublicBaseUrl);
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
    [MEDIA_STORAGE_IMAGE_PROVIDER_KEY, next.mediaStorageImageProvider],
    [MEDIA_STORAGE_VIDEO_PROVIDER_KEY, next.mediaStorageVideoProvider],
    [MEDIA_STORAGE_REMOTE_PREFIXES_KEY, next.mediaStorageRemotePrefixes.join(",")],
    [FILESTORE_REMOTE_STORAGE_ENABLED_KEY, next.filestoreRemoteStorageEnabled ? "on" : "off"],
    [FILESTORE_REMOTE_MIN_SIZE_MB_KEY, String(next.filestoreRemoteMinSizeMb)],
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
    [TENCENT_COS_SECRET_ID_KEY, next.tencentCosSecretId],
    [TENCENT_COS_SECRET_KEY_KEY, next.tencentCosSecretKey],
    [TENCENT_COS_BUCKET_KEY, next.tencentCosBucket],
    [TENCENT_COS_REGION_KEY, next.tencentCosRegion],
    [TENCENT_COS_ROOT_PATH_KEY, next.tencentCosRootPath],
    [TENCENT_COS_PUBLIC_BASE_URL_KEY, next.tencentCosPublicBaseUrl],
    [ALIYUN_OSS_ACCESS_KEY_ID_KEY, next.aliyunOssAccessKeyId],
    [ALIYUN_OSS_ACCESS_KEY_SECRET_KEY, next.aliyunOssAccessKeySecret],
    [ALIYUN_OSS_BUCKET_KEY, next.aliyunOssBucket],
    [ALIYUN_OSS_REGION_KEY, next.aliyunOssRegion],
    [ALIYUN_OSS_ROOT_PATH_KEY, next.aliyunOssRootPath],
    [ALIYUN_OSS_PUBLIC_BASE_URL_KEY, next.aliyunOssPublicBaseUrl],
  ];
  await prisma.$transaction(entries.map(([key, value]) => prisma.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })));
  await resetStorageRuntimeCachesLocally();
  await broadcastStorageConfigReload();
}

async function resetStorageRuntimeCachesLocally() {
  await Promise.all([
    import("./mediaStorage")
      .then((module) => module.resetMediaStorageRuntimeCaches())
      .catch(() => undefined),
    import("./oneDriveChina")
      .then((module) => module.resetOneDriveChinaTransientCaches())
      .catch(() => undefined),
    import("./tencentCos")
      .then((module) => module.resetTencentCosClientCache())
      .catch(() => undefined),
    import("./aliyunOss")
      .then((module) => module.resetAliyunOssClientCache())
      .catch(() => undefined),
  ]);
}

function normalizeMediaStorageProvider(input: unknown, fallback: MediaStorageProvider): MediaStorageProvider {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "cos") return "cos";
  if (raw === "oss") return "oss";
  if (raw === "onedrive-cn") return "onedrive-cn";
  if (raw === "local") return "local";
  return fallback;
}

function normalizeCosBucket(input: unknown) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (!/^[a-z0-9][a-z0-9-]{1,58}-\d{5,20}$/u.test(raw)) {
    throw new Error("COS 存储桶名称格式不正确，应包含 APPID 后缀");
  }
  return raw;
}

function normalizeCosRegion(input: unknown) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9-]{1,40}$/u.test(raw)) throw new Error("COS 地域格式不正确");
  return raw;
}

function normalizeOssBucket(input: unknown) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(raw)) {
    throw new Error("OSS 存储桶名称格式不正确");
  }
  return raw;
}

function normalizeOssRegion(input: unknown) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (!/^oss-[a-z][a-z0-9-]{1,40}$/u.test(raw)) throw new Error("OSS 地域格式不正确");
  return raw;
}

function normalizePublicBaseUrl(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("COS 公网/CDN 域名格式不正确");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("COS 公网/CDN 域名必须是 HTTPS 地址");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/u, "");
}

function parseBooleanSetting(input: unknown, fallback: boolean) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeFileSizeThresholdMb(input: unknown, fallback: number) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(10240, Math.round(value * 100) / 100);
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
