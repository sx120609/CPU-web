import jwt from "jsonwebtoken";
import { config } from "../config";
import { getSiteOrigin } from "./siteSettings";
import {
  clearOneDriveChinaAuthorization,
  getMediaStorageRuntimeConfig,
  setOneDriveChinaDriveSelection,
  setOneDriveChinaLastError,
  setOneDriveChinaRefreshTokenState,
  setOneDriveChinaResolvedSite,
} from "./storageConfig";

const GRAPH_BASE_URL = "https://microsoftgraph.chinacloudapi.cn/v1.0";
const GRAPH_RESOURCE = "https://microsoftgraph.chinacloudapi.cn";
const LOGIN_BASE_URL = "https://login.partner.microsoftonline.cn";

const DELEGATED_SCOPE = [
  "offline_access",
  `${GRAPH_RESOURCE}/User.Read`,
  `${GRAPH_RESOURCE}/Files.ReadWrite.All`,
  `${GRAPH_RESOURCE}/Sites.ReadWrite.All`,
].join(" ");
const APP_ONLY_SCOPE = `${GRAPH_RESOURCE}/.default`;

export const ONEDRIVE_CN_CALLBACK_PATH = "/api/storage/onedrive-cn/callback";

type AuthStatePayload = {
  kind: "onedrive-cn";
  adminUserId: number;
  fingerprint: string;
};

export type OneDriveChinaDriveOption = {
  id: string;
  name: string;
  webUrl: string;
  driveType: string;
};

export type OneDriveChinaStoredFile = {
  relativePath: string;
  size: number | null;
  lastModifiedAt: string;
  webUrl: string;
};

export type OneDriveChinaDirectoryEntry = {
  name: string;
  kind: "folder" | "file";
  size: number | null;
  lastModifiedAt: string;
  webUrl: string;
  downloadUrl?: string;
};

export type OneDriveChinaItemMetadata = OneDriveChinaDirectoryEntry;

export type OneDriveChinaUploadSession = {
  uploadUrl: string;
  expiresAt: string;
};

type DelegatedTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

let delegatedAccessTokenCache: DelegatedTokenResult | null = null;
let appOnlyAccessTokenCache: { accessToken: string; expiresAt: number } | null = null;
const rootItemIdCache = new Map<string, string>();
const folderIdCache = new Map<string, string>();

export async function buildOneDriveChinaAuthorization(input: {
  requestOrigin: string;
  adminUserId: number;
}) {
  const runtime = await getMediaStorageRuntimeConfig();
  if (!runtime.oneDriveChinaClientId.trim()) throw new Error("请先填写 Azure 应用 ID");
  if (!runtime.oneDriveChinaClientSecret.trim()) throw new Error("请先填写 Azure 应用密钥");
  if (!runtime.oneDriveChinaSharepointUrl.trim()) throw new Error("请先填写 SharePoint 站点地址");

  const callbackUrl = buildOneDriveChinaCallbackUrl(input.requestOrigin, runtime);
  const state = jwt.sign({
    kind: "onedrive-cn",
    adminUserId: input.adminUserId,
    fingerprint: buildStorageFingerprint(runtime),
  } satisfies AuthStatePayload, config.jwtSecret, { expiresIn: "15m" });
  const params = new URLSearchParams({
    client_id: runtime.oneDriveChinaClientId,
    response_type: "code",
    redirect_uri: callbackUrl,
    response_mode: "query",
    scope: DELEGATED_SCOPE,
    state,
    prompt: "select_account",
  });
  return {
    callbackUrl,
    authorizeUrl: `${LOGIN_BASE_URL}/organizations/oauth2/v2.0/authorize?${params.toString()}`,
  };
}

