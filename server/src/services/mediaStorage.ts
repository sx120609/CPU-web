import type { RequestHandler } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { mediaImageDeliveryUrl } from "../utils/mediaImageUrl";
import { prisma } from "../prisma";
import {
  createOneDriveChinaUploadSession,
  deleteOneDriveChinaFile,
  fetchOneDriveChinaFile,
  listOneDriveChinaFiles,
  resolveOneDriveChinaDirectDownloadUrl,
  uploadOneDriveChinaFile,
} from "./oneDriveChina";
import { getCachedJson, setCachedJson } from "./cache";
import { buildRedisKey } from "./redis";
import { getMediaStorageRuntimeConfig, getMediaStorageRuntimeConfigSync, type MediaStorageKind } from "./storageConfig";
import {
  createTencentCosUploadSession,
  deleteTencentCosFile,
  downloadTencentCosFileBuffer,
  fetchTencentCosFile,
  headTencentCosFile,
  isTencentCosConfigured,
  listTencentCosFiles,
  resolveTencentCosPublicUrl,
  uploadTencentCosFile,
} from "./tencentCos";
import {
  createAliyunOssUploadSession,
  deleteAliyunOssFile,
  downloadAliyunOssFileBuffer,
  fetchAliyunOssFile,
  headAliyunOssFile,
  isAliyunOssConfigured,
  listAliyunOssFiles,
  resolveAliyunOssPublicUrl,
  uploadAliyunOssFile,
} from "./aliyunOss";

const CACHE_CONTROL_VALUE = "public, max-age=2592000, immutable";
const REMOTE_PUBLIC_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const WEB_STATIC_PREFIX = "web-static/";

export type MediaStorageBackend = "local" | "onedrive-cn" | "cos" | "oss";

export type SaveMediaAssetInput = {
  relativePath: string;
  buffer: Buffer;
  contentType?: string | null;
  mediaKind?: MediaStorageKind | null;
};

export type SaveMediaAssetResult = {
  backend: MediaStorageBackend;
  relativePath: string;
  url: string;
  localPath: string;
};

export type MediaProcessingLocalFile = {
  localPath: string;
  temporary: boolean;
};

export type MediaStorageAdminFileEntry = {
  relativePath: string;
  url: string;
  mediaKind: MediaStorageKind | "unknown";
  configuredBackend: MediaStorageBackend;
  inRemotePrefix: boolean;
  localExists: boolean;
  cacheExists: boolean;
  remoteExists: boolean;
  localSizeBytes: number | null;
  cacheSizeBytes: number | null;
  remoteSizeBytes: number | null;
  localUpdatedAt: string;
  cacheUpdatedAt: string;
  remoteUpdatedAt: string;
  oneDriveExists: boolean;
  oneDriveSizeBytes: number | null;
  oneDriveUpdatedAt: string;
  cosExists: boolean;
  cosSizeBytes: number | null;
  cosUpdatedAt: string;
  ossExists: boolean;
  ossSizeBytes: number | null;
  ossUpdatedAt: string;
};

export type MediaStorageAdminInventory = {
  generatedAt: string;
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
  remotePrefixes: string[];
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteError: string;
  oneDriveConfigured: boolean;
  oneDriveReachable: boolean;
  oneDriveError: string;
  cosConfigured: boolean;
  cosReachable: boolean;
  cosError: string;
  ossConfigured: boolean;
  ossReachable: boolean;
  ossError: string;
  summary: {
    total: number;
    localCount: number;
    cacheCount: number;
    remoteCount: number;
    oneDriveCount: number;
    cosCount: number;
    ossCount: number;
    legacyAvatarCount: number;
    eligibleMigrationCount: number;
    syncedCount: number;
    migratedCount: number;
    outOfScopeLocalCount: number;
  };
  list: MediaStorageAdminFileEntry[];
};

export type MediaStorageMigrationItem = {
  relativePath: string;
  status: "migrated" | "failed";
  message: string;
};

export type MediaStorageMigrationResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
  remotePrefixes: string[];
  eligible: number;
  processed: number;
  remaining: number;
  batchLimit: number;
  migrated: number;
  failed: number;
  list: MediaStorageMigrationItem[];
};

export type MediaStorageCleanupItem = {
  relativePath: string;
  status: "removed" | "failed";
  message: string;
};

export type MediaStorageCleanupResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
  remotePrefixes: string[];
  eligible: number;
  removed: number;
  failed: number;
  list: MediaStorageCleanupItem[];
};

const localUploadRoot = path.resolve(process.cwd(), "uploads");
const mediaCacheRoot = path.resolve(process.cwd(), "runtime", "media-cache");
const remotePublicUrlCache = new Map<string, { url: string; expiresAt: number }>();
const remotePublicUrlPromises = new Map<string, Promise<string>>();

export function resetMediaStorageRuntimeCaches() {
  remotePublicUrlCache.clear();
  remotePublicUrlPromises.clear();
}

export function buildUploadUrl(relativePath: string) {
  return `/uploads/${normalizeUploadRelativePath(relativePath)}`;
}

export function resolveMediaKindForRelativePath(relativePath: string): MediaStorageKind | "unknown" {
  const ext = path.extname(normalizeUploadRelativePath(relativePath)).replace(/^\./, "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp"].includes(ext)) return "image";
  if (["mp4", "webm", "ogv", "mov", "m4v", "mkv"].includes(ext)) return "video";
  return "unknown";
}

