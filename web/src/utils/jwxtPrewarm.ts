import { jwxtApi } from "@/api/jwxt";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { jwxtScopedStorageKey } from "@/utils/jwxtCache";
import {
  isJwxtTabCacheStale,
  readJwxtTabCache,
  type JwxtDataTab,
  writeJwxtTabCache,
} from "@/utils/jwxtTabCache";
import {
  buildScheduleCacheKey,
  scheduleCalendarCacheKey,
  scheduleLastCacheKey,
  writeCache,
  writeStoredLastScheduleCacheKey,
} from "@/views/schedule/cache";
import {
  buildGraduateFallbackCalendar,
  extendScheduleWeeksToCalendar,
  hydrateCalendar,
} from "@/views/schedule/calendar";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";

const PREWARM_MARKER_BASE = "cpu-jwxt-data-prewarm-v1";
const PREWARM_MIN_INTERVAL_MS = 30 * 60 * 1000;
const STEP_DELAY_MS = 180;

let prewarmScheduled = false;
let prewarmInFlight = false;

function justLoggedOutThisSession() {
  try {
    return sessionStorage.getItem("cpu-just-logged-out") === "1";
  } catch {
    return false;
  }
}

function prewarmMarkerKey(identity: string) {
  return jwxtScopedStorageKey(PREWARM_MARKER_BASE, identity);
}

function readPrewarmMarker(identity: string) {
  try {
    const key = prewarmMarkerKey(identity);
    return key ? Number(localStorage.getItem(key) || 0) : 0;
  } catch {
    return 0;
  }
}

function writePrewarmMarker(identity: string) {
  try {
    const key = prewarmMarkerKey(identity);
    if (key) localStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function shouldSkipByCooldown(identity: string, force?: boolean) {
  if (force) return false;
  const lastAt = readPrewarmMarker(identity);
  return Boolean(lastAt && Date.now() - lastAt < PREWARM_MIN_INTERVAL_MS);
}

function idle(callback: () => void, timeout = 5000) {
  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout });
  } else {
    window.setTimeout(callback, 1200);
  }
}

function delay(ms = STEP_DELAY_MS) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function scheduleJwxtDataPrewarm(options?: { force?: boolean; immediate?: boolean }) {
  if (prewarmScheduled || prewarmInFlight || justLoggedOutThisSession()) return;
  prewarmScheduled = true;
  const run = () => {
    prewarmScheduled = false;
    void prewarmJwxtData(options);
  };
  if (options?.immediate) {
    window.setTimeout(run, 0);
    return;
  }
  idle(run);
}

async function prewarmJwxtData(options?: { force?: boolean }) {
  if (prewarmInFlight || justLoggedOutThisSession()) return false;
  prewarmInFlight = true;
  try {
    const auth = useAuthStore();
    const jwxt = useJwxtStore();
    if (!auth.ready) {
      await auth.fetchMe({ probe: true }).catch(() => undefined);
    }
    if (!auth.isLoggedIn || justLoggedOutThisSession()) return false;

    jwxt.hydrate();
    const ready = await jwxt.ensureSession({ refresh: true, silent: true, allowAutoLogin: false }).catch(() => false);
    if (!ready || !auth.isLoggedIn) return false;

    const identity = await auth.detectAcademicIdentity({
      silent: true,
      fallback: auth.academicIdentity,
    }).catch(() => auth.academicIdentity);

    if (shouldSkipByCooldown(identity, options?.force)) return false;
    writePrewarmMarker(identity);

    if (identity === "graduate") {
      await prewarmGraduateSchedule(jwxt, identity, options?.force);
    } else {
      await prewarmUndergraduateData(jwxt, identity, options?.force);
    }
    return true;
  } finally {
    prewarmInFlight = false;
  }
}

async function prewarmUndergraduateData(jwxt: ReturnType<typeof useJwxtStore>, identity: string, force?: boolean) {
  const calendar = await prewarmCalendar(jwxt, "undergraduate");
  const scheduleData = await prewarmTab("schedule", identity, force, () =>
    jwxt.withSessionRetry(() => jwxtApi.schedule(undefined, { silent: true })),
  );
  if (scheduleData?.parsed) {
    writeScheduleCaches(["undergraduate", "jwxt"], scheduleData.parsed, calendar);
  }

  const jobs: Array<[JwxtDataTab, () => Promise<any>]> = [
    ["grades", () => jwxt.withSessionRetry(() => jwxtApi.grades(undefined, { silent: true }))],
    ["midterm", () => jwxt.withSessionRetry(() => jwxtApi.midtermGrades(undefined, { silent: true }))],
    ["progress", () => jwxt.withSessionRetry(() => jwxtApi.progress({ silent: true }))],
    ["pyfa", () => jwxt.withSessionRetry(() => jwxtApi.pyfa({ silent: true }))],
  ];

  for (const [tab, load] of jobs) {
    await delay();
    await prewarmTab(tab, identity, force, load);
  }
}

async function prewarmGraduateSchedule(jwxt: ReturnType<typeof useJwxtStore>, identity: string, force?: boolean) {
  const scheduleData = await prewarmTab("schedule", identity, force, async () => {
    const result = await jwxt.withSessionRetry(() => jwxtApi.graduateSchedule(undefined, { silent: true }));
    const fallbackCalendar = buildGraduateFallbackCalendar(result.parsed);
    const parsed = extendScheduleWeeksToCalendar(result.parsed, fallbackCalendar);
    if (fallbackCalendar) {
      writeCache(scheduleCalendarCacheKey("graduate", parsed?.currentSemester), fallbackCalendar);
    }
    return { ...result, parsed };
  });

  if (scheduleData?.parsed) {
    const calendar = readGraduateCalendar(scheduleData.parsed);
    writeScheduleCaches(["graduate"], scheduleData.parsed, calendar);
  }
}

async function prewarmTab<T = any>(
  tab: JwxtDataTab,
  identity: string,
  force: boolean | undefined,
  load: () => Promise<T>,
) {
  const cached = readJwxtTabCache<T>(tab, identity);
  if (!force && cached?.data && !isJwxtTabCacheStale(cached.savedAt)) return cached.data;
  try {
    const data = await load();
    writeJwxtTabCache(tab, identity, data);
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

async function prewarmCalendar(jwxt: ReturnType<typeof useJwxtStore>, scope: string) {
  try {
    const result = await jwxt.withSessionRetry(() => jwxtApi.calendar(undefined, { silent: true }));
    const calendar = hydrateCalendar(result.parsed);
    if (calendar) writeCache(scheduleCalendarCacheKey(scope, calendar.currentSemester), calendar);
    return calendar;
  } catch {
    return null;
  }
}

function readGraduateCalendar(parsed: ScheduleResult) {
  return buildGraduateFallbackCalendar(parsed);
}

function writeScheduleCaches(scopes: string[], parsed: ScheduleResult, calendar: CalendarResult | null) {
  for (const scope of scopes) {
    const key = buildScheduleCacheKey({
      scope,
      semester: parsed.currentSemester,
      week: parsed.currentWeek || calendar?.currentWeek || "current",
      currentSemester: parsed.currentSemester,
      currentWeek: parsed.currentWeek,
      calendarWeek: calendar?.currentWeek,
      graduate: scope === "graduate",
    });
    if (!key) continue;
    writeCache(key, parsed);
    writeStoredLastScheduleCacheKey(scheduleLastCacheKey(scope), key);
    if (calendar) writeCache(scheduleCalendarCacheKey(scope, parsed.currentSemester), calendar);
  }
}
