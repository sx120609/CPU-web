import { request } from "./request";

/** 一条同步记录，见 server/src/services/nextSync.ts。 */
export type SyncRecord = {
  collection: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
};

export type SyncPull = { records: SyncRecord[]; cursor: string; more: boolean };
export type SyncPush = {
  applied: Array<{ collection: string; id: string }>;
  newer: SyncRecord[];
  rejected: Array<{ collection: string; id: string; reason: string }>;
};

/** 日程和药大拾间 NEXT 共用 `/api/next-sync`；网页只拉日程和它的设置。 */
export const agendaApi = {
  pull: (cursor: string) => request.get<SyncPull>(
    "/next-sync",
    { collection: "agenda,settings", ...(cursor ? { cursor } : {}) },
    { cacheTtlMs: 0, suppressErrorMessage: true },
  ),
  push: (records: Array<Omit<SyncRecord, "data"> & { data?: unknown }>) =>
    request.post<SyncPush>("/next-sync", { records }, { suppressErrorMessage: true, preserveResponseCache: true }),
};