function summarizeConfiguredProvider(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>) {
  return runtime.effectiveImageProvider === runtime.effectiveVideoProvider
    ? runtime.effectiveImageProvider
    : "mixed";
}

function resolveConfiguredBackendForRelativePath(
  relativePath: string,
  runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>,
): MediaStorageBackend {
  if (isFileCollectRelativePath(relativePath) && runtime.filestoreRemoteStorageEnabled) return "onedrive-cn";
  const kind = resolveMediaKindForRelativePath(relativePath);
  if (kind === "video") return runtime.effectiveVideoProvider;
  if (kind === "image") return runtime.effectiveImageProvider;
  return runtime.effectiveProvider;
}

function resolveConfiguredBackendForInventoryRow(
  relativePath: string,
  runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>,
  sizeBytes: number | null,
): MediaStorageBackend {
  if (isFileCollectRelativePath(relativePath) && runtime.filestoreRemoteStorageEnabled) {
    const thresholdBytes = Math.round(Math.max(0, Number(runtime.filestoreRemoteMinSizeMb || 0)) * 1024 * 1024);
    if (thresholdBytes > 0 && sizeBytes !== null && sizeBytes < thresholdBytes) return "local";
    return "onedrive-cn";
  }
  return resolveConfiguredBackendForRelativePath(relativePath, runtime);
}

function remoteStorageConfigured(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>) {
  return oneDriveStorageConfigured(runtime) || cosStorageConfigured(runtime) || ossStorageConfigured(runtime);
}

function oneDriveStorageConfigured(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>) {
  return Boolean(runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim());
}

function cosStorageConfigured(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>) {
  return Boolean(
    (runtime.tencentCosSecretId.trim() || runtime.legacyTencentCosSecretId.trim())
    && (runtime.tencentCosSecretKey.trim() || runtime.legacyTencentCosSecretKey.trim())
    && (runtime.tencentCosBucket.trim() || runtime.legacyTencentCosBucket.trim())
    && (runtime.tencentCosRegion.trim() || runtime.legacyTencentCosRegion.trim()),
  );
}

function ossStorageConfigured(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfigSync>>) {
  return Boolean(
    (runtime.aliyunOssAccessKeyId.trim() || runtime.legacyAliyunOssAccessKeyId.trim())
    && (runtime.aliyunOssAccessKeySecret.trim() || runtime.legacyAliyunOssAccessKeySecret.trim())
    && (runtime.aliyunOssBucket.trim() || runtime.legacyAliyunOssBucket.trim())
    && (runtime.aliyunOssRegion.trim() || runtime.legacyAliyunOssRegion.trim()),
  );
}

export function resolveMediaLocalPathFromUploadUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return "";
  const existing = resolveExistingLocalMediaPath(relativePath);
  if (existing) return existing;
  return resolvePreferredLocalMediaPath(relativePath);
}

export async function ensureMediaLocalPathFromUploadUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return "";
  const existing = resolveExistingLocalMediaPath(relativePath);
  if (existing) return existing;
  if (!(await canUseRemoteMediaStorageFallback(relativePath))) {
    return resolvePreferredLocalMediaPath(relativePath);
  }
  return hydrateRemoteMediaToCache(relativePath);
}

export async function resolveMediaPublicUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return String(url || "").trim();
  const runtime = await getMediaStorageRuntimeConfig();
  const configuredBackend = resolveConfiguredBackendForRelativePath(relativePath, runtime);
  const usesRemote = configuredBackend !== "local" && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
  if (!usesRemote) {
    return buildUploadUrl(relativePath);
  }

  const cached = remotePublicUrlCache.get(relativePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const remoteDriveKey = configuredBackend === "cos"
    ? runtime.tencentCosBucket.trim() || runtime.legacyTencentCosBucket.trim() || "default"
    : configuredBackend === "oss"
      ? runtime.aliyunOssBucket.trim() || runtime.legacyAliyunOssBucket.trim() || "default"
      : runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim() || "default";
  const sharedCacheKey = buildRedisKey("media-public-url", configuredBackend, remoteDriveKey, relativePath);
  const sharedCachedUrl = await getCachedJson<string>(sharedCacheKey);
  if (sharedCachedUrl) {
    remotePublicUrlCache.set(relativePath, {
      url: sharedCachedUrl,
      expiresAt: Date.now() + REMOTE_PUBLIC_URL_CACHE_TTL_MS,
    });
    return sharedCachedUrl;
  }

  const existingPromise = remotePublicUrlPromises.get(relativePath);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    try {
      const directUrl = configuredBackend === "cos"
        ? await resolveTencentCosPublicUrl(relativePath)
        : configuredBackend === "oss"
          ? await resolveAliyunOssPublicUrl(relativePath)
          : await resolveOneDriveChinaDirectDownloadUrl(relativePath);
      const resolved = directUrl || buildUploadUrl(relativePath);
      if (directUrl) {
        remotePublicUrlCache.set(relativePath, {
          url: directUrl,
          expiresAt: Date.now() + REMOTE_PUBLIC_URL_CACHE_TTL_MS,
        });
        await setCachedJson(sharedCacheKey, directUrl, REMOTE_PUBLIC_URL_CACHE_TTL_MS).catch(() => undefined);
      }
      return resolved;
    } catch {
      return buildUploadUrl(relativePath);
    } finally {
      remotePublicUrlPromises.delete(relativePath);
    }
  })();

  remotePublicUrlPromises.set(relativePath, promise);
  return promise;
}

