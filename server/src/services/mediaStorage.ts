import type { RequestHandler } from "express";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { fetchOneDriveChinaFile, uploadOneDriveChinaFile } from "./oneDriveChina";
import { getMediaStorageRuntimeConfig, getMediaStorageRuntimeConfigSync } from "./storageConfig";

const CACHE_CONTROL_VALUE = "public, max-age=2592000, immutable";

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

const localUploadRoot = path.resolve(process.cwd(), "uploads");
const mediaCacheRoot = path.resolve(process.cwd(), "runtime", "media-cache");

export function buildUploadUrl(relativePath: string) {
  return `/uploads/${normalizeUploadRelativePath(relativePath)}`;
}

export function resolveMediaLocalPathFromUploadUrl(url: string) {
  const relativePath = relativeUploadPathFromUrl(url);
  if (!relativePath) return "";
  return resolvePreferredLocalMediaPath(relativePath);
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
  const normalized = normalizeUploadRelativePath(relativePath);
  return runtime.effectiveRemotePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function localAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(localUploadRoot, relativePath);
}

function cachedAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(mediaCacheRoot, relativePath);
}

function resolvePreferredLocalMediaPath(relativePath: string) {
  const runtime = getMediaStorageRuntimeConfigSync();
  const normalized = normalizeUploadRelativePath(relativePath);
  const isRemote = runtime.effectiveProvider === "onedrive-cn"
    && runtime.effectiveRemotePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
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
