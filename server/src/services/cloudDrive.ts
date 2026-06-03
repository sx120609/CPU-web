import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { config } from "../config";
import {
  createOneDriveChinaFolder,
  createOneDriveChinaUploadSession,
  deleteOneDriveChinaFile,
  fetchOneDriveChinaFile,
  getOneDriveChinaItemMetadata,
  listOneDriveChinaDirectory,
  renameOneDriveChinaItem,
  type OneDriveChinaDirectoryEntry,
  type OneDriveChinaItemMetadata,
} from "./oneDriveChina";
import { getMediaStorageRuntimeConfig } from "./storageConfig";

const CLOUD_DRIVE_NAMESPACE = "cloud-drive";
const LOCAL_CLOUD_DRIVE_ROOT = path.resolve(process.cwd(), "runtime", CLOUD_DRIVE_NAMESPACE);
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const UPLOAD_TOKEN_EXPIRES_IN = "6h";
const MAX_PROXY_UPLOAD_BYTES = 200 * 1024 * 1024;

export type CloudDriveBackend = "local" | "onedrive-cn";

export type CloudDriveEntry = {
  name: string;
  relativePath: string;
  kind: "folder" | "file";
  sizeBytes: number | null;
  updatedAt: string;
  extension: string;
  previewable: boolean;
  webUrl: string;
};

export type CloudDriveListResult = {
  backend: CloudDriveBackend;
  remoteReady: boolean;
  currentPath: string;
  rootName: string;
  rootStoragePath: string;
  siteName: string;
  driveName: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: CloudDriveEntry[];
};

export type CloudDriveAccessUrlResult = {
  url: string;
};

export type CloudDriveUploadInitResult = {
  backend: CloudDriveBackend;
  mode: "direct" | "proxy";
  relativePath: string;
  uploadUrl?: string;
  uploadToken?: string;
  expiresAt?: string;
};

export type CloudDriveUploadCompleteResult = {
  entry: CloudDriveEntry;
};

export type CloudDriveStreamTarget =
  | {
      backend: "local";
      absolutePath: string;
      fileName: string;
      disposition: "inline" | "attachment";
    }
  | {
      backend: "onedrive-cn";
      relativePath: string;
      fileName: string;
      disposition: "inline" | "attachment";
    };

type CloudDriveAccessTokenPayload = {
  kind: "cloud-drive-access";
  adminUserId: number;
  relativePath: string;
  disposition: "inline" | "attachment";
};

