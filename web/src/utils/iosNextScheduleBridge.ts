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

type LegacyRecord = Record<string, unknown>;

function legacyRecord(value: unknown): LegacyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LegacyRecord : null;
}

function legacyText(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function legacyNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && value.trim()) {
      const match = value.trim().match(/-?\d+(?:\.\d+)?/);
      if (match) {
        const parsed = Number(match[0]);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
      }
    }
  }
  return 0;
}

function legacyArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as LegacyRecord);
  return value == null ? [] : [value];
}

function legacyWeekList(value: unknown, weeks: string) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(Number).filter((item) => Number.isFinite(item) && item > 0))]
      .sort((a, b) => a - b);
  }
  if (typeof value === "string" && value.trim()) {
    return normalizedCourseWeekList({ weeks: value });
  }
  return normalizedCourseWeekList({ weeks });
}

function legacySlotRange(note: string, start: number, end: number) {
  const parsed = (note.match(/\d{1,2}/g) ?? []).map(Number).filter((item) => item >= 1 && item <= 20);
  const resolvedStart = start > 0 ? start : parsed[0] || 0;
  const resolvedEnd = end > 0 ? end : parsed[parsed.length - 1] || resolvedStart;
  return {
    startSlot: resolvedStart > 0 ? resolvedStart : undefined,
    endSlot: resolvedEnd > 0 ? Math.max(resolvedStart || resolvedEnd, resolvedEnd) : undefined,
  };
}

function normalizeLegacyCourse(raw: unknown) {
  const value = legacyRecord(raw) ?? {};
  const name = legacyText(
    value.name,
    value.courseName,
    value.kcmc,
    value.kcmcName,
    value.title,
    value.course,
    value.kc,
  ) || "课程";
  const teacher = legacyText(value.teacher, value.teacherName, value.jsmc, value.js, value.instructor) || undefined;
  const location = legacyText(value.location, value.classroom, value.room, value.jxcd, value.dd, value.place) || undefined;
  const weeks = legacyText(value.weeks, value.weekText, value.weeksText, value.zc, value.week, value.weekRange);
  const slotNote = legacyText(value.slotNote, value.timeNote, value.sectionText, value.jc, value.timeRange) || undefined;
  const slot = legacySlotRange(
    slotNote || "",
    legacyNumber(value.startSlot, value.start, value.slotStart, value.sectionStart),
    legacyNumber(value.endSlot, value.end, value.slotEnd, value.sectionEnd),
  );
  return {
    ...value,
    name,
    teacher,
    location,
    weeks,
    weekList: legacyWeekList(value.weekList ?? value.weeksList ?? value.weekNumbers, weeks),
    slotNote,
    ...slot,
    ...(typeof value.customId === "string" ? { customId: value.customId } : {}),
    ...(typeof value.sourceKey === "string" ? { sourceKey: value.sourceKey } : {}),
    ...(typeof value.custom === "boolean" ? { custom: value.custom } : {}),
    ...(typeof value.orphaned === "boolean" ? { orphaned: value.orphaned } : {}),
  };
}

function normalizeLegacyCell(raw: unknown, fallbackDay = 0, fallbackSlot = 0) {
  const value = legacyRecord(raw) ?? {};
  const day = legacyNumber(value.day, value.weekday, value.weekDay, value.dayOfWeek, value.x, fallbackDay);
  const bigSlot = legacyNumber(
    value.bigSlot,
    value.slot,
    value.section,
    value.lesson,
    value.period,
    value.timeSlot,
    value.y,
    fallbackSlot,
  );
  const looksLikeCourse = ["name", "courseName", "kcmc", "kcmcName", "title", "kc"].some((key) => key in value);
  const rawCourses = value.courses ?? value.courseList ?? value.items ?? value.list
    ?? (value.course ? [value.course] : looksLikeCourse ? [value] : []);
  return {
    ...value,
    day,
    bigSlot,
    courses: legacyArray(rawCourses).flatMap((course) => {
      // A few legacy responses use a two-dimensional day/slot table. Preserve
      // only actual course records; empty cells must not create native blocks.
      if (Array.isArray(course)) return course.map(normalizeLegacyCourse);
      return [normalizeLegacyCourse(course)];
    }),
  };
}

