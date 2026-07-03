import { getToken } from "@/api/request";

export type FilestoreBetaStatus = "open" | "closed";

export interface FilestoreBetaField {
  id: string;
  key: string;
  label: string;
  required: boolean;
  pattern: string;
  placeholder: string;
}

export interface FilestoreBetaRules {
  allowedTypes: string[];
  maxSizeMb: number;
  maxCount: number;
}

export interface FilestoreBetaTemplate {
  id?: number;
  name: string;
  description: string;
  fields: FilestoreBetaField[];
  fileRules: FilestoreBetaRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FilestoreBetaSettings {
  siteUrl: string;
  siteTitle: string;
  taskTemplates: FilestoreBetaTemplate[];
}

export interface FilestoreBetaViewer {
  ok: true;
  role: string;
  isSuperAdmin: boolean;
  isManager: boolean;
  user: {
    userId: number;
    username: string;
    displayName: string;
  };
  settings: FilestoreBetaSettings;
}

export interface FilestoreBetaCreator {
  userId: number;
  username: string;
  displayName: string;
  role: string;
}

export interface FilestoreBetaFile {
  id: number;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface FilestoreBetaSubmission {
  id: number;
  data: Record<string, string>;
  ip: string;
  status: string;
  createdAt: string;
  files: FilestoreBetaFile[];
}

export interface FilestoreBetaStats {
  submitted: number;
  inListSubmitted: number;
  expected: number;
  missing: string[];
  unexpected: Array<{
    id: number;
    name: string;
    identity: string;
    createdAt: string;
  }>;
}

export interface FilestoreBetaTask {
  id: number;
  slug: string;
  token: string;
  title: string;
  description: string;
  deadline: string;
  fields: FilestoreBetaField[];
  fileRules: FilestoreBetaRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  status: FilestoreBetaStatus;
  createdAt: string;
  updatedAt: string;
  submitUrl: string;
  createdBy?: FilestoreBetaCreator | null;
  submissions?: FilestoreBetaSubmission[];
  stats?: FilestoreBetaStats;
  renameResult?: {
    renamed: number;
    unchanged: number;
    missing: number;
  };
}

export interface FilestoreBetaTaskPayload {
  title: string;
  description: string;
  deadline: string | null;
  status: FilestoreBetaStatus;
  fields: FilestoreBetaField[];
  fileRules: FilestoreBetaRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  renameExistingFiles?: boolean;
}

export interface FilestoreBetaPublicTask extends FilestoreBetaTask {
  siteTitle: string;
  remoteUpload?: {
    enabled: boolean;
    mode: "onedrive-cn" | "local";
    minSizeMb: number;
    minSizeBytes: number;
  };
}

export interface FilestoreBetaPublicStatus {
  title: string;
  deadline: string;
  status: FilestoreBetaStatus;
  siteTitle: string;
  stats: {
    submitted: number;
    expected: number;
    missing: number;
  };
  submissions: Array<{
    id: number;
    displayName: string;
    identity: string;
    createdAt: string;
    files: Array<{
      storedName: string;
      size: number;
    }>;
  }>;
}

export interface FilestoreBetaDuplicatePayload {
  ok: true;
  exists: boolean;
  identity: string;
  identityLabel: string;
  submission: null | {
    id: number;
    createdAt: string;
    fileCount: number;
    files: string[];
  };
}

export interface FilestoreBetaPreparedRemoteFile {
  id: number;
  index: number;
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface FilestoreBetaPreparedLocalFile {
  id: number;
  index: number;
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
}

export interface FilestoreBetaPrepareRemoteResult {
  ok: true;
  directUpload: true;
  submissionId: number;
  files: FilestoreBetaPreparedRemoteFile[];
  localFiles: FilestoreBetaPreparedLocalFile[];
}

export interface FilestoreBetaSubmitResult {
  ok: true;
  id: number;
  submissionId: number;
  createdAt: string;
  files: string[];
}

export interface FilestoreBetaFileAccess {
  ok: true;
  id: number;
  action: "download" | "preview";
  backend: "local" | "onedrive-cn";
  url: string;
  viewer?: "office" | "onedrive" | null;
  previewMessage?: string;
  filename: string;
  mimeType: string;
}

export interface FilestoreBetaAssignableUser {
  userId: number;
  username: string;
  displayName: string;
  role: string;
}

export interface FilestoreBetaRegexResult {
  regex: string;
  description: string;
  placeholder: string;
}

export interface FilestoreBetaFilenameRepairResult {
  total: number;
  updated: number;
  unchanged: number;
  unrecoverable: number;
  samples?: Array<{
    id: number;
    beforeOriginalName: string;
    afterOriginalName: string;
    beforeStoredName: string;
    afterStoredName: string;
  }>;
}

export interface FilestoreBetaRemoteFilenameRepairResult {
  scanned: number;
  repaired: number;
  synced: number;
  unchanged: number;
  skippedLocal: number;
  conflicts: number;
  failed: number;
  details: Array<{
    fileId: number;
    storedName: string;
    from: string;
    to: string;
    status: string;
    message?: string;
  }>;
}

type JsonRequestInit = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit | null;
};

export class FilestoreBetaApiError extends Error {
  constructor(public status: number, message: string, public payload: Record<string, unknown> = {}) {
    super(message);
  }
}

export function filestoreBetaUrl(path: string) {
  return `/filestore${path.startsWith("/") ? path : `/${path}`}`;
}

function headers(init?: JsonRequestInit) {
  const output = new Headers(init?.headers);
  const token = getToken();
  if (token && !output.has("Authorization")) output.set("Authorization", `Bearer ${token}`);
  if (init?.json !== undefined && !output.has("Content-Type")) output.set("Content-Type", "application/json");
  return output;
}

async function parseJsonPayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function filestoreBetaFetch<T>(path: string, init: JsonRequestInit = {}) {
  const response = await fetch(filestoreBetaUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: headers(init),
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const payload = await parseJsonPayload(response);
  if (!response.ok) {
    const message = String(payload.message || payload.error || response.statusText || "请求失败");
    throw new FilestoreBetaApiError(response.status, message, payload);
  }
  return payload as T;
}

export async function filestoreBetaBlob(path: string, init: RequestInit = {}) {
  const response = await fetch(filestoreBetaUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: headers(init),
  });
  if (!response.ok) {
    const payload = await parseJsonPayload(response);
    const message = String(payload.message || payload.error || response.statusText || "下载失败");
    throw new FilestoreBetaApiError(response.status, message, payload);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("content-disposition") || ""),
    type: response.headers.get("content-type") || "",
  };
}

function filenameFromDisposition(disposition: string) {
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = disposition.match(/filename="([^"]+)"/i);
  return basicMatch ? basicMatch[1] : "";
}