export async function shouldUseRemoteMediaStorageForRelativePath(relativePath: string) {
  return shouldPreferRemoteMediaStorage(normalizeUploadRelativePath(relativePath));
}

export async function createRemoteMediaUploadSession(input: {
  relativePath: string;
  contentType?: string | null;
  mediaKind?: MediaStorageKind | null;
  sizeBytes?: number | null;
}) {
  const relativePath = normalizeUploadRelativePath(input.relativePath);
  const backend = await preferredRemoteMediaStorageBackend(relativePath, input.mediaKind ?? undefined, input.sizeBytes ?? undefined);
  if (backend === "cos") return createTencentCosUploadSession(relativePath, input.contentType);
  if (backend === "oss") return createAliyunOssUploadSession(relativePath, input.contentType);
  if (backend === "onedrive-cn") {
    const session = await createOneDriveChinaUploadSession(relativePath, input.contentType);
    return { ...session, strategy: "chunked" as const };
  }
  return null;
}

export async function prepareMediaLocalFileForProcessing(url: string): Promise<MediaProcessingLocalFile> {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return { localPath: "", temporary: false };
  const existing = resolveExistingLocalMediaPath(relativePath);
  if (existing) return { localPath: existing, temporary: false };
  if (!(await canUseRemoteMediaStorageFallback(relativePath))) {
    return {
      localPath: resolvePreferredLocalMediaPath(relativePath),
      temporary: false,
    };
  }
  try {
    const buffer = await downloadConfiguredRemoteFileBuffer(relativePath);
    if (!buffer.length) return { localPath: "", temporary: false };
    const ext = path.extname(relativePath).replace(/^\./, "").toLowerCase();
    const tempDir = path.resolve(process.cwd(), "runtime", "media-processing");
    await mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `${Date.now()}-${randomUUID()}${ext ? `.${ext}` : ""}`);
    await writeFile(localPath, buffer);
    return { localPath, temporary: true };
  } catch {
    return { localPath: "", temporary: false };
  }
}

export async function saveMediaAsset(input: SaveMediaAssetInput): Promise<SaveMediaAssetResult> {
  const relativePath = normalizeUploadRelativePath(input.relativePath);
  const backend = await preferredRemoteMediaStorageBackend(relativePath, input.mediaKind ?? undefined, input.buffer.byteLength);
  if (!backend) {
    const localPath = localAssetAbsolutePath(relativePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, input.buffer);
    return {
      backend: "local",
      relativePath,
      url: buildUploadUrl(relativePath),
      localPath,
    };
  }

  const cachePath = cachedAssetAbsolutePath(relativePath);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, input.buffer);
  if (backend === "cos") {
    await uploadTencentCosFile(relativePath, input.buffer, input.contentType || "application/octet-stream");
  } else if (backend === "oss") {
    await uploadAliyunOssFile(relativePath, input.buffer, input.contentType || "application/octet-stream");
  } else {
    await uploadOneDriveChinaFile(relativePath, input.buffer, input.contentType || "application/octet-stream");
  }
  return {
    backend,
    relativePath,
    url: buildUploadUrl(relativePath),
    localPath: cachePath,
  };
}

export async function deleteMediaAsset(relativePathInput: string) {
  const relativePath = normalizeUploadRelativePath(relativePathInput);
  const [runtime] = await Promise.all([getMediaStorageRuntimeConfig()]);
  const localPath = localAssetAbsolutePath(relativePath);
  const cachePath = cachedAssetAbsolutePath(relativePath);
  await Promise.all([
    unlink(localPath).catch((error: any) => {
      if (error?.code !== "ENOENT") throw error;
    }),
    unlink(cachePath).catch((error: any) => {
      if (error?.code !== "ENOENT") throw error;
    }),
  ]);
  const shouldDeleteRemote = remoteStorageConfigured(runtime)
    && (pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes) || isFileCollectRelativePath(relativePath));
  if (shouldDeleteRemote) {
    await Promise.all([
      oneDriveStorageConfigured(runtime)
        ? deleteOneDriveChinaFile(relativePath).catch((error: any) => {
          if (String(error?.message || "").includes("404")) return false;
          throw error;
        })
        : Promise.resolve(false),
      cosStorageConfigured(runtime) ? deleteTencentCosFile(relativePath) : Promise.resolve(false),
      ossStorageConfigured(runtime) ? deleteAliyunOssFile(relativePath) : Promise.resolve(false),
    ]);
  }
}

