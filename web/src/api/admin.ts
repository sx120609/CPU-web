import { request } from "./request";

export const adminApi = {
  // 概览
  overview: () => request.get<any>("/admin/overview"),
  // 用户
  users: (params: { q?: string; role?: string; status?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/users", params),
  updateUser: (id: number, patch: { status?: string; role?: string; nickname?: string }) =>
    request.patch<any>(`/admin/users/${id}`, patch),
  // 帖子
  topics: (params: { q?: string; board?: string; hidden?: "0" | "1"; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/topics", params),
  updateTopic: (id: number, patch: { hidden?: boolean; pinned?: boolean; locked?: boolean; boardSlug?: string }) =>
    request.patch<any>(`/admin/topics/${id}`, patch),
  deleteTopic: (id: number) => request.delete<any>(`/admin/topics/${id}`),
  // 爬虫
  feeds: () => request.get<any[]>("/admin/feeds"),
  updateFeed: (id: number, patch: { enabled?: boolean; cronMinutes?: number; maxPages?: number }) =>
    request.patch<any>(`/admin/feeds/${id}`, patch),
  runFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/run`),
  runAllFeeds: () => request.post<any>("/admin/feeds/run-all"),
  // 公告
  announcements: () => request.get<any[]>("/admin/announcements"),
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string }) =>
    request.post<any>("/admin/announcements", p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
};
