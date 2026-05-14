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
  postCount: number;
  replyCount: number;
  reputation: number;
  lastSeenAt?: string;
  createdAt: string;
}

export const authApi = {
  login: (payload: LoginPayload) => request.post<{ token: string; user: UserInfo }>("/auth/login", payload),
  register: (payload: RegisterPayload) => request.post<{ token: string; user: UserInfo }>("/auth/register", payload),
  logout: () => request.post<{ ok: true }>("/auth/logout"),
  me: () => request.get<UserInfo>("/user/me"),
  updateMe: (payload: Partial<UserInfo>) => request.patch<UserInfo>("/user/me", payload),
};
