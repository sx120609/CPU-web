import { request, type RequestOptions } from "./request";

export type SiteConfig = {
  siteOrigin: string;
  siteFilingNumber: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewApiUrl: string;
  aiReviewModel: string;
  aiReviewFallbackModels: string;
  aiReviewApiKey: string;
  imageReviewEnabled: boolean;
  imageReviewApiUrl: string;
  imageReviewModel: string;
  imageReviewFallbackModels: string;
  imageReviewApiKey: string;
  imageReviewSystemPrompt: string;
  imageReviewUserPrompt: string;
  imageReviewConcurrency: number;
  imageReviewRequestGroupSize: number;
  videoReviewEnabled: boolean;
  videoReviewApiUrl: string;
  videoReviewModel: string;
  videoReviewFallbackModels: string;
  videoReviewApiKey: string;
  videoReviewSystemPrompt: string;
  videoReviewUserPrompt: string;
  videoReviewConcurrency: number;
  aiReviewThreshold: number;
  imageReviewThreshold: number;
  videoReviewThreshold: number;
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

export type MediaStorageConfig = {
  mediaStorageProvider: "local" | "onedrive-cn";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  mediaStorageRemotePrefixes: string[];
  oneDriveChinaClientId: string;
  oneDriveChinaClientSecretConfigured: boolean;
  oneDriveChinaSharepointUrl: string;
  oneDriveChinaSharepointHost: string;
  oneDriveChinaSharepointPath: string;
  oneDriveChinaSiteId: string;
  oneDriveChinaSiteName: string;
  oneDriveChinaDriveId: string;
  oneDriveChinaDriveName: string;
  oneDriveChinaRootPath: string;
  oneDriveChinaRefreshTokenConfigured: boolean;
  oneDriveChinaAuthorizedAt: string;
  oneDriveChinaLastError: string;
};

export type OneDriveChinaDriveOption = {
  id: string;
  name: string;
  webUrl: string;
  driveType: string;
};

export type MediaStorageAdminFileEntry = {
  relativePath: string;
  url: string;
  mediaKind: "image" | "video" | "unknown";
  configuredBackend: "local" | "onedrive-cn";
  inRemotePrefix: boolean;
  localExists: boolean;
  cacheExists: boolean;
  remoteExists: boolean;
  localSizeBytes: number | null;
  cacheSizeBytes: number | null;
  remoteSizeBytes: number | null;
  localUpdatedAt: string;
  cacheUpdatedAt: string;
  remoteUpdatedAt: string;
};

export type MediaStorageAdminInventory = {
  generatedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteError: string;
  summary: {
    total: number;
    localCount: number;
    cacheCount: number;
    remoteCount: number;
    eligibleMigrationCount: number;
    syncedCount: number;
    migratedCount: number;
    outOfScopeLocalCount: number;
  };
  list: MediaStorageAdminFileEntry[];
};

export type MediaStorageMigrationResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  eligible: number;
  migrated: number;
  failed: number;
  list: Array<{
    relativePath: string;
    status: "migrated" | "failed";
    message: string;
  }>;
};

export type MediaStorageCleanupResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: "local" | "onedrive-cn" | "mixed";
  mediaStorageImageProvider: "local" | "onedrive-cn";
  mediaStorageVideoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  eligible: number;
  removed: number;
  failed: number;
  list: Array<{
    relativePath: string;
    status: "removed" | "failed";
    message: string;
  }>;
};

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

export type CloudDriveDirectory = {
  backend: "local" | "onedrive-cn";
  remoteReady: boolean;
  currentPath: string;
  rootName: string;
  rootStoragePath: string;
  siteName: string;
  driveName: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: CloudDriveEntry[];
};

export type CloudDriveUploadInitResult = {
  backend: "local" | "onedrive-cn";
  mode: "direct" | "proxy";
  relativePath: string;
  uploadUrl?: string;
  uploadToken?: string;
  expiresAt?: string;
};

export type SitePromptDefaults = Pick<
  SiteConfig,
  | "imageReviewSystemPrompt"
  | "imageReviewUserPrompt"
  | "videoReviewSystemPrompt"
  | "videoReviewUserPrompt"
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

export type ForumVideoSweepResult = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  videoReferences: number;
  uniqueVideoUrls: number;
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

export type ForumVideoReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewModel?: string | null;
  reviewEndpoint?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  transcriptStatus?: string | null;
  manualReviewedAt?: string | null;
  manualReviewNote?: string | null;
  manualReviewedBy?: { id: number; nickname: string; username?: string } | null;
};

export type ForumVideoQueueRow = {
  id: number;
  url: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
  transcriptStatus?: string | null;
  createdAt: string;
  targetKind: "topic" | "reply" | "unknown";
  targetId?: number | null;
  targetLabel: string;
  targetUrl: string;
};

