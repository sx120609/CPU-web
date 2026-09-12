import { watch } from "vue";
import { jwxtApi } from "@/api/jwxt";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import type { Router } from "vue-router";
import { isNativeScheduleShell } from "./clientInfo";
import { applyScheduleEditsToCells, normalizeScheduleEditsState } from "./scheduleEdits";
import { normalizedCourseWeekList } from "./scheduleWeeks";
import { buildGraduateFallbackCalendar, extendScheduleWeeksToCalendar, hydrateCalendar } from "@/views/schedule/calendar";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";
import { normalizeSlotRange, smallSlots } from "@/views/schedule/slots";

type ScheduleEdits = ReturnType<typeof normalizeScheduleEditsState>;
type SemesterEntry = {
  semester: string;
  createdAt: number;
  calendar: CalendarResult | null;
  edits: ScheduleEdits;
  weeks: string[];
  preferredWeek: string;
  schedules: Map<string, ScheduleResult>;
  pending: Map<string, Promise<ScheduleResult>>;
  complete?: ScheduleResult;
  background?: Promise<void>;
};
const CACHE_LIFETIME = 12 * 60 * 60 * 1000;

/** A stable, non-reversible account fingerprint. The native shell keeps the last
 * timetable on disk under this key and drops it as soon as the key changes, so a
 * relaunch can show that timetable immediately without ever crossing accounts. */
