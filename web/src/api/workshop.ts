import { request, type RequestOptions } from "./request";

export type WorkshopType = "game" | "tool" | "extension";
export type WorkshopSlot = "splash" | "dialog";
export type WorkshopPermission =
  | "storage"
  | "site.public"
  | "ui.toast"
  | "ui.confirm"
  | "navigation"
  | "fullscreen"
  | "motion.shake";
export interface WorkshopPlacement {
  slot: WorkshopSlot;
  workId: string;
  version: WorkshopVersion;
  maxDurationSeconds: number;
  active?: boolean;
  updatedAt?: string;
}
export type WorkshopCatalogItem = Pick<
  WorkshopVersion,
  "name" | "description" | "type" | "version"
> & { id: string; slug: string };
export type WorkshopStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
export interface WorkshopManifest {
  schemaVersion: 1;
  id: string;
  type: WorkshopType;
  name: string;
  version: string;
  description: string;
  entry: string;
  permissions?: WorkshopPermission[];
  extension?: { slots: WorkshopSlot[] };
  game?: {
    orientation: "portrait" | "landscape" | "any";
    controls: ("pointer" | "keyboard" | "touch")[];
    aspectRatio?: number;
  };
}
export interface WorkshopVersion {
  id: string;
  workId: string;
  version: string;
  name: string;
  description: string;
  type: WorkshopType;
  manifest: WorkshopManifest;
  status: WorkshopStatus;
  reviewReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}
export interface WorkshopWork {
  id: string;
  slug: string;
  author: { id: number; nickname: string };
  disabled: boolean;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  favoriteCount: number;
  isFavorited: boolean;
  version: WorkshopVersion | null;
  versions?: WorkshopVersion[];
}
export interface WorkshopPage<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
export interface WorkshopRuntimeTicket {
  url: string;
  expiresAt: string;
  versionId: string;
}
export type WorkshopStorage =
  | null
  | boolean
  | number
  | string
  | WorkshopStorage[]
  | { [key: string]: WorkshopStorage };
export interface WorkshopReport {
  id: string;
  reason: string;
  createdAt: string;
  work: { id: string; slug: string; name: string };
  reporter: { id: number; nickname: string };
  resolvedAt: string | null;
  resolution: string | null;
  resolvedBy: { id: number; nickname: string } | null;
}
export interface WorkshopAudit {
  id: string;
  actor: { id: number; nickname: string } | null;
  version: { id: string; version: string } | null;
  action: string;
  reason: string | null;
  createdAt: string;
}
export interface WorkshopSaveSummary {
  workId: string;
  name: string;
  bytes: number;
  updatedAt: string;
}
export interface WorkshopListParams {
  q?: string;
  type?: WorkshopType;
  page?: number;
  pageSize?: number;
  favorites?: "1";
}
const readOptions: RequestOptions = {
  cacheTtlMs: 0,
  cacheStaleTtlMs: 0,
  suppressErrorMessage: true,
};
const writeOptions: RequestOptions = { suppressErrorMessage: true };
const workPath = (id: string) => `/workshop/works/${encodeURIComponent(id)}`;

