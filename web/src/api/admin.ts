import { request } from "./request";

export type SiteConfig = {
  siteOrigin: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewModel: string;
  aiReviewApiKey: string;
  imageReviewEnabled: boolean;
  imageReviewApiUrl: string;
  imageReviewModel: string;
  imageReviewApiKey: string;
  imageReviewSystemPrompt: string;
  imageReviewUserPrompt: string;
  imageReviewConcurrency: number;
  imageReviewRequestGroupSize: number;
  aiReviewAutoPassScore: number;
  aiReviewBlockScore: number;
  imageReviewAutoPassScore: number;
  imageReviewBlockScore: number;
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
export type SitePromptDefaults = Pick<
  SiteConfig,
  | "imageReviewSystemPrompt"
  | "imageReviewUserPrompt"
  | "aiTopicReviewSystemPrompt"
  | "aiTopicReviewUserPrompt"
  | "aiReplyReviewSystemPrompt"
  | "aiReplyReviewUserPrompt"
  | "aiEditSimilaritySystemPrompt"
  | "aiEditSimilarityUserPrompt"
>;

export type AiReviewLogRow = {
  id: number;
  kind: string;
  targetId?: number | null;
  targetLabel?: string | null;
  targetUrl?: string | null;
  provider: string;
  model: string;
  endpoint?: string | null;
  status: string;
  requestSummary: string;
  responseSummary: string;
  errorMessage?: string | null;
  createdById?: number | null;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  createdBy?: { id: number; nickname: string; username?: string } | null;
};

export type ForumImageSweepResult = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  imageReferences: number;
  uniqueImageUrls: number;
  createdAssets: number;
  requeuedAssets: number;
  alreadyTracked: number;
  skippedAssets: number;
  pendingAfterScan: number;
  moderationTriggered: boolean;
};

export type ReviewTargetKind = "topic" | "reply";

export type ForumImageReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewModel?: string | null;
  reviewEndpoint?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  manualReviewedAt?: string | null;
  manualReviewNote?: string | null;
  manualReviewedBy?: { id: number; nickname: string; username?: string } | null;
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
  harmonyClients: number;
  feeds: number;
  boards: number;
  forumEligibleUsers: number;
  forumEnabledUsers: number;
  forumPendingUsers: number;
  forumEnabledToday: number;
};

export type DatabaseBackupStatus = {
  supported: boolean;
  provider: "sqlite-file" | "unsupported";
  exists: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  databasePathLabel: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  downloadFileName: string | null;
  reason: string | null;
};

export type DatabaseRestoreResult = {
  restoredAt: string;
  databasePathLabel: string;
  sizeBytes: number;
  safetyCopyPathLabel: string | null;
};

export type DatabaseMigrationRunRecord = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  clearTarget: boolean;
  batchSize: number;
  success: boolean;
  output: string;
};

export type DatabaseMigrationStatus = {
  supported: boolean;
  sourceProvider: "sqlite-file" | "unsupported";
  targetConfigured: boolean;
  targetDisplay: string | null;
  running: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  reason: string | null;
  lastRun: DatabaseMigrationRunRecord | null;
};

export type EpayConfig = {
  id: number;
  enabled: boolean;
  gatewayUrl: string;
  submitUrl: string;
  pid: string;
  hasMerchantKey: boolean;
  merchantKeyMasked: string;
  signType: "MD5";
  defaultType: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
  enabledTypes: Array<"alipay" | "wxpay" | "qqpay" | "bank" | "jdpay">;
  notifyUrl: string;
  returnUrl: string;
  siteOrigin: string;
  createdAt: string;
  updatedAt: string;
};

export type EpayPreview = {
  submitUrl: string;
  method: "POST";
  params: Record<string, string>;
};

export type SponsorConfig = {
  title: string;
  description: string;
  presetAmounts: number[];
  minAmount: string;
  maxAmount: string;
  wallEnabled: boolean;
  allowMessage: boolean;
};