function normalizeLegacyCells(value: LegacyRecord) {
  const cells: ReturnType<typeof normalizeLegacyCell>[] = [];
  const rawCells = value.cells ?? value.scheduleCells ?? value.grid;
  if (Array.isArray(rawCells)) {
    rawCells.forEach((cell, index) => {
      if (Array.isArray(cell)) {
        cell.forEach((nested, slotIndex) => {
          cells.push(normalizeLegacyCell(nested, index + 1, slotIndex + 1));
        });
      } else {
        cells.push(normalizeLegacyCell(cell));
      }
    });
  } else if (rawCells && typeof rawCells === "object") {
    Object.entries(rawCells as LegacyRecord).forEach(([key, cell]) => {
      const parts = key.match(/(\d+)[^\d]+(\d+)/);
      cells.push(normalizeLegacyCell(cell, parts ? Number(parts[1]) : 0, parts ? Number(parts[2]) : 0));
    });
  }

  // Older weekly responses sometimes returned a flat course list instead of
  // cells. Group those records so the native grid sees the same shape as Web.
  const flat = value.courses ?? value.courseList ?? value.items;
  if (flat !== undefined && flat !== null) {
    const grouped = new Map<string, ReturnType<typeof normalizeLegacyCell>>();
    legacyArray(flat).forEach((course) => {
      const record = legacyRecord(course) ?? {};
      const normalized = normalizeLegacyCell({
        day: record.day ?? record.weekday ?? record.weekDay ?? record.dayOfWeek,
        bigSlot: record.bigSlot ?? record.slot ?? record.section ?? record.lesson,
        courses: [course],
      });
      if (normalized.day < 1 || normalized.bigSlot < 1) return;
      const key = `${normalized.day}:${normalized.bigSlot}`;
      const current = grouped.get(key) ?? { day: normalized.day, bigSlot: normalized.bigSlot, courses: [] };
      current.courses.push(...normalized.courses);
      grouped.set(key, current);
    });
    grouped.forEach((group, key) => {
      const existing = cells.find((cell) => `${cell.day}:${cell.bigSlot}` === key);
      if (existing) existing.courses.push(...group.courses);
      else cells.push(group);
    });
  }
  return cells
    .filter((cell) => cell.day >= 1 && cell.day <= 7 && cell.bigSlot >= 1 && cell.courses.length)
    .map((cell) => ({ ...cell, courses: cell.courses.filter((course) => course.name.trim()) }));
}

function normalizeLegacyOptions(value: unknown, kind: "semester" | "week") {
  return legacyArray(value).map((item) => {
    const record = legacyRecord(item);
    const option = record ? legacyText(record.value, record.id, record.code, record.key) : legacyText(item);
    const label = record ? legacyText(record.label, record.name, record.text, option) : option;
    return { value: option, label: label || option, current: Boolean(record?.current ?? record?.selected) };
  }).filter((item) => item.value || kind === "week");
}