export async function completeOneDriveChinaAuthorization(input: {
  code: string;
  state: string;
  requestOrigin: string;
}) {
  const runtime = await getMediaStorageRuntimeConfig();
  const payload = jwt.verify(String(input.state || ""), config.jwtSecret) as AuthStatePayload;
  if (payload.kind !== "onedrive-cn") throw new Error("授权状态无效");
  if (payload.fingerprint !== buildStorageFingerprint(runtime)) {
    throw new Error("授权期间配置已变更，请返回后台重新发起授权");
  }
  const callbackUrl = buildOneDriveChinaCallbackUrl(input.requestOrigin, runtime);
  const token = await exchangeAuthorizationCode({
    clientId: runtime.oneDriveChinaClientId,
    clientSecret: runtime.oneDriveChinaClientSecret,
    code: input.code,
    redirectUri: callbackUrl,
  });
  await setOneDriveChinaRefreshTokenState({
    refreshToken: token.refreshToken,
    authorizedAt: new Date().toISOString(),
    lastError: "",
  });
  delegatedAccessTokenCache = token;
  const resolved = await resolveConfiguredSharePointSite(token.accessToken);
  const drives = await fetchSiteDrives(token.accessToken, resolved.siteId);
  const defaultDrive = await fetchDefaultSiteDrive(token.accessToken, resolved.siteId).catch(() => null);
  const selectedDrive = resolveSelectedDrive(drives, defaultDrive, runtime.oneDriveChinaDriveId);
  await setOneDriveChinaResolvedSite({
    sharepointUrl: resolved.sharepointUrl,
    sharepointHost: resolved.sharepointHost,
    sharepointPath: resolved.sharepointPath,
    siteId: resolved.siteId,
    siteName: resolved.siteName,
    driveId: selectedDrive?.id || "",
    driveName: selectedDrive?.name || "",
    lastError: "",
  });
  resetOneDriveChinaTransientCaches();
  return {
    siteName: resolved.siteName,
    driveName: selectedDrive?.name || "",
    drives,
  };
}

export async function listOneDriveChinaDriveOptions() {
  const runtime = await getMediaStorageRuntimeConfig();
  if (!runtime.oneDriveChinaSharepointUrl.trim()) throw new Error("请先填写 SharePoint 站点地址");
  const accessToken = await acquireOneDriveChinaAccessToken("delegated");
  const resolved = runtime.oneDriveChinaSiteId.trim()
    ? {
        sharepointUrl: runtime.oneDriveChinaSharepointUrl,
        sharepointHost: runtime.oneDriveChinaSharepointHost,
        sharepointPath: runtime.oneDriveChinaSharepointPath,
        siteId: runtime.oneDriveChinaSiteId,
        siteName: runtime.oneDriveChinaSiteName,
      }
    : await resolveConfiguredSharePointSite(accessToken);
  const drives = await fetchSiteDrives(accessToken, resolved.siteId);
  const defaultDrive = await fetchDefaultSiteDrive(accessToken, resolved.siteId).catch(() => null);
  const selectedDrive = resolveSelectedDrive(drives, defaultDrive, runtime.oneDriveChinaDriveId);
  await setOneDriveChinaResolvedSite({
    sharepointUrl: resolved.sharepointUrl,
    sharepointHost: resolved.sharepointHost,
    sharepointPath: resolved.sharepointPath,
    siteId: resolved.siteId,
    siteName: resolved.siteName,
    driveId: selectedDrive?.id || "",
    driveName: selectedDrive?.name || "",
    lastError: "",
  });
  return {
    siteId: resolved.siteId,
    siteName: resolved.siteName,
    sharepointUrl: resolved.sharepointUrl,
    sharepointHost: resolved.sharepointHost,
    sharepointPath: resolved.sharepointPath,
    selectedDriveId: selectedDrive?.id || "",
    selectedDriveName: selectedDrive?.name || "",
    list: drives,
  };
}

export async function saveOneDriveChinaDriveSelection(driveId: string) {
  const options = await listOneDriveChinaDriveOptions();
  const selected = options.list.find((item) => item.id === driveId);
  if (!selected) throw new Error("所选文档库不存在");
  await setOneDriveChinaDriveSelection(selected.id, selected.name);
  return {
    driveId: selected.id,
    driveName: selected.name,
  };
}

export async function disconnectOneDriveChinaAuthorization() {
  await clearOneDriveChinaAuthorization();
  resetOneDriveChinaTransientCaches();
}