type CloudDriveUploadTokenPayload = {
  kind: "cloud-drive-upload";
  adminUserId: number;
  backend: CloudDriveBackend;
  relativePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

type CloudDriveContext = {
  backend: CloudDriveBackend;
  remoteReady: boolean;
  siteName: string;
  driveName: string;
  rootStoragePath: string;
};

export function cloudDriveProxyUploadLimitBytes() {
  return MAX_PROXY_UPLOAD_BYTES;
}

export async function listCloudDriveDirectory(inputPath = ""): Promise<CloudDriveListResult> {
  const currentPath = normalizeCloudDrivePath(inputPath, true);
  const context = await getCloudDriveContext();
  const entries = context.backend === "onedrive-cn"
    ? await listRemoteCloudDriveDirectory(currentPath)
    : await listLocalCloudDriveDirectory(currentPath);
  return {
    backend: context.backend,
    remoteReady: context.remoteReady,
    currentPath,
    rootName: "云盘根目录",
    rootStoragePath: context.rootStoragePath,
    siteName: context.siteName,
    driveName: context.driveName,
    breadcrumbs: buildBreadcrumbs(currentPath),
    entries: entries.sort(compareEntries),
  };
}

export async function createCloudDriveFolder(parentPath: string, rawName: string) {
  const parent = normalizeCloudDrivePath(parentPath, true);
  const name = normalizeCloudDriveEntryName(rawName);
  const relativePath = joinCloudDrivePath(parent, name);
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    const storagePath = toStorageRelativePath(relativePath);
    const existing = await getOneDriveChinaItemMetadata(storagePath);
    if (existing) throw new Error("同名文件或文件夹已存在");
    return mapCloudDriveEntry(await createOneDriveChinaFolder(storagePath), relativePath);
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  if (existsSync(absolutePath)) throw new Error("同名文件或文件夹已存在");
  await mkdir(absolutePath, { recursive: true });
  return readLocalCloudDriveEntry(relativePath);
}

export async function renameCloudDriveEntry(relativePathInput: string, rawName: string) {
  const relativePath = normalizeCloudDrivePath(relativePathInput, false);
  const name = normalizeCloudDriveEntryName(rawName);
  const parentPath = cloudDriveParentPath(relativePath);
  const nextRelativePath = joinCloudDrivePath(parentPath, name);
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    const entry = await renameOneDriveChinaItem(toStorageRelativePath(relativePath), name);
    return mapCloudDriveEntry(entry, nextRelativePath);
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  const nextAbsolutePath = resolveLocalCloudDriveAbsolutePath(nextRelativePath);
  if (!existsSync(absolutePath)) throw new Error("文件或文件夹不存在");
  if (existsSync(nextAbsolutePath)) throw new Error("同名文件或文件夹已存在");
  await rename(absolutePath, nextAbsolutePath);
  return readLocalCloudDriveEntry(nextRelativePath);
}

export async function deleteCloudDriveEntry(relativePathInput: string) {
  const relativePath = normalizeCloudDrivePath(relativePathInput, false);
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    const deleted = await deleteOneDriveChinaFile(toStorageRelativePath(relativePath));
    if (!deleted) throw new Error("文件或文件夹不存在");
    return { ok: true };
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  if (!existsSync(absolutePath)) throw new Error("文件或文件夹不存在");
  await rm(absolutePath, { recursive: true, force: false });
  return { ok: true };
}

export async function buildCloudDriveAccessUrl(input: {
  relativePath: string;
  adminUserId: number;
  download?: boolean;
}): Promise<CloudDriveAccessUrlResult> {
  const relativePath = normalizeCloudDrivePath(input.relativePath, false);
  const token = jwt.sign({
    kind: "cloud-drive-access",
    adminUserId: input.adminUserId,
    relativePath,
    disposition: input.download ? "attachment" : "inline",
  } satisfies CloudDriveAccessTokenPayload, config.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
  return {
    url: `/api/storage/cloud-drive/file?token=${encodeURIComponent(token)}`,
  };
}

export async function prepareCloudDriveUpload(input: {
  parentPath: string;
  fileName: string;
  mimeType?: string;
  fileSize: number;
  adminUserId: number;
}): Promise<CloudDriveUploadInitResult> {
  const parentPath = normalizeCloudDrivePath(input.parentPath, true);
  const fileName = normalizeCloudDriveEntryName(input.fileName);
  const relativePath = joinCloudDrivePath(parentPath, fileName);
  const mimeType = String(input.mimeType || "").trim();
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    const existing = await getOneDriveChinaItemMetadata(toStorageRelativePath(relativePath));
    if (existing) throw new Error("同名文件或文件夹已存在");
    const session = await createOneDriveChinaUploadSession(toStorageRelativePath(relativePath), mimeType || undefined, {
      conflictBehavior: "fail",
    });
    const uploadToken = jwt.sign({
      kind: "cloud-drive-upload",
      adminUserId: input.adminUserId,
      backend: "onedrive-cn",
      relativePath,
      fileName,
      mimeType,
      fileSize: input.fileSize,
    } satisfies CloudDriveUploadTokenPayload, config.jwtSecret, { expiresIn: UPLOAD_TOKEN_EXPIRES_IN });
    return {
      backend: "onedrive-cn",
      mode: "direct",
      relativePath,
      uploadUrl: session.uploadUrl,
      uploadToken,
      expiresAt: session.expiresAt,
    };
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  if (existsSync(absolutePath)) throw new Error("同名文件或文件夹已存在");
  return {
    backend: "local",
    mode: "proxy",
    relativePath,
  };
}

export async function completeCloudDriveUpload(uploadToken: string, adminUserId: number): Promise<CloudDriveUploadCompleteResult> {
  const payload = verifyCloudDriveUploadToken(uploadToken);
  if (payload.adminUserId !== adminUserId) throw new Error("上传会话与当前账号不匹配");
  if (payload.backend === "onedrive-cn") {
    const storagePath = toStorageRelativePath(payload.relativePath);
    const entry = await getOneDriveChinaItemMetadata(storagePath);
    if (!entry || entry.kind !== "file") {
      throw new Error("文件还没上传完成，请稍后再试");
    }
    return {
      entry: mapCloudDriveEntry(entry, payload.relativePath),
    };
  }

  return {
    entry: await readLocalCloudDriveEntry(payload.relativePath),
  };
}

export async function saveCloudDriveFile(input: {
  parentPath: string;
  fileName: string;
  buffer: Buffer;
  contentType?: string;
}) {
  const parentPath = normalizeCloudDrivePath(input.parentPath, true);
  const fileName = normalizeCloudDriveEntryName(input.fileName);
  const relativePath = joinCloudDrivePath(parentPath, fileName);
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    throw new Error("当前后端请使用直传会话上传");
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  const parentAbsolutePath = resolveLocalCloudDriveAbsolutePath(parentPath);
  if (existsSync(absolutePath)) throw new Error("同名文件或文件夹已存在");
  await mkdir(parentAbsolutePath, { recursive: true });
  await writeFile(absolutePath, input.buffer);
  return readLocalCloudDriveEntry(relativePath);
}

export async function resolveCloudDriveStreamTarget(token: string): Promise<CloudDriveStreamTarget | null> {
  const payload = verifyCloudDriveAccessToken(token);
  const relativePath = normalizeCloudDrivePath(payload.relativePath, false);
  const context = await getCloudDriveContext();
  if (context.backend === "onedrive-cn") {
    const entry = await getOneDriveChinaItemMetadata(toStorageRelativePath(relativePath));
    if (!entry || entry.kind !== "file") return null;
    return {
      backend: "onedrive-cn",
      relativePath: toStorageRelativePath(relativePath),
      fileName: entry.name,
      disposition: payload.disposition,
    };
  }

  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  const stats = await stat(absolutePath).catch(() => null);
  if (!stats?.isFile()) return null;
  return {
    backend: "local",
    absolutePath,
    fileName: path.basename(absolutePath),
    disposition: payload.disposition,
  };
}

export async function fetchCloudDriveRemoteFile(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  return fetchOneDriveChinaFile(relativePath, range, ifNoneMatch);
}

async function getCloudDriveContext(): Promise<CloudDriveContext> {
  const runtime = await getMediaStorageRuntimeConfig();
  const remoteReady = Boolean(
    (runtime.oneDriveChinaRefreshToken.trim() && runtime.oneDriveChinaDriveId.trim())
    || (runtime.legacyTenantId && runtime.legacyClientId && runtime.legacyClientSecret && runtime.legacyDriveId),
  );
  if (!remoteReady) {
    await mkdir(LOCAL_CLOUD_DRIVE_ROOT, { recursive: true });
  }
  const rootStoragePath = remoteReady
    ? buildDisplayRootPath(runtime.oneDriveChinaRootPath || runtime.legacyRootPath || "", CLOUD_DRIVE_NAMESPACE)
    : LOCAL_CLOUD_DRIVE_ROOT;
  return {
    backend: remoteReady ? "onedrive-cn" : "local",
    remoteReady,
    siteName: runtime.oneDriveChinaSiteName || "",
    driveName: runtime.oneDriveChinaDriveName || runtime.oneDriveChinaDriveId || runtime.legacyDriveId || "",
    rootStoragePath,
  };
}

async function listRemoteCloudDriveDirectory(currentPath: string) {
  const storagePath = toStorageRelativePath(currentPath);
  const entries = await listOneDriveChinaDirectory(storagePath);
  if (entries === null) {
    if (!currentPath) return [];
    throw new Error("文件夹不存在");
  }
  return entries.map((entry) => mapCloudDriveEntry(entry, joinCloudDrivePath(currentPath, entry.name)));
}

async function listLocalCloudDriveDirectory(currentPath: string) {
  const absolutePath = resolveLocalCloudDriveAbsolutePath(currentPath);
  const stats = await stat(absolutePath).catch(() => null);
  if (!stats) {
    if (!currentPath) {
      await mkdir(absolutePath, { recursive: true });
      return [];
    }
    throw new Error("文件夹不存在");
  }
  if (!stats.isDirectory()) throw new Error("当前路径不是文件夹");
  const dirents = await readdir(absolutePath, { withFileTypes: true });
  const entries = await Promise.all(dirents.map(async (dirent) => {
    const relativePath = joinCloudDrivePath(currentPath, dirent.name);
    return readLocalCloudDriveEntry(relativePath);
  }));
  return entries;
}

async function readLocalCloudDriveEntry(relativePathInput: string): Promise<CloudDriveEntry> {
  const relativePath = normalizeCloudDrivePath(relativePathInput, false);
  const absolutePath = resolveLocalCloudDriveAbsolutePath(relativePath);
  const stats = await stat(absolutePath);
  return {
    name: path.basename(absolutePath),
    relativePath,
    kind: stats.isDirectory() ? "folder" : "file",
    sizeBytes: stats.isDirectory() ? null : stats.size,
    updatedAt: stats.mtime.toISOString(),
    extension: stats.isDirectory() ? "" : path.extname(absolutePath).replace(/^\./, "").toLowerCase(),
    previewable: stats.isDirectory() ? false : isPreviewableExtension(path.extname(absolutePath).replace(/^\./, "")),
    webUrl: "",
  };
}

function mapCloudDriveEntry(entry: OneDriveChinaDirectoryEntry | OneDriveChinaItemMetadata, relativePath: string): CloudDriveEntry {
  return {
    name: entry.name,
    relativePath,
    kind: entry.kind,
    sizeBytes: entry.kind === "folder" ? null : entry.size,
    updatedAt: entry.lastModifiedAt,
    extension: entry.kind === "folder" ? "" : path.extname(entry.name).replace(/^\./, "").toLowerCase(),
    previewable: entry.kind === "file" && isPreviewableExtension(path.extname(entry.name).replace(/^\./, "")),
    webUrl: entry.webUrl,
  };
}

function normalizeCloudDrivePath(value: string, allowEmpty: boolean) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    if (allowEmpty) return "";
    throw new Error("路径不能为空");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((segment) => segment === "." || segment === "..")) {
    throw new Error("路径不合法");
  }
  return parts.join("/");
}

