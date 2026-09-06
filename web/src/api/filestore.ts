import { COOKIE_SESSION_MARKER, getCsrfToken, getToken } from "@/api/request";
import type { QuestionnaireField } from "@/api/tools";

export type FilestoreStatus = "open" | "closed";

export interface FilestoreField {
  id: string;
  key: string;
  label: string;
  required: boolean;
  pattern: string;
  placeholder: string;
}

export type FilestoreSurveyField = QuestionnaireField;
export type FilestoreSurveyAnswer = string | string[];

export interface FilestoreRules {
  allowedTypes: string[];
  maxSizeMb: number;
  maxCount: number;
}

export interface FilestoreTemplate {
  id?: number;
  name: string;
  description: string;
  fields: FilestoreField[];
  surveyFields: FilestoreSurveyField[];
  fileRules: FilestoreRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FilestoreSettings {
  siteUrl: string;
  siteTitle: string;
  taskTemplates: FilestoreTemplate[];
}

export interface FilestoreViewer {
  ok: true;
  role: string;
  isSuperAdmin: boolean;
  isManager: boolean;
  user: {
    userId: number;
    username: string;
    displayName: string;
  };
  settings: FilestoreSettings;
}

export interface FilestoreCreator {
  userId: number;
  username: string;
  displayName: string;
  role: string;
}

export interface FilestoreFile {
  id: number;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface FilestoreSubmission {
  id: number;
  data: Record<string, string>;
  answers: Record<string, FilestoreSurveyAnswer>;
  ip: string;
  status: string;
  createdAt: string;
  files: FilestoreFile[];
}

export interface FilestoreStats {
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

export interface FilestoreTask {
  id: number;
  slug: string;
  token: string;
  title: string;
  description: string;
  deadline: string;
  fields: FilestoreField[];
  surveyFields: FilestoreSurveyField[];
  fileRules: FilestoreRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  status: FilestoreStatus;
  createdAt: string;
  updatedAt: string;
  submitUrl: string;
  createdBy?: FilestoreCreator | null;
  submissions?: FilestoreSubmission[];
  stats?: FilestoreStats;
  renameResult?: {
    renamed: number;
    unchanged: number;
    missing: number;
  };
}

export interface FilestoreTaskPayload {
  title: string;
  description: string;
  deadline: string | null;
  status: FilestoreStatus;
  fields: FilestoreField[];
  surveyFields: FilestoreSurveyField[];
  fileRules: FilestoreRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  renameExistingFiles?: boolean;
}

export interface FilestorePublicTask extends FilestoreTask {
  siteTitle: string;
  remoteUpload?: {
    enabled: boolean;
    mode: "onedrive-cn" | "local";
    minSizeMb: number;
    minSizeBytes: number;
  };
}

export interface FilestorePublicStatus {
  title: string;
  deadline: string;
  status: FilestoreStatus;
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

export interface FilestoreDuplicatePayload {
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

export interface FilestorePreparedRemoteFile {
  id: number;
  index: number;
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface FilestorePreparedLocalFile {
  id: number;
  index: number;
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
}

export interface FilestorePrepareRemoteResult {
  ok: true;
  directUpload: true;
  submissionId: number;
  files: FilestorePreparedRemoteFile[];
  localFiles: FilestorePreparedLocalFile[];
}

export interface FilestoreSubmitResult {
  ok: true;
  id: number;
  submissionId: number;
  createdAt: string;
  files: string[];
}

export interface FilestoreFileAccess {
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

export interface FilestoreAssignableUser {
  userId: number;
  username: string;
  displayName: string;
  role: string;
}

export interface FilestoreRegexResult {
  regex: string;
  description: string;
  placeholder: string;
}

export interface FilestoreFilenameRepairResult {
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

export interface FilestoreRemoteFilenameRepairResult {
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

export class FilestoreApiError extends Error {
  constructor(public status: number, message: string, public payload: Record<string, unknown> = {}) {
    super(message);
  }
}

export function filestoreUrl(path: string) {
  return `/filestore${path.startsWith("/") ? path : `/${path}`}`;
}

function headers(init?: JsonRequestInit) {
  const output = new Headers(init?.headers);
  const token = getToken();
  if (token && token !== COOKIE_SESSION_MARKER && !output.has("Authorization")) {
    output.set("Authorization", `Bearer ${token}`);
  }
  const csrf = getCsrfToken();
  if (csrf && !output.has("X-CSRF-Token")) output.set("X-CSRF-Token", csrf);
  output.set("X-CPU-Auth-Mode", "cookie");
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

export async function filestoreFetch<T>(path: string, init: JsonRequestInit = {}) {
  const response = await fetch(filestoreUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: headers(init),
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const payload = await parseJsonPayload(response);
  if (!response.ok) {
    const message = String(payload.message || payload.error || response.statusText || "请求失败");
    throw new FilestoreApiError(response.status, message, payload);
  }
  return payload as T;
}

export function filestoreUpload<T>(path: string, form: FormData, onProgress: (loaded: number, total: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(xhr.responseText || "{}");
        if (!payload || typeof payload !== "object") throw new Error("Invalid payload");
      } catch {
        reject(new FilestoreApiError(xhr.status, "上传响应格式异常，请稍后重试"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
      else reject(new FilestoreApiError(xhr.status, String(payload.error || payload.message || "提交失败"), payload));
    });
    xhr.addEventListener("error", () => reject(new FilestoreApiError(0, "网络错误，提交失败")));
    xhr.open("POST", filestoreUrl(path));
    headers().forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.send(form);
  });
}

export async function filestoreBlob(path: string, init: RequestInit = {}) {
  const response = await fetch(filestoreUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: headers(init),
  });
  if (!response.ok) {
    const payload = await parseJsonPayload(response);
    const message = String(payload.message || payload.error || response.statusText || "下载失败");
    throw new FilestoreApiError(response.status, message, payload);
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

export const filestoreApi = {
  me: () => filestoreFetch<FilestoreViewer>("/api/admin/me"),
  settings: () => filestoreFetch<FilestoreSettings>("/api/settings"),
  saveSettings: (payload: Partial<FilestoreSettings>) =>
    filestoreFetch<FilestoreSettings>("/api/settings", { method: "POST", json: payload }),

  tasks: () => filestoreFetch<FilestoreTask[]>("/api/tasks"),
  createTask: (payload: FilestoreTaskPayload) =>
    filestoreFetch<FilestoreTask>("/api/tasks", { method: "POST", json: payload }),
  task: (id: number) => filestoreFetch<FilestoreTask>(`/api/tasks/${id}`),
  updateTask: (id: number, payload: FilestoreTaskPayload) =>
    filestoreFetch<FilestoreTask>(`/api/tasks/${id}`, { method: "PATCH", json: payload }),
  deleteTask: (id: number) =>
    filestoreFetch<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),
  repairFilenames: (id: number) =>
    filestoreFetch<FilestoreFilenameRepairResult>(`/api/tasks/${id}/repair-filenames`, { method: "POST" }),
  repairRemoteFilenames: (id: number) =>
    filestoreFetch<FilestoreRemoteFilenameRepairResult>(`/api/tasks/${id}/repair-remote-filenames`, { method: "POST" }),
  bindOwner: (id: number, userId: number) =>
    filestoreFetch<FilestoreTask>(`/api/tasks/${id}/owner`, { method: "PATCH", json: { userId } }),

  searchUsers: (q: string, size = 8) =>
    filestoreFetch<FilestoreAssignableUser[]>(`/api/platform/users?${new URLSearchParams({ q, size: String(size) })}`),
  generateRegex: (prompt: string) =>
    filestoreFetch<FilestoreRegexResult>("/api/platform/ai/regex", { method: "POST", json: { prompt } }),

  publicTask: (slug: string) =>
    filestoreFetch<FilestorePublicTask>(`/api/public/tasks/${encodeURIComponent(slug)}`),
  publicStatus: (slug: string) =>
    filestoreFetch<FilestorePublicStatus>(`/api/public/status/${encodeURIComponent(slug)}`),
  checkDuplicate: (slug: string, data: Record<string, string>) =>
    filestoreFetch<FilestoreDuplicatePayload>(`/api/submit/${encodeURIComponent(slug)}/check-duplicate`, {
      method: "POST",
      json: { data },
    }),
  prepareRemote: (slug: string, payload: { data: Record<string, string>; answers?: Record<string, FilestoreSurveyAnswer>; overwrite: boolean; files: Array<{ name: string; size: number; type: string }> }) =>
    filestoreFetch<FilestorePrepareRemoteResult>(`/api/submit/${encodeURIComponent(slug)}/prepare-remote`, {
      method: "POST",
      json: payload,
    }),
  completeRemote: (slug: string, payload: { submissionId: number; remoteFileIds: number[]; overwrite: boolean }) =>
    filestoreFetch<FilestoreSubmitResult>(`/api/submit/${encodeURIComponent(slug)}/complete-remote`, {
      method: "POST",
      json: payload,
    }),
  completeRemoteMultipart: (slug: string, form: FormData) =>
    filestoreFetch<FilestoreSubmitResult>(`/api/submit/${encodeURIComponent(slug)}/complete-remote`, {
      method: "POST",
      body: form,
    }),

  fileAccess: (id: number, action: "download" | "preview") =>
    filestoreFetch<FilestoreFileAccess>(`/api/files/${id}/access?action=${encodeURIComponent(action)}`),
  fileBlob: (id: number, action: "download" | "preview") =>
    filestoreBlob(`/api/files/${id}/${action}`),
  deleteFile: (id: number) =>
    filestoreFetch<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" }),
  deleteSubmission: (id: number) =>
    filestoreFetch<{ ok: true }>(`/api/submissions/${id}`, { method: "DELETE" }),
};