export async function listOneDriveChinaFiles(): Promise<OneDriveChinaStoredFile[]> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const rootPath = normalizeRemoteFolderPath(drive.rootPath);
  const rootFolder = await resolveConfiguredRootFolder(drive.driveId, rootPath);
  if (!rootFolder) return [];

  if (rootFolder.file) {
    return [{
      relativePath: rootPath || rootFolder.name || "",
      size: typeof rootFolder.size === "number" ? rootFolder.size : null,
      lastModifiedAt: String(rootFolder.lastModifiedDateTime || "").trim(),
      webUrl: String(rootFolder.webUrl || "").trim(),
    }].filter((item) => item.relativePath);
  }
  if (!rootFolder.id) return [];

  const queue: Array<{ itemId: string; relativeBase: string }> = [{
    itemId: rootFolder.id,
    relativeBase: "",
  }];
  const files: OneDriveChinaStoredFile[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const children = await listDriveChildrenByItemId(drive.driveId, current.itemId);
    for (const item of children) {
      const relativePath = current.relativeBase ? `${current.relativeBase}/${item.name}` : item.name;
      if (item.folder) {
        queue.push({ itemId: item.id, relativeBase: relativePath });
        continue;
      }
      if (!item.file) continue;
      files.push({
        relativePath,
        size: typeof item.size === "number" ? item.size : null,
        lastModifiedAt: String(item.lastModifiedDateTime || "").trim(),
        webUrl: String(item.webUrl || "").trim(),
      });
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
  return files;
}

export async function uploadOneDriveChinaFile(relativePath: string, buffer: Buffer, contentType: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  await ensureRemoteFolder(drive.driveId, pathDirname(remotePath));
  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/root:/${encodeGraphPath(remotePath)}:/content`, {
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

export async function createOneDriveChinaUploadSession(
  relativePath: string,
  contentType?: string | null,
  options?: { conflictBehavior?: "replace" | "fail" | "rename" },
): Promise<OneDriveChinaUploadSession> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  await ensureRemoteFolder(drive.driveId, pathDirname(remotePath));
  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/root:/${encodeGraphPath(remotePath)}:/createUploadSession`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": options?.conflictBehavior || "replace",
        ...(contentType ? { file: { mimeType: String(contentType).trim() } } : {}),
      },
      deferCommit: false,
    }),
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `创建世纪互联直传会话失败：${detail}` : `创建世纪互联直传会话失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { uploadUrl?: string; expirationDateTime?: string };
  const uploadUrl = String(payload.uploadUrl || "").trim();
  if (!uploadUrl) throw new Error("创建世纪互联直传会话失败：响应缺少 uploadUrl");
  return {
    uploadUrl,
    expiresAt: String(payload.expirationDateTime || "").trim(),
  };
}

export async function fetchOneDriveChinaFile(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const headers = new Headers();
  const normalizedRange = Array.isArray(range) ? range[0] : range;
  const normalizedIfNoneMatch = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
  if (normalizedRange) headers.set("Range", normalizedRange);
  if (normalizedIfNoneMatch) headers.set("If-None-Match", normalizedIfNoneMatch);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  return graphRequestWithCurrentMode(`/drives/${drive.driveId}/root:/${encodeGraphPath(remotePath)}:/content`, {
    method: "GET",
    headers,
    redirect: "follow",
  });
}

export async function deleteOneDriveChinaFile(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/root:/${encodeGraphPath(remotePath)}`, {
    method: "DELETE",
  });
  if (response.status === 404) return false;
  if (!response.ok && response.status !== 204) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `删除世纪互联文件失败：${detail}` : `删除世纪互联文件失败：HTTP ${response.status}`);
  }
  return true;
}

export async function validateOneDriveChinaClientCredentials() {
  const runtime = await getMediaStorageRuntimeConfig();
  if (!runtime.oneDriveChinaClientId.trim()) throw new Error("请先填写 Azure 应用 ID");
  if (!runtime.oneDriveChinaClientSecret.trim()) throw new Error("请先填写 Azure 应用密钥");
  const form = new URLSearchParams({
    client_id: runtime.oneDriveChinaClientId,
    client_secret: runtime.oneDriveChinaClientSecret,
    grant_type: "client_credentials",
    scope: APP_ONLY_SCOPE,
  });
  const response = await fetch(`${LOGIN_BASE_URL}/organizations/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (response.ok) {
    return {
      ok: true,
      message: "Azure 应用 ID 与密钥已通过服务端校验，可继续发起登录授权。",
      detail: "",
    };
  }
  const detail = await safeReadResponseText(response);
  if (/invalid_client|7000215/i.test(detail)) {
    throw new Error(detail ? `Azure 应用密钥校验失败：${detail}` : "Azure 应用密钥校验失败：invalid_client");
  }
  return {
    ok: true,
    message: "Azure 应用 ID 与密钥已被服务端接受，但应用权限或租户策略返回了额外限制。通常不影响继续走登录授权。",
    detail,
  };
}

export async function resolveOneDriveChinaDirectDownloadUrl(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const item = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  const metadataDownloadUrl = String(item?.["@microsoft.graph.downloadUrl"] || "").trim();
  if (metadataDownloadUrl) return metadataDownloadUrl;
  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/root:/${encodeGraphPath(remotePath)}:/content`, {
    method: "GET",
    redirect: "manual",
  });
  const location = String(response.headers.get("location") || "").trim();
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    return location;
  }
  if (response.ok && response.url && !response.url.startsWith(GRAPH_BASE_URL)) {
    return response.url;
  }
  if (response.status === 404) return "";
  const detail = await safeReadResponseText(response);
  throw new Error(detail ? `获取世纪互联文件直链失败：${detail}` : `获取世纪互联文件直链失败：HTTP ${response.status}`);
}

