import { request } from "./request";

export type RadioSemesterStatus = "draft" | "active" | "archived";
export type RadioScheduleStatus = "draft" | "published" | "archived";
export type RadioSongRequestStatus = "pending" | "approved" | "fulfilled" | "rejected";
export type RadioMusicProvider = "netease" | "qq";
export type RadioMusicSearchMode = "all" | RadioMusicProvider;

export interface RadioMusicSelection {
  provider: RadioMusicProvider;
  trackId: string;
  mediaMid?: string | null;
  album?: string | null;
  cover?: string | null;
  duration?: number | null;
}

export interface RadioMusicSearchResult extends RadioMusicSelection {
  name: string;
  artist: string;
  fee: number;
  playable: boolean;
}

export interface RadioMusicSearchResponse {
  query: string;
  providerMode: RadioMusicSearchMode;
  sharedLogin: {
    netease: boolean;
    qq: boolean;
  };
  results: RadioMusicSearchResult[];
}

export interface RadioMusicResolveResponse {
  provider: RadioMusicProvider;
  playable: boolean;
  trial: boolean;
  level?: string | null;
  quality?: string | null;
  requestedQuality: string;
  reason: string;
  message: string;
  restriction?: {
    provider: RadioMusicProvider;
    category: string;
    message: string;
    action: "login" | "upgrade" | "purchase" | "switch_source";
  } | null;
  streamToken?: string | null;
  streamUrl?: string | null;
}

export type RadioMusicAuthSource = "database" | "env" | "none";

export interface RadioMusicProviderAuthStatus {
  provider: RadioMusicProvider;
  source: RadioMusicAuthSource;
  hasCookie: boolean;
  loggedIn: boolean;
  playbackKeyReady: boolean;
  userId?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  updatedAt?: string | null;
}

export interface RadioMusicAuthStatus {
  qq: RadioMusicProviderAuthStatus;
}

export interface RadioMusicSyncSession {
  token: string;
  expiresAt: string;
  returnPath: string;
}

export interface RadioSimpleUser {
  id: number;
  username: string;
  nickname: string;
  role: string;
}

export interface RadioSemester {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  status: RadioSemesterStatus;
  isCurrent: boolean;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: RadioSimpleUser | null;
  counts?: {
    playTimes: number;
    scheduleItems: number;
  };
}

export interface RadioPlayTime {
  id: number;
  semesterId?: number | null;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  location?: string | null;
  note?: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  semester?: Pick<RadioSemester, "id" | "code" | "name" | "status" | "isCurrent"> | null;
  createdBy?: RadioSimpleUser | null;
  counts?: {
    scheduleItems: number;
  };
}

export interface RadioScheduleItem {
  id: number;
  semesterId?: number | null;
  playTimeId?: number | null;
  title: string;
  subtitle?: string | null;
  hostNames?: string | null;
  summary?: string | null;
  coverImage?: string | null;
  tags: string[];
  requestEnabled: boolean;
  status: RadioScheduleStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  semester?: Pick<RadioSemester, "id" | "code" | "name" | "status" | "isCurrent"> | null;
  playTime?: Pick<RadioPlayTime, "id" | "name" | "weekday" | "startTime" | "endTime" | "location" | "enabled" | "sortOrder"> | null;
  createdBy?: RadioSimpleUser | null;
  requestCount: number;
}

export interface RadioSongRequest {
  id: number;
  scheduleItemId?: number | null;
  requesterId?: number | null;
  nickname: string;
  contact?: string | null;
  songTitle: string;
  artist?: string | null;
  sourceProvider?: RadioMusicProvider | null;
  sourceTrackId?: string | null;
  sourceSelection?: RadioMusicSelection | null;
  dedication?: string | null;
  message?: string | null;
  status: RadioSongRequestStatus;
  adminNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleItem?: Pick<RadioScheduleItem, "id" | "title" | "subtitle" | "requestEnabled"> | null;
  requester?: RadioSimpleUser | null;
  reviewedBy?: RadioSimpleUser | null;
}

