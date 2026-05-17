import { request } from "./request";

export const adminApi = {
  // 概览
  overview: () => request.get<any>("/admin/overview"),
  // 用户
  users: (params: {
    q?: string;
    role?: string;
    status?: string;
    loginClient?: string;
    usedIosClient?: string;
    usedAndroidClient?: string;
    loginFrom?: string;
    loginTo?: string;
    page?: number;
    size?: number;
  }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/users", params),
  updateUser: (id: number, patch: { status?: string; role?: string; nickname?: string }) =>
    request.patch<any>(`/admin/users/${id}`, patch),
  createUser: (data: {
    username: string; password: string; nickname: string;
    role?: string; college?: string; enrollYear?: number;
  }) => request.post<any>("/admin/users", data),
  resetUserPassword: (id: number, newPassword: string) =>
    request.patch<{ ok: true }>(`/admin/users/${id}/password`, { newPassword }),
  deleteUser: (id: number) =>
    request.delete<{ deletedUserId: number; deletedTopics: number; deletedReplies: number }>(`/admin/users/${id}`),
  // 站点功能开关
  features: () => request.get<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean }>("/admin/features"),
  updateFeatures: (patch: { forum?: boolean; market?: boolean; coursereview?: boolean; electric?: boolean }) =>
    request.patch<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean }>("/admin/features", patch),
  // 帖子
  topics: (params: { q?: string; board?: string; hidden?: "0" | "1"; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/topics", params),
  updateTopic: (id: number, patch: { hidden?: boolean; pinned?: boolean; locked?: boolean; boardSlug?: string }) =>
    request.patch<any>(`/admin/topics/${id}`, patch),
  deleteTopic: (id: number) => request.delete<any>(`/admin/topics/${id}`),
  destroyTopic: (id: number) => request.delete<any>(`/admin/topics/${id}?hard=1`),
  // 爬虫
  feeds: () => request.get<any[]>("/admin/feeds"),
  updateFeed: (id: number, patch: { enabled?: boolean; cronMinutes?: number; maxPages?: number }) =>
    request.patch<any>(`/admin/feeds/${id}`, patch),
  runFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/run`),
  resetRunFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/reset-run`),
  runAllFeeds: () => request.post<any>("/admin/feeds/run-all"),
  // 公告
  announcements: () => request.get<any[]>("/admin/announcements"),
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string }) =>
    request.post<any>("/admin/announcements", p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
};