export async function resolveOneDriveChinaPreviewUrl(relativePath: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const item = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  if (!item?.id || item.folder) return "";
  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/items/${encodeURIComponent(item.id)}/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (response.status === 404) return "";
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `获取世纪互联文件预览链接失败：${detail}` : `获取世纪互联文件预览链接失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { getUrl?: string; postUrl?: string; postParameters?: string };
  return String(payload.getUrl || "").trim();
}

export async function getOneDriveChinaItemMetadata(relativePath: string): Promise<OneDriveChinaItemMetadata | null> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const response = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  if (!response) return null;
  return {
    name: response.name || pathBasename(remotePath),
    kind: response.folder ? "folder" : "file",
    size: typeof response.size === "number" ? response.size : null,
    lastModifiedAt: String(response.lastModifiedDateTime || "").trim(),
    webUrl: String(response.webUrl || "").trim(),
    downloadUrl: String(response["@microsoft.graph.downloadUrl"] || "").trim(),
  };
}

export async function listOneDriveChinaDirectory(relativePath: string): Promise<OneDriveChinaDirectoryEntry[] | null> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const folder = await resolveConfiguredRootFolder(drive.driveId, remotePath);
  if (!folder) return null;
  if (folder.file) throw new Error("当前路径不是文件夹");
  if (!folder.id) return [];
  const children = await listDriveChildrenByItemId(drive.driveId, folder.id);
  return children
    .map((item) => ({
      name: item.name,
      kind: item.folder ? "folder" as const : "file" as const,
      size: item.folder ? null : (typeof item.size === "number" ? item.size : null),
      lastModifiedAt: String(item.lastModifiedDateTime || "").trim(),
      webUrl: String(item.webUrl || "").trim(),
      downloadUrl: String(item["@microsoft.graph.downloadUrl"] || "").trim(),
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base", numeric: true });
    });
}

export async function createOneDriveChinaFolder(relativePath: string): Promise<OneDriveChinaItemMetadata> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const existing = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  if (existing) throw new Error("同名文件或文件夹已存在");
  await ensureRemoteFolder(drive.driveId, remotePath);
  const created = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  if (!created) throw new Error("创建远端目录失败：目录创建后未能重新读取");
  return {
    name: created.name || pathBasename(remotePath),
    kind: "folder",
    size: null,
    lastModifiedAt: String(created.lastModifiedDateTime || "").trim(),
    webUrl: String(created.webUrl || "").trim(),
  };
}

export async function renameOneDriveChinaItem(relativePath: string, newName: string): Promise<OneDriveChinaItemMetadata> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const remotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const target = await fetchRemoteItemMetadataByPath(drive.driveId, remotePath);
  if (!target?.id) throw new Error("文件或文件夹不存在");

  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/items/${encodeURIComponent(target.id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: newName,
    }),
  });
  if (response.status === 409) throw new Error("同名文件或文件夹已存在");
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `重命名世纪互联文件失败：${detail}` : `重命名世纪互联文件失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as {
    name?: string;
    size?: number;
    webUrl?: string;
    lastModifiedDateTime?: string;
    folder?: Record<string, unknown>;
    file?: Record<string, unknown>;
  };
  return {
    name: String(payload.name || newName).trim() || newName,
    kind: payload.folder ? "folder" : "file",
    size: payload.folder ? null : (typeof payload.size === "number" ? payload.size : null),
    lastModifiedAt: String(payload.lastModifiedDateTime || "").trim(),
    webUrl: String(payload.webUrl || "").trim(),
  };
}