export const filestoreBetaApi = {
  me: () => filestoreBetaFetch<FilestoreBetaViewer>("/api/admin/me"),
  settings: () => filestoreBetaFetch<FilestoreBetaSettings>("/api/settings"),
  saveSettings: (payload: Partial<FilestoreBetaSettings>) =>
    filestoreBetaFetch<FilestoreBetaSettings>("/api/settings", { method: "POST", json: payload }),

  tasks: () => filestoreBetaFetch<FilestoreBetaTask[]>("/api/tasks"),
  createTask: (payload: FilestoreBetaTaskPayload) =>
    filestoreBetaFetch<FilestoreBetaTask>("/api/tasks", { method: "POST", json: payload }),
  task: (id: number) => filestoreBetaFetch<FilestoreBetaTask>(`/api/tasks/${id}`),
  updateTask: (id: number, payload: FilestoreBetaTaskPayload) =>
    filestoreBetaFetch<FilestoreBetaTask>(`/api/tasks/${id}`, { method: "PATCH", json: payload }),
  deleteTask: (id: number) =>
    filestoreBetaFetch<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),
  repairFilenames: (id: number) =>
    filestoreBetaFetch<FilestoreBetaFilenameRepairResult>(`/api/tasks/${id}/repair-filenames`, { method: "POST" }),
  repairRemoteFilenames: (id: number) =>
    filestoreBetaFetch<FilestoreBetaRemoteFilenameRepairResult>(`/api/tasks/${id}/repair-remote-filenames`, { method: "POST" }),
  bindOwner: (id: number, userId: number) =>
    filestoreBetaFetch<FilestoreBetaTask>(`/api/tasks/${id}/owner`, { method: "PATCH", json: { userId } }),

  searchUsers: (q: string, size = 8) =>
    filestoreBetaFetch<FilestoreBetaAssignableUser[]>(`/api/platform/users?${new URLSearchParams({ q, size: String(size) })}`),
  generateRegex: (prompt: string) =>
    filestoreBetaFetch<FilestoreBetaRegexResult>("/api/platform/ai/regex", { method: "POST", json: { prompt } }),

  publicTask: (slug: string) =>
    filestoreBetaFetch<FilestoreBetaPublicTask>(`/api/public/tasks/${encodeURIComponent(slug)}`),
  publicStatus: (slug: string) =>
    filestoreBetaFetch<FilestoreBetaPublicStatus>(`/api/public/status/${encodeURIComponent(slug)}`),
  checkDuplicate: (slug: string, data: Record<string, string>) =>
    filestoreBetaFetch<FilestoreBetaDuplicatePayload>(`/api/submit/${encodeURIComponent(slug)}/check-duplicate`, {
      method: "POST",
      json: { data },
    }),
  prepareRemote: (slug: string, payload: { data: Record<string, string>; overwrite: boolean; files: Array<{ name: string; size: number; type: string }> }) =>
    filestoreBetaFetch<FilestoreBetaPrepareRemoteResult>(`/api/submit/${encodeURIComponent(slug)}/prepare-remote`, {
      method: "POST",
      json: payload,
    }),
  completeRemote: (slug: string, payload: { submissionId: number; remoteFileIds: number[]; overwrite: boolean }) =>
    filestoreBetaFetch<FilestoreBetaSubmitResult>(`/api/submit/${encodeURIComponent(slug)}/complete-remote`, {
      method: "POST",
      json: payload,
    }),
  completeRemoteMultipart: (slug: string, form: FormData) =>
    filestoreBetaFetch<FilestoreBetaSubmitResult>(`/api/submit/${encodeURIComponent(slug)}/complete-remote`, {
      method: "POST",
      body: form,
    }),

  fileAccess: (id: number, action: "download" | "preview") =>
    filestoreBetaFetch<FilestoreBetaFileAccess>(`/api/files/${id}/access?action=${encodeURIComponent(action)}`),
  fileBlob: (id: number, action: "download" | "preview") =>
    filestoreBetaBlob(`/api/files/${id}/${action}`),
  deleteFile: (id: number) =>
    filestoreBetaFetch<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" }),
  deleteSubmission: (id: number) =>
    filestoreBetaFetch<{ ok: true }>(`/api/submissions/${id}`, { method: "DELETE" }),
};