export const workshopApi = {
  publicSite: () =>
    request.get<{ name: string; locale: string }>(
      "/workshop/public/site",
      undefined,
      readOptions,
    ),
  publicCatalog: (params: WorkshopListParams = {}) =>
    request.get<WorkshopPage<WorkshopCatalogItem>>(
      "/workshop/public/catalog",
      { ...params, pageSize: Math.min(params.pageSize || 12, 12) },
      readOptions,
    ),
  placements: () =>
    request.get<{ items: WorkshopPlacement[] }>(
      "/workshop/placements",
      undefined,
      readOptions,
    ),
  adminPlacements: () =>
    request.get<{ items: WorkshopPlacement[] }>(
      "/workshop/admin/placements",
      undefined,
      readOptions,
    ),
  setPlacement: (slot: WorkshopSlot, versionId: string | null) =>
    request.put<{ items: WorkshopPlacement[] }>(
      `/workshop/admin/placements/${slot}`,
      { versionId },
      writeOptions,
    ),
  list: (params: WorkshopListParams = {}) =>
    request.get<WorkshopPage<WorkshopWork>>(
      "/workshop/works",
      { ...params },
      readOptions,
    ),
  detail: (id: string) =>
    request.get<WorkshopWork>(workPath(id), undefined, readOptions),
  mine: (params: WorkshopListParams = {}) =>
    request.get<WorkshopPage<WorkshopWork>>(
      "/workshop/mine",
      { ...params },
      readOptions,
    ),
  upload: (file: File, options?: RequestOptions, expectedWorkId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (expectedWorkId) form.append("expectedWorkId", expectedWorkId);
    return request.post<{
      workId: string;
      versionId: string;
      work: WorkshopWork;
      version: WorkshopVersion;
    }>("/workshop/packages", form, {
      ...writeOptions,
      timeout: 120_000,
      ...options,
    });
  },
  submit: (id: string) =>
    request.post(
      `/workshop/versions/${encodeURIComponent(id)}/submit`,
      undefined,
      writeOptions,
    ),
  preview: (id: string) =>
    request.post<WorkshopRuntimeTicket>(
      `/workshop/versions/${encodeURIComponent(id)}/preview`,
      undefined,
      writeOptions,
    ),
  play: (id: string) =>
    request.post<WorkshopRuntimeTicket>(
      `${workPath(id)}/play`,
      undefined,
      writeOptions,
    ),
  favorite: (id: string) =>
    request.put(`${workPath(id)}/favorite`, undefined, writeOptions),
  unfavorite: (id: string) =>
    request.delete(`${workPath(id)}/favorite`, writeOptions),
  report: (id: string, reason: string) =>
    request.post(`${workPath(id)}/reports`, { reason }, writeOptions),
  queue: (params: WorkshopListParams = {}) =>
    request.get<WorkshopPage<WorkshopWork>>(
      "/workshop/admin/queue",
      { ...params },
      readOptions,
    ),
  adminWorks: (
    params: WorkshopListParams & {
      state?: "published" | "unpublished" | "disabled";
    } = {},
  ) =>
    request.get<WorkshopPage<WorkshopWork>>(
      "/workshop/admin/works",
      { ...params },
      readOptions,
    ),
  reports: (
    params: {
      page?: number;
      pageSize?: number;
      reportStatus?: "open" | "resolved";
    } = {},
  ) =>
    request.get<WorkshopPage<WorkshopReport>>(
      "/workshop/admin/reports",
      params,
      readOptions,
    ),
  audits: (id: string, params: { page?: number; pageSize?: number } = {}) =>
    request.get<WorkshopPage<WorkshopAudit>>(
      `/workshop/admin/works/${encodeURIComponent(id)}/audits`,
      params,
      readOptions,
    ),
  resolveReport: (id: string, resolution: string) =>
    request.post(
      `/workshop/admin/reports/${encodeURIComponent(id)}/resolve`,
      { resolution },
      writeOptions,
    ),
  review: (id: string, decision: "approve" | "reject", reason?: string) =>
    request.post(
      `/workshop/admin/versions/${encodeURIComponent(id)}/review`,
      { decision, reason },
      writeOptions,
    ),
  state: (id: string, action: "unpublish" | "disable" | "enable") =>
    request.post(
      `/workshop/admin/works/${encodeURIComponent(id)}/state`,
      { action },
      writeOptions,
    ),
  getStorage: (id: string, versionId: string) =>
    request.get<{ data: WorkshopStorage }>(
      `${workPath(id)}/storage`,
      { versionId },
      readOptions,
    ),
  setStorage: (id: string, versionId: string, data: WorkshopStorage) =>
    request.put(`${workPath(id)}/storage`, { versionId, data }, writeOptions),
  savedWorks: (params: { page?: number; pageSize?: number } = {}) =>
    request.get<WorkshopPage<WorkshopSaveSummary>>("/workshop/storage", params, readOptions),
  deleteStorage: (id: string, versionId?: string) =>
    request.delete(`${workPath(id)}/storage`, {
      ...writeOptions,
      params: { versionId },
    }),
};
