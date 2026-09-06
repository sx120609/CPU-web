import crypto from "node:crypto";
import { withCache } from "./cache";
import * as transport from "./jwxtTransport";
import { normalizeCalendarWeekDays } from "./jwxtParser";
import { Errors } from "../utils/response";

const SCHEDULE_DATA_CACHE_REVISION = "schedule-data-v2";
const SCHEDULE_TTL_MS = 5 * 60_000;
const CALENDAR_TTL_MS = 24 * 60 * 60_000;

export type ScheduleQuery = { semester?: string; week?: string; refresh?: boolean };
type Calendar = Awaited<ReturnType<typeof transport.getCalendar>>;
type Dependencies = Pick<typeof transport, "getSchedule" | "getCalendar"> & {
  cache: typeof withCache;
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
  const deps: Dependencies = { ...transport, cache: withCache, now: () => new Date(), ...dependencies };
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
    const parsed = calendarAtDate(snapshot.parsed, deps.now());
    if (semester && parsed.currentWeek > 0) {
      await deps.cache("jwxt-calendar", currentKey, CALENDAR_TTL_MS, async () => snapshot, { refresh: true });
    }
    return {
      ...snapshot,
      parsed,
      stale: deps.now().getTime() - Date.parse(snapshot.syncedAt) > CALENDAR_TTL_MS,
    };
  }

  async function readRawSchedule(token: string, query: ScheduleQuery) {
    const semester = String(query.semester || "").trim();
    const week = String(query.week || "").trim();
    return deps.cache(
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
        return { parsed, syncedAt: deps.now().toISOString() };
      },
      { refresh: query.refresh },
    );
  }

  async function readSchedule(token: string, query: ScheduleQuery = {}) {
    // The page and widgets share these raw responses, including session renewal in the transport.
    let calendar = await readCalendar(token, query).catch(() => null);
    const semester = String(query.semester || calendar?.parsed.currentSemester || "").trim();
    const currentWeek = calendar?.parsed.currentWeek ?? 0;
    const week = String(query.week || "").trim() || (currentWeek > 0 ? String(currentWeek) : "");
    const snapshot = await readRawSchedule(token, { ...query, semester, week });
    if (calendar?.parsed.currentSemester !== snapshot.parsed.currentSemester) {
      calendar = await readCalendar(token, { semester: snapshot.parsed.currentSemester }).catch(() => null);
    }
    const matchingCalendar = calendar?.parsed.weeks.length
      && calendar.parsed.currentSemester === snapshot.parsed.currentSemester ? calendar : null;
    return {
      ...snapshot,
      calendar: matchingCalendar?.parsed ?? null,
      calendarSyncedAt: matchingCalendar?.syncedAt ?? null,
      stale: deps.now().getTime() - Date.parse(snapshot.syncedAt) > SCHEDULE_TTL_MS || Boolean(matchingCalendar?.stale),
    };
  }

  return { readSchedule, readCalendar };
}

export type ScheduleDataService = ReturnType<typeof createScheduleDataService>;
export const scheduleData = createScheduleDataService();
