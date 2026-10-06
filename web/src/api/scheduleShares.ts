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
  /** 只在发布的回应里有：这次是否新建了分享码，以及课表内容是否有变化。 */
  created?: boolean;
  changed?: boolean;
  writeToken?: string;
};

export type ScheduleShareMeta = Omit<ScheduleShare, "schedule" | "calendar" | "created" | "changed" | "writeToken">;

export const scheduleShareApi = {
  create: (payload: { semester: string; schedule: ScheduleResult; calendar: CalendarResult }) =>
    request.post<ScheduleShare>("/schedule-shares", payload),
  get: (code: string) => request.get<ScheduleShare>(`/schedule-shares/${encodeURIComponent(code)}`, undefined, { cacheTtlMs: 0 }),
  /** 当前账号发布过的分享码。每个学期只有一个，再次发布会更新它。 */
  mine: () => request.get<{ shares: ScheduleShareMeta[] }>("/schedule-shares/mine", undefined, { cacheTtlMs: 0 }),
  meta: (code: string) => request.get<ScheduleShareMeta>(`/schedule-shares/${encodeURIComponent(code)}/meta`, undefined, { cacheTtlMs: 0 }),
  /** 发布者本人登录后即可撤销；`writeToken` 只是兼容早期保存过它的调用方。 */
  revoke: (code: string, writeToken?: string) => request.delete<{ ok: true }>(
    `/schedule-shares/${encodeURIComponent(code)}`,
    writeToken ? { headers: { "X-Write-Token": writeToken } } : undefined,
  ),
};
