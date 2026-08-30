import { request, type RequestOptions } from "./request";
import type { TopNavigationItem } from "./site";

export type AiServiceConfig = {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  assistantContextMaxMessages: number;
  assistantContextMaxCharsPerMessage: number;
};

export type AiServiceScene = "assistant" | "learning-assistant" | "smart-post" | "text-review" | "qq-group-ad" | "image-review" | "video-review";
export type AiServiceFallbackRoute = {
  serviceId: string;
  model: string;
};
export type AiServiceFallbackMap = Record<AiServiceScene, AiServiceFallbackRoute[]>;

export type SiteConfig = {
  siteOrigin: string;
  siteFilingNumber: string;
  assistantModel: string;
  learningAssistantModel: string;
  learningAssistantTiers: Record<"low" | "high" | "max", {
    model: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
    pointMultiplier: number;
    freeInUnlimited: boolean;
  }>;
  learningAssistantAccessMode: "guest-unlimited" | "account-quota";
  learningPlatforms: LearningPlatformAvailability;
  aiServices: AiServiceConfig[];
  aiServiceFallbacks: AiServiceFallbackMap;
  assistantServiceId: string;
  learningAssistantServiceId: string;
  smartPostServiceId: string;
  smartPostEnabled: boolean;
  smartPostModel: string;
  smartPostFallbackModels: string;
  smartPostTokensPerQuota: number;
  aiReviewServiceId: string;
  aiReviewEnabled: boolean;
  aiReviewProvider: string;
  aiReviewApiUrl: string;
  aiReviewModel: string;
  aiReviewFallbackModels: string;
  aiReviewApiKey: string;
  qqGroupAdReviewServiceId: string;
  qqGroupAdReviewEnabled: boolean;
  qqGroupAdReviewProvider: string;
  qqGroupAdReviewApiUrl: string;
  qqGroupAdReviewModel: string;
  qqGroupAdReviewFallbackModels: string;
  qqGroupAdReviewApiKey: string;
  qqGroupAdReviewPeakEnabled: boolean;
  qqGroupAdReviewPeakStart: string;
  qqGroupAdReviewPeakEnd: string;
  qqGroupAdReviewPeakServiceId: string;
  qqGroupAdReviewPeakModel: string;
  qqGroupAdReviewSystemPrompt: string;
  qqGroupAdReviewUserPrompt: string;
  imageReviewServiceId: string;
  imageReviewProvider: string;
  imageReviewEnabled: boolean;
  imageReviewApiUrl: string;
  imageReviewModel: string;
  imageReviewFallbackModels: string;
  imageReviewApiKey: string;
  imageReviewSystemPrompt: string;
  imageReviewUserPrompt: string;
  imageReviewConcurrency: number;
  imageReviewRequestGroupSize: number;
  videoReviewServiceId: string;
  videoReviewProvider: string;
  videoReviewEnabled: boolean;
  videoReviewApiUrl: string;
  videoReviewModel: string;
  videoReviewFallbackModels: string;
  videoReviewApiKey: string;
  videoReviewSystemPrompt: string;
  videoReviewUserPrompt: string;
  videoReviewConcurrency: number;
  aiReviewThreshold: number;
  qqGroupAdReviewThreshold: number;
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
  assistantDailyQuotas: Array<{ level: number; quota: number }>;
};

export type LearningPlatformAvailability = Record<
  "chaoxing" | "zhihuishu" | "icve" | "zjy" | "icourse" | "yuketang" | "weban",
  boolean
>;

export type AiModelCatalog = {
  endpoint: string;
  models: string[];
};

export type CampusAssistantQuotaResetResult = {
  dateKey: string;
  resetUsers: number;
};

export type AssistantPointUser = {
  id: number;
  username: string;
  nickname: string;
  avatar?: string | null;
  assistantPoints: number;
};

export type AssistantPointLedgerRow = {
  id: number;
  userId: number;
  delta: number;
  balanceAfter: number;
  source: "admin_grant" | "sponsor_reward" | "question_bounty_reward" | "ai_usage" | "ai_refund";
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  user: Pick<AssistantPointUser, "id" | "username" | "nickname" | "avatar">;
  operator?: { id: number; username: string; nickname: string } | null;
};