export async function moveOneDriveChinaItem(relativePath: string, targetRelativePath: string): Promise<OneDriveChinaItemMetadata> {
  const runtime = await getMediaStorageRuntimeConfig();
  const drive = await requireActiveRemoteDrive(runtime);
  const sourceRemotePath = buildRemoteStoragePath(relativePath, drive.rootPath);
  const targetRemotePath = buildRemoteStoragePath(targetRelativePath, drive.rootPath);
  if (sourceRemotePath === targetRemotePath) {
    const item = await fetchRemoteItemMetadataByPath(drive.driveId, sourceRemotePath);
    if (!item?.id) throw new Error("文件或文件夹不存在");
    return {
      name: item.name || pathBasename(sourceRemotePath),
      kind: item.folder ? "folder" : "file",
      size: item.folder ? null : (typeof item.size === "number" ? item.size : null),
      lastModifiedAt: String(item.lastModifiedDateTime || "").trim(),
      webUrl: String(item.webUrl || "").trim(),
    };
  }

  const source = await fetchRemoteItemMetadataByPath(drive.driveId, sourceRemotePath);
  if (!source?.id) throw new Error("文件或文件夹不存在");
  const existingTarget = await fetchRemoteItemMetadataByPath(drive.driveId, targetRemotePath);
  if (existingTarget?.id) throw new Error("目标位置已存在同名文件或文件夹");

  const targetParentPath = pathDirname(targetRemotePath);
  await ensureRemoteFolder(drive.driveId, targetParentPath);
  const targetParent = await resolveConfiguredRootFolder(drive.driveId, targetParentPath);
  if (!targetParent?.id) throw new Error("目标目录不存在");
  const targetName = pathBasename(targetRemotePath);
  if (!targetName) throw new Error("目标文件名不能为空");

  const response = await graphRequestWithCurrentMode(`/drives/${drive.driveId}/items/${encodeURIComponent(source.id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: targetName,
      parentReference: {
        id: targetParent.id,
      },
    }),
  });
  if (response.status === 409) throw new Error("目标位置已存在同名文件或文件夹");
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `移动世纪互联文件失败：${detail}` : `移动世纪互联文件失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as {
    name?: string;
    size?: number;
    webUrl?: string;
    lastModifiedDateTime?: string;
    folder?: Record<string, unknown>;
    file?: Record<string, unknown>;
  };
  return {
    name: String(payload.name || targetName).trim() || targetName,
    kind: payload.folder ? "folder" : "file",
    size: payload.folder ? null : (typeof payload.size === "number" ? payload.size : null),
    lastModifiedAt: String(payload.lastModifiedDateTime || "").trim(),
    webUrl: String(payload.webUrl || "").trim(),
  };
}

async function requireActiveRemoteDrive(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>) {
  if (runtime.oneDriveChinaRefreshToken.trim() && runtime.oneDriveChinaDriveId.trim()) {
    return {
      driveId: runtime.oneDriveChinaDriveId,
      rootPath: runtime.oneDriveChinaRootPath,
    };
  }
  if (runtime.legacyTenantId && runtime.legacyClientId && runtime.legacyClientSecret && runtime.legacyDriveId) {
    return {
      driveId: runtime.legacyDriveId,
      rootPath: runtime.legacyRootPath,
    };
  }
  throw new Error("世纪互联 OneDrive / SharePoint 尚未完成授权或未选择文档库");
}

async function resolveConfiguredSharePointSite(accessToken: string) {
  const runtime = await getMediaStorageRuntimeConfig();
  const parsed = parseSharePointCandidateInput(runtime.oneDriveChinaSharepointUrl);
  let lastError = "";
  for (const candidatePath of parsed.candidatePaths) {
    const response = await fetch(`${GRAPH_BASE_URL}${buildSiteByPathEndpoint(parsed.host, candidatePath)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.ok) {
      const payload = await response.json() as { id?: string; displayName?: string; webUrl?: string };
      const webUrl = String(payload.webUrl || parsed.normalizedUrl || "").trim();
      return {
        sharepointUrl: webUrl || `${parsed.protocol}//${parsed.host}${candidatePath === "/" ? "/" : candidatePath}`,
        sharepointHost: parsed.host,
        sharepointPath: candidatePath,
        siteId: String(payload.id || "").trim(),
        siteName: String(payload.displayName || "").trim() || candidatePath || parsed.host,
      };
    }
    lastError = await safeReadResponseText(response);
    if (response.status !== 404) break;
  }
  throw new Error(lastError || "无法根据 SharePoint 地址解析到站点，请确认地址是否正确");
}

