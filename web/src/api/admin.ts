import { request } from "./request";

export type SiteConfig = {
  siteOrigin: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewModel: string;
  aiReviewApiKey: string;
  aiReviewAutoPassScore: number;
  aiReviewBlockScore: number;
  aiReviewForceBlockScore: number;
  aiEditSimilarityThreshold: number;
  aiTopicReviewSystemPrompt: string;
  aiTopicReviewUserPrompt: string;
  aiReplyReviewSystemPrompt: string;
  aiReplyReviewUserPrompt: string;
  aiEditSimilaritySystemPrompt: string;
  aiEditSimilarityUserPrompt: string;
  anonymousMinReputation: number;
  accountAgeDaysPerStep: number;
  accountAgePointsPerStep: number;
  accountAgePointsCap: number;
  postPointsPerTopic: number;
  postPointsCap: number;
  replyPointsPerReply: number;
  replyPointsCap: number;
  forumEnabledBonus: number;
  anonymousTiers: Array<{ reputation: number; quota: number }>;
  reputationLevels: Array<{ level: number; name: string; minReputation: number }>;
};

export type AdminOverview = {
  users: number;
  banned: number;
  recentLogins: number;
  topics: number;
  todayTopics: number;
  hiddenTopics: number;
  replies: number;
  iosClients: number;
  androidClients: number;
  feeds: number;
  boards: number;
  forumEligibleUsers: number;
  forumEnabledUsers: number;
  forumPendingUsers: number;
  forumEnabledToday: number;
};

export const adminApi = {
  // 概览
  overview: () => request.get<AdminOverview>("/admin/overview"),
  // 用户
  users: (params: {
    q?: string;
    role?: string;
    status?: string;
    forumEnabled?: string;
    loginClient?: string;
    usedClient?: string;
    usedIosClient?: string;
    usedAndroidClient?: string;
    loginFrom?: string;
    loginTo?: string;
    sort?: string;
    page?: number;
    size?: number;
  }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/users", params),
  updateUser: (id: number, patch: {
    status?: string;
    role?: string;
    nickname?: string;
    aiReviewWhitelisted?: boolean;
    mutedUntil?: string | null;
    anonymousCredits?: number;
    anonymousCreditsFrozen?: boolean;
  }) =>
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
  siteConfig: () => request.get<SiteConfig>("/admin/site-config"),
  updateSiteConfig: (patch: {
    siteOrigin?: string;
    aiReviewEnabled?: boolean;
    aiReviewProvider?: string;
    aiReviewModel?: string;
    aiReviewApiKey?: string;
    aiReviewAutoPassScore?: number;
    aiReviewBlockScore?: number;
    aiReviewForceBlockScore?: number;
    aiEditSimilarityThreshold?: number;
    aiTopicReviewSystemPrompt?: string;
    aiTopicReviewUserPrompt?: string;
    aiReplyReviewSystemPrompt?: string;
    aiReplyReviewUserPrompt?: string;
    aiEditSimilaritySystemPrompt?: string;
    aiEditSimilarityUserPrompt?: string;
    anonymousMinReputation?: number;
    accountAgeDaysPerStep?: number;
    accountAgePointsPerStep?: number;
    accountAgePointsCap?: number;
    postPointsPerTopic?: number;
    postPointsCap?: number;
    replyPointsPerReply?: number;
    replyPointsCap?: number;
    forumEnabledBonus?: number;
    anonymousTiers?: Array<{ reputation: number; quota: number }>;
    reputationLevels?: Array<{ level: number; name: string; minReputation: number }>;
  }) =>
    request.patch<SiteConfig>("/admin/site-config", patch),
  features: () => request.get<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean }>("/admin/features"),
  updateFeatures: (patch: { forum?: boolean; market?: boolean; coursereview?: boolean; electric?: boolean }) =>
    request.patch<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean }>("/admin/features", patch),
  // 帖子
  topics: (params: { q?: string; board?: string; hidden?: "0" | "1"; reviewStatus?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/topics", params),
  updateTopic: (id: number, patch: {
    hidden?: boolean;
    pinned?: boolean;
    globalPinned?: boolean;
    locked?: boolean;
    boardSlug?: string;
    aiReviewStatus?: "manual_reviewing" | "approved_manual" | "rejected_manual";
    manualReviewNote?: string;
  }) =>
    request.patch<any>(`/admin/topics/${id}`, patch),
  updateReply: (id: number, patch: {
    aiReviewStatus?: "manual_reviewing" | "approved_manual" | "rejected_manual";
    manualReviewNote?: string;
  }) =>
    request.patch<any>(`/admin/replies/${id}`, patch),
  reviewTarget: (kind: "topic" | "reply", id: number) =>
    request.get<{ kind: "topic" | "reply"; id: number; title: string; aiReviewStatus: string; hidden: boolean; topicId?: number; reviewable: boolean }>(`/admin/review-targets/${kind}/${id}`),
  deleteTopic: (id: number) => request.delete<any>(`/admin/topics/${id}`),
  destroyTopic: (id: number) => request.delete<any>(`/admin/topics/${id}?hard=1`),
  // 板块
  boards: () => request.get<any[]>("/admin/boards"),
  createBoard: (payload: {
    slug: string;
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    order?: number;
    type: "normal" | "question" | "market" | "coursereview";
    anonymousEnabled?: boolean;
  }) => request.post<any>("/admin/boards", payload),
  updateBoard: (id: number, payload: Partial<{
    slug: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    order: number;
    type: "normal" | "question" | "market" | "coursereview";
    anonymousEnabled: boolean;
  }>) => request.patch<any>(`/admin/boards/${id}`, payload),
  deleteBoard: (id: number) => request.delete<any>(`/admin/boards/${id}`),
  // 爬虫
  feeds: () => request.get<any[]>("/admin/feeds"),
  updateFeed: (id: number, patch: { enabled?: boolean; cronMinutes?: number; maxPages?: number }) =>
    request.patch<any>(`/admin/feeds/${id}`, patch),
  runFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/run`),
  resetRunFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/reset-run`),
  runAllFeeds: () => request.post<any>("/admin/feeds/run-all"),
  // 公告
  announcements: () => request.get<any[]>("/admin/announcements"),
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string; targetClient?: "all" | "ios" | "android" }) =>
    request.post<any>("/admin/announcements", p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
};