function normalizeScheduleResponse(response: unknown): ScheduleResult {
  let value: unknown = response;
  for (let index = 0; index < 4; index += 1) {
    const record = legacyRecord(value);
    if (!record) break;
    if (record.parsed && typeof record.parsed === "object") value = record.parsed;
    else if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) value = record.data;
    else if (record.schedule && typeof record.schedule === "object") value = record.schedule;
    else break;
  }
  const data = legacyRecord(value);
  if (!data) throw new Error("教务系统未返回有效课表，请稍后重试。");
  const cells = normalizeLegacyCells(data);
  if (!cells.length) throw new Error("教务系统未返回有效课表，请稍后重试。");
  const semesters = normalizeLegacyOptions(data.semesters ?? data.semesterList ?? data.terms, "semester");
  const weeks = normalizeLegacyOptions(data.weeks ?? data.weekList ?? data.weekOptions, "week");
  const currentSemester = legacyText(data.currentSemester, data.semester, data.term, semesters.find((item) => item.current)?.value);
  const currentWeek = legacyText(data.currentWeek, data.week, weeks.find((item) => item.current)?.value);
  return {
    ...data,
    source: data.source === "modern" || data.source === "legacy" ? data.source : undefined,
    scope: data.scope === "semester" || data.scope === "week" || data.scope === "unknown" ? data.scope : undefined,
    semesters,
    weeks,
    currentSemester,
    currentWeek,
    cells,
  } as ScheduleResult;
}

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

/** The native shell uses the same module-admin capability as the Web router. */
export function nativeScheduleAuthInfo() {
  const auth = useAuthStore();
  const user = auth?.user;
  // Keep the native shell compatible with an older Web bundle that may not
  // expose the Pinia getter yet. The router uses these same raw role fields
  // when deciding whether /admin is reachable.
  const role = String(user?.role ?? "").trim().toLowerCase();
  const canAccessAdmin = Boolean(auth?.canAccessModuleAdmin)
    || role === "admin"
    || role === "mod"
    || user?.voiceHubRole === "super_admin"
    || Boolean(user?.lostFoundRole);
  return {
    account: nativeScheduleAccountKey(),
    canAccessAdmin,
  };
}

/**
 * Expose the Web auth state machine to the native login surface. Keeping the
 * actual SSO and cookie work in the Web store means native login follows the
 * same pending-session, captcha, credential-encryption, and session-cookie
 * rules as the browser login page.
 */
export function installIosNativeAuthBridge(authStore?: any) {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  if (!host.CPUTimeNative) return;
  const auth = authStore ?? useAuthStore();
  if (!auth) return;

  const result = (ok: boolean, error = "") => {
    const info = nativeScheduleAuthInfo();
    return {
      ok,
      error: error || String(auth.ssoError || ""),
      needCaptcha: Boolean(auth.ssoNeedCaptcha),
      captchaImage: String(auth.ssoCaptchaImage || ""),
      account: info.account,
      canAccessAdmin: info.canAccessAdmin,
    };
  };

  host.CPUTimeNative.nativeLoginBegin = async () => {
    try {
      await auth.ssoBegin({ silent: true });
      return result(true);
    } catch (error) {
      return result(false, error instanceof Error ? error.message : "统一认证暂时不可用，请稍后再试。");
    }
  };
  host.CPUTimeNative.nativeSsoLogin = async (
    username: string,
    password: string,
    captcha: string,
    remember: boolean,
  ) => {
    try {
      const ok = await auth.ssoLogin(
        String(username || ""),
        String(password || ""),
        String(captcha || "") || undefined,
        Boolean(remember),
      );
      return result(ok);
    } catch (error) {
      return result(false, error instanceof Error ? error.message : "登录暂时失败，请稍后再试。");
    }
  };
  host.CPUTimeNative.nativeAccountLogin = async (username: string, password: string) => {
    try {
      await auth.login(String(username || ""), String(password || ""));
      return result(true);
    } catch (error) {
      return result(false, error instanceof Error ? error.message : "登录暂时失败，请稍后再试。");
    }
  };
}

/** HTML parsing and authentication stay on the server. The client caches and
 * merges parsed courses, applies saved edits and supplies native week filtering. */
