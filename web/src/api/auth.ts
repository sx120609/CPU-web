import { request, type RequestOptions } from "./request";
import type { AgentEncryptedLoginCredentials } from "@/utils/agentCredentialCrypto";
import type { AccountVerification } from "@/api/accountVerification";

export interface LoginPayload { username: string; password: string }
export interface RegisterPayload { username: string; password: string; nickname: string; college?: string; enrollYear?: number }
export interface UserInfo {
  profileReview?: { status: string; reason: string | null; pending: Record<string, unknown> | null };
  id: number;
  /** 所属学校；旧版服务端不返回。 */
  schoolId?: string;
  /** 平台管理员（默认学校的站点管理员），管所有学校和全站设置；旧版服务端不返回。 */
  platformAdmin?: boolean;
  username: string;
  nickname: string;
  nicknameReview?: {
    status: "none" | "checking" | "approved" | "rejected" | "review_failed" | string;
    pendingNickname?: string | null;
    reason?: string | null;
    requestedAt?: string | null;
    reviewedAt?: string | null;
  };
  avatar?: string | null;
  bio?: string | null;
  college?: string | null;
  enrollYear?: number | null;
  role: string;
  voiceHubRole?: "admin" | "super_admin" | null;
  lostFoundRole?: "admin" | "super_admin" | null;
  studentSso?: boolean;
  dataAuthAgreedAt?: string | null;
  forumEnabled?: boolean;
  forumEnabledAt?: string | null;
  status?: string;
  mutedUntil?: string | null;
  postCount: number;
  replyCount: number;
  reputation: number;
  sponsorTotalCents?: number;
  sponsorAmount?: number;
  vipActive?: boolean;
  profileTheme?: string | null;
  profileFrame?: string | null;
  verification?: AccountVerification | null;
  reputationLevel?: {
    level: number;
    name: string;
    minReputation: number;
    nextLevel?: { level: number; name: string; minReputation: number; need: number } | null;
  };
  lastSeenAt?: string;
  lastLoginAt?: string | null;
  lastLoginClient?: string | null;
  usedIosClient?: boolean;
  usedIosNativeClient?: boolean;
  usedIosPwaClient?: boolean;
  usedAndroidClient?: boolean;
  usedHarmonyClient?: boolean;
  usedDesktopClient?: boolean;
  topicSubmissionLocked?: boolean;
  aiReviewWhitelisted?: boolean;
  anonymousState?: {
    eligible: boolean;
    minReputation: number;
    weeklyQuota: number;
    availableCredits: number;
    storedCredits: number;
    frozen: boolean;
    weekKey: string;
    staleWeek: boolean;
    nextResetAt: string;
    nextTier?: { reputation: number; weeklyQuota: number; need: number } | null;
  };
  reputationBreakdown?: {
    total: number;
    accountAgeDays: number;
    agePoints: number;
    postPoints: number;
    replyPoints: number;
    forumPoints: number;
    caps: {
      agePoints: number;
      postPoints: number;
      replyPoints: number;
    };
  };
  createdAt: string;
}

