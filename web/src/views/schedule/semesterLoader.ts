import type { ScheduleResult } from "./types";

export interface ScheduleResponse {
  parsed: ScheduleResult;
  calendar?: unknown;
  syncedAt?: string;
}

/** Semester rules are fetched once; old agents are filled one week at a time.
 * Foreground navigation and background filling share the same requests. */
export function createSemesterScheduleLoader(
  fetch: (params: { semester?: string; week?: string; refresh?: string }) => Promise<ScheduleResponse>,
  publish: (response: ScheduleResponse, week: string, reset: boolean) => void,
) {
  type Entry = {
    semester: string;
    initial?: Promise<ScheduleResponse>;
    complete?: ScheduleResponse;
    weeks: Map<string, ScheduleResponse>;
    pending: Map<string, Promise<ScheduleResponse>>;
    preferred: string;
    reset: boolean;
    background?: Promise<void>;
  };
  const entries = new Map<string, Entry>();
  let active: Entry | undefined;
  let supportsScope: boolean | undefined;
  const valid = (entry: Entry) => entries.get(entry.semester) === entry;
  const accept = (entry: Entry, response: ScheduleResponse, week: string) => {
    if (!valid(entry)) throw new Error("课表请求已失效");
    const data = response.parsed;
    if (entry.semester && data.currentSemester !== entry.semester) throw new Error("教务系统返回了其他学期的课表");
    if (!entry.semester) {
      entries.delete("");
      entry.semester = data.currentSemester;
      entries.set(entry.semester, entry);
    }
    if (data.scope === "semester") entry.complete = response;
    else entry.weeks.set(week, response);
    publish(response, data.scope === "semester" ? "all" : week, entry.reset);
    entry.reset = false;
    return response;
  };
  const loadWeek = (entry: Entry, week: string): Promise<ScheduleResponse> => {
    const cached = entry.complete ?? entry.weeks.get(week);
    if (cached) return Promise.resolve(cached);
    const pending = entry.pending.get(week);
    if (pending) return pending;
    const request = fetch({ semester: entry.semester, week })
      .then(response => accept(entry, response, week))
      .finally(() => entry.pending.delete(week));
    entry.pending.set(week, request);
    return request;
  };
  const prefetch = (entry: Entry, data: ScheduleResult) => {
    if (entry.complete || entry.background) return;
    const weeks = [...new Set(data.weeks.map(item => Number(item.value))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= 64))].map(String);
    entry.background = (async () => {
      // Allow the visible page to paint before starting compatibility requests.
      await new Promise(resolve => setTimeout(resolve, 300));
      while (valid(entry) && active === entry && !entry.complete) {
        const next = weeks.filter(week => !entry.weeks.has(week)).sort((a, b) =>
          Math.abs(Number(a) - Number(entry.preferred)) - Math.abs(Number(b) - Number(entry.preferred))
          || Number(b) - Number(a))[0];
        if (!next) return;
        await loadWeek(entry, next);
      }
    })().catch(() => { /* Retain successful weeks; retry missing ones on the next visit. */ })
      .finally(() => { entry.background = undefined; });
  };
  return {
    clear() { entries.clear(); active = undefined; },
    select(semester: string, week: string) {
      active = entries.get(semester);
      if (!active) return;
      active.preferred = week;
      const data = active.complete ?? active.weeks.values().next().value;
      if (data) prefetch(active, data.parsed);
    },
    async load(semester = "", week = "", force = false) {
      let entry = entries.get(semester);
      if (!entry || force) {
        entry = { semester, weeks: new Map(), pending: new Map(), preferred: week, reset: force };
        entries.set(semester, entry);
      }
      active = entry;
      entry.preferred = week;
      if (!entry.complete && !entry.weeks.size && !entry.initial) {
        const target = entry;
        target.initial = (async () => {
          const request = (requested?: string) => fetch({ semester: semester || undefined,
            week: requested, refresh: force ? "1" : undefined });
          let response: ScheduleResponse;
          if (supportsScope === false) response = await request(week || undefined);
          else {
            try { response = await request("all"); }
            catch (error) {
              const failure = error as { status?: number; code?: number; message?: string };
              if (!valid(target) || failure.status === 401 || failure.code === 4001
                || /请先登录教务|教务会话已失效|重新登录|重新授权/.test(failure.message || "")) throw error;
              response = await request(week || undefined);
              supportsScope = false;
            }
            if (supportsScope !== false) {
              supportsScope = response.parsed.scope !== undefined;
              if (!supportsScope) response = await request(week || undefined);
            }
          }
          return accept(target, response, response.parsed.currentWeek || week);
        })().finally(() => { target.initial = undefined; });
      }
      const initial = entry.initial ? await entry.initial : entry.complete ?? entry.weeks.values().next().value!;
      if (!valid(entry)) throw new Error("课表请求已失效");
      const selected = week || initial.parsed.currentWeek;
      const response = await loadWeek(entry, selected);
      prefetch(entry, initial.parsed);
      return response;
    },
  };
}