export function installIosNextScheduleBridge(router?: Router, options: { fastRefresh?: boolean } = {}) {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  installIosNativeAuthBridge(auth);
  let generation = 0;
  let activeSemester = "";
  let selectionRevision = 0;
  let supportsScope: boolean | undefined;
  const semesters = new Map<string, SemesterEntry>();
  const foreground = new Map<string, Promise<unknown>>();
  const accountKey = nativeScheduleAccountKey;
  // A superseded selection is an expected request outcome. Keep it distinct
  // from service/auth failures so the native shell can leave its current grid
  // untouched while the newer selection finishes.
  const cancelled = () => ({ version: 1, auth: { authenticated: true }, cancelled: true });
  const notifyNativeAuth = () => {
    const info = nativeScheduleAuthInfo();
    host.CPUTimeNative?.authChanged?.(info.account, info.canAccessAdmin);
  };
  // Native opens the quick menu independently of the Web router. Refresh the
  // account from /user/me before reporting the capability so a role granted
  // after launch is reflected without requiring an app restart. The immediate
  // report keeps the menu responsive while the request is in flight.
  const refreshNativeAuth = async () => {
    notifyNativeAuth();
    try {
      if (auth.isLoggedIn && typeof auth.refreshSelfSilently === "function") {
        await auth.refreshSelfSilently();
      } else if (typeof auth.fetchMe === "function") {
        await auth.fetchMe({ probe: true });
      }
    } catch {
      // A transient profile failure must not hide a capability already known
      // locally; the next auth/store update will report the eventual state.
    }
    notifyNativeAuth();
    return nativeScheduleAuthInfo();
  };
  host.CPUTimeNative && (host.CPUTimeNative.refreshAuth = refreshNativeAuth);
  const unauthorized = () => ({ version: 1, auth: { authenticated: false, account: accountKey() } });

  watch(() => [
    auth.user?.id,
    auth.user?.role,
    auth.user?.voiceHubRole,
    auth.user?.lostFoundRole,
    auth.academicIdentity,
    jwxt.isLoggedIn,
  ], () => {
    generation += 1;
    selectionRevision += 1;
    semesters.clear();
    foreground.clear();
    activeSemester = "";
    notifyNativeAuth();
  }, { flush: "sync" });

  // The iOS shell may open its quick menu before any auth store field changes
  // after startup. Report the current capability immediately so a restored
  // administrator account does not remain stuck at Swift's default `false`
  // value. Harmony owns its own header/auth reporting and passes fastRefresh,
  // so an extra initial event there would be redundant.
  if (!options.fastRefresh) notifyNativeAuth();

  const valid = (entry: SemesterEntry, epoch: number) => generation === epoch
    && jwxt.isLoggedIn && semesters.get(entry.semester) === entry;
  const remember = (entry: SemesterEntry) => {
    semesters.delete(entry.semester);
    semesters.set(entry.semester, entry);
    // Bound retained client data, including semester switches.
    while (semesters.size > 4) semesters.delete(semesters.keys().next().value!);
  };
  const parsed = (response: { parsed?: unknown }): ScheduleResult => normalizeScheduleResponse(response);
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
        if (selection !== selectionRevision) return cancelled();
        remember(entry);
      }
      if (selection === selectionRevision) activeSemester = entry.semester;
      const selected = week || (entry.calendar?.currentWeek ? String(entry.calendar.currentWeek)
        : entry.schedules.values().next().value?.currentWeek || entry.complete?.currentWeek || "");
      entry.preferredWeek = selected;
      const data = entry.complete ?? await loadWeek(entry, selected, epoch);
      if (generation !== epoch || !jwxt.isLoggedIn) return unauthorized();
      if (selection !== selectionRevision) return cancelled();
      if (!valid(entry, epoch)) return cancelled();
      const result = snapshot(entry, data, selected);
      prefetch(entry, epoch);
      return result;
    } catch (error) {
      if (initialGeneration !== generation || !jwxt.isLoggedIn) return unauthorized();
      // A superseded selection can fail while its old network work is still
      // unwinding. Keep that expected race out of the native error surface.
      if (selection !== selectionRevision) return cancelled();
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