export async function listMediaStorageAdminInventory(): Promise<MediaStorageAdminInventory> {
  const runtime = await getMediaStorageRuntimeConfig();
  const [localFiles, cacheFiles, legacyAvatarCount] = await Promise.all([
    collectLocalFiles(localUploadRoot),
    collectLocalFiles(mediaCacheRoot),
    prisma.user.count({ where: { avatar: { startsWith: "data:image/" } } }),
  ]);
  const oneDriveConfigured = oneDriveStorageConfigured(runtime);
  const cosConfigured = cosStorageConfigured(runtime) && await isTencentCosConfigured();
  const ossConfigured = ossStorageConfigured(runtime) && await isAliyunOssConfigured();
  let oneDriveReachable = false;
  let oneDriveError = "";
  let cosReachable = false;
  let cosError = "";
  let ossReachable = false;
  let ossError = "";
  let oneDriveFiles = new Map<string, { sizeBytes: number | null; updatedAt: string }>();
  let cosFiles = new Map<string, { sizeBytes: number | null; updatedAt: string }>();
  let ossFiles = new Map<string, { sizeBytes: number | null; updatedAt: string }>();

  if (oneDriveConfigured) {
    try {
      oneDriveFiles = new Map(
        (await listOneDriveChinaFiles()).map((item) => [
          normalizeUploadRelativePath(item.relativePath),
          {
            sizeBytes: typeof item.size === "number" ? item.size : null,
            updatedAt: String(item.lastModifiedAt || "").trim(),
          },
        ]),
      );
      oneDriveReachable = true;
    } catch (error) {
      oneDriveError = String((error as any)?.message || error || "读取世纪互联文件列表失败").slice(0, 500);
    }
  }
  if (cosConfigured) {
    try {
      cosFiles = new Map(
        (await listTencentCosFiles())
          .filter((item) => !normalizeUploadRelativePath(item.relativePath).startsWith(WEB_STATIC_PREFIX))
          .map((item) => [
            normalizeUploadRelativePath(item.relativePath),
            { sizeBytes: item.size, updatedAt: String(item.lastModifiedAt || "").trim() },
          ]),
      );
      cosReachable = true;
    } catch (error) {
      cosError = String((error as any)?.message || error || "读取腾讯云 COS 文件列表失败").slice(0, 500);
    }
  }
  if (ossConfigured) {
    try {
      ossFiles = new Map(
        (await listAliyunOssFiles())
          .filter((item) => !normalizeUploadRelativePath(item.relativePath).startsWith(WEB_STATIC_PREFIX))
          .map((item) => [
            normalizeUploadRelativePath(item.relativePath),
            { sizeBytes: item.size, updatedAt: String(item.lastModifiedAt || "").trim() },
          ]),
      );
      ossReachable = true;
    } catch (error) {
      ossError = String((error as any)?.message || error || "读取阿里云 OSS 文件列表失败").slice(0, 500);
    }
  }

  const remoteConfigured = oneDriveConfigured || cosConfigured || ossConfigured;
  const remoteReachable = (!oneDriveConfigured || oneDriveReachable)
    && (!cosConfigured || cosReachable)
    && (!ossConfigured || ossReachable)
    && remoteConfigured;
  const remoteError = [oneDriveError, cosError, ossError].filter(Boolean).join("；");

  const allPaths = new Set<string>([
    ...localFiles.keys(),
    ...cacheFiles.keys(),
    ...oneDriveFiles.keys(),
    ...cosFiles.keys(),
    ...ossFiles.keys(),
  ]);
  const list = Array.from(allPaths)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((relativePath) => {
      const local = localFiles.get(relativePath);
      const cache = cacheFiles.get(relativePath);
      const oneDrive = oneDriveFiles.get(relativePath);
      const cos = cosFiles.get(relativePath);
      const oss = ossFiles.get(relativePath);
      const mediaKind = resolveMediaKindForRelativePath(relativePath);
      const sizeBytes = local?.sizeBytes ?? cache?.sizeBytes ?? oss?.sizeBytes ?? cos?.sizeBytes ?? oneDrive?.sizeBytes ?? null;
      const configuredBackend = resolveConfiguredBackendForInventoryRow(relativePath, runtime, sizeBytes);
      const eligibleForRemote = configuredBackend !== "local" && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
      const configuredRemote = configuredBackend === "cos"
        ? cos
        : configuredBackend === "oss"
          ? oss
          : configuredBackend === "onedrive-cn"
            ? oneDrive
            : undefined;
      const anyRemote = configuredRemote || oss || cos || oneDrive;
      return {
        relativePath,
        url: buildUploadUrl(relativePath),
        mediaKind,
        configuredBackend,
        inRemotePrefix: eligibleForRemote,
        localExists: Boolean(local),
        cacheExists: Boolean(cache),
        remoteExists: Boolean(anyRemote),
        localSizeBytes: local?.sizeBytes ?? null,
        cacheSizeBytes: cache?.sizeBytes ?? null,
        remoteSizeBytes: anyRemote?.sizeBytes ?? null,
        localUpdatedAt: local?.updatedAt ?? "",
        cacheUpdatedAt: cache?.updatedAt ?? "",
        remoteUpdatedAt: anyRemote?.updatedAt ?? "",
        oneDriveExists: Boolean(oneDrive),
        oneDriveSizeBytes: oneDrive?.sizeBytes ?? null,
        oneDriveUpdatedAt: oneDrive?.updatedAt ?? "",
        cosExists: Boolean(cos),
        cosSizeBytes: cos?.sizeBytes ?? null,
        cosUpdatedAt: cos?.updatedAt ?? "",
        ossExists: Boolean(oss),
        ossSizeBytes: oss?.sizeBytes ?? null,
        ossUpdatedAt: oss?.updatedAt ?? "",
      } satisfies MediaStorageAdminFileEntry;
    });

  return {
    generatedAt: new Date().toISOString(),
    mediaStorageProvider: summarizeConfiguredProvider(runtime),
    mediaStorageImageProvider: runtime.effectiveImageProvider,
    mediaStorageVideoProvider: runtime.effectiveVideoProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    remoteConfigured,
    remoteReachable,
    remoteError,
    oneDriveConfigured,
    oneDriveReachable,
    oneDriveError,
    cosConfigured,
    cosReachable,
    cosError,
    ossConfigured,
    ossReachable,
    ossError,
    summary: {
      total: list.length,
      localCount: list.filter((item) => item.localExists).length,
      cacheCount: list.filter((item) => item.cacheExists).length,
      remoteCount: list.filter((item) => item.remoteExists).length,
      oneDriveCount: list.filter((item) => item.oneDriveExists).length,
      cosCount: list.filter((item) => item.cosExists).length,
      ossCount: list.filter((item) => item.ossExists).length,
      legacyAvatarCount,
      eligibleMigrationCount: list.filter((item) => needsMigrationToConfiguredBackend(item)).length + legacyAvatarCount,
      syncedCount: list.filter((item) => hasRedundantCopiesForConfiguredBackend(item)).length,
      migratedCount: list.filter((item) => isStoredOnConfiguredBackend(item)).length,
      outOfScopeLocalCount: list.filter((item) => item.configuredBackend !== "local" && item.localExists && !item.inRemotePrefix).length,
    },
    list,
  };
}