export type AssistantPointOverview = {
  totalPoints: number;
  holderCount: number;
  eligibleUserCount: number;
  transactionCount: number;
  recent: AssistantPointLedgerRow[];
};

export type AssistantPointLedgerPage = {
  page: number;
  size: number;
  total: number;
  list: AssistantPointLedgerRow[];
  summary: {
    transactions: number;
    income: number;
    expense: number;
    net: number;
  };
};

export type AssistantPointLedgerParams = {
  q?: string;
  source?: "" | AssistantPointLedgerRow["source"];
  direction?: "" | "income" | "expense";
  from?: string;
  to?: string;
  page?: number;
  size?: number;
};

export type MediaStorageBackend = "local" | "onedrive-cn" | "cos";

export type MediaStorageConfig = {
  mediaStorageProvider: MediaStorageBackend;
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
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
  tencentCosSecretId: string;
  tencentCosSecretKeyConfigured: boolean;
  tencentCosBucket: string;
  tencentCosRegion: string;
  tencentCosRootPath: string;
  tencentCosPublicBaseUrl: string;
};

export type FilestoreStorageConfig = {
  enabled: boolean;
  minSizeMb: number;
  minSizeBytes: number;
  remoteReady: boolean;
  remoteConfigured: boolean;
  mediaStorageProvider: "local" | "onedrive-cn";
  imageProvider: "local" | "onedrive-cn";
  videoProvider: "local" | "onedrive-cn";
  remotePrefixes: string[];
  fileCollectPrefix: string;
  oneDriveChinaSiteName: string;
  oneDriveChinaDriveName: string;
  oneDriveChinaRootPath: string;
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
  configuredBackend: MediaStorageBackend;
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
  oneDriveExists: boolean;
  oneDriveSizeBytes: number | null;
  oneDriveUpdatedAt: string;
  cosExists: boolean;
  cosSizeBytes: number | null;
  cosUpdatedAt: string;
};

