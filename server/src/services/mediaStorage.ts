import type { RequestHandler } from "express";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { config } from "../config";

const GRAPH_BASE_URL = "https://microsoftgraph.chinacloudapi.cn/v1.0";
const GRAPH_SCOPE = "https://microsoftgraph.chinacloudapi.cn/.default";
const LOGIN_BASE_URL = "https://login.chinacloudapi.cn";
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
const remoteManagedPrefixes = normalizeRemotePrefixes(config.mediaStorageRemotePrefixes);
const remoteFolderIds = new Map<string, string>();

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let cachedRootItemId = "";

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
  if (!shouldUseRemoteMediaStorage(relativePath)) {
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
  await uploadToOneDriveChina(relativePath, input.buffer, input.contentType || "application/octet-stream");
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

  if (shouldUseRemoteMediaStorage(relativePath)) {
    try {
      const remote = await fetchOneDriveChinaAsset(relativePath, req.headers.range, req.headers["if-none-match"]);
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

function normalizeRemotePrefixes(prefixes: string[]) {
  return Array.from(new Set(
    prefixes
      .map((item) => String(item || "").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/"))
      .filter(Boolean),
  ));
}

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

function shouldUseRemoteMediaStorage(relativePath: string) {
  if (config.mediaStorageProvider !== "onedrive-cn") return false;
  const normalized = normalizeUploadRelativePath(relativePath);
  return remoteManagedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function localAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(localUploadRoot, relativePath);
}

function cachedAssetAbsolutePath(relativePath: string) {
  return resolveWithinRoot(mediaCacheRoot, relativePath);
}

function resolvePreferredLocalMediaPath(relativePath: string) {
  return shouldUseRemoteMediaStorage(relativePath)
    ? cachedAssetAbsolutePath(relativePath)
    : localAssetAbsolutePath(relativePath);
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

async function uploadToOneDriveChina(relativePath: string, buffer: Buffer, contentType: string) {
  assertOneDriveChinaConfig();
  const remotePath = buildRemoteStoragePath(relativePath);
  await ensureRemoteFolder(path.posix.dirname(remotePath));
  const response = await graphRequest(`/drives/${config.oneDriveChinaDriveId}/root:/${encodeGraphPath(remotePath)}:/content`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `上传到世纪互联 OneDrive 失败：${detail}` : `上传到世纪互联 OneDrive 失败：HTTP ${response.status}`);
  }
}

async function fetchOneDriveChinaAsset(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  assertOneDriveChinaConfig();
  const headers = new Headers();
  const normalizedRange = Array.isArray(range) ? range[0] : range;
  const normalizedIfNoneMatch = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
  if (normalizedRange) headers.set("Range", normalizedRange);
  if (normalizedIfNoneMatch) headers.set("If-None-Match", normalizedIfNoneMatch);
  const remotePath = buildRemoteStoragePath(relativePath);
  return graphRequest(`/drives/${config.oneDriveChinaDriveId}/root:/${encodeGraphPath(remotePath)}:/content`, {
    method: "GET",
    headers,
    redirect: "follow",
  });
}

async function ensureRemoteFolder(folderPath: string) {
  assertOneDriveChinaConfig();
  const normalized = normalizeRemoteFolderPath(folderPath);
  if (!normalized) return;
  const segments = normalized.split("/");
  let parentId = await getOneDriveChinaRootItemId();
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const cachedFolderId = remoteFolderIds.get(currentPath);
    if (cachedFolderId) {
      parentId = cachedFolderId;
      continue;
    }
    const exists = await fetchRemoteItemMetadataByPath(currentPath);
    if (exists?.id) {
      remoteFolderIds.set(currentPath, exists.id);
      parentId = exists.id;
      continue;
    }
    const created = await graphRequest(`/drives/${config.oneDriveChinaDriveId}/items/${encodeURIComponent(parentId)}/children`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: segment,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    if (!created.ok && created.status !== 409) {
      const detail = await safeReadResponseText(created);
      throw new Error(detail ? `创建远端目录失败：${detail}` : `创建远端目录失败：HTTP ${created.status}`);
    }
    if (created.ok) {
      const payload = await created.json() as { id?: string };
      if (!payload.id) throw new Error("创建远端目录失败：响应缺少目录 id");
      remoteFolderIds.set(currentPath, payload.id);
      parentId = payload.id;
      continue;
    }
    const conflicted = await fetchRemoteItemMetadataByPath(currentPath);
    if (!conflicted?.id) {
      throw new Error("创建远端目录失败：目录冲突后未能重新读取目录信息");
    }
    remoteFolderIds.set(currentPath, conflicted.id);
    parentId = conflicted.id;
  }
}

function normalizeRemoteFolderPath(value: string) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function buildRemoteStoragePath(relativePath: string) {
  const normalizedRelative = normalizeUploadRelativePath(relativePath);
  const rootPath = normalizeRemoteFolderPath(config.oneDriveChinaRootPath);
  return rootPath ? `${rootPath}/${normalizedRelative}` : normalizedRelative;
}

function encodeGraphPath(value: string) {
  return normalizeRemoteFolderPath(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function graphRequest(resourcePath: string, init: RequestInit, retry = true): Promise<Response> {
  const token = await getOneDriveChinaAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${GRAPH_BASE_URL}${resourcePath}`, {
    ...init,
    headers,
  });
  if (response.status === 401 && retry) {
    cachedAccessToken = null;
    return graphRequest(resourcePath, init, false);
  }
  return response;
}

async function fetchRemoteItemMetadataByPath(remotePath: string) {
  const response = await graphRequest(`/drives/${config.oneDriveChinaDriveId}/root:/${encodeGraphPath(remotePath)}`, {
    method: "GET",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `检查远端目录失败：${detail}` : `检查远端目录失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<{ id?: string }>;
}

async function getOneDriveChinaRootItemId() {
  assertOneDriveChinaConfig();
  if (cachedRootItemId) return cachedRootItemId;
  const response = await graphRequest(`/drives/${config.oneDriveChinaDriveId}/root`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `读取远端根目录失败：${detail}` : `读取远端根目录失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { id?: string };
  if (!payload.id) throw new Error("读取远端根目录失败：响应缺少根目录 id");
  cachedRootItemId = payload.id;
  return payload.id;
}

async function getOneDriveChinaAccessToken() {
  assertOneDriveChinaConfig();
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }
  const form = new URLSearchParams({
    client_id: config.oneDriveChinaClientId,
    client_secret: config.oneDriveChinaClientSecret,
    grant_type: "client_credentials",
    scope: GRAPH_SCOPE,
  });
  const response = await fetch(`${LOGIN_BASE_URL}/${encodeURIComponent(config.oneDriveChinaTenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `获取世纪互联 OneDrive 令牌失败：${detail}` : `获取世纪互联 OneDrive 令牌失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("获取世纪互联 OneDrive 令牌失败：响应缺少 access_token");
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
  return payload.access_token;
}

function assertOneDriveChinaConfig() {
  if (config.mediaStorageProvider !== "onedrive-cn") return;
  const missing = [
    ["ONEDRIVE_CN_TENANT_ID", config.oneDriveChinaTenantId],
    ["ONEDRIVE_CN_CLIENT_ID", config.oneDriveChinaClientId],
    ["ONEDRIVE_CN_CLIENT_SECRET", config.oneDriveChinaClientSecret],
    ["ONEDRIVE_CN_DRIVE_ID", config.oneDriveChinaDriveId],
  ].filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (missing.length) {
    throw new Error(`世纪互联 OneDrive 配置不完整：缺少 ${missing.join("、")}`);
  }
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