export async function migrateLocalMediaAssetsToRemote(input: {
  limit?: number;
  excludePaths?: string[];
} = {}): Promise<MediaStorageMigrationResult> {
  const runtime = await getMediaStorageRuntimeConfig();
  const startedAt = new Date().toISOString();
  const inventory = await listMediaStorageAdminInventory();
  const batchLimit = normalizeMigrationBatchLimit(input.limit);
  const excluded = new Set((input.excludePaths ?? []).map((item) => normalizeRequestRelativePath(item)).filter(Boolean));
  const allEligibleFiles = inventory.list
    .filter((item) => needsMigrationToConfiguredBackend(item))
    .map((item) => item.relativePath)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const pendingFiles = allEligibleFiles.filter((item) => !excluded.has(normalizeUploadRelativePath(item)));
  const eligibleFiles = pendingFiles.slice(0, batchLimit);

  const results: MediaStorageMigrationItem[] = [];
  for (const relativePath of eligibleFiles) {
    const localPath = localAssetAbsolutePath(relativePath);
    const cachePath = cachedAssetAbsolutePath(relativePath);
    try {
      const inventoryRow = inventory.list.find((item) => item.relativePath === relativePath);
      if (!inventoryRow) continue;
      const targetBackend = inventoryRow.configuredBackend;
      const sourceBuffer = await readMigrationSourceBuffer(inventoryRow, localPath, cachePath);
      if (!sourceBuffer.length) throw new Error("缺少可迁移的源文件");

      if (targetBackend !== "local") {
        if (targetBackend === "cos") {
          await uploadTencentCosFile(relativePath, sourceBuffer, guessContentType(relativePath));
          const verified = await headTencentCosFile(relativePath);
          if (!verified.exists || (verified.size !== null && verified.size !== sourceBuffer.length)) {
            throw new Error("COS 上传后的文件大小校验失败");
          }
        } else if (targetBackend === "oss") {
          await uploadAliyunOssFile(relativePath, sourceBuffer, guessContentType(relativePath));
          const verified = await headAliyunOssFile(relativePath);
          if (!verified.exists || (verified.size !== null && verified.size !== sourceBuffer.length)) {
            throw new Error("OSS 上传后的文件大小校验失败");
          }
        } else {
          await uploadOneDriveChinaFile(relativePath, sourceBuffer, guessContentType(relativePath));
        }
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, sourceBuffer);
        await syncMediaAssetLocalPath(relativePath, cachePath);
        results.push({
          relativePath,
          status: "migrated",
          message: targetBackend === "cos"
            ? "已迁移到腾讯云 COS 并完成大小校验"
            : targetBackend === "oss"
              ? "已迁移到阿里云 OSS 并完成大小校验"
              : "已迁移到世纪互联并同步当前后端",
        });
        continue;
      }

      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, sourceBuffer);
      await syncMediaAssetLocalPath(relativePath, localPath);
      results.push({
        relativePath,
        status: "migrated",
        message: "已迁移到本地并切换为当前后端",
      });
    } catch (error) {
      results.push({
        relativePath,
        status: "failed",
        message: String((error as any)?.message || error || "迁移失败").slice(0, 500),
      });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mediaStorageProvider: summarizeConfiguredProvider(runtime),
    mediaStorageImageProvider: runtime.effectiveImageProvider,
    mediaStorageVideoProvider: runtime.effectiveVideoProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    eligible: allEligibleFiles.length,
    processed: eligibleFiles.length,
    remaining: Math.max(0, pendingFiles.length - eligibleFiles.length),
    batchLimit,
    migrated: results.filter((item) => item.status === "migrated").length,
    failed: results.filter((item) => item.status === "failed").length,
    list: results,
  };
}

