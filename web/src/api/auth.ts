import { request, type RequestOptions } from "./request";
import type { AgentEncryptedLoginCredentials } from "@/utils/agentCredentialCrypto";

export interface LoginPayload { username: string; password: string }
export interface RegisterPayload { username: string; password: string; nickname: string; college?: string; enrollYear?: number }
export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
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
  logout: (options?: RequestOptions) => request.post<{ ok: true }>("/auth/logout", undefined, {
    suppressAuthRedirect: true,
    suppressAuthMessage: true,
    suppressErrorMessage: true,
    ...options,
  }),
  me: (options?: RequestOptions) => request.get<UserInfo>("/user/me", undefined, options),
  updateMe: (payload: Partial<UserInfo>) => request.patch<UserInfo>("/user/me", payload),
  changePassword: (oldPassword: string, newPassword: string) =>
    request.patch<{ ok: true }>("/user/password", { oldPassword, newPassword }),
  qqBotProfile: (options?: RequestOptions) => request.get<QqBotProfile>("/qqbot/me", undefined, options),
  createQqBotBindToken: (options?: RequestOptions) => request.post<{ token: string; expiresAt: string }>("/qqbot/bind-token", undefined, options),
  deleteQqBotBinding: (options?: RequestOptions) => request.delete<{ ok: true }>("/qqbot/binding", options),
};
