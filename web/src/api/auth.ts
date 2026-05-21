import { request } from "./request";

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
  studentSso?: boolean;
  dataAuthAgreedAt?: string | null;
  forumEnabled?: boolean;
  forumEnabledAt?: string | null;
  status?: string;
  mutedUntil?: string | null;
  postCount: number;
  replyCount: number;
  reputation: number;
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

export interface SsoBeginResult {
  pendingId: string;
  needCaptcha: boolean;
  captchaImage?: string;
}

export interface SsoLoginResult {
  ok: boolean;
  siteToken?: string;
  jwxtToken?: string;
  user?: UserInfo;
  needNickname?: boolean;
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
}

export const authApi = {
  login: (payload: LoginPayload) => request.post<{ token: string; user: UserInfo }>("/auth/login", payload),
  register: (payload: RegisterPayload) => request.post<{ token: string; user: UserInfo }>("/auth/register", payload),
  ssoBegin: () => request.post<SsoBeginResult>("/auth/sso-begin"),
  ssoLogin: (p: { pendingId: string; username: string; password: string; captcha?: string }) =>
    request.post<SsoLoginResult>("/auth/sso-login", p),
  logout: () => request.post<{ ok: true }>("/auth/logout"),
  me: () => request.get<UserInfo>("/user/me"),
  updateMe: (payload: Partial<UserInfo>) => request.patch<UserInfo>("/user/me", payload),
  enableForumAccess: (confirmText: string) => request.post<UserInfo>("/user/forum-access/enable", { confirmText }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request.patch<{ ok: true }>("/user/password", { oldPassword, newPassword }),
};