export interface RadioPublicSongRequest {
  id: number;
  scheduleItemId?: number | null;
  nickname: string;
  songTitle: string;
  artist?: string | null;
  sourceProvider?: RadioMusicProvider | null;
  sourceTrackId?: string | null;
  sourceSelection?: RadioMusicSelection | null;
  status: RadioSongRequestStatus;
  createdAt: string;
  updatedAt: string;
  scheduleItem?: Pick<RadioScheduleItem, "id" | "title" | "subtitle" | "requestEnabled"> | null;
}

export interface RadioOverview {
  currentSemester: RadioSemester | null;
  playTimes: RadioPlayTime[];
  scheduleItems: RadioScheduleItem[];
  recentRequests: RadioPublicSongRequest[];
  requestSummary: {
    total: number;
    pending: number;
    fulfilled: number;
  };
}

export interface RadioManageBootstrap {
  semesters: RadioSemester[];
  playTimes: RadioPlayTime[];
  scheduleItems: RadioScheduleItem[];
  requests: RadioSongRequest[];
}

export interface RadioSemesterPayload {
  code: string;
  name: string;
  description?: string;
  status?: RadioSemesterStatus;
  isCurrent?: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface RadioPlayTimePayload {
  semesterId?: number | null;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  location?: string;
  note?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface RadioSchedulePayload {
  semesterId?: number | null;
  playTimeId?: number | null;
  title: string;
  subtitle?: string;
  hostNames?: string;
  summary?: string;
  coverImage?: string;
  tags?: string[];
  requestEnabled?: boolean;
  status?: RadioScheduleStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export interface RadioSongRequestPayload {
  scheduleItemId?: number | null;
  nickname?: string;
  contact?: string;
  songTitle: string;
  artist?: string;
  sourceSelection?: RadioMusicSelection;
  dedication?: string;
  message?: string;
}

export interface RadioSongRequestPatchPayload {
  scheduleItemId?: number | null;
  status?: RadioSongRequestStatus;
  adminNote?: string | null;
}

export const radioApi = {
  overview: () => request.get<RadioOverview>("/radio/overview"),
  searchMusic: (params: { q: string; provider?: RadioMusicSearchMode; limit?: number }) => request.get<RadioMusicSearchResponse>("/radio/music/search", params),
  resolveMusic: (params: { provider: RadioMusicProvider; trackId: string; mediaMid?: string | null; quality?: string }) => request.get<RadioMusicResolveResponse>("/radio/music/resolve", params),
  submitRequest: (payload: RadioSongRequestPayload) => request.post<RadioSongRequest>("/radio/requests", payload),
  manageBootstrap: () => request.get<RadioManageBootstrap>("/radio/manage/bootstrap"),
  musicAuthStatus: () => request.get<RadioMusicAuthStatus>("/radio/manage/music-auth"),
  createQqMusicSyncSession: (payload: { returnPath?: string }) => request.post<RadioMusicSyncSession>("/radio/manage/music-auth/qq-sync-session", payload),
  saveQqMusicCookie: (payload: { cookie: string }) => request.post<RadioMusicAuthStatus>("/radio/manage/music-auth/qq-cookie", payload),
  clearQqMusicCookie: () => request.delete<RadioMusicAuthStatus>("/radio/manage/music-auth/qq-cookie"),
  createSemester: (payload: RadioSemesterPayload) => request.post<RadioSemester>("/radio/manage/semesters", payload),
  updateSemester: (id: number, payload: Partial<RadioSemesterPayload>) => request.patch<RadioSemester>(`/radio/manage/semesters/${id}`, payload),
  createPlayTime: (payload: RadioPlayTimePayload) => request.post<RadioPlayTime>("/radio/manage/play-times", payload),
  updatePlayTime: (id: number, payload: Partial<RadioPlayTimePayload>) => request.patch<RadioPlayTime>(`/radio/manage/play-times/${id}`, payload),
  createSchedule: (payload: RadioSchedulePayload) => request.post<RadioScheduleItem>("/radio/manage/schedules", payload),
  updateSchedule: (id: number, payload: Partial<RadioSchedulePayload>) => request.patch<RadioScheduleItem>(`/radio/manage/schedules/${id}`, payload),
  updateRequest: (id: number, payload: RadioSongRequestPatchPayload) => request.patch<RadioSongRequest>(`/radio/manage/requests/${id}`, payload),
};
