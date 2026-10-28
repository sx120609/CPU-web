import { request } from "./request";

export interface ZhsCourse { key: string; id: string; kind: "shared" | "hike"; name: string }
export interface ZhsSnapshot {
  verification: { id: string; courseName: string; videoTitle: string } | null;
  speed: number;
  activity: { message: string; updatedAt: string } | null;
  enabled: boolean;
  state: "offline" | "starting" | "qr" | "loading" | "ready" | "running" | "completed" | "stopped" | "error";
  loggedIn: boolean; message: string; qr: string | null;
  courses: ZhsCourse[]; warnings: string[];
  current: { courseKey: string; title: string; percent: number | null } | null;
  completed: number; total: number; logs: ZhsLog[];
}
export interface ZhsLog { id: string; at: string; message: string; kind: "info" | "skipped" | "uninspected" }
export interface ZhsSettings { historyScope: string; canAdmin: boolean; autoAnswer: boolean; autoSubmit: boolean }
const base = "/course-bot/zhihuishu";
const quiet = { suppressErrorMessage: true };
export const zhihuishuApi = {
  session: () => request.get<ZhsSnapshot>(`${base}/session`, undefined, { ...quiet, cacheTtlMs: 0, cacheStaleTtlMs: 0 }),
  login: () => request.post<ZhsSnapshot>(`${base}/session`, {}, quiet),
  disconnect: () => request.delete<ZhsSnapshot>(`${base}/session`, quiet),
  refresh: () => request.post<ZhsSnapshot>(`${base}/courses/refresh`, {}, quiet),
  start: (keys: string[], speed = 1) => request.post<ZhsSnapshot>(`${base}/tasks`, { keys, speed }, quiet),
  settings: () => request.get<ZhsSettings>(`${base}/settings`, undefined, { ...quiet, cacheTtlMs: 0, cacheStaleTtlMs: 0 }),
  saveSettings: (settings: Pick<ZhsSettings, "autoAnswer" | "autoSubmit">) => request.post<ZhsSettings>(`${base}/settings`, settings, quiet),
};