export async function cleanupMigratedLocalMediaAssets(): Promise<MediaStorageCleanupResult> {
  const runtime = await getMediaStorageRuntimeConfig();
  const startedAt = new Date().toISOString();
  const inventory = await listMediaStorageAdminInventory();
  const eligibleFiles = inventory.list
    .filter((item) => hasRedundantCopiesForConfiguredBackend(item))
    .map((item) => item.relativePath)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const results: MediaStorageCleanupItem[] = [];
  for (const relativePath of eligibleFiles) {
    const row = inventory.list.find((item) => item.relativePath === relativePath);
    if (!row) continue;
    const localPath = localAssetAbsolutePath(relativePath);
    const cachePath = cachedAssetAbsolutePath(relativePath);
    try {
      let removedAny = false;
      if (row.configuredBackend !== "local") {
        for (const targetPath of [localPath, cachePath]) {
          const removed = await unlink(targetPath)
            .then(() => true)
            .catch((error: any) => {
              if (error?.code === "ENOENT") return false;
              throw error;
            });
          removedAny = removedAny || removed;
        }
        if (row.configuredBackend === "cos" && row.oneDriveExists) {
          removedAny = await deleteOneDriveChinaFile(relativePath) || removedAny;
        }
        if (row.configuredBackend === "cos" && row.ossExists) {
          removedAny = await deleteAliyunOssFile(relativePath) || removedAny;
        }
        if (row.configuredBackend === "oss" && row.oneDriveExists) {
          removedAny = await deleteOneDriveChinaFile(relativePath) || removedAny;
        }
        if (row.configuredBackend === "oss" && row.cosExists) {
          removedAny = await deleteTencentCosFile(relativePath) || removedAny;
        }
        if (row.configuredBackend === "onedrive-cn" && row.cosExists) {
          removedAny = await deleteTencentCosFile(relativePath) || removedAny;
        }
        if (row.configuredBackend === "onedrive-cn" && row.ossExists) {
          removedAny = await deleteAliyunOssFile(relativePath) || removedAny;
        }
        await syncMediaAssetLocalPath(relativePath, "");
      } else {
        const cacheRemoved = await unlink(cachePath)
          .then(() => true)
          .catch((error: any) => {
            if (error?.code === "ENOENT") return false;
            throw error;
          });
        removedAny = removedAny || cacheRemoved;
        if (row.oneDriveExists) removedAny = await deleteOneDriveChinaFile(relativePath) || removedAny;
        if (row.cosExists) removedAny = await deleteTencentCosFile(relativePath) || removedAny;
        if (row.ossExists) removedAny = await deleteAliyunOssFile(relativePath) || removedAny;
      }
      results.push({
        relativePath,
        status: "removed",
        message: removedAny
          ? (row.configuredBackend !== "local" ? "已删除非当前后端的本地、缓存或旧远端副本" : "已删除非当前后端的远端/缓存副本")
          : "没有需要删除的旧副本",
      });
    } catch (error) {
      results.push({
        relativePath,
        status: "failed",
        message: String((error as any)?.message || error || "删除本地副本失败").slice(0, 500),
      });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mediaStorageProvider: summarizeConfiguredProvider(runtime),
    mediaStorageImageProvider: runtime.effectiveImageProvider,
    mediaStorageVideoProvider: runtime.effectiveVideoProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    eligible: eligibleFiles.length,
    removed: results.filter((item) => item.status === "removed").length,
    failed: results.filter((item) => item.status === "failed").length,
    list: results,
  };
}

export const uploadAssetHandler: RequestHandler = async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.status(405).send("不支持的请求方法");
    return;
  }

  const relativePath = normalizeRequestRelativePath(decodeRequestPathname(req.path));
  if (!relativePath) {
    res.status(404).send("文件不存在");
    return;
  }

  if (await canUseRemoteMediaStorageFallback(relativePath)) {
    try {
      const runtime = await getMediaStorageRuntimeConfig();
      const configuredBackend = resolveConfiguredBackendForRelativePath(relativePath, runtime);
      if (configuredBackend === "cos" && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes)) {
        res.setHeader("Cache-Control", "no-cache");
        res.redirect(302, mediaImageDeliveryUrl(await resolveTencentCosPublicUrl(relativePath), "cos", relativePath, req.query));
        return;
      }
      if (configuredBackend === "oss" && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes)) {
        res.setHeader("Cache-Control", "no-cache");
        res.redirect(302, mediaImageDeliveryUrl(await resolveAliyunOssPublicUrl(relativePath), "oss", relativePath, req.query));
        return;
      }
      const remote = await fetchConfiguredRemoteMedia(relativePath, req.headers.range, req.headers["if-none-match"]);
      if (remote && (remote.status >= 200 && remote.status < 300 || remote.status === 304)) {
        writeRemoteResponseHeaders(res, remote.headers, remote.status);
        if (req.method === "HEAD" || !remote.body.length) {
          res.end();
          return;
        }
        Readable.from(remote.body).pipe(res);
        return;
      }
    } catch {
      // 远端异常时继续使用保留在本机的副本，避免 COS / OneDrive 短暂故障影响站内图片。
    }
  }

  const publicLocalPath = await findExistingLocalAsset(relativePath, false);
  if (publicLocalPath) {
    res.setHeader("Cache-Control", CACHE_CONTROL_VALUE);
    res.sendFile(publicLocalPath);
    return;
  }

  const cachedPath = await findExistingLocalAsset(relativePath, true);
  if (cachedPath) {
    res.setHeader("Cache-Control", CACHE_CONTROL_VALUE);
    res.sendFile(cachedPath);
    return;
  }

  res.status(404).send("文件不存在");
};