async function fetchSiteDrives(accessToken: string, siteId: string): Promise<OneDriveChinaDriveOption[]> {
  const response = await fetch(`${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drives`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `读取 SharePoint 文档库失败：${detail}` : `读取 SharePoint 文档库失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { value?: Array<{ id?: string; name?: string; webUrl?: string; driveType?: string }> };
  return Array.isArray(payload.value)
    ? payload.value
      .map((item) => ({
        id: String(item.id || "").trim(),
        name: String(item.name || "").trim() || "未命名文档库",
        webUrl: String(item.webUrl || "").trim(),
        driveType: String(item.driveType || "").trim(),
      }))
      .filter((item) => item.id)
    : [];
}

async function fetchDefaultSiteDrive(accessToken: string, siteId: string): Promise<OneDriveChinaDriveOption | null> {
  const response = await fetch(`${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drive`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `读取 SharePoint 默认文档库失败：${detail}` : `读取 SharePoint 默认文档库失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { id?: string; name?: string; webUrl?: string; driveType?: string };
  if (!payload.id) return null;
  return {
    id: String(payload.id || "").trim(),
    name: String(payload.name || "").trim() || "默认文档库",
    webUrl: String(payload.webUrl || "").trim(),
    driveType: String(payload.driveType || "").trim(),
  };
}

function resolveSelectedDrive(list: OneDriveChinaDriveOption[], defaultDrive: OneDriveChinaDriveOption | null, preferredDriveId: string) {
  return list.find((item) => item.id === preferredDriveId)
    || (defaultDrive ? list.find((item) => item.id === defaultDrive.id) || defaultDrive : null)
    || list[0]
    || null;
}

async function acquireOneDriveChinaAccessToken(mode: "delegated" | "auto" = "auto") {
  const runtime = await getMediaStorageRuntimeConfig();
  const hasDelegated = Boolean(
    runtime.oneDriveChinaClientId.trim()
    && runtime.oneDriveChinaClientSecret.trim()
    && runtime.oneDriveChinaRefreshToken.trim(),
  );
  if (!hasDelegated) {
    if (mode === "delegated") throw new Error("请先在后台点击登录授权");
    if (runtime.legacyTenantId && runtime.legacyClientId && runtime.legacyClientSecret && runtime.legacyDriveId) {
      return getLegacyAppOnlyAccessToken(runtime);
    }
    throw new Error("世纪互联 OneDrive / SharePoint 尚未完成授权");
  }

  if (delegatedAccessTokenCache && delegatedAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return delegatedAccessTokenCache.accessToken;
  }
  const form = new URLSearchParams({
    client_id: runtime.oneDriveChinaClientId,
    client_secret: runtime.oneDriveChinaClientSecret,
    grant_type: "refresh_token",
    refresh_token: runtime.oneDriveChinaRefreshToken,
    scope: DELEGATED_SCOPE,
  });
  const response = await fetch(`${LOGIN_BASE_URL}/organizations/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    await setOneDriveChinaLastError(detail || `HTTP ${response.status}`).catch(() => null);
    throw new Error(detail ? `刷新世纪互联 OneDrive 授权失败：${detail}` : `刷新世纪互联 OneDrive 授权失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new Error("刷新世纪互联 OneDrive 授权失败：响应缺少 access_token");
  const refreshToken = String(payload.refresh_token || runtime.oneDriveChinaRefreshToken).trim();
  const nextDelegatedToken = {
    accessToken: payload.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
  delegatedAccessTokenCache = nextDelegatedToken;
  if (payload.refresh_token && payload.refresh_token !== runtime.oneDriveChinaRefreshToken) {
    await setOneDriveChinaRefreshTokenState({
      refreshToken,
      authorizedAt: runtime.oneDriveChinaAuthorizedAt || new Date().toISOString(),
      lastError: "",
    }).catch(() => null);
  }
  return nextDelegatedToken.accessToken;
}

async function getLegacyAppOnlyAccessToken(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>) {
  if (appOnlyAccessTokenCache && appOnlyAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return appOnlyAccessTokenCache.accessToken;
  }
  const form = new URLSearchParams({
    client_id: runtime.legacyClientId,
    client_secret: runtime.legacyClientSecret,
    grant_type: "client_credentials",
    scope: APP_ONLY_SCOPE,
  });
  const response = await fetch(`${LOGIN_BASE_URL}/${encodeURIComponent(runtime.legacyTenantId)}/oauth2/v2.0/token`, {
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
  appOnlyAccessTokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
  return payload.access_token;
}

async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<DelegatedTokenResult> {
  const response = await fetch(`${LOGIN_BASE_URL}/organizations/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `换取世纪互联 OneDrive refresh token 失败：${detail}` : `换取世纪互联 OneDrive refresh token 失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("换取世纪互联 OneDrive refresh token 失败：响应缺少 access_token 或 refresh_token");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
}

async function graphRequestWithCurrentMode(resourcePath: string, init: RequestInit, retry = true): Promise<Response> {
  const token = await acquireOneDriveChinaAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const targetUrl = /^https?:\/\//i.test(resourcePath) ? resourcePath : `${GRAPH_BASE_URL}${resourcePath}`;
  const response = await fetch(targetUrl, {
    ...init,
    headers,
  });
  if (response.status === 401 && retry) {
    delegatedAccessTokenCache = null;
    appOnlyAccessTokenCache = null;
    return graphRequestWithCurrentMode(resourcePath, init, false);
  }
  return response;
}

async function ensureRemoteFolder(driveId: string, folderPath: string) {
  const normalized = normalizeRemoteFolderPath(folderPath);
  if (!normalized) return;
  const segments = normalized.split("/");
  let parentId = await getRootItemId(driveId);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const cacheKey = `${driveId}:${currentPath}`;
    const cachedFolderId = folderIdCache.get(cacheKey);
    if (cachedFolderId) {
      parentId = cachedFolderId;
      continue;
    }
    const exists = await fetchRemoteItemMetadataByPath(driveId, currentPath);
    if (exists?.id) {
      if (!exists.folder) {
        throw new Error(`创建远端目录失败：${currentPath} 已存在同名文件`);
      }
      folderIdCache.set(cacheKey, exists.id);
      parentId = exists.id;
      continue;
    }
    const created = await graphRequestWithCurrentMode(`/drives/${driveId}/items/${encodeURIComponent(parentId)}/children`, {
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
      folderIdCache.set(cacheKey, payload.id);
      parentId = payload.id;
      continue;
    }
    const conflicted = await fetchRemoteItemMetadataByPath(driveId, currentPath);
    if (!conflicted?.id) throw new Error("创建远端目录失败：目录冲突后未能重新读取目录信息");
    folderIdCache.set(cacheKey, conflicted.id);
    parentId = conflicted.id;
  }
}

async function fetchRemoteItemMetadataByPath(driveId: string, remotePath: string) {
  const response = await graphRequestWithCurrentMode(`/drives/${driveId}/root:/${encodeGraphPath(remotePath)}`, {
    method: "GET",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `检查远端目录失败：${detail}` : `检查远端目录失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<{
    id?: string;
    name?: string;
    size?: number;
    webUrl?: string;
    "@microsoft.graph.downloadUrl"?: string;
    lastModifiedDateTime?: string;
    folder?: Record<string, unknown>;
    file?: Record<string, unknown>;
  }>;
}

async function getRootItemId(driveId: string) {
  const cached = rootItemIdCache.get(driveId);
  if (cached) return cached;
  const response = await graphRequestWithCurrentMode(`/drives/${driveId}/root`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(detail ? `读取远端根目录失败：${detail}` : `读取远端根目录失败：HTTP ${response.status}`);
  }
  const payload = await response.json() as { id?: string };
  if (!payload.id) throw new Error("读取远端根目录失败：响应缺少根目录 id");
  rootItemIdCache.set(driveId, payload.id);
  return payload.id;
}

async function resolveConfiguredRootFolder(driveId: string, rootPath: string) {
  if (!rootPath) {
    return {
      id: await getRootItemId(driveId),
      name: "",
      folder: {},
      file: null as Record<string, unknown> | null,
      size: null as number | null,
      webUrl: "",
      lastModifiedDateTime: "",
    };
  }
  const item = await fetchRemoteItemMetadataByPath(driveId, rootPath).catch((error: any) => {
    if (String(error?.message || "").includes("HTTP 404")) return null;
    throw error;
  });
  return item || null;
}

async function listDriveChildrenByItemId(driveId: string, itemId: string) {
  const items: Array<{
    id: string;
    name: string;
    size?: number;
    webUrl?: string;
    "@microsoft.graph.downloadUrl"?: string;
    lastModifiedDateTime?: string;
    folder?: Record<string, unknown>;
    file?: Record<string, unknown>;
  }> = [];
  let nextUrl = `${GRAPH_BASE_URL}/drives/${driveId}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,size,webUrl,lastModifiedDateTime,folder,file`;
  while (nextUrl) {
    const response = await graphRequestWithCurrentMode(nextUrl, { method: "GET" });
    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(detail ? `读取远端文件列表失败：${detail}` : `读取远端文件列表失败：HTTP ${response.status}`);
    }
    const payload = await response.json() as {
      value?: Array<{
        id?: string;
        name?: string;
        size?: number;
        webUrl?: string;
        "@microsoft.graph.downloadUrl"?: string;
        lastModifiedDateTime?: string;
        folder?: Record<string, unknown>;
        file?: Record<string, unknown>;
      }>;
      "@odata.nextLink"?: string;
    };
    for (const item of Array.isArray(payload.value) ? payload.value : []) {
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!id || !name) continue;
      items.push({
        id,
        name,
        size: typeof item.size === "number" ? item.size : undefined,
        webUrl: String(item.webUrl || "").trim(),
        "@microsoft.graph.downloadUrl": String(item["@microsoft.graph.downloadUrl"] || "").trim(),
        lastModifiedDateTime: String(item.lastModifiedDateTime || "").trim(),
        folder: item.folder,
        file: item.file,
      });
    }
    nextUrl = String(payload["@odata.nextLink"] || "").trim();
  }
  return items;
}

function parseSharePointCandidateInput(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请先填写 SharePoint 站点地址");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("SharePoint 地址格式不正确");
  }
  const cleanedPath = url.pathname.replace(/\/+$/, "") || "/";
  const basePath = cleanedPath
    .replace(/\/_layouts\/.*$/i, "")
    .replace(/\/Forms\/.*$/i, "")
    .replace(/\/Shared%20Documents\/.*$/i, "")
    .replace(/\/Documents\/.*$/i, "")
    || "/";
  const segments = basePath.split("/").filter(Boolean);
  const candidatePaths: string[] = [];
  for (let size = segments.length; size >= 0; size -= 1) {
    const candidate = size ? `/${segments.slice(0, size).join("/")}` : "/";
    if (!candidatePaths.includes(candidate)) candidatePaths.push(candidate);
  }
  return {
    protocol: url.protocol,
    host: url.hostname.toLowerCase(),
    normalizedUrl: `${url.protocol}//${url.host}${cleanedPath}`,
    candidatePaths,
  };
}

function buildSiteByPathEndpoint(host: string, path: string) {
  if (!path || path === "/") return "/sites/root";
  return `/sites/${host}:${encodeGraphPath(path)}`;
}

function buildStorageFingerprint(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>) {
  return [
    runtime.oneDriveChinaClientId.trim(),
    runtime.oneDriveChinaSharepointUrl.trim(),
    runtime.oneDriveChinaRootPath.trim(),
  ].join("|");
}

function buildOneDriveChinaCallbackUrl(requestOrigin: string, _runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>) {
  const configuredOrigin = getSiteOrigin();
  return `${normalizeOrigin(configuredOrigin || requestOrigin)}${ONEDRIVE_CN_CALLBACK_PATH}`;
}

function normalizeOrigin(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("当前请求缺少可用站点域名，无法生成回调地址");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  return parsed.origin.replace(/\/+$/, "");
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

function buildRemoteStoragePath(relativePath: string, rootPath: string) {
  const normalizedRelative = normalizeRemoteFolderPath(relativePath);
  const normalizedRoot = normalizeRemoteFolderPath(rootPath);
  return normalizedRoot ? `${normalizedRoot}/${normalizedRelative}` : normalizedRelative;
}

function encodeGraphPath(value: string) {
  const normalized = normalizeRemoteFolderPath(value);
  if (!normalized) return "/";
  return `/${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function pathDirname(value: string) {
  const normalized = normalizeRemoteFolderPath(value);
  if (!normalized.includes("/")) return "";
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function pathBasename(value: string) {
  const normalized = normalizeRemoteFolderPath(value);
  if (!normalized) return "";
  return normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
}

async function safeReadResponseText(response: Response) {
  return response.text().then((text) => text.trim().slice(0, 600)).catch(() => "");
}

export function resetOneDriveChinaTransientCaches() {
  delegatedAccessTokenCache = null;
  appOnlyAccessTokenCache = null;
  rootItemIdCache.clear();
  folderIdCache.clear();
}