export type QqBotConfig = {
  id: number;
  enabled: boolean;
  botQqId: string;
  napcatBaseUrl: string;
  hasAccessToken: boolean;
  accessTokenMasked: string;
  connectionStatus: "disabled" | "http" | "idle" | "connecting" | "connected" | "error";
  connectionError: string;
  webhookSecret: string;
  defaultBoardSlug: string;
  allowPrivatePost: boolean;
  allowGroupPost: boolean;
  notificationEnabled: boolean;
  notifyCategories: string[];
  webhookPath: string;
  createdAt: string;
  updatedAt: string;
};

export type QqBotGroup = {
  id: number;
  groupId: string;
  name?: string | null;
  enabled: boolean;
  allowPosting: boolean;
  defaultBoardSlug?: string | null;
  notificationEnabled: boolean;
  notifyCategories: Array<"system" | "school-feed">;
  notifyAudiences: Array<"public" | "staff">;
  createdAt: string;
  updatedAt: string;
};

export const adminApi = {
  // 概览
  overview: () => request.get<AdminOverview>("/admin/overview"),
  // 数据库备份
  databaseStatus: () => request.get<DatabaseBackupStatus>("/admin/database/status"),
  downloadDatabaseBackup: () =>
    request.get<Blob>("/admin/database/backup", undefined, {
      responseType: "blob",
      timeout: 120000,
      suppressErrorMessage: true,
    }),
  restoreDatabase: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request.post<DatabaseRestoreResult>("/admin/database/restore", form, {
      timeout: 120000,
    });
  },
  databaseMigrationStatus: () => request.get<DatabaseMigrationStatus>("/admin/database/postgres/status"),
  runDatabaseMigration: (payload: { batchSize: number; clearTarget?: boolean; dryRun?: boolean }) =>
    request.post<DatabaseMigrationRunRecord>("/admin/database/postgres/migrate", payload, {
      timeout: 0,
    }),
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
    usedHarmonyClient?: string;
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
  sitePromptDefaults: () => request.get<SitePromptDefaults>("/admin/site-config/prompt-defaults"),
  updateSiteConfig: (patch: {
    siteOrigin?: string;
    aiReviewEnabled?: boolean;
    aiReviewProvider?: string;
    aiReviewModel?: string;
    aiReviewApiKey?: string;
    imageReviewEnabled?: boolean;
    imageReviewApiUrl?: string;
    imageReviewModel?: string;
    imageReviewApiKey?: string;
    imageReviewSystemPrompt?: string;
    imageReviewUserPrompt?: string;
    imageReviewConcurrency?: number;
    imageReviewRequestGroupSize?: number;
    aiReviewAutoPassScore?: number;
    aiReviewBlockScore?: number;
    imageReviewAutoPassScore?: number;
    imageReviewBlockScore?: number;
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
  aiReviewLogs: (params: { kind?: string; status?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: AiReviewLogRow[] }>("/admin/ai-review/logs", params),
  sweepForumImages: () =>
    request.post<ForumImageSweepResult>("/admin/ai-review/images/sweep", {}, { timeout: 120000 }),
  features: () => request.get<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>("/admin/features"),
  updateFeatures: (patch: { forum?: boolean; market?: boolean; coursereview?: boolean; electric?: boolean; sponsor?: boolean }) =>
    request.patch<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>("/admin/features", patch),
  // 易支付
  epayConfig: () => request.get<EpayConfig>("/admin/epay-config"),
  updateEpayConfig: (patch: Partial<{
    enabled: boolean;
    gatewayUrl: string;
    pid: string;
    merchantKey: string;
    clearMerchantKey: boolean;
    signType: "MD5";
    defaultType: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
    enabledTypes: Array<"alipay" | "wxpay" | "qqpay" | "bank" | "jdpay">;
  }>) => request.patch<EpayConfig>("/admin/epay-config", patch),
  previewEpayPayment: (payload: {
    outTradeNo: string;
    name: string;
    money: string;
    type?: "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";
    notifyUrl?: string;
    returnUrl?: string;
    clientIp?: string;
    device?: string;
    param?: string;
  }) => request.post<EpayPreview>("/admin/epay-config/preview", payload),
  sponsorConfig: () => request.get<SponsorConfig>("/admin/sponsor-config"),
  updateSponsorConfig: (payload: Partial<SponsorConfig>) =>
    request.patch<SponsorConfig>("/admin/sponsor-config", payload),
  sponsorOverview: () => request.get<any>("/admin/sponsor-overview"),
  sponsorOrders: (params: { q?: string; status?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/sponsor-orders", params),
  updateSponsorOrder: (id: number, payload: { status?: "pending" | "paid" | "closed"; message?: string; displayMode?: "public" | "anonymous" | "hidden" }) =>
    request.patch<any>(`/admin/sponsor-orders/${id}`, payload),
  sponsorLogs: (params: { q?: string; signOk?: "0" | "1"; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/sponsor-logs", params),
  // QQBot / NapCat
  qqBotConfig: () => request.get<QqBotConfig>("/admin/qqbot/config"),
  updateQqBotConfig: (payload: Partial<{
    enabled: boolean;
    botQqId: string;
    napcatBaseUrl: string;
    accessToken: string;
    clearAccessToken: boolean;
    webhookSecret: string;
    defaultBoardSlug: string;
    allowPrivatePost: boolean;
    allowGroupPost: boolean;
    notificationEnabled: boolean;
    notifyCategories: string[];
  }>) => request.patch<QqBotConfig>("/admin/qqbot/config", payload),
  qqBotBindings: (params?: { q?: string }) => request.get<any[]>("/admin/qqbot/bindings", params),
  updateQqBotBinding: (id: number, payload: { enabled: boolean }) => request.patch<any>(`/admin/qqbot/bindings/${id}`, payload),
  deleteQqBotBinding: (id: number) => request.delete<{ ok: true }>(`/admin/qqbot/bindings/${id}`),
  qqBotGroups: () => request.get<QqBotGroup[]>("/admin/qqbot/groups"),
  upsertQqBotGroup: (payload: {
    groupId: string;
    name?: string;
    enabled?: boolean;
    allowPosting?: boolean;
    defaultBoardSlug?: string | null;
    notificationEnabled?: boolean;
    notifyCategories?: Array<"system" | "school-feed">;
    notifyAudiences?: Array<"public" | "staff">;
  }) => request.post<QqBotGroup>("/admin/qqbot/groups", payload),
  deleteQqBotGroup: (id: number) => request.delete<{ ok: true }>(`/admin/qqbot/groups/${id}`),
  qqBotLogs: (params: { status?: string; eventType?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/qqbot/logs", params),
  sendQqBotTestMessage: (payload: { qqId?: string; groupId?: string; message: string }) =>
    request.post<{ ok: true }>("/admin/qqbot/test-message", payload),
  dispatchQqBotNotifications: () => request.post<{ sent: number }>("/admin/qqbot/dispatch-notifications"),
  createQqBotBindToken: () => request.post<{ token: string; expiresAt: string }>("/qqbot/bind-token"),
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
  reviewTarget: (kind: ReviewTargetKind, id: number) =>
    request.get<{ kind: ReviewTargetKind; id: number; title: string; aiReviewStatus: string; hidden: boolean; topicId?: number; reviewable: boolean }>(`/admin/review-targets/${kind}/${id}`),
  reviewTargetImages: (kind: ReviewTargetKind, id: number) =>
    request.get<{ kind: ReviewTargetKind; id: number; topicId?: number; list: ForumImageReviewAsset[] }>(`/admin/review-targets/${kind}/${id}/images`),
  updateForumImage: (id: number, patch: {
    status: "approved" | "rejected";
    manualReviewNote?: string;
  }) =>
    request.patch<ForumImageReviewAsset>(`/admin/forum-images/${id}`, patch),
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
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string; source?: string; targetClient?: "all" | "ios" | "android" | "harmony" }) =>
    request.post<any>("/admin/announcements", p),
  updateAnnouncement: (id: number, p: { title?: string; content?: string; level?: string; link?: string | null; source?: string | null; targetClient?: "all" | "ios" | "android" | "harmony" }) =>
    request.patch<any>(`/admin/announcements/${id}`, p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
};
