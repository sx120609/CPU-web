import crypto from "node:crypto";
import { getCachedJson, setCachedJson, withCache } from "./cache";
import * as transport from "./jwxtTransport";
import { normalizeCalendarWeekDays } from "./jwxtParser";
import { buildRedisKey } from "./redis";
import { Errors } from "../utils/response";
import { applyScheduleTermConfig, getScheduleTermConfig } from "./scheduleTermConfig";

const SCHEDULE_DATA_CACHE_REVISION = "schedule-data-v2";
const SCHEDULE_TTL_MS = 5 * 60_000;
const CALENDAR_TTL_MS = 24 * 60 * 60_000;
// 改课标记要比它之前写下的任何一份课表缓存（5 分钟有效，再加 20 分钟过期可用）都活得久。
const SCHEDULE_CHANGE_TTL_MS = 30 * 60_000;
const SCHEDULE_FINGERPRINT_TTL_MS = 7 * 24 * 60 * 60_000;
const LEGACY_REFRESH_MESSAGE = "新版教务暂时没有返回课表，课表没有更新，请稍后再刷新。";

export type ScheduleQuery = { semester?: string; week?: string; refresh?: boolean };
type Calendar = Awaited<ReturnType<typeof transport.getCalendar>>;
type ParsedSchedule = Awaited<ReturnType<typeof transport.getSchedule>>;
type RawSchedule = { parsed: ParsedSchedule; syncedAt: string; outdated?: boolean };
/** page: an ordinary read; refresh: the user asked for 教务's latest; outdated: the cached copy predates a recorded change. */
type ScheduleFetchReason = "page" | "refresh" | "outdated";
type Dependencies = Pick<typeof transport, "getSchedule" | "getCalendar"> & {
  cache: typeof withCache;
  readState: typeof getCachedJson;
  writeState: typeof setCachedJson;
  now: () => Date;
};

export function scheduleDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function calendarAtDate(calendar: Calendar, now = new Date()): Calendar {
  const today = scheduleDate(now);
  const weeks = calendar.weeks.map((item) => {
    const days = normalizeCalendarWeekDays(item.days);
    return { ...item, days, monday: days[0] || "", sunday: days[6] || "" };
  });
  return { ...calendar, weeks, today, currentWeek: weeks.find((item) => item.days.includes(today))?.week ?? 0 };
}

