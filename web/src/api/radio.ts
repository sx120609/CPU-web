import { request } from "./request";

export type RadioSemesterStatus = "draft" | "active" | "archived";
export type RadioScheduleStatus = "draft" | "published" | "archived";
export type RadioSongRequestStatus = "pending" | "approved" | "fulfilled" | "rejected";

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

export interface RadioOverview {
  currentSemester: RadioSemester | null;
  playTimes: RadioPlayTime[];
  scheduleItems: RadioScheduleItem[];
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
  submitRequest: (payload: RadioSongRequestPayload) => request.post<RadioSongRequest>("/radio/requests", payload),
  manageBootstrap: () => request.get<RadioManageBootstrap>("/radio/manage/bootstrap"),
  createSemester: (payload: RadioSemesterPayload) => request.post<RadioSemester>("/radio/manage/semesters", payload),
  updateSemester: (id: number, payload: Partial<RadioSemesterPayload>) => request.patch<RadioSemester>(`/radio/manage/semesters/${id}`, payload),
  createPlayTime: (payload: RadioPlayTimePayload) => request.post<RadioPlayTime>("/radio/manage/play-times", payload),
  updatePlayTime: (id: number, payload: Partial<RadioPlayTimePayload>) => request.patch<RadioPlayTime>(`/radio/manage/play-times/${id}`, payload),
  createSchedule: (payload: RadioSchedulePayload) => request.post<RadioScheduleItem>("/radio/manage/schedules", payload),
  updateSchedule: (id: number, payload: Partial<RadioSchedulePayload>) => request.patch<RadioScheduleItem>(`/radio/manage/schedules/${id}`, payload),
  updateRequest: (id: number, payload: RadioSongRequestPatchPayload) => request.patch<RadioSongRequest>(`/radio/manage/requests/${id}`, payload),
};