export type AdminOverview = {
  users: number;
  banned: number;
  todayLogins: number;
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
  dailyActiveSeries: Array<{
    date: string;
    count: number;
  }>;
};

export type WeiwallSyncConfig = {
  id: number;
  enabled: boolean;
  baseUrl: string;
  schoolEn: string;
  tenantId: number;
  tokenPresent: boolean;
  tokenPreview: string;
  tokenExpiresAt: string | null;
  tokenExpiresKnown: boolean;
  tokenExpired: boolean;
  intervalSeconds: number;
  topicPages: number;
  commentPageSize: number;
  maxCommentPages: number;
  maxReplyPages: number;
  board: null | {
    id: number;
    slug: string;
    name: string;
    readOnly: boolean;
    topicCount: number;
  };
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  lastSyncedAt: string | null;
};

export type WeiwallSyncRunResult = {
  ok: boolean;
  boardSlug: string;
  sourceName: string;
  pagesScanned: number;
  topicsScanned: number;
  topicsCreated: number;
  topicsUpdated: number;
  repliesCreated: number;
  repliesUpdated: number;
  authorsCreated: number;
  authorsUpdated: number;
  commentsFetched: number;
  latestExternalTopicId: string | null;
  topicTraces: Array<{
    phase: "latest" | "backfill";
    action: "fetched" | "probed" | "skipped";
    externalTopicId: string;
    localTopicId: number | null;
    title: string;
    remoteCommentCount: number | null;
    localReplyCountBefore: number | null;
    visibleReplyCountAfter: number | null;
    commentsFetched: number;
    repliesCreated: number;
    repliesUpdated: number;
    note: string | null;
  }>;
  error?: string | null;
};

export type WeiwallTokenAuthSession = {
  flowId: string;
  authorizeUrl: string;
  qrDataUrl: string;
  callbackUrl: string;
  expiresAt: string;
};

