import { request } from "./request";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";

export type ScheduleShare = {
  code: string;
  owner: string;
  semester: string;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
  schedule: ScheduleResult;
  calendar: CalendarResult;
  writeToken?: string;
};

export const scheduleShareApi = {
  create: (payload: { semester: string; schedule: ScheduleResult; calendar: CalendarResult }) =>
    request.post<ScheduleShare>("/schedule-shares", payload),
  get: (code: string) => request.get<ScheduleShare>(`/schedule-shares/${encodeURIComponent(code)}`, undefined, { cacheTtlMs: 0 }),
  revoke: (code: string, writeToken: string) => request.delete<{ ok: true }>(`/schedule-shares/${encodeURIComponent(code)}`, { headers: { "X-Write-Token": writeToken } }),
};