function normalizeCloudDriveEntryName(value: string) {
  const trimmed = String(value || "").trim().replace(/\\/g, "/");
  if (!trimmed) throw new Error("名称不能为空");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length !== 1 || parts[0] === "." || parts[0] === "..") {
    throw new Error("名称不合法");
  }
  return parts[0];
}

function joinCloudDrivePath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function cloudDriveParentPath(relativePath: string) {
  const normalized = normalizeCloudDrivePath(relativePath, false);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function toStorageRelativePath(relativePath: string) {
  return relativePath ? `${CLOUD_DRIVE_NAMESPACE}/${relativePath}` : CLOUD_DRIVE_NAMESPACE;
}

function resolveLocalCloudDriveAbsolutePath(relativePath: string) {
  const normalized = normalizeCloudDrivePath(relativePath, true);
  const absolutePath = normalized
    ? path.resolve(LOCAL_CLOUD_DRIVE_ROOT, ...normalized.split("/"))
    : LOCAL_CLOUD_DRIVE_ROOT;
  const relative = path.relative(LOCAL_CLOUD_DRIVE_ROOT, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径越界");
  }
  return absolutePath;
}

function buildBreadcrumbs(currentPath: string) {
  const breadcrumbs = [{ name: "云盘根目录", path: "" }];
  if (!currentPath) return breadcrumbs;
  let acc = "";
  for (const part of currentPath.split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    breadcrumbs.push({ name: part, path: acc });
  }
  return breadcrumbs;
}

function compareEntries(a: CloudDriveEntry, b: CloudDriveEntry) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base", numeric: true });
}

function isPreviewableExtension(extension: string) {
  const normalized = String(extension || "").trim().toLowerCase();
  return [
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif",
    "mp4", "webm", "mov", "m4v", "ogv",
    "mp3", "wav", "ogg", "m4a", "aac",
    "pdf", "txt", "md", "json", "csv",
  ].includes(normalized);
}

function buildDisplayRootPath(rootPath: string, namespace: string) {
  const normalizedRoot = String(rootPath || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalizedRoot ? `${normalizedRoot}/${namespace}` : namespace;
}

function verifyCloudDriveAccessToken(token: string) {
  const payload = jwt.verify(String(token || ""), config.jwtSecret) as CloudDriveAccessTokenPayload;
  if (payload.kind !== "cloud-drive-access") throw new Error("访问令牌无效");
  return payload;
}

function verifyCloudDriveUploadToken(token: string) {
  const payload = jwt.verify(String(token || ""), config.jwtSecret) as CloudDriveUploadTokenPayload;
  if (payload.kind !== "cloud-drive-upload") throw new Error("上传令牌无效");
  return payload;
}
