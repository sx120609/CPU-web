import type { RequestHandler } from "express";
import path from "node:path";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "../prisma";
import {
  fetchOneDriveChinaFile,
  listOneDriveChinaFiles,
  resolveOneDriveChinaDirectDownloadUrl,
  uploadOneDriveChinaFile,
} from "./oneDriveChina";
import { getMediaStorageRuntimeConfig, getMediaStorageRuntimeConfigSync } from "./storageConfig";

const CACHE_CONTROL_VALUE = "public, max-age=2592000, immutable";
const REMOTE_PUBLIC_URL_CACHE_TTL_MS = 10 * 60 * 1000;

export type MediaStorageBackend = "local" | "onedrive-cn";

export type SaveMediaAssetInput = {
  relativePath: string;
  buffer: Buffer;
  contentType?: string | null;
};

export type SaveMediaAssetResult = {
  backend: MediaStorageBackend;
  relativePath: string;
  url: string;
  localPath: string;
};

export type MediaStorageAdminFileEntry = {
  relativePath: string;
  url: string;
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
  mediaStorageProvider: MediaStorageBackend;
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
  mediaStorageProvider: MediaStorageBackend;
  remotePrefixes: string[];
  eligible: number;
  migrated: number;
  failed: number;
  list: MediaStorageMigrationItem[];
};

const localUploadRoot = path.resolve(process.cwd(), "uploads");
const mediaCacheRoot = path.resolve(process.cwd(), "runtime", "media-cache");
const remotePublicUrlCache = new Map<string, { url: string; expiresAt: number }>();
const remotePublicUrlPromises = new Map<string, Promise<string>>();

export function buildUploadUrl(relativePath: string) {
  return `/uploads/${normalizeUploadRelativePath(relativePath)}`;
}

export function resolveMediaLocalPathFromUploadUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return "";
  return resolvePreferredLocalMediaPath(relativePath);
}

export async function resolveMediaPublicUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return String(url || "").trim();
  if (!(await shouldUseRemoteMediaStorage(relativePath))) {
    return buildUploadUrl(relativePath);
  }

  const cached = remotePublicUrlCache.get(relativePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
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

export async function saveMediaAsset(input: SaveMediaAssetInput): Promise<SaveMediaAssetResult> {
  const relativePath = normalizeUploadRelativePath(input.relativePath);
  if (!(await shouldUseRemoteMediaStorage(relativePath))) {
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

export async function listMediaStorageAdminInventory(): Promise<MediaStorageAdminInventory> {
  const runtime = await getMediaStorageRuntimeConfig();
  const localFiles = await collectLocalFiles(localUploadRoot);
  const cacheFiles = await collectLocalFiles(mediaCacheRoot);
  const remoteConfigured = Boolean(runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim());
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
      return {
        relativePath,
        url: buildUploadUrl(relativePath),
        inRemotePrefix: pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes),
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
    mediaStorageProvider: runtime.effectiveProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    remoteConfigured,
    remoteReachable,
    remoteError,
    summary: {
      total: list.length,
      localCount: list.filter((item) => item.localExists).length,
      cacheCount: list.filter((item) => item.cacheExists).length,
      remoteCount: list.filter((item) => item.remoteExists).length,
      eligibleMigrationCount: list.filter((item) => item.localExists && item.inRemotePrefix).length,
      syncedCount: list.filter((item) => item.localExists && item.remoteExists && item.inRemotePrefix).length,
      migratedCount: list.filter((item) => !item.localExists && item.cacheExists && item.remoteExists && item.inRemotePrefix).length,
      outOfScopeLocalCount: list.filter((item) => item.localExists && !item.inRemotePrefix).length,
    },
    list,
  };
}

export async function migrateLocalMediaAssetsToRemote(): Promise<MediaStorageMigrationResult> {
  const runtime = await getMediaStorageRuntimeConfig();
  if (runtime.effectiveProvider !== "onedrive-cn") {
    throw new Error("请先将媒体存储后端切换为世纪互联 OneDrive / SharePoint");
  }

  const startedAt = new Date().toISOString();
  const localFiles = await collectLocalFiles(localUploadRoot);
  const eligibleFiles = Array.from(localFiles.keys())
    .filter((relativePath) => pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const results: MediaStorageMigrationItem[] = [];
  for (const relativePath of eligibleFiles) {
    const sourcePath = localAssetAbsolutePath(relativePath);
    const cachePath = cachedAssetAbsolutePath(relativePath);
    try {
      const buffer = await readFile(sourcePath);
      await uploadOneDriveChinaFile(relativePath, buffer, guessContentType(relativePath));
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, buffer);
      await prisma.forumImageAsset.updateMany({
        where: {
          OR: [
            { localPath: sourcePath },
            { url: buildUploadUrl(relativePath) },
          ],
        },
        data: {
          localPath: cachePath,
        },
      });
      await unlink(sourcePath).catch((error: any) => {
        if (error?.code !== "ENOENT") throw error;
      });
      results.push({
        relativePath,
        status: "migrated",
        message: "已上传远端、写入缓存并移除本地源文件",
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
    mediaStorageProvider: runtime.effectiveProvider,
    remotePrefixes: [...runtime.effectiveRemotePrefixes],
    eligible: eligibleFiles.length,
    migrated: results.filter((item) => item.status === "migrated").length,
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

  if (await shouldUseRemoteMediaStorage(relativePath)) {
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
  const runtime = await getMediaStorageRuntimeConfig();
  if (runtime.effectiveProvider !== "onedrive-cn") return false;
  return pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
}

function localAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(localUploadRoot, relativePath);
}

function cachedAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(mediaCacheRoot, relativePath);
}

function resolvePreferredLocalMediaPath(relativePath: string) {
  const runtime = getMediaStorageRuntimeConfigSync();
  const isRemote = runtime.effectiveProvider === "onedrive-cn"
    && pathMatchesPrefixes(relativePath, runtime.effectiveRemotePrefixes);
  return isRemote ? cachedAssetAbsolutePath(relativePath) : localAssetAbsolutePath(relativePath);
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
