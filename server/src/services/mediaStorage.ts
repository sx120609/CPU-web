import type { RequestHandler } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
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

const CACHE_CONTROL_VALUE = "public, max-age=2592000, immutable";
const REMOTE_PUBLIC_URL_CACHE_TTL_MS = 10 * 60 * 1000;

export type MediaStorageBackend = "local" | "onedrive-cn";

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
  summary: {
    total: number;
    localCount: number;
    cacheCount: number;
    remoteCount: number;
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
  return Boolean(runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim());
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
  const usesRemote = configuredBackend === "onedrive-cn"
    && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
  if (!usesRemote) {
    return buildUploadUrl(relativePath);
  }

  const cached = remotePublicUrlCache.get(relativePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const remoteDriveKey = runtime.oneDriveChinaDriveId.trim()
    || runtime.legacyDriveId.trim()
    || "default";
  const sharedCacheKey = buildRedisKey("media-public-url", remoteDriveKey, relativePath);
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
      const directUrl = await resolveOneDriveChinaDirectDownloadUrl(relativePath);
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
  const remote = await shouldPreferRemoteMediaStorage(relativePath, input.mediaKind ?? undefined, input.sizeBytes ?? undefined);
  if (!remote) return null;
  return createOneDriveChinaUploadSession(relativePath, input.contentType);
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
    const response = await fetchOneDriveChinaFile(relativePath);
    if (!response.ok) return { localPath: "", temporary: false };
    const buffer = Buffer.from(await response.arrayBuffer());
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
  if (!(await shouldPreferRemoteMediaStorage(relativePath, input.mediaKind ?? undefined, input.buffer.byteLength))) {
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
  await uploadOneDriveChinaFile(relativePath, input.buffer, input.contentType || "application/octet-stream");
  return {
    backend: "onedrive-cn",
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
    await deleteOneDriveChinaFile(relativePath).catch((error: any) => {
      if (String(error?.message || "").includes("404")) return false;
      throw error;
    });
  }
}

export async function listMediaStorageAdminInventory(): Promise<MediaStorageAdminInventory> {
  const runtime = await getMediaStorageRuntimeConfig();
  const localFiles = await collectLocalFiles(localUploadRoot);
  const cacheFiles = await collectLocalFiles(mediaCacheRoot);
  const remoteConfigured = remoteStorageConfigured(runtime);
  let remoteReachable = false;
  let remoteError = "";
  let remoteFiles = new Map<string, { sizeBytes: number | null; updatedAt: string }>();

  if (remoteConfigured) {
    try {
      remoteFiles = new Map(
        (await listOneDriveChinaFiles()).map((item) => [
          normalizeUploadRelativePath(item.relativePath),
          {
            sizeBytes: typeof item.size === "number" ? item.size : null,
            updatedAt: String(item.lastModifiedAt || "").trim(),
          },
        ]),
      );
      remoteReachable = true;
    } catch (error) {
      remoteError = String((error as any)?.message || error || "读取远端文件列表失败").slice(0, 500);
    }
  }

  const allPaths = new Set<string>([
    ...localFiles.keys(),
    ...cacheFiles.keys(),
    ...remoteFiles.keys(),
  ]);
  const list = Array.from(allPaths)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((relativePath) => {
      const local = localFiles.get(relativePath);
      const cache = cacheFiles.get(relativePath);
      const remote = remoteFiles.get(relativePath);
      const mediaKind = resolveMediaKindForRelativePath(relativePath);
      const sizeBytes = local?.sizeBytes ?? cache?.sizeBytes ?? remote?.sizeBytes ?? null;
      const configuredBackend = resolveConfiguredBackendForInventoryRow(relativePath, runtime, sizeBytes);
      const eligibleForRemote = configuredBackend === "onedrive-cn" && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
      return {
        relativePath,
        url: buildUploadUrl(relativePath),
        mediaKind,
        configuredBackend,
        inRemotePrefix: eligibleForRemote,
        localExists: Boolean(local),
        cacheExists: Boolean(cache),
        remoteExists: Boolean(remote),
        localSizeBytes: local?.sizeBytes ?? null,
        cacheSizeBytes: cache?.sizeBytes ?? null,
        remoteSizeBytes: remote?.sizeBytes ?? null,
        localUpdatedAt: local?.updatedAt ?? "",
        cacheUpdatedAt: cache?.updatedAt ?? "",
        remoteUpdatedAt: remote?.updatedAt ?? "",
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
    summary: {
      total: list.length,
      localCount: list.filter((item) => item.localExists).length,
      cacheCount: list.filter((item) => item.cacheExists).length,
      remoteCount: list.filter((item) => item.remoteExists).length,
      eligibleMigrationCount: list.filter((item) => needsMigrationToConfiguredBackend(item)).length,
      syncedCount: list.filter((item) => hasRedundantCopiesForConfiguredBackend(item)).length,
      migratedCount: list.filter((item) => isStoredOnConfiguredBackend(item)).length,
      outOfScopeLocalCount: list.filter((item) => item.configuredBackend === "onedrive-cn" && item.localExists && !item.inRemotePrefix).length,
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
      if (targetBackend === "onedrive-cn") {
        const sourcePath = inventoryRow.localExists ? localPath : inventoryRow.cacheExists ? cachePath : "";
        if (!sourcePath) throw new Error("缺少可上传的本地源文件");
        const buffer = await readFile(sourcePath);
        await uploadOneDriveChinaFile(relativePath, buffer, guessContentType(relativePath));
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, buffer);
        await syncMediaAssetLocalPath(relativePath, cachePath);
        results.push({
          relativePath,
          status: "migrated",
          message: inventoryRow.remoteExists ? "已补齐远端缓存并同步当前后端" : "已迁移到世纪互联并同步当前后端",
        });
        continue;
      }

      const sourceBuffer = inventoryRow.localExists
        ? await readFile(localPath)
        : inventoryRow.cacheExists
          ? await readFile(cachePath)
          : await downloadRemoteFileBuffer(relativePath);
      if (!sourceBuffer?.length) throw new Error("缺少可回迁的远端或缓存文件");
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
      if (row.configuredBackend === "onedrive-cn") {
        for (const targetPath of [localPath, cachePath]) {
          const removed = await unlink(targetPath)
            .then(() => true)
            .catch((error: any) => {
              if (error?.code === "ENOENT") return false;
              throw error;
            });
          removedAny = removedAny || removed;
        }
      } else {
        const cacheRemoved = await unlink(cachePath)
          .then(() => true)
          .catch((error: any) => {
            if (error?.code === "ENOENT") return false;
            throw error;
          });
        removedAny = removedAny || cacheRemoved;
        if (row.remoteExists) {
          const deletedRemote = await deleteOneDriveChinaFile(relativePath).catch((error: any) => {
            throw error;
          });
          removedAny = removedAny || deletedRemote;
        }
      }
      results.push({
        relativePath,
        status: "removed",
        message: removedAny
          ? (row.configuredBackend === "onedrive-cn" ? "已删除非当前后端的本地/缓存副本" : "已删除非当前后端的远端/缓存副本")
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

  const relativePath = normalizeRequestRelativePath(req.path);
  if (!relativePath) {
    res.status(404).send("文件不存在");
    return;
  }

  const publicLocalPath = await findExistingLocalAsset(relativePath, false);
  if (publicLocalPath) {
    res.setHeader("Cache-Control", CACHE_CONTROL_VALUE);
    res.sendFile(publicLocalPath);
    return;
  }

  if (await canUseRemoteMediaStorageFallback(relativePath)) {
    try {
      const remote = await fetchOneDriveChinaFile(relativePath, req.headers.range, req.headers["if-none-match"]);
      if (remote.ok || remote.status === 304) {
        writeRemoteResponseHeaders(res, remote);
        if (req.method === "HEAD" || !remote.body) {
          res.end();
          return;
        }
        Readable.fromWeb(remote.body as any).pipe(res);
        return;
      }
      if (remote.status !== 404) {
        const detail = await safeReadResponseText(remote);
        res.status(502).send(detail ? `远端媒体回源失败：${detail}` : `远端媒体回源失败：HTTP ${remote.status}`);
        return;
      }
    } catch (error) {
      const cachedPath = await findExistingLocalAsset(relativePath, true);
      if (cachedPath) {
        res.setHeader("Cache-Control", CACHE_CONTROL_VALUE);
        res.sendFile(cachedPath);
        return;
      }
      res.status(502).send(error instanceof Error ? error.message : "远端媒体回源失败");
      return;
    }
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
  const runtime = await getMediaStorageRuntimeConfig();
  if (isFileCollectRelativePath(relativePath) && runtime.filestoreRemoteStorageEnabled) {
    const thresholdBytes = Math.round(Math.max(0, Number(runtime.filestoreRemoteMinSizeMb || 0)) * 1024 * 1024);
    if (thresholdBytes > 0 && typeof sizeBytes === "number" && sizeBytes < thresholdBytes) return false;
    return true;
  }
  const kind = mediaKind || resolveMediaKindForRelativePath(relativePath);
  const configuredBackend = kind === "video"
    ? runtime.effectiveVideoProvider
    : kind === "image"
      ? runtime.effectiveImageProvider
      : runtime.effectiveProvider;
  if (configuredBackend !== "onedrive-cn") return false;
  return pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
}

async function canUseRemoteMediaStorageFallback(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  if (!remoteStorageConfigured(runtime)) return false;
  if (isFileCollectRelativePath(relativePath)) return true;
  return pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
}

async function hydrateRemoteMediaToCache(relativePath: string) {
  try {
    const response = await fetchOneDriveChinaFile(relativePath);
    if (!response.ok) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
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
  const response = await fetchOneDriveChinaFile(relativePath);
  if (!response.ok) return Buffer.alloc(0);
  return Buffer.from(await response.arrayBuffer());
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
  if (row.configuredBackend === "onedrive-cn") {
    return row.inRemotePrefix && !row.remoteExists && (row.localExists || row.cacheExists);
  }
  return !row.localExists && (row.cacheExists || row.remoteExists);
}

function hasRedundantCopiesForConfiguredBackend(row: MediaStorageAdminFileEntry) {
  if (row.configuredBackend === "onedrive-cn") {
    return row.remoteExists && (row.localExists || row.cacheExists);
  }
  return row.localExists && (row.cacheExists || row.remoteExists);
}

function isStoredOnConfiguredBackend(row: MediaStorageAdminFileEntry) {
  return row.configuredBackend === "onedrive-cn" ? row.remoteExists : row.localExists;
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
  const isRemote = configuredBackend === "onedrive-cn"
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
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
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

async function safeReadResponseText(response: Response) {
  return response.text().then((text) => text.trim().slice(0, 400)).catch(() => "");
}

function writeRemoteResponseHeaders(res: Parameters<RequestHandler>[1], response: Response) {
  res.status(response.status);
  for (const name of ["content-type", "content-length", "content-disposition", "last-modified", "etag", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("Cache-Control", response.headers.get("cache-control") || CACHE_CONTROL_VALUE);
}