function normalizeUploadRelativePath(value: string) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) throw new Error("媒体路径不能为空");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((segment) => segment === "." || segment === "..")) {
    throw new Error("媒体路径不合法");
  }
  return parts.join("/");
}

function normalizeMigrationBatchLimit(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value)) return 10;
  return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeRequestRelativePath(value: string) {
  try {
    return normalizeUploadRelativePath(value);
  } catch {
    return "";
  }
}

function decodeRequestPathname(value: string) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function relativeUploadPathFromUrl(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) {
    return normalizeRequestRelativePath(raw.replace(/^\/uploads\/+/, ""));
  }
  try {
    const parsed = new URL(raw);
    if (!parsed.pathname.startsWith("/uploads/")) return "";
    return normalizeRequestRelativePath(parsed.pathname.replace(/^\/uploads\/+/, ""));
  } catch {
    return "";
  }
}

async function shouldUseRemoteMediaStorage(relativePath: string) {
  return shouldPreferRemoteMediaStorage(relativePath);
}

async function shouldPreferRemoteMediaStorage(relativePath: string, mediaKind?: MediaStorageKind, sizeBytes?: number | null) {
  return Boolean(await preferredRemoteMediaStorageBackend(relativePath, mediaKind, sizeBytes));
}

async function preferredRemoteMediaStorageBackend(relativePath: string, mediaKind?: MediaStorageKind, sizeBytes?: number | null) {
  const runtime = await getMediaStorageRuntimeConfig();
  if (isFileCollectRelativePath(relativePath) && runtime.filestoreRemoteStorageEnabled) {
    const thresholdBytes = Math.round(Math.max(0, Number(runtime.filestoreRemoteMinSizeMb || 0)) * 1024 * 1024);
    if (thresholdBytes > 0 && typeof sizeBytes === "number" && sizeBytes < thresholdBytes) return null;
    return "onedrive-cn" as const;
  }
  const kind = mediaKind || resolveMediaKindForRelativePath(relativePath);
  const configuredBackend = kind === "video"
    ? runtime.effectiveVideoProvider
    : kind === "image"
      ? runtime.effectiveImageProvider
      : runtime.effectiveProvider;
  if (configuredBackend === "local") return null;
  return pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes) ? configuredBackend : null;
}

async function canUseRemoteMediaStorageFallback(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  if (!remoteStorageConfigured(runtime)) return false;
  if (isFileCollectRelativePath(relativePath)) return oneDriveStorageConfigured(runtime);
  return pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
}

async function hydrateRemoteMediaToCache(relativePath: string) {
  try {
    const buffer = await downloadConfiguredRemoteFileBuffer(relativePath);
    if (!buffer.length) return "";
    const cachePath = cachedAssetAbsolutePath(relativePath);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, buffer);
    return cachePath;
  } catch {
    return "";
  }
}

async function downloadRemoteFileBuffer(relativePath: string) {
  return downloadConfiguredRemoteFileBuffer(relativePath);
}

async function downloadConfiguredRemoteFileBuffer(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const configuredBackend = resolveConfiguredBackendForRelativePath(relativePath, runtime);
  const providers = orderedRemoteProviders(configuredBackend);
  for (const provider of providers) {
    try {
      if (provider === "cos" && cosStorageConfigured(runtime)) {
        const buffer = await downloadTencentCosFileBuffer(relativePath);
        if (buffer.length) return buffer;
      }
      if (provider === "oss" && ossStorageConfigured(runtime)) {
        const buffer = await downloadAliyunOssFileBuffer(relativePath);
        if (buffer.length) return buffer;
      }
      if (provider === "onedrive-cn" && oneDriveStorageConfigured(runtime)) {
        const response = await fetchOneDriveChinaFile(relativePath);
        if (response.ok) return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      continue;
    }
  }
  return Buffer.alloc(0);
}

async function fetchConfiguredRemoteMedia(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  const runtime = await getMediaStorageRuntimeConfig();
  const configuredBackend = resolveConfiguredBackendForRelativePath(relativePath, runtime);
  const providers = orderedRemoteProviders(configuredBackend);
  for (const provider of providers) {
    if (provider === "cos" && cosStorageConfigured(runtime)) {
      const response = await fetchTencentCosFile(relativePath, range, ifNoneMatch);
      if (response.status !== 404) return response;
    }
    if (provider === "oss" && ossStorageConfigured(runtime)) {
      const response = await fetchAliyunOssFile(relativePath, range, ifNoneMatch);
      if (response.status !== 404) return response;
    }
    if (provider === "onedrive-cn" && oneDriveStorageConfigured(runtime)) {
      const response = await fetchOneDriveChinaFile(relativePath, range, ifNoneMatch);
      if (response.status !== 404) {
        return {
          status: response.status,
          headers: response.headers,
          body: response.body ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0),
        };
      }
    }
  }
  return null;
}