export type MediaStorageAdminInventory = {
  generatedAt: string;
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
  remotePrefixes: string[];
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteError: string;
  oneDriveConfigured: boolean;
  oneDriveReachable: boolean;
  oneDriveError: string;
  cosConfigured: boolean;
  cosReachable: boolean;
  cosError: string;
  summary: {
    total: number;
    localCount: number;
    cacheCount: number;
    remoteCount: number;
    oneDriveCount: number;
    cosCount: number;
    legacyAvatarCount: number;
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
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
  remotePrefixes: string[];
  eligible: number;
  processed: number;
  remaining: number;
  batchLimit: number;
  migrated: number;
  failed: number;
  list: Array<{
    relativePath: string;
    status: "migrated" | "failed";
    message: string;
  }>;
  avatarMigration?: {
    eligible: number;
    processed: number;
    remaining: number;
    migrated: number;
    failed: number;
  };
};

export type MediaStorageCleanupResult = {
  startedAt: string;
  finishedAt: string;
  mediaStorageProvider: MediaStorageBackend | "mixed";
  mediaStorageImageProvider: MediaStorageBackend;
  mediaStorageVideoProvider: MediaStorageBackend;
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

export type SitePromptDefaults = Pick<
  SiteConfig,
  | "qqGroupAdReviewSystemPrompt"
  | "qqGroupAdReviewUserPrompt"
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
  pointCost: number;
  createdBy?: { id: number; nickname: string; username?: string } | null;
};

export type AiUsageLogPage = {
  page: number;
  size: number;
  total: number;
  list: AiReviewLogRow[];
  summary: {
    success: number;
    error: number;
    started: number;
    averageDurationMs: number;
    pointCost: number;
  };
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
  desktopClients: number;
  todayDesktopLogins: number;
  feeds: number;
  boards: number;
  dailyActiveSeries: Array<{
    date: string;
    count: number;
  }>;
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
  assistantPointsPerYuan: number;
  categories: Array<{
    id: string;
    title: string;
    description: string;
    goalAmount: string | null;
    deadline: string | null;
    enabled: boolean;
    featured: boolean;
  }>;
};

export type QqBotConfig = {
  id: number;
  enabled: boolean;
  botQqId: string;
  connectionMode: "outbound" | "inbound";
  napcatBaseUrl: string;
  hasAccessToken: boolean;
  accessTokenMasked: string;
  connectionStatus: "disabled" | "http" | "inbound" | "idle" | "connecting" | "connected" | "error";
  connectionError: string;
  webhookSecret: string;
  defaultBoardSlug: string;
  allowPrivatePost: boolean;
  allowGroupPost: boolean;
  notificationEnabled: boolean;
  qrCodeSendingEnabled: boolean;
  notifyCategories: string[];
  superAdminQqIds: string[];
  webhookPath: string;
  inboundWebSocketPath: string;
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
  memberWelcomeEnabled: boolean;
  memberWelcomeMessage: string;
  adFilterEnabled: boolean;
  assistantProactiveReplyEnabled: boolean;
  assistantReplyQrCodeEnabled: boolean;
  adFilterGroupNoticeEnabled: boolean;
  adFilterBlockQrCodeEnabled: boolean;
  adFilterBlockGroupCardEnabled: boolean;
  adFilterWhitelistBlockQrCodeEnabled: boolean;
  adFilterWhitelistBlockGroupCardEnabled: boolean;
  adFilterReportThreshold: number;
  joinReviewEnabled: boolean;
  allowMute: boolean;
  allowKick: boolean;
  allowKickAndBlock: boolean;
  commandUserQqIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type JwxtAgentConnection = {
  configured: boolean;
  online: boolean;
  ready: boolean;
  inFlight: number;
  maxConcurrent: number;
  connectedAt: number | null;
  lastPongAt: number | null;
  jwxtEnabled: boolean;
  crawlEnabled: boolean;
};

export type WechatServiceConfig = {
  id: number;
  enabled: boolean;
  accountName: string;
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string;
  token: string;
  encodingAesKey: string;
  messageMode: "plaintext" | "compatible" | "safe";
  notificationEnabled: boolean;
  assistantEnabled: boolean;
  notifyCategories: string[];
  notificationTemplateId: string;
  templateTitleField: string;
  templateContentField: string;
  templateTimeField: string;
  templateRemarkField: string;
  callbackUrl: string;
  oauthCallbackUrl: string;
  oauthDomain: string;
  createdAt: string;
  updatedAt: string;
};

export type TopNavigationAdminPayload = {
  items: TopNavigationItem[];
  defaults: TopNavigationItem[];
};

export type JwxtAgentAdminItem = {
  id: string;
  name: string;
  enabled: boolean;
  jwxtEnabled: boolean;
  crawlEnabled: boolean;
  weight: number;
  maxConcurrent: number;
  tokenConfigured: boolean;
  replicaIdentityPinned: boolean;
  replicaKeyFingerprint: string;
  connection: JwxtAgentConnection;
  pool: null | {
    id: string;
    name: string;
    kind: "local" | "agent";
    weight: number;
    inFlight: number;
    cooldownRemainingMs: number;
    consecutiveFailures: number;
  };
  loginPool: JwxtLoginPoolNode | null;
};

export type JwxtLoginPoolNode = {
  id: string;
  name: string;
  kind: "local" | "remote" | "agent";
  enabled: boolean;
  weight: number;
  inFlight: number;
  available: boolean;
  consecutiveFailures: number;
  lastError: string;
};

export type JwxtAgentsAdminConfig = {
  source: "environment" | "database";
  agentPath: string;
  localJwxtEnabled: boolean;
  localJwxtWeight: number;
  crawlAgentId: string;
  local: unknown | null;
  localLoginPool: JwxtLoginPoolNode | null;
  loginPool: {
    dedicated: boolean;
    queryTransport: "local" | "remote" | "agent";
  };
  agents: JwxtAgentAdminItem[];
};

export type ForumAdAdmin = {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  linkUrl: string;
  buttonText: string | null;
  placement: "forum-index-top" | "forum-home-pinned" | "forum-home-hot" | "forum-feed-inline" | "forum-board-top";
  sortOrder: number;
  enabled: boolean;
  vipExempt: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  metrics: {
    all: ForumAdMetricCounter;
    last7Days: ForumAdMetricCounter;
    last30Days: ForumAdMetricCounter;
    mobile: ForumAdMetricCounter;
    desktop: ForumAdMetricCounter;
    daily: Array<{ day: string; impressions: number; clicks: number; ctr: number }>;
  };
};

export type ForumAdMetricCounter = {
  impressions: number;
  clicks: number;
  ctr: number;
};

export type VipGiftCodeAdmin = {
  id: number;
  codePreview: string;
  maxUses: number;
  usedCount: number;
  enabled: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JwxtAgentsAdminPatch = {
  localJwxtEnabled: boolean;
  localJwxtWeight: number;
  crawlAgentId: string;
  agents: Array<{
    id: string;
    name: string;
    token?: string;
    enabled: boolean;
    jwxtEnabled: boolean;
    crawlEnabled: boolean;
    weight: number;
    maxConcurrent: number;
  }>;
};

export type JwxtAgentUpdateResult = {
  accepted: true;
  alreadyScheduled: boolean;
  requestedAt: string;
};

export type AdminDeploymentStatus = {
  available: boolean;
  unavailableReason: string;
  phase: "idle" | "running" | "success" | "failed";
  id: string;
  requestedAt: string;
  startedAt: string;
  finishedAt: string | null;
  operatorId: number | null;
  pid: number | null;
  exitCode: number | null;
  currentCommit: string;
  successfulDeployCommit: string;
  branch: string;
  deployedCommit: string;
  message: string;
  logs: string[];
};

export const adminApi = {
  // 概览
  overview: (options?: RequestOptions) => request.get<AdminOverview>("/admin/overview", undefined, options),
  deploymentStatus: (options?: RequestOptions) =>
    request.get<AdminDeploymentStatus>("/admin/deployment", undefined, { cacheTtlMs: 0, ...options }),
  startDeploymentUpdate: () =>
    request.post<AdminDeploymentStatus>(
      "/admin/deployment/update",
      { confirmation: "UPDATE_AND_DEPLOY" },
      { preserveResponseCache: true },
    ),
  jwxtAgents: (options?: RequestOptions) =>
    request.get<JwxtAgentsAdminConfig>("/admin/jwxt-agents", undefined, options),
  updateJwxtAgents: (payload: JwxtAgentsAdminPatch) =>
    request.patch<JwxtAgentsAdminConfig>("/admin/jwxt-agents", payload),
  generateJwxtAgentToken: () =>
    request.post<{ token: string }>("/admin/jwxt-agents/generate-token", {}),
  resetJwxtAgentIdentity: (agentId: string) =>
    request.post<JwxtAgentsAdminConfig>(`/admin/jwxt-agents/${encodeURIComponent(agentId)}/reset-identity`, {}),
  updateJwxtAgent: (agentId: string) =>
    request.post<JwxtAgentUpdateResult>(`/admin/jwxt-agents/${encodeURIComponent(agentId)}/update`, {}),
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
      loginClient?: string;
      usedClient?: string;
      usedIosClient?: string;
      usedAndroidClient?: string;
      usedHarmonyClient?: string;
      usedDesktopClient?: string;
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
    voiceHubRole?: "admin" | "super_admin" | null;
    lostFoundRole?: "admin" | "super_admin" | null;
    nickname?: string;
    aiReviewWhitelisted?: boolean;
    mutedUntil?: string | null;
    anonymousCredits?: number;
    anonymousCreditsFrozen?: boolean;
    isVip?: boolean;
  }) =>
    request.patch<any>(`/admin/users/${id}`, patch),
  updateUserModuleRoles: (id: number, patch: {
    voiceHubRole?: "admin" | "super_admin" | null;
    lostFoundRole?: "admin" | "super_admin" | null;
  }) => request.patch<any>(`/admin/users/${id}/module-roles`, patch),
  createUser: (data: {
    username: string; password: string; nickname: string;
    role?: string;
    voiceHubRole?: "admin" | "super_admin" | null;
    lostFoundRole?: "admin" | "super_admin" | null;
    college?: string; enrollYear?: number;
  }) => request.post<any>("/admin/users", data),
  resetUserPassword: (id: number, newPassword: string) =>
    request.patch<{ ok: true }>(`/admin/users/${id}/password`, { newPassword }),
  deleteUser: (id: number) =>
    request.delete<{ deletedUserId: number; deletedTopics: number; deletedReplies: number }>(`/admin/users/${id}`),
  // 站点功能开关
  siteConfig: (options?: RequestOptions) => request.get<SiteConfig>("/admin/site-config", undefined, options),
  aiModels: (payload?: { provider?: string; apiUrl?: string; apiKey?: string }) =>
    request.post<AiModelCatalog>("/admin/ai-models", payload ?? {}),
  topNavigation: (options?: RequestOptions) => request.get<TopNavigationAdminPayload>("/admin/top-navigation", undefined, options),
  updateTopNavigation: (items: TopNavigationItem[]) => request.patch<TopNavigationAdminPayload>("/admin/top-navigation", { items }),
  resetTopNavigation: () => request.post<TopNavigationAdminPayload>("/admin/top-navigation/reset", {}),
  sitePromptDefaults: (options?: RequestOptions) => request.get<SitePromptDefaults>("/admin/site-config/prompt-defaults", undefined, options),
  filestoreStorageConfig: (options?: RequestOptions) => request.get<FilestoreStorageConfig>("/admin/filestore-settings", undefined, options),
  updateFilestoreStorageConfig: (patch: { enabled?: boolean; minSizeMb?: number }) =>
    request.patch<FilestoreStorageConfig>("/admin/filestore-settings", patch),
  mediaStorageConfig: (options?: RequestOptions) => request.get<MediaStorageConfig>("/admin/media-storage", undefined, options),
  updateMediaStorageConfig: (patch: {
    mediaStorageProvider?: MediaStorageBackend;
    mediaStorageImageProvider?: MediaStorageBackend;
    mediaStorageVideoProvider?: MediaStorageBackend;
    mediaStorageRemotePrefixes?: string[] | string;
    oneDriveChinaClientId?: string;
    oneDriveChinaClientSecret?: string;
    clearOneDriveChinaClientSecret?: boolean;
    oneDriveChinaSharepointUrl?: string;
    oneDriveChinaRootPath?: string;
    tencentCosSecretId?: string;
    tencentCosSecretKey?: string;
    clearTencentCosSecretKey?: boolean;
    tencentCosBucket?: string;
    tencentCosRegion?: string;
    tencentCosRootPath?: string;
    tencentCosPublicBaseUrl?: string;
  }) => request.patch<MediaStorageConfig>("/admin/media-storage", patch),
  validateTencentCos: () =>
    request.post<{
      ok: true;
      message: string;
      bucket: string;
      region: string;
      rootPath: string;
      endpoint: string;
    }>("/admin/media-storage/cos/validate", {}),
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
  mediaStorageFiles: (options?: RequestOptions) =>
    request.get<MediaStorageAdminInventory>("/admin/media-storage/files", undefined, { timeout: 120000, ...options }),
  migrateMediaStorageFiles: (payload?: { limit?: number; excludePaths?: string[] }) =>
    request.post<MediaStorageMigrationResult>("/admin/media-storage/migrate", payload ?? {}, { timeout: 10 * 60 * 1000 }),
  cleanupMediaStorageLocalFiles: () =>
    request.post<MediaStorageCleanupResult>("/admin/media-storage/cleanup-local", {}, { timeout: 10 * 60 * 1000 }),
  updateSiteConfig: (patch: {
    siteOrigin?: string;
    siteFilingNumber?: string;
    assistantModel?: string;
    learningAssistantModel?: string;
    learningAssistantTiers?: SiteConfig["learningAssistantTiers"];
    learningAssistantAccessMode?: "guest-unlimited" | "account-quota";
    learningPlatforms?: LearningPlatformAvailability;
    aiServices?: AiServiceConfig[];
    aiServiceFallbacks?: AiServiceFallbackMap;
    assistantServiceId?: string;
    learningAssistantServiceId?: string;
    smartPostServiceId?: string;
    smartPostEnabled?: boolean;
    smartPostModel?: string;
    smartPostFallbackModels?: string;
    smartPostTokensPerQuota?: number;
    aiReviewServiceId?: string;
    aiReviewEnabled?: boolean;
    aiReviewProvider?: string;
    aiReviewApiUrl?: string;
    aiReviewModel?: string;
    aiReviewFallbackModels?: string;
    aiReviewApiKey?: string;
    qqGroupAdReviewServiceId?: string;
    qqGroupAdReviewEnabled?: boolean;
    qqGroupAdReviewProvider?: string;
    qqGroupAdReviewApiUrl?: string;
    qqGroupAdReviewModel?: string;
    qqGroupAdReviewFallbackModels?: string;
    qqGroupAdReviewApiKey?: string;
    qqGroupAdReviewPeakEnabled?: boolean;
    qqGroupAdReviewPeakStart?: string;
    qqGroupAdReviewPeakEnd?: string;
    qqGroupAdReviewPeakServiceId?: string;
    qqGroupAdReviewPeakModel?: string;
    qqGroupAdReviewSystemPrompt?: string;
    qqGroupAdReviewUserPrompt?: string;
    imageReviewServiceId?: string;
    imageReviewProvider?: string;
    imageReviewEnabled?: boolean;
    imageReviewApiUrl?: string;
    imageReviewModel?: string;
    imageReviewFallbackModels?: string;
    imageReviewApiKey?: string;
    imageReviewSystemPrompt?: string;
    imageReviewUserPrompt?: string;
    imageReviewConcurrency?: number;
    imageReviewRequestGroupSize?: number;
    videoReviewServiceId?: string;
    videoReviewProvider?: string;
    videoReviewEnabled?: boolean;
    videoReviewApiUrl?: string;
    videoReviewModel?: string;
    videoReviewFallbackModels?: string;
    videoReviewApiKey?: string;
    videoReviewSystemPrompt?: string;
    videoReviewUserPrompt?: string;
    videoReviewConcurrency?: number;
    aiReviewThreshold?: number;
    qqGroupAdReviewThreshold?: number;
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
    assistantDailyQuotas?: Array<{ level: number; quota: number }>;
  }) =>
    request.patch<SiteConfig>("/admin/site-config", patch),
  resetCampusAssistantDailyQuota: () =>
    request.post<CampusAssistantQuotaResetResult>("/admin/campus-assistant/quota/reset-today", {}),
  assistantPointUsers: (params: { q?: string; size?: number }, options?: RequestOptions) =>
    request.get<AssistantPointUser[]>("/admin/campus-assistant/points/users", params, options),
  assistantPointOverview: (options?: RequestOptions) =>
    request.get<AssistantPointOverview>("/admin/campus-assistant/points/overview", undefined, options),
  assistantPointLedger: (params: AssistantPointLedgerParams, options?: RequestOptions) =>
    request.get<AssistantPointLedgerPage>("/admin/campus-assistant/points/ledger", params, options),
  grantAssistantPoints: (payload: { userIds?: number[]; allUsers?: boolean; points: number; reason: string }) =>
    request.post<{
      points: number;
      recipientCount: number;
    }>("/admin/campus-assistant/points/grant", payload),
  backfillSponsorAssistantPoints: () =>
    request.post<{
      orderCount: number;
      userCount: number;
      totalPoints: number;
    }>("/admin/campus-assistant/points/backfill-sponsors", {}),
  aiReviewLogs: (params: { kind?: string; status?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: AiReviewLogRow[] }>("/admin/ai-review/logs", params, options),
  aiUsageLogs: (params: { kind?: string; status?: string; q?: string; from?: string; to?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<AiUsageLogPage>("/admin/ai-usage/logs", params, options),
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
  sponsorOrders: (params: { q?: string; status?: string; categoryId?: string; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/sponsor-orders", params),
  updateSponsorOrder: (id: number, payload: { status?: "pending" | "paid" | "closed"; categoryId?: string; message?: string; displayMode?: "public" | "anonymous" | "hidden" }) =>
    request.patch<any>(`/admin/sponsor-orders/${id}`, payload),
  sponsorLogs: (params: { q?: string; signOk?: "0" | "1"; page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/sponsor-logs", params),
  // QQBot / NapCat
  qqBotConfig: (options?: RequestOptions) => request.get<QqBotConfig>("/admin/qqbot/config", undefined, options),
  updateQqBotConfig: (payload: Partial<{
    enabled: boolean;
    botQqId: string;
    connectionMode: "outbound" | "inbound";
    napcatBaseUrl: string;
    accessToken: string;
    clearAccessToken: boolean;
    webhookSecret: string;
    defaultBoardSlug: string;
    allowPrivatePost: boolean;
    allowGroupPost: boolean;
    notificationEnabled: boolean;
    qrCodeSendingEnabled: boolean;
    notifyCategories: string[];
    superAdminQqIds: string[];
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
    memberWelcomeEnabled?: boolean;
    memberWelcomeMessage?: string;
    adFilterEnabled?: boolean;
    assistantProactiveReplyEnabled?: boolean;
    assistantReplyQrCodeEnabled?: boolean;
    adFilterGroupNoticeEnabled?: boolean;
    adFilterBlockQrCodeEnabled?: boolean;
    adFilterBlockGroupCardEnabled?: boolean;
    adFilterWhitelistBlockQrCodeEnabled?: boolean;
    adFilterWhitelistBlockGroupCardEnabled?: boolean;
    adFilterReportThreshold?: number;
    joinReviewEnabled?: boolean;
    allowMute?: boolean;
    allowKick?: boolean;
    allowKickAndBlock?: boolean;
    commandUserQqIds?: string[];
  }) => request.post<QqBotGroup>("/admin/qqbot/groups", payload),
  deleteQqBotGroup: (id: number) => request.delete<{ ok: true }>(`/admin/qqbot/groups/${id}`),
  qqBotLogs: (params: { status?: string; eventType?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/qqbot/logs", params, options),
  sendQqBotTestMessage: (payload: { qqId?: string; groupId?: string; message: string }) =>
    request.post<{ ok: true }>("/admin/qqbot/test-message", payload),
  dispatchQqBotNotifications: () => request.post<{ sent: number }>("/admin/qqbot/dispatch-notifications"),
  createQqBotBindToken: () => request.post<{ token: string; expiresAt: string }>("/qqbot/bind-token"),
  wechatConfig: (options?: RequestOptions) => request.get<WechatServiceConfig>("/admin/wechat/config", undefined, options),
  updateWechatConfig: (payload: Partial<{
    enabled: boolean;
    accountName: string;
    appId: string;
    appSecret: string;
    clearAppSecret: boolean;
    token: string;
    encodingAesKey: string;
    messageMode: "plaintext" | "compatible" | "safe";
    notificationEnabled: boolean;
    assistantEnabled: boolean;
    notifyCategories: string[];
    notificationTemplateId: string;
    templateTitleField: string;
    templateContentField: string;
    templateTimeField: string;
    templateRemarkField: string;
  }>) => request.patch<WechatServiceConfig>("/admin/wechat/config", payload),
  generateWechatCredentials: (target: "token" | "encodingAesKey" | "both") =>
    request.post<WechatServiceConfig>("/admin/wechat/credentials", { target }),
  wechatBindings: (params?: { q?: string }, options?: RequestOptions) => request.get<any[]>("/admin/wechat/bindings", params, options),
  updateWechatBinding: (id: number, payload: { enabled: boolean }) => request.patch<any>(`/admin/wechat/bindings/${id}`, payload),
  deleteWechatBinding: (id: number) => request.delete<{ ok: true }>(`/admin/wechat/bindings/${id}`),
  sendWechatTestMessage: (id: number, message: string) => request.post<{ ok: true }>(`/admin/wechat/bindings/${id}/test-message`, { message }),
  dispatchWechatNotifications: () => request.post<{ sent: number; skipped: number }>("/admin/wechat/dispatch-notifications"),
  publishWechatMenu: () => request.post<{ ok: true; menu: { button: Array<{ name: string; sub_button: Array<{ type: "view"; name: string; url: string }> }> } }>("/admin/wechat/menu/publish"),
  wechatLogs: (params: { status?: string; eventType?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/wechat/logs", params, options),
  // 帖子
  topics: (
    params: { q?: string; board?: string; hidden?: "0" | "1"; reviewStatus?: string; page?: number; size?: number },
    options?: RequestOptions,
  ) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/admin/topics", params, options),
  manualReviews: (options?: RequestOptions) =>
    request.get<{ total: number; topicCount: number; replyCount: number; topics: any[]; replies: any[] }>("/admin/manual-reviews", undefined, options),
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
  retryAiReview: (kind: ReviewTargetKind, id: number) =>
    request.post<{ kind: ReviewTargetKind; id: number; topicId?: number; aiReviewStatus: "checking" }>(`/admin/review-targets/${kind}/${id}/retry-ai`, {}),
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
  // 公告
  announcements: (options?: RequestOptions) => request.get<any[]>("/admin/announcements", undefined, options),
  createAnnouncement: (p: { title: string; content: string; level?: string; link?: string; source?: string; targetClient?: "all" | "ios" | "android" | "harmony" | "web" | Array<"ios" | "android" | "harmony" | "web"> }) =>
    request.post<any>("/admin/announcements", p),
  updateAnnouncement: (id: number, p: { title?: string; content?: string; level?: string; link?: string | null; source?: string | null; targetClient?: "all" | "ios" | "android" | "harmony" | "web" | Array<"ios" | "android" | "harmony" | "web"> }) =>
    request.patch<any>(`/admin/announcements/${id}`, p),
  deleteAnnouncement: (id: number) => request.delete<any>(`/admin/announcements/${id}`),
  // 论坛广告
  forumAds: (options?: RequestOptions) => request.get<ForumAdAdmin[]>("/admin/forum-ads", undefined, options),
  uploadForumAdImage: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request.post<{ url: string; size: number; transcoded: boolean }>("/admin/forum-ads/image", data);
  },
  createForumAd: (payload: Partial<Omit<ForumAdAdmin, "id" | "createdAt" | "updatedAt" | "metrics">> & Pick<ForumAdAdmin, "title" | "linkUrl" | "placement">) =>
    request.post<ForumAdAdmin>("/admin/forum-ads", payload),
  updateForumAd: (id: number, payload: Partial<Omit<ForumAdAdmin, "id" | "createdAt" | "updatedAt" | "metrics">>) =>
    request.patch<ForumAdAdmin>(`/admin/forum-ads/${id}`, payload),
  deleteForumAd: (id: number) => request.delete<{ ok: true }>(`/admin/forum-ads/${id}`),
  // VIP 礼品码
  vipGiftCodes: (options?: RequestOptions) => request.get<VipGiftCodeAdmin[]>("/admin/vip-gift-codes", undefined, options),
  createVipGiftCodes: (payload: {
    quantity?: number;
    maxUses?: number;
    note?: string | null;
  }) => request.post<{ items: VipGiftCodeAdmin[]; codes: string[]; redemptionPaths: string[] }>("/admin/vip-gift-codes", payload),
  updateVipGiftCode: (id: number, payload: Partial<Pick<VipGiftCodeAdmin, "enabled" | "maxUses" | "note">>) =>
    request.patch<VipGiftCodeAdmin>(`/admin/vip-gift-codes/${id}`, payload),
};