export interface QqBotProfile {
  enabled: boolean;
  botQqId: string;
  defaultBoardSlug: string;
  allowPrivatePost: boolean;
  allowGroupPost: boolean;
  binding: null | {
    id: number;
    qqId: string;
    nickname: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
  activeBindToken: null | {
    token: string;
    expiresAt: string;
  };
  recentTopics: Array<{
    id: number;
    title: string;
    boardSlug: string;
    boardName: string;
    hidden: boolean;
    createdAt: string;
  }>;
}

export interface WechatProfile {
  enabled: boolean;
  accountName: string;
  wechatId: string;
  notificationEnabled: boolean;
  assistantEnabled: boolean;
  persistentNotificationAvailable: boolean;
  subscriptionAvailable: boolean;
  subscriptionTemplateId: string;
  oauthAvailable: boolean;
  qrBindingAvailable: boolean;
  messageBindingAvailable: boolean;
  binding: null | {
    id: number;
    enabled: boolean;
    subscribed: boolean;
    subscribedAt?: string | null;
    unsubscribedAt?: string | null;
    lastInteractionAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  activeBindToken: null | {
    token: string;
    expiresAt: string;
  };
}

export interface SsoBeginResult {
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
  credentialPublicKey?: string;
}

export interface SsoLoginResult {
  ok: boolean;
  sessionAuthenticated?: boolean;
  jwxtAuthenticated?: boolean;
  siteToken?: string;
  jwxtToken?: string;
  user?: UserInfo;
  needNickname?: boolean;
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
  /** 南医统一认证：这台设备第一次登录，要扫学校给的二维码。 */
  needMfa?: boolean;
  mfa?: { pendingId: string; qrImage: string };
  /** 扫码轮询的状态；done 时本响应就是登录结果。 */
  mfaStatus?: "waiting" | "scanned" | "expired" | "failed";
}

export const authApi = {
  login: (payload: LoginPayload) => request.post<{ token?: string; sessionAuthenticated?: boolean; user: UserInfo }>("/auth/login", payload),
  register: (payload: RegisterPayload) => request.post<{ token?: string; sessionAuthenticated?: boolean; user: UserInfo }>("/auth/register", payload),
  ssoBegin: (options?: RequestOptions) => request.post<SsoBeginResult>("/auth/sso-begin", undefined, options),
  ssoLogin: (
    p:
      | { pendingId: string; username: string; password: string; captcha?: string; remember?: boolean }
      | { pendingId: string; credentials: AgentEncryptedLoginCredentials; remember?: boolean },
    options?: RequestOptions,
  ) => request.post<SsoLoginResult>("/auth/sso-login", p, options),
  ssoMfaPoll: (p: { pendingId: string; remember?: boolean }, options?: RequestOptions) =>
    request.post<SsoLoginResult>("/auth/sso-mfa/poll", p, options),
  ssoMfaRefresh: (pendingId: string) =>
    request.post<{ qrImage: string }>("/auth/sso-mfa/refresh", { pendingId }, { suppressErrorMessage: true }),
  logout: (options?: RequestOptions) => request.post<{ ok: true }>("/auth/logout", undefined, {
    suppressAuthRedirect: true,
    suppressAuthMessage: true,
    suppressErrorMessage: true,
    ...options,
  }),
  me: (options?: RequestOptions) => request.get<UserInfo>("/user/me", undefined, { cacheTtlMs: 0, cacheStaleTtlMs: 0, ...options }),
  updateMe: (payload: Partial<UserInfo>) => request.patch<UserInfo>("/user/me", payload),
  changePassword: (oldPassword: string, newPassword: string) =>
    request.patch<{ ok: true }>("/user/password", { oldPassword, newPassword }),
  qqBotProfile: (options?: RequestOptions) => request.get<QqBotProfile>("/qqbot/me", undefined, options),
  createQqBotBindToken: (options?: RequestOptions) => request.post<{ token: string; expiresAt: string }>("/qqbot/bind-token", undefined, options),
  deleteQqBotBinding: (options?: RequestOptions) => request.delete<{ ok: true }>("/qqbot/binding", options),
  wechatProfile: (options?: RequestOptions) => request.get<WechatProfile>("/wechat/me", undefined, options),
  createWechatOauthUrl: (options?: RequestOptions) => request.post<{ url: string; expiresAt: string }>("/wechat/oauth-url", undefined, options),
  createWechatBindQr: (options?: RequestOptions) => request.post<{ imageUrl: string; expiresAt: string }>("/wechat/bind-qr", undefined, options),
  wechatJsSdkConfig: (url: string, options?: RequestOptions) => request.post<{
    appId: string;
    timestamp: number;
    nonceStr: string;
    signature: string;
  }>("/wechat/js-sdk-config", { url }, options),
  deleteWechatBinding: (options?: RequestOptions) => request.delete<{ ok: true }>("/wechat/binding", options),
};