export function createScheduleDataService(dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    ...transport,
    cache: withCache,
    readState: getCachedJson,
    writeState: setCachedJson,
    now: () => new Date(),
    ...dependencies,
  };
  const tokenKey = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

  async function readCalendar(token: string, query: ScheduleQuery = {}) {
    const semester = String(query.semester || "").trim();
    const currentKey = [SCHEDULE_DATA_CACHE_REVISION, tokenKey(token), "current", scheduleDate(deps.now())];
    const snapshot = await deps.cache(
      "jwxt-calendar",
      semester ? [SCHEDULE_DATA_CACHE_REVISION, tokenKey(token), semester] : currentKey,
      CALENDAR_TTL_MS,
      async () => {
        const parsed = await deps.getCalendar(token, { semester });
        if (!parsed.currentSemester || !Array.isArray(parsed.weeks) || !parsed.weeks.length) {
          throw Errors.badGateway("教务暂未返回可用校历");
        }
        if (semester && parsed.currentSemester && parsed.currentSemester !== semester) {
          throw Errors.badGateway("教务返回的校历学期与请求不一致");
        }
        return { parsed, syncedAt: deps.now().toISOString() };
      },
      { refresh: query.refresh },
    );
    const upstreamCalendar = calendarAtDate(snapshot.parsed, deps.now());
    const config = await getScheduleTermConfig(upstreamCalendar.currentSemester || semester);
    const parsed = applyScheduleTermConfig(upstreamCalendar, config, deps.now());
    if (semester && parsed.currentWeek > 0) {
      await deps.cache("jwxt-calendar", currentKey, CALENDAR_TTL_MS, async () => snapshot, { refresh: true });
    }
    return {
      ...snapshot,
      parsed,
      stale: deps.now().getTime() - Date.parse(snapshot.syncedAt) > CALENDAR_TTL_MS,
    };
  }

  const changeKey = (token: string) => buildRedisKey("jwxt", "schedule-changed", tokenKey(token));

  /**
   * Fingerprints every timetable fetched from 教务. When one of a session's
   * timetables differs from its last fetch, 教务 has changed the arrangement:
   * the session's other cached weeks and semester views predate that change
   * and must not be served as they are. A refresh of a single week, or one with
   * nothing to compare against, cannot vouch for the other weeks, so it has
   * the same effect.
   */
  async function noteUpstreamSchedule(
    token: string,
    parsed: ParsedSchedule,
    request: { semester: string; week: string; reason: ScheduleFetchReason },
    at: Date,
  ) {
    const view = request.week || (parsed.scope === "semester" ? "all" : parsed.currentWeek);
    const fingerprintKey = buildRedisKey(
      "jwxt", "schedule-fingerprint", tokenKey(token), request.semester || parsed.currentSemester || "_", view || "_",
    );
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(parsed.cells)).digest("hex");
    const previous = await deps.readState<string>(fingerprintKey);
    await deps.writeState(fingerprintKey, fingerprint, SCHEDULE_FINGERPRINT_TTL_MS);
    // A reload caused by the marker only catches up with a change already recorded.
    if (request.reason === "outdated") return;
    const explicit = request.reason === "refresh";
    const changed = previous ? previous !== fingerprint : explicit;
    if (changed || (explicit && parsed.scope !== "semester")) {
      await deps.writeState(changeKey(token), at.getTime(), SCHEDULE_CHANGE_TTL_MS);
    }
  }

  async function readRawSchedule(token: string, query: ScheduleQuery): Promise<RawSchedule> {
    const semester = String(query.semester || "").trim();
    const week = String(query.week || "").trim();
    const read = (reason: ScheduleFetchReason) => deps.cache(
      "jwxt-schedule",
      [SCHEDULE_DATA_CACHE_REVISION, tokenKey(token), semester || "_", week || "_", !semester || !week ? scheduleDate(deps.now()) : "_"],
      SCHEDULE_TTL_MS,
      async () => {
        const parsed = await deps.getSchedule(token, { semester, week });
        if (!Array.isArray(parsed.cells) || parsed.pageRecognized === false) {
          throw Errors.badGateway("教务未返回可识别的课表");
        }
        if (semester && parsed.currentSemester !== semester) {
          throw Errors.badGateway("教务返回的课表学期与请求不一致");
        }
        if (Number(week) > 0 && Number(parsed.currentWeek) !== Number(week)) {
          throw Errors.badGateway("教务返回的课表周次与请求不一致");
        }
        // 旧版教务不跟着新版改课。用户点了刷新就要新版的数据，拿不到时说清楚，而不是把旧数据当成刷新结果。
        if (reason === "refresh" && parsed.source === "legacy") throw Errors.badGateway(LEGACY_REFRESH_MESSAGE);
        const syncedAt = deps.now();
        await noteUpstreamSchedule(token, parsed, { semester, week, reason }, syncedAt).catch(() => undefined);
        return { parsed, syncedAt: syncedAt.toISOString() };
      },
      { refresh: reason !== "page" },
    );
    if (query.refresh) return read("refresh");
    const snapshot = await read("page");
    const changedAt = Number(await deps.readState<number>(changeKey(token)).catch(() => null)) || 0;
    if (!changedAt || Date.parse(snapshot.syncedAt) >= changedAt) return snapshot;
    // This copy predates a change 教务 made to the session's timetable. Keep it
    // only when 教务 cannot be reached, and say that it may be out of date.
    return read("outdated").catch((): RawSchedule => ({ ...snapshot, outdated: true }));
  }

  async function readSchedule(token: string, query: ScheduleQuery = {}) {
    // The page and widgets share these raw responses, including session renewal in the transport.
    let calendar = await readCalendar(token, query).catch(() => null);
    const semester = String(query.semester || calendar?.parsed.currentSemester || "").trim();
    const currentWeek = calendar?.parsed.currentWeek ?? 0;
    const week = String(query.week || "").trim() || (currentWeek > 0 ? String(currentWeek) : "");
    const { outdated, ...snapshot } = await readRawSchedule(token, { ...query, semester, week });
    if (calendar?.parsed.currentSemester !== snapshot.parsed.currentSemester) {
      calendar = await readCalendar(token, { semester: snapshot.parsed.currentSemester }).catch(() => null);
    }
    const matchingCalendar = calendar?.parsed.weeks.length
      && calendar.parsed.currentSemester === snapshot.parsed.currentSemester ? calendar : null;
    return {
      ...snapshot,
      calendar: matchingCalendar?.parsed ?? null,
      calendarSyncedAt: matchingCalendar?.syncedAt ?? null,
      stale: Boolean(outdated)
        || deps.now().getTime() - Date.parse(snapshot.syncedAt) > SCHEDULE_TTL_MS
        || Boolean(matchingCalendar?.stale),
    };
  }

  return { readSchedule, readCalendar };
}


export type ScheduleDataService = ReturnType<typeof createScheduleDataService>;
export const scheduleData = createScheduleDataService();