export type WeiwallTokenAuthStatus = {
  flowId: string;
  status: "pending" | "success" | "error" | "expired";
  expiresAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type DatabaseBackupStatus = {
  supported: boolean;
  provider: "postgresql" | "unsupported";
  backupMethod: "pg-dump" | null;
  restoreSupported: boolean;
  restoreMethod: "pg-restore" | null;
  exists: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  databasePathLabel: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  downloadFileName: string | null;
  reason: string | null;
  restoreReason: string | null;
  maxRestoreUploadBytes: number | null;
  restoreUploadAccept: string;
};

export type DatabaseRestoreResult = {
  restoredAt: string;
  durationMs: number;
  fileName: string;
  fileSizeBytes: number;
  provider: "postgresql";
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
  overview: (options?: RequestOptions) => request.get<AdminOverview>("/admin/overview", undefined, options),
  // 数据库备份
  databaseStatus: (options?: RequestOptions) => request.get<DatabaseBackupStatus>("/admin/database/status", undefined, options),
  downloadDatabaseBackup: () =>
    request.get<Blob>("/admin/database/backup", undefined, {
      responseType: "blob",
      timeout: 120000,
      suppressErrorMessage: true,
    }),
  restoreDatabaseBackup: (formData: FormData, options?: RequestOptions) =>
    request.post<DatabaseRestoreResult>("/admin/database/restore", formData, options),
  // 用户
  users: (
    params: {
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
    },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/users", params, options),
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
  siteConfig: (options?: RequestOptions) => request.get<SiteConfig>("/admin/site-config", undefined, options),
  sitePromptDefaults: (options?: RequestOptions) => request.get<SitePromptDefaults>("/admin/site-config/prompt-defaults", undefined, options),
  mediaStorageConfig: (options?: RequestOptions) => request.get<MediaStorageConfig>("/admin/media-storage", undefined, options),
  updateMediaStorageConfig: (patch: {
    mediaStorageProvider?: "local" | "onedrive-cn";
    mediaStorageImageProvider?: "local" | "onedrive-cn";
    mediaStorageVideoProvider?: "local" | "onedrive-cn";
    mediaStorageRemotePrefixes?: string[] | string;
    oneDriveChinaClientId?: string;
    oneDriveChinaClientSecret?: string;
    clearOneDriveChinaClientSecret?: boolean;
    oneDriveChinaSharepointUrl?: string;
    oneDriveChinaRootPath?: string;
  }) => request.patch<MediaStorageConfig>("/admin/media-storage", patch),
  beginOneDriveChinaAuth: () =>
    request.post<{ callbackUrl: string; authorizeUrl: string }>("/admin/media-storage/onedrive-cn/authorize", {}),
  validateOneDriveChinaClient: () =>
    request.post<{ ok: true; message: string; detail?: string }>("/admin/media-storage/onedrive-cn/validate-client", {}),
  oneDriveChinaDrives: (options?: RequestOptions) =>
    request.get<{
      siteId: string;
      siteName: string;
      sharepointUrl: string;
      sharepointHost: string;
      sharepointPath: string;
      selectedDriveId: string;
      selectedDriveName: string;
      list: OneDriveChinaDriveOption[];
    }>("/admin/media-storage/onedrive-cn/drives", undefined, options),
  saveOneDriveChinaDrive: (driveId: string) =>
    request.patch<{ driveId: string; driveName: string }>("/admin/media-storage/onedrive-cn/drive", { driveId }),
  clearOneDriveChinaAuthorization: () =>
    request.delete<{ ok: true }>("/admin/media-storage/onedrive-cn/authorization"),
  mediaStorageFiles: (options?: RequestOptions) => request.get<MediaStorageAdminInventory>("/admin/media-storage/files", undefined, options),
  migrateMediaStorageFiles: () => request.post<MediaStorageMigrationResult>("/admin/media-storage/migrate", {}),
  cleanupMediaStorageLocalFiles: () => request.post<MediaStorageCleanupResult>("/admin/media-storage/cleanup-local", {}),
  cloudDrive: (path = "") =>
    request.get<CloudDriveDirectory>("/admin/cloud-drive", { path }),
  createCloudDriveFolder: (data: { path?: string; name: string }) =>
    request.post<CloudDriveEntry>("/admin/cloud-drive/folders", data),
  renameCloudDriveEntry: (data: { path: string; name: string }) =>
    request.patch<CloudDriveEntry>("/admin/cloud-drive/rename", data),
  deleteCloudDriveEntry: (path: string) =>
    request.delete<{ ok: true }>("/admin/cloud-drive", { params: { path } }),
  cloudDriveAccessUrl: (data: { path: string; download?: boolean }) =>
    request.post<{ url: string }>("/admin/cloud-drive/access", data),
  initCloudDriveUpload: (data: {
    path?: string;
    fileName: string;
    mimeType?: string;
    fileSize: number;
  }) => request.post<CloudDriveUploadInitResult>("/admin/cloud-drive/upload/init", data, { timeout: 30000 }),
  completeCloudDriveUpload: (uploadToken: string) =>
    request.post<{ entry: CloudDriveEntry }>("/admin/cloud-drive/upload/complete", { uploadToken }, { timeout: 180000 }),
  uploadCloudDriveFile: (formData: FormData, options?: RequestOptions) =>
    request.post<CloudDriveEntry>("/admin/cloud-drive/upload", formData, options),
  updateSiteConfig: (patch: {
    siteOrigin?: string;
    siteFilingNumber?: string;
    aiReviewEnabled?: boolean;
    aiReviewProvider?: string;
    aiReviewApiUrl?: string;
    aiReviewModel?: string;
    aiReviewFallbackModels?: string;
    aiReviewApiKey?: string;
    imageReviewEnabled?: boolean;
    imageReviewApiUrl?: string;
    imageReviewModel?: string;
    imageReviewFallbackModels?: string;
    imageReviewApiKey?: string;
    imageReviewSystemPrompt?: string;
    imageReviewUserPrompt?: string;
    imageReviewConcurrency?: number;
    imageReviewRequestGroupSize?: number;
    videoReviewEnabled?: boolean;
    videoReviewApiUrl?: string;
    videoReviewModel?: string;
    videoReviewFallbackModels?: string;
    videoReviewApiKey?: string;
    videoReviewSystemPrompt?: string;
    videoReviewUserPrompt?: string;
    videoReviewConcurrency?: number;
    aiReviewThreshold?: number;
    imageReviewThreshold?: number;
    videoReviewThreshold?: number;
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
  aiReviewLogs: (params: { kind?: string; status?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: AiReviewLogRow[] }>("/admin/ai-review/logs", params, options),
  sweepForumImages: () =>
    request.post<ForumImageSweepResult>("/admin/ai-review/images/sweep", {}, { timeout: 120000 }),
  sweepForumVideos: () =>
    request.post<ForumVideoSweepResult>("/admin/ai-review/videos/sweep", {}, { timeout: 120000 }),
  features: (options?: RequestOptions) =>
    request.get<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>("/admin/features", undefined, options),
  updateFeatures: (patch: { forum?: boolean; market?: boolean; coursereview?: boolean; electric?: boolean; sponsor?: boolean }) =>
    request.patch<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>("/admin/features", patch),
  // 易支付
  epayConfig: (options?: RequestOptions) => request.get<EpayConfig>("/admin/epay-config", undefined, options),
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
  qqBotConfig: (options?: RequestOptions) => request.get<QqBotConfig>("/admin/qqbot/config", undefined, options),
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
  qqBotBindings: (params?: { q?: string }, options?: RequestOptions) => request.get<any[]>("/admin/qqbot/bindings", params, options),
  updateQqBotBinding: (id: number, payload: { enabled: boolean }) => request.patch<any>(`/admin/qqbot/bindings/${id}`, payload),
  deleteQqBotBinding: (id: number) => request.delete<{ ok: true }>(`/admin/qqbot/bindings/${id}`),
  qqBotGroups: (options?: RequestOptions) => request.get<QqBotGroup[]>("/admin/qqbot/groups", undefined, options),
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
  qqBotLogs: (params: { status?: string; eventType?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/qqbot/logs", params, options),
  sendQqBotTestMessage: (payload: { qqId?: string; groupId?: string; message: string }) =>
    request.post<{ ok: true }>("/admin/qqbot/test-message", payload),
  dispatchQqBotNotifications: () => request.post<{ sent: number }>("/admin/qqbot/dispatch-notifications"),
  createQqBotBindToken: () => request.post<{ token: string; expiresAt: string }>("/qqbot/bind-token"),
  // 帖子
  topics: (
    params: { q?: string; board?: string; hidden?: "0" | "1"; reviewStatus?: string; page?: number; size?: number },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/topics", params, options),
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
  reviewTargetVideos: (kind: ReviewTargetKind, id: number) =>
    request.get<{ kind: ReviewTargetKind; id: number; topicId?: number; list: ForumVideoReviewAsset[] }>(`/admin/review-targets/${kind}/${id}/videos`),
  updateForumImage: (id: number, patch: {
    status: "approved" | "rejected";
    manualReviewNote?: string;
  }) =>
    request.patch<ForumImageReviewAsset>(`/admin/forum-images/${id}`, patch),
  forumVideos: (
    params?: {
      status?: "pending" | "manual_review" | "rejected" | "approved" | "error";
      page?: number;
      size?: number;
    },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: ForumVideoQueueRow[] }>("/admin/forum-videos", params, options),
  updateForumVideo: (id: number, patch: {
    status: "approved" | "rejected";
    manualReviewNote?: string;
  }) =>
    request.patch<ForumVideoReviewAsset>(`/admin/forum-videos/${id}`, patch),
  deleteTopic: (id: number) => request.delete<any>(`/admin/topics/${id}`),
  destroyTopic: (id: number) => request.delete<any>(`/admin/topics/${id}?hard=1`),
  // 板块
  boards: (options?: RequestOptions) => request.get<any[]>("/admin/boards", undefined, options),
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
  feeds: (options?: RequestOptions) => request.get<any[]>("/admin/feeds", undefined, options),
  updateFeed: (id: number, patch: { enabled?: boolean; cronMinutes?: number; maxPages?: number }) =>
    request.patch<any>(`/admin/feeds/${id}`, patch),
  runFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/run`),
  resetRunFeed: (id: number) => request.post<any>(`/admin/feeds/${id}/reset-run`),
  runAllFeeds: () => request.post<any>("/admin/feeds/run-all"),
  // 逛逛同步
  weiwallSync: () => request.get<WeiwallSyncConfig>("/admin/weiwall-sync"),
  updateWeiwallSync: (patch: Partial<{
    enabled: boolean;
    baseUrl: string;
    schoolEn: string;
    tenantId: number;
    token: string;
    clearToken: boolean;
    intervalSeconds: number;
    topicPages: number;
    commentPageSize: number;
    maxCommentPages: number;
    maxReplyPages: number;
  }>) => request.patch<WeiwallSyncConfig>("/admin/weiwall-sync", patch),
  runWeiwallSync: () => request.post<WeiwallSyncRunResult>("/admin/weiwall-sync/run", {}),
  createWeiwallAuthLink: (origin?: string) => request.post<WeiwallTokenAuthSession>("/admin/weiwall-sync/auth-link", origin ? { origin } : {}),
  getWeiwallAuthStatus: (flowId: string) => request.get<WeiwallTokenAuthStatus>(`/admin/weiwall-sync/auth-status/${flowId}`),
  // 公告
  announcements: (options?: RequestOptions) => request.get<any[]>("/admin/announcements", undefined, options),
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string; source?: string; targetClient?: "all" | "ios" | "android" | "harmony" }) =>
    request.post<any>("/admin/announcements", p),
  updateAnnouncement: (id: number, p: { title?: string; content?: string; level?: string; link?: string | null; source?: string | null; targetClient?: "all" | "ios" | "android" | "harmony" }) =>
    request.patch<any>(`/admin/announcements/${id}`, p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
};
