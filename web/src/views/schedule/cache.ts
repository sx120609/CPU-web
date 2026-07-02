import { jwxtScopedStorageKey } from "@/utils/jwxtCache";
import type { CacheEnvelope, LastState } from "./types";

export const SCHEDULE_CACHE_TTL = 12 * 60 * 60 * 1000;
export const DEFAULT_LAST_STATE_CACHE_BASE = "cpu-schedule-last-state-v1";
export const JWXT_PANE_LAST_STATE_CACHE_BASE = "cpu-jwxt-schedule-view-state-v1";

const SCHEDULE_CACHE_BASE = "cpu-schedule-cache-v3";
const CALENDAR_CACHE_BASE = "cpu-schedule-calendar-v1";
const LAST_CACHE_BASE = "cpu-schedule-last-cache-key-v1";

export function buildScheduleCacheKey(input: {
  scope: string;
  semester?: string | null;
  week?: string | number | null;
  currentSemester?: string | null;
  currentWeek?: string | number | null;
  calendarWeek?: string | number | null;
  graduate?: boolean;
}) {
  const semester = input.semester || input.currentSemester || "current";
  const week = input.graduate
    ? "all"
    : (input.week || input.calendarWeek || input.currentWeek || "current");
  return jwxtScopedStorageKey(SCHEDULE_CACHE_BASE, input.scope, semester, week);
}

export function scheduleCalendarCacheKey(scope: string) {
  return jwxtScopedStorageKey(CALENDAR_CACHE_BASE, scope);
}

export function scheduleLastStateCacheKey(scope: string, base = DEFAULT_LAST_STATE_CACHE_BASE) {
  return jwxtScopedStorageKey(base, scope);
}

export function scheduleLastCacheKey(scope: string) {
  return jwxtScopedStorageKey(LAST_CACHE_BASE, scope);
}

export function readCache<T>(key: string): CacheEnvelope<T> | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsedValue = JSON.parse(raw);
    if (!parsedValue || typeof parsedValue.savedAt !== "number") return null;
    return parsedValue as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): CacheEnvelope<T> | null {
  if (!key) return null;
  const envelope = { savedAt: Date.now(), data };
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    /* ignore */
  }
  return envelope;
}

export function isStale(savedAt: number, ttl = SCHEDULE_CACHE_TTL) {
  return !savedAt || Date.now() - savedAt > ttl;
}

export function readStoredLastState(key: string): LastState | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as LastState : null;
  } catch {
    return null;
  }
}

export function writeStoredLastState(key: string, state: LastState) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function readStoredLastScheduleCacheKey(key: string) {
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function writeStoredLastScheduleCacheKey(key: string, value: string) {
  if (!key || !value) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