async function readMigrationSourceBuffer(row: MediaStorageAdminFileEntry, localPath: string, cachePath: string) {
  if (row.localExists) return readFile(localPath);
  if (row.cacheExists) return readFile(cachePath);
  if (row.cosExists) {
    const buffer = await downloadTencentCosFileBuffer(row.relativePath);
    if (buffer.length) return buffer;
  }
  if (row.ossExists) {
    const buffer = await downloadAliyunOssFileBuffer(row.relativePath);
    if (buffer.length) return buffer;
  }
  if (row.oneDriveExists) {
    const response = await fetchOneDriveChinaFile(row.relativePath);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.alloc(0);
}

async function syncMediaAssetLocalPath(relativePath: string, nextLocalPath: string) {
  const url = buildUploadUrl(relativePath);
  await prisma.forumImageAsset.updateMany({
    where: { url },
    data: { localPath: nextLocalPath },
  });
  await prisma.forumVideoAsset.updateMany({
    where: { url },
    data: { localPath: nextLocalPath },
  });
}

function needsMigrationToConfiguredBackend(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "cos") {
    return row.inRemotePrefix && !row.cosExists && (row.localExists || row.cacheExists || row.oneDriveExists || row.ossExists);
  }
  if (row.configuredBackend === "oss") {
    return row.inRemotePrefix && !row.ossExists && (row.localExists || row.cacheExists || row.oneDriveExists || row.cosExists);
  }
  if (row.configuredBackend === "onedrive-cn") {
    return row.inRemotePrefix && !row.oneDriveExists && (row.localExists || row.cacheExists || row.cosExists || row.ossExists);
  }
  return !row.localExists && (row.cacheExists || row.oneDriveExists || row.cosExists || row.ossExists);
}

function hasRedundantCopiesForConfiguredBackend(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "cos") {
    return row.cosExists && (row.localExists || row.cacheExists || row.oneDriveExists || row.ossExists);
  }
  if (row.configuredBackend === "oss") {
    return row.ossExists && (row.localExists || row.cacheExists || row.oneDriveExists || row.cosExists);
  }
  if (row.configuredBackend === "onedrive-cn") {
    return row.oneDriveExists && (row.localExists || row.cacheExists || row.cosExists || row.ossExists);
  }
  return row.localExists && (row.cacheExists || row.oneDriveExists || row.cosExists || row.ossExists);
}

function isStoredOnConfiguredBackend(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "cos") return row.cosExists;
  if (row.configuredBackend === "oss") return row.ossExists;
  if (row.configuredBackend === "onedrive-cn") return row.oneDriveExists;
  return row.localExists;
}

function isFileCollectRelativePath(relativePath: string) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === "file-collect" || normalized.startsWith("file-collect/");
}

function localAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(localUploadRoot, relativePath);
}

function cachedAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(mediaCacheRoot, relativePath);
}

function resolvePreferredLocalMediaPath(relativePath: string) {
  const runtime = getMediaStorageRuntimeConfigSync();
  const configuredBackend = resolveConfiguredBackendForRelativePath(relativePath, runtime);
  const isRemote = configuredBackend !== "local"
    && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
  return isRemote ? cachedAssetAbsolutePath(relativePath) : localAssetAbsolutePath(relativePath);
}

function resolveExistingLocalMediaPath(relativePath: string) {
  const localPath = localAssetAbsolutePath(relativePath);
  if (existsSync(localPath)) return localPath;
  const cachePath = cachedAssetAbsolutePath(relativePath);
  if (existsSync(cachePath)) return cachePath;
  return "";
}

function resolveWithinRoot(root: string, relativePath: string) {
  const normalized = normalizeUploadRelativePath(relativePath);
  const absolute = path.resolve(root, normalized);
  if (!(absolute === root || absolute.startsWith(root + path.sep))) {
    throw new Error("媒体路径越界");
  }
  return absolute;
}

async function findExistingLocalAsset(relativePath: string, includeCache: boolean) {
  const candidates = [localAssetAbsolutePath(relativePath)];
  if (includeCache) candidates.push(cachedAssetAbsolutePath(relativePath));
  for (const candidate of candidates) {
    try {
      const file = await stat(candidate);
      if (file.isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return "";
}

async function collectLocalFiles(root: string) {
  const results = new Map<string, { sizeBytes: number; updatedAt: string }>();
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch((error: any) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!entries) continue;
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = await stat(absolutePath).catch(() => null);
      if (!file?.isFile()) continue;
      const relativePath = normalizeUploadRelativePath(path.relative(root, absolutePath).replace(/\\/g, "/"));
      results.set(relativePath, {
        sizeBytes: file.size,
        updatedAt: file.mtime.toISOString(),
      });
    }
  }
  return results;
}

function pathMatchesPrefixes(relativePath: string, prefixes: string[]) {
  const normalized = normalizeUploadRelativePath(relativePath);
  return prefixes.some((prefix) => prefix === "*" || normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function guessContentType(relativePath: string) {
  const ext = path.extname(relativePath).replace(/^\./, "").toLowerCase();
  const contentTypeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    txt: "text/plain; charset=utf-8",
    json: "application/json",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
  };
  return contentTypeMap[ext] || "application/octet-stream";
}

function writeRemoteResponseHeaders(res: Parameters<RequestHandler>[1], headers: Headers, status: number) {
  res.status(status);
  for (const name of ["content-type", "content-length", "content-disposition", "last-modified", "etag", "content-range", "accept-ranges"]) {
    const value = headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("Cache-Control", headers.get("cache-control") || CACHE_CONTROL_VALUE);
}

function orderedRemoteProviders(configuredBackend: MediaStorageBackend): Array<Exclude<MediaStorageBackend, "local">> {
  const preferred = configuredBackend === "local" ? [] : [configuredBackend];
  return [...new Set<Exclude<MediaStorageBackend, "local">>([
    ...preferred,
    "oss",
    "cos",
    "onedrive-cn",
  ])];
}