export function nativeScheduleAccountKey() {
  const auth = useAuthStore();
  const id = auth?.user?.id;
  if (!id || !auth.isLoggedIn) return "";
  let hash = 0x811c9dc5;
  for (const character of `${id}:${auth.academicIdentity}`) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** HTML parsing and authentication stay on the server. The client caches and
 * merges parsed courses, applies saved edits and supplies native week filtering. */
export function installIosNextScheduleBridge(router?: Router, options: { fastRefresh?: boolean } = {}) {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  let generation = 0;
  let activeSemester = "";
  let selectionRevision = 0;
  let supportsScope: boolean | undefined;
  const semesters = new Map<string, SemesterEntry>();
  const foreground = new Map<string, Promise<unknown>>();
  const accountKey = nativeScheduleAccountKey;
  const unauthorized = () => ({ version: 1, auth: { authenticated: false, account: accountKey() } });

  watch(() => [auth.user?.id, auth.academicIdentity, jwxt.isLoggedIn], () => {
    generation += 1;
    selectionRevision += 1;
    semesters.clear();
    foreground.clear();
    activeSemester = "";
    host.CPUTimeNative?.authChanged?.(accountKey());
  }, { flush: "sync" });

  const valid = (entry: SemesterEntry, epoch: number) => generation === epoch
    && jwxt.isLoggedIn && semesters.get(entry.semester) === entry;
  const remember = (entry: SemesterEntry) => {
    semesters.delete(entry.semester);
    semesters.set(entry.semester, entry);
    // Bound retained client data, including semester switches.
    while (semesters.size > 4) semesters.delete(semesters.keys().next().value!);
  };
  const parsed = (response: { parsed?: unknown }): ScheduleResult => {
    const value = response.parsed as ScheduleResult | null;
    if (!value || !Array.isArray(value.cells)) throw new Error("教务系统未返回有效课表，请稍后重试。");
    return value;
  };
  const edited = (entry: SemesterEntry, data: ScheduleResult) => ({
    ...data, cells: nativeCells(entry.semester, applyScheduleEditsToCells(data.cells, entry.edits)),
  });
  const nativeCells = (semester: string, cells: ScheduleResult["cells"]) => cells.map(cell => ({
    ...cell,
    courses: cell.courses.map(course => {
      const range = normalizeSlotRange(cell.bigSlot, course);
      const fallback = ["official", semester, cell.day, range.start, course.name.trim().replace(/\s+/g, " ")].join("|");
      return {
        ...course,
        nativeId: course.customId ? `custom:${course.customId}` : course.sourceKey ? `source:${course.sourceKey}` : fallback,
        weekList: normalizedCourseWeekList(course),
      };
    }),
  }));
  const periods = smallSlots.map(slot => ({ number: slot.no, startTime: slot.start, endTime: slot.end }));
  const snapshot = (entry: SemesterEntry, data: ScheduleResult, week?: string) => ({
    version: 1, source: "jwxt", completeSemester: Boolean(entry.complete), fetchedAt: entry.createdAt,
    periods,
    data: { ...edited(entry, entry.complete ?? data), currentWeek: week || (entry.calendar?.currentWeek
      ? String(entry.calendar.currentWeek) : data.currentWeek) },
    calendar: entry.calendar, auth: { authenticated: true, identity: "undergraduate", account: accountKey() },
  });
  const loadWeek = (entry: SemesterEntry, week: string, epoch: number): Promise<ScheduleResult> => {
    const cached = entry.schedules.get(week);
    if (cached) return Promise.resolve(cached);
    const pending = entry.pending.get(week);
    if (pending) return pending;
    const request = jwxt.withSessionRetry(() => jwxtApi.schedule({ semester: entry.semester, week }, { silent: true }))
      .then((response: { parsed?: unknown }) => {
        const data = parsed(response);
        if (!valid(entry, epoch)) throw new Error("课表会话已变化");
        if (data.currentSemester && data.currentSemester !== entry.semester) throw new Error("教务系统返回了其他学期的课表");
        entry.schedules.set(week, data);
        host.CPUTimeNative?.scheduleWeekPrefetched?.(snapshot(entry, data, week));
        return data;
      }).finally(() => entry.pending.delete(week));
    entry.pending.set(week, request);
    return request;
  };
  const prefetch = (entry: SemesterEntry, epoch: number) => {
    if (entry.background || entry.complete || !entry.weeks.length) return;
    entry.background = (async () => {
      // Return the visible week first. Only one background request at a time;
      // explicit week selections can run alongside it and share pending work.
      await new Promise(resolve => setTimeout(resolve, 300));
      while (true) {
        if (!valid(entry, epoch) || activeSemester !== entry.semester) return;
        const current = Number(entry.preferredWeek);
        const week = entry.weeks.filter(value => !entry.schedules.has(value)).sort((a, b) =>
          Math.abs(Number(a) - current) - Math.abs(Number(b) - current) || Number(b) - Number(a)
        )[0];
        if (!week) break;
        await loadWeek(entry, week, epoch);
      }
      if (!valid(entry, epoch) || activeSemester !== entry.semester) return;
      const cells = new Map<string, ScheduleResult["cells"][number]>();
      const seen = new Map<string, ScheduleResult["cells"][number]["courses"][number]>();
      for (const week of entry.weeks) {
        for (const cell of entry.schedules.get(week)!.cells) {
          const cellKey = `${cell.day}:${cell.bigSlot}`;
          const target = cells.get(cellKey) ?? { ...cell, courses: [] };
          for (const course of cell.courses) {
            const weekList = normalizedCourseWeekList(course);
            const key = JSON.stringify([cellKey, { ...course, weekList }]);
            const previous = seen.get(key);
            if (previous) {
              if (!weekList.length && !previous.weekList.includes(Number(week))) previous.weekList.push(Number(week));
            } else {
              const normalized = { ...course, weekList: weekList.length ? weekList : [Number(week)] };
              seen.set(key, normalized);
              target.courses.push(normalized);
            }
          }
          cells.set(cellKey, target);
        }
      }
      entry.complete = { ...entry.schedules.values().next().value!, cells: [...cells.values()] };
      entry.schedules.clear(); // Keep only the merged semester after completion.
      host.CPUTimeNative?.schedulePrefetched?.(snapshot(entry, entry.complete));
    })().catch(() => {
      // Keep every successful week. A later visit retries only missing weeks;
      // background failures must never erase the visible timetable.
    }).finally(() => { entry.background = undefined; });
  };

  const fetchSchedule = async (semester?: string, week?: string, force = false) => {
    const selection = ++selectionRevision;
    const initialGeneration = generation;
    try {
      if (!auth.ready) await auth.fetchMe({ probe: true });
      jwxt.hydrate();
      const ready = await jwxt.ensureSession({
        refresh: force && !options.fastRefresh, silent: true, allowAutoLogin: true, repairUnavailableSession: true,
      });
      if (!ready) return unauthorized();
      const epoch = generation;
      const graduate = auth.academicIdentity === "graduate";
      if (graduate) {
        const data = parsed(await jwxt.withSessionRetry(() => jwxtApi.graduateSchedule({
          semester: semester || undefined, refresh: force ? "1" : undefined,
        }, { silent: true })));
        if (generation !== epoch || !jwxt.isLoggedIn) return unauthorized();
        const calendar = buildGraduateFallbackCalendar(data);
        const expanded = extendScheduleWeeksToCalendar(data, calendar) ?? data;
        return { version: 1, source: "graduate", completeSemester: true, fetchedAt: Date.now(), periods,
          data: { ...expanded, currentWeek: week || (calendar?.currentWeek ? String(calendar.currentWeek) : data.currentWeek),
            cells: nativeCells(data.currentSemester, expanded.cells) }, calendar,
          auth: { authenticated: true, identity: "graduate", account: accountKey() } };
      }
      if (selection === selectionRevision) activeSemester = semester || "";
      let entry = semester ? semesters.get(semester) : undefined;
      if (entry && Date.now() - entry.createdAt > CACHE_LIFETIME) {
        semesters.delete(entry.semester);
        entry = undefined;
      }
      if (force) {
        // Supersede older background work before the new network request.
        // Only the visible week's explicit refresh bypasses the server cache.
        if (semester) semesters.delete(semester);
        else semesters.clear();
        entry = undefined;
      }
      if (!entry) {
        const loadMetadata = (resolved: string) => Promise.all([
          jwxt.withSessionRetry(() => jwxtApi.calendar({ semester: resolved }, { silent: true }))
            .then((result: { parsed: unknown }) => hydrateCalendar(result.parsed as CalendarResult)).catch(() => null),
          auth.isLoggedIn ? jwxtApi.getScheduleEdits(resolved, { silent: true })
            .then(result => normalizeScheduleEditsState(result.edits)) : Promise.resolve(normalizeScheduleEditsState(null)),
        ] as const);
        // A known semester lets independent reads share the same network wait.
        // Retain edit errors until the timetable finishes; never show unedited data.
        const metadata = options.fastRefresh && semester
          ? loadMetadata(semester).then(value => ({ value, error: null as unknown }), error => ({ value: null, error }))
          : undefined;
        let requestedDataWeek: string | undefined;
        const loadInitial = async (requested?: string) => {
          requestedDataWeek = requested === "all" ? undefined : requested;
          return parsed(await jwxt.withSessionRetry(() => jwxtApi.schedule({
            semester: semester || undefined, week: requested, refresh: force ? "1" : undefined,
          }, { silent: true })));
        };
        let data: ScheduleResult;
        if (options.fastRefresh && force && week) {
          data = await loadInitial(week);
        } else if (supportsScope === false) {
          data = await loadInitial(week || undefined);
        } else {
          try {
            data = await loadInitial("all");
          } catch (error) {
            const failure = error as { status?: number; code?: number; message?: string };
            if (generation !== epoch || !jwxt.isLoggedIn || failure.status === 401 || failure.code === 4001
              || /请先登录教务|教务会话已失效|重新登录|重新授权/.test(failure.message || "")) throw error;
            // Older servers/agents may reject the new all-weeks sentinel.
            // Retry the exact pre-existing request contract, not guessed rules.
            data = await loadInitial(week || undefined);
            supportsScope = false;
          }
          if (supportsScope !== false) {
            supportsScope = data.scope !== undefined;
            if (!supportsScope) data = await loadInitial(week || undefined);
          }
        }
        if (generation !== epoch || !jwxt.isLoggedIn) return unauthorized();
        if (semester && data.currentSemester && data.currentSemester !== semester) throw new Error("教务系统返回了其他学期的课表");
        const resolved = semester || data.currentSemester;
        const prepared = await metadata;
        if (prepared?.error) throw prepared.error;
        const [calendar, edits] = prepared?.value ?? await loadMetadata(resolved);
        if (generation !== epoch || !jwxt.isLoggedIn) return unauthorized();
        data = extendScheduleWeeksToCalendar(data, calendar) ?? data;
        // Only advertised/calendar weeks establish completeness. Course ranges
        // alone cannot prove that later, unseen teaching weeks do not exist.
        const weeks = [...new Set(data.weeks.map(item => Number(item.value))
          .filter(value => Number.isInteger(value) && value >= 1 && value <= 64))].sort((a, b) => a - b).map(String);
        entry = { semester: resolved, createdAt: Date.now(), calendar, edits, weeks, preferredWeek: week || data.currentWeek,
          schedules: new Map([[requestedDataWeek || data.currentWeek, data]]), pending: new Map(),
          complete: data.scope === "semester" ? data : undefined };
        if (selection !== selectionRevision) return { version: 1, auth: { authenticated: true }, error: "课表请求已被新选择替代" };
        remember(entry);
      }
      if (selection === selectionRevision) activeSemester = entry.semester;
      const selected = week || (entry.calendar?.currentWeek ? String(entry.calendar.currentWeek)
        : entry.schedules.values().next().value?.currentWeek || entry.complete?.currentWeek || "");
      entry.preferredWeek = selected;
      const data = entry.complete ?? await loadWeek(entry, selected, epoch);
      if (generation !== epoch || !jwxt.isLoggedIn) return unauthorized();
      if (!valid(entry, epoch)) throw new Error("课表请求已更新，请重试。");
      const result = snapshot(entry, data, selected);
      prefetch(entry, epoch);
      return result;
    } catch (error) {
      if (initialGeneration !== generation || !jwxt.isLoggedIn) return unauthorized();
      return { version: 1, auth: { authenticated: true }, error: error instanceof Error ? error.message : "课表暂时无法加载，请重试。" };
    }
  };
  // Native cache hits need no data request, but can still reprioritize upcoming weeks.
  host.CPUTimeNativeSchedulePrioritize = (semester: string, week: string) => {
    const entry = semesters.get(semester);
    if (!entry || !jwxt.isLoggedIn || Date.now() - entry.createdAt > CACHE_LIFETIME) return;
    activeSemester = semester;
    entry.preferredWeek = week;
    prefetch(entry, generation);
  };
  host.CPUTimeNativeScheduleFetch = (semester?: string, week?: string, force = false) => {
    const key = JSON.stringify([generation, semester || "", week || "", force]);
    const pending = foreground.get(key);
    if (pending) return pending;
    const request = fetchSchedule(semester, week, force).finally(() => {
      if (foreground.get(key) === request) foreground.delete(key);
    });
    foreground.set(key, request);
    return request;
  };
  if (host.CPUTimeNative) {
    host.CPUTimeNative.loadSchedule = (options: { semester?: string; week?: string; force?: boolean } = {}) =>
      host.CPUTimeNativeScheduleFetch(options.semester, options.week, options.force);
    if (router) host.CPUTimeNative.openWebRoute = (path: string) => router.push(path);
    host.CPUTimeNative.ready?.();
  }
}
