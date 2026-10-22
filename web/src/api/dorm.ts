import { request } from "./request";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";
import type { DormColor } from "@/views/schedule/dorm";

export type DormMemberSnapshotMeta = { semester: string; syncedAt: string; changedAt: string };

export type { DormColor };

export type DormMember = {
  id: number;
  color: DormColor;
  nickname: string;
  avatar: string | null;
  isOwner: boolean;
  snapshot: DormMemberSnapshotMeta | null;
};

export type DormInvite = { code: string | null; expiresAt: string | null; expired: boolean };

export type DormStatus =
  | { status: "none" }
  | {
    status: "active";
    id: number;
    name: string | null;
    memberLimit: number;
    isOwner: boolean;
    since: string;
    invite: DormInvite | null;
    me: DormMember;
    members: DormMember[];
  };

export type DormSchedules = {
  members: { id: number; color: DormColor; nickname: string; snapshot: {
    semester: string;
    syncedAt: string;
    changedAt: string;
    schedule: ScheduleResult;
    calendar: CalendarResult;
  } | null }[];
};

const noCache = { cacheTtlMs: 0 };
// 课表页后台同步不应弹出错误或把人带去登录页。
const backgroundOptions = { suppressErrorMessage: true, suppressAuthRedirect: true, suppressAuthMessage: true };

export const dormApi = {
  status: (background = false) => request.get<DormStatus>("/dorm", undefined, background ? { ...noCache, ...backgroundOptions } : noCache),
  invite: () => request.post<DormStatus>("/dorm/invite"),
  cancelInvite: () => request.delete<DormStatus>("/dorm/invite"),
  join: (code: string) => request.post<DormStatus>("/dorm/join", { code }),
  leave: () => request.delete<DormStatus>("/dorm"),
  removeMember: (userId: number) => request.delete<DormStatus>(`/dorm/members/${userId}`),
  setName: (name: string | null) => request.patch<DormStatus>("/dorm", { name }),
  setMyColor: (myColor: DormColor) => request.patch<DormStatus>("/dorm", { myColor }),
  schedules: () => request.get<DormSchedules>("/dorm/schedules", undefined, noCache),
  syncSchedule: (payload: { semester: string; schedule: ScheduleResult; calendar: CalendarResult }) =>
    request.put<{ changed: boolean; semester: string; syncedAt: string; changedAt: string }>("/dorm/schedule", payload, backgroundOptions),
};
