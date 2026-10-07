// 共享课表：别人分享给我的课表整份保存在这台设备上，按导入它的账号分开
// （iOS 见 NativeSharedSchedule.swift、NativeScheduleSharingService.swift）。
// 发布和撤销自己的分享码走站点账号（/api/schedule-shares），跟着账号走；
// 这里的本地库只是读取方自己的收藏，不会上传。
import type { ScheduleShare, ScheduleShareMeta } from "@/api/scheduleShares";
import { normalizeCalendarWeekDays } from "./calendar";
import type { CalendarResult, CalendarWeek, ScheduleCell, ScheduleCourse, ScheduleResult } from "./types";

export const SHARED_SCHEDULE_STORAGE_KEY = "cpu-shared-schedules-v1";
export const MAX_SHARED_COURSES = 600;
export const MAX_SAVED_SHARES = 30;

export interface SavedSharedSchedule {
  meta: ScheduleShareMeta;
  schedule: ScheduleResult;
  calendar: CalendarResult;
  /** 读取方自己起的名字，只在这台设备上。 */
  remark: string;
  fetchedAt: number;
  /** 发布者撤销了分享。保存的副本还能打开，只是不会再变。 */
  revoked: boolean;
}

export interface SharedScheduleLibrary {
  /** 这份库属于哪个账号。换一个账号登录就从空的开始。 */
  account: string;
  schedules: SavedSharedSchedule[];
}

export function emptySharedLibrary(): SharedScheduleLibrary {
  return { account: "", schedules: [] };
}

/**
 * 从输入或粘贴的内容里取出分享码：大小写、空格、短横线都可以，
 * 整条 `/schedule/share/CODE` 链接也可以。取不出来就是 null。
 */
export function normalizeShareCode(input: string) {
  let text = String(input ?? "").trim();
  const marker = text.toLowerCase().indexOf("/schedule/share/");
  if (marker >= 0) {
    text = text.slice(marker + "/schedule/share/".length);
    text = text.split(/[?#/]/u)[0] ?? "";
  }
  const code = text.toUpperCase().replace(/[\s-]/gu, "");
  return /^[A-Z2-9]{8}$/u.test(code) ? code : null;
}

/** 发布者留的昵称；没留时服务端填的是「同学」，那不算昵称。 */
export function shareOwnerName(meta: Pick<ScheduleShareMeta, "owner">) {
  const value = String(meta.owner ?? "").trim();
  return value && value !== "同学" ? value : null;
}

/** 备注优先：昵称是发布者自己挑的，很多人可以叫同一个。 */
export function sharedScheduleName(saved: Pick<SavedSharedSchedule, "remark" | "meta">) {
  return saved.remark.trim() || shareOwnerName(saved.meta) || "共享课表";
}

export function sharedCourseCount(schedule: Pick<ScheduleResult, "cells">) {
  return (schedule.cells ?? []).reduce((sum, cell) => sum + (cell.courses?.length ?? 0), 0);
}

export class SharedScheduleReadError extends Error {
  constructor(public readonly kind: "empty" | "noCalendar", message: string) {
    super(message);
  }
}

function clip(value: unknown, length: number) {
  return String(value ?? "").slice(0, length);
}

function optionalClip(value: unknown, length: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, length) : undefined;
}

/** 去掉值为 undefined 的键，保存和比较时就不会多出空字段。 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function clampInt(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : undefined;
}

/**
 * 服务端的分享文档。服务端只检查每门课有名字，所以网格拿来当下标的东西都在这里
 * 收紧：坏掉的一行直接丢掉，而不是画到画不了的地方。编辑身份属于发布者的账号，
 * 读取方改不了这份课表，所以不带过来。
 */
export function readSharedSchedule(
  share: Pick<ScheduleShare, "code" | "owner" | "semester" | "courseCount" | "createdAt" | "updatedAt" | "schedule" | "calendar">,
  fetchedAt = Date.now(),
): SavedSharedSchedule {
  let remaining = MAX_SHARED_COURSES;
  const cells: ScheduleCell[] = [];
  for (const cell of share.schedule?.cells ?? []) {
    const day = Number(cell?.day);
    const bigSlot = Number(cell?.bigSlot);
    if (!Number.isInteger(day) || day < 1 || day > 7) continue;
    if (!Number.isInteger(bigSlot) || bigSlot < 1 || bigSlot > 20) continue;
    const courses: ScheduleCourse[] = [];
    for (const course of cell.courses ?? []) {
      if (remaining <= 0) break;
      const name = String(course?.name ?? "").trim();
      if (!name) continue;
      const startSlot = clampInt(course.startSlot, 1, 20);
      const endSlot = course.endSlot === undefined || course.endSlot === null
        ? undefined
        : clampInt(course.endSlot, startSlot ?? 1, 20);
      courses.push(compact<ScheduleCourse>({
        name: name.slice(0, 80),
        teacher: optionalClip(course.teacher, 80),
        weeks: clip(course.weeks, 120),
        weekList: [...new Set((Array.isArray(course.weekList) ? course.weekList : [])
          .map(Number).filter((week) => Number.isInteger(week) && week >= 1 && week <= 64))].sort((a, b) => a - b),
        location: optionalClip(course.location, 80),
        slotNote: optionalClip(course.slotNote, 120),
        startSlot,
        endSlot,
        customStartTime: optionalClip(course.customStartTime, 8),
        customEndTime: optionalClip(course.customEndTime, 8),
      }));
      remaining -= 1;
    }
    if (courses.length) cells.push({ day, bigSlot, courses });
  }
  if (!cells.length) throw new SharedScheduleReadError("empty", "这份共享课表里没有课程");

  const weeks: CalendarWeek[] = [];
  for (const week of share.calendar?.weeks ?? []) {
    const number = Number(week?.week);
    if (!Number.isInteger(number) || number < 1 || number > 64) continue;
    // 教务给的一周可能从周日开始或缺几天，这里统一成周一开头的七天。
    const days = normalizeCalendarWeekDays(Array.isArray(week.days) ? week.days : []);
    if (days.length !== 7 || !days.every((day) => /^\d{4}-\d{2}-\d{2}$/u.test(day))) continue;
    weeks.push({ week: number, days, monday: days[0], sunday: days[6] });
  }
  weeks.sort((a, b) => a.week - b.week);
  if (!weeks.length) throw new SharedScheduleReadError("noCalendar", "这份共享课表没有校历，无法按周显示");

  const semester = clip(share.semester, 80);
  const calendar: CalendarResult = {
    currentSemester: semester,
    currentWeek: weeks[0].week,
    semesterStart: clip(share.calendar?.semesterStart, 10),
    semesterEnd: clip(share.calendar?.semesterEnd, 10),
    weeks,
    periods: (share.calendar?.periods ?? [])
      .filter((period) => Number.isInteger(Number(period?.id)) && Number(period.id) >= 1 && Number(period.id) <= 48)
      .map((period) => ({ id: Number(period.id), name: clip(period.name, 20), start: clip(period.start, 5), end: clip(period.end, 5) })),
    adjustments: (share.calendar?.adjustments ?? [])
      .filter((item) => item?.kind === "off" || item?.kind === "swap")
      .map((item) => compact({
        date: clip(item.date, 10),
        kind: item.kind,
        source: optionalClip(item.source, 10),
        note: optionalClip(item.note, 40),
      })),
  };
  const schedule: ScheduleResult = {
    scope: "semester",
    semesters: [],
    weeks: weeks.map((week) => ({ value: String(week.week), label: `第 ${week.week} 周`, current: false })),
    currentSemester: semester,
    currentWeek: String(weeks[0].week),
    cells,
  };
  return {
    meta: {
      code: clip(share.code, 8),
      owner: clip(share.owner, 40),
      semester,
      courseCount: sharedCourseCount(schedule),
      createdAt: clip(share.createdAt, 40),
      updatedAt: clip(share.updatedAt, 40),
    },
    schedule,
    calendar,
    remark: "",
    fetchedAt,
    revoked: false,
  };
}

/**
 * `today`（"yyyy-MM-dd"）落在哪一周。学期开始前是第一周，结束后是最后一周，
 * 所以网格总有一周可以显示。分享里存的当前周只是发布者当时恰好在的那一周。
 */
export function sharedScheduleWeek(calendar: Pick<CalendarResult, "weeks">, today: string) {
  const weeks = calendar.weeks ?? [];
  const hit = weeks.find((week) => week.days.includes(today));
  if (hit) return hit.week;
  if (!weeks.length) return 1;
  return today < (weeks[0].days[0] ?? "") ? weeks[0].week : weeks[weeks.length - 1].week;
}

// MARK: 本地库（纯函数，规则可以不依赖浏览器单独检查）

/** 把预览过的分享按备注保存下来。同一个码再导入一次是替换，不是多一份。 */
export function saveSharedSchedule(library: SharedScheduleLibrary, schedule: SavedSharedSchedule, remark: string): SharedScheduleLibrary {
  const saved = { ...schedule, remark: remark.trim() };
  const index = library.schedules.findIndex((item) => item.meta.code === saved.meta.code);
  const schedules = [...library.schedules];
  if (index >= 0) schedules[index] = saved;
  else schedules.push(saved);
  return { ...library, schedules: schedules.slice(-MAX_SAVED_SHARES) };
}

/** 已保存分享的一份更新的下载。备注保留。 */
export function refreshSharedSchedule(library: SharedScheduleLibrary, schedule: SavedSharedSchedule): SharedScheduleLibrary {
  const index = library.schedules.findIndex((item) => item.meta.code === schedule.meta.code);
  if (index < 0) return library;
  const schedules = [...library.schedules];
  schedules[index] = { ...schedule, remark: schedules[index].remark };
  return { ...library, schedules };
}

export function renameSharedSchedule(library: SharedScheduleLibrary, code: string, remark: string): SharedScheduleLibrary {
  return {
    ...library,
    schedules: library.schedules.map((item) => (item.meta.code === code ? { ...item, remark: remark.trim() } : item)),
  };
}

/** 发布者撤销了：副本留着，只是不再当它是活的。 */
export function markSharedScheduleRevoked(library: SharedScheduleLibrary, code: string): SharedScheduleLibrary {
  return {
    ...library,
    schedules: library.schedules.map((item) => (item.meta.code === code ? { ...item, revoked: true } : item)),
  };
}

export function removeSharedSchedule(library: SharedScheduleLibrary, code: string): SharedScheduleLibrary {
  return { ...library, schedules: library.schedules.filter((item) => item.meta.code !== code) };
}

/** 换了账号登录就重新开始。空的账号（没登录）什么都不改。 */
export function adoptSharedLibraryAccount(library: SharedScheduleLibrary, account: string): SharedScheduleLibrary {
  const next = String(account ?? "").trim();
  if (!next || next === library.account) return library;
  return library.account ? { account: next, schedules: [] } : { ...library, account: next };
}

// MARK: 存取

function isSavedSchedule(value: unknown): value is SavedSharedSchedule {
  const item = value as SavedSharedSchedule;
  return Boolean(
    item
    && typeof item.meta?.code === "string"
    && Array.isArray(item.schedule?.cells)
    && Array.isArray(item.calendar?.weeks),
  );
}

export function parseSharedLibrary(raw: string | null | undefined): SharedScheduleLibrary {
  if (!raw) return emptySharedLibrary();
  try {
    const parsed = JSON.parse(raw);
    return {
      account: typeof parsed?.account === "string" ? parsed.account : "",
      schedules: (Array.isArray(parsed?.schedules) ? parsed.schedules : [])
        .filter(isSavedSchedule)
        .map((item: SavedSharedSchedule) => ({
          ...item,
          remark: typeof item.remark === "string" ? item.remark : "",
          fetchedAt: Number(item.fetchedAt) || 0,
          revoked: Boolean(item.revoked),
        })),
    };
  } catch {
    return emptySharedLibrary();
  }
}

export function loadSharedLibrary(): SharedScheduleLibrary {
  try {
    return parseSharedLibrary(localStorage.getItem(SHARED_SCHEDULE_STORAGE_KEY));
  } catch {
    return emptySharedLibrary();
  }
}

/** 存不下（本地空间满了）时返回 false，调用方要告诉用户。 */
export function storeSharedLibrary(library: SharedScheduleLibrary) {
  try {
    localStorage.setItem(SHARED_SCHEDULE_STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

// MARK: 和服务端同步

export interface SharedScheduleApi {
  get: (code: string) => Promise<ScheduleShare>;
  meta: (code: string) => Promise<ScheduleShareMeta>;
}

export function isNotFoundError(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}

/**
 * 把每份保存的分享检查一遍：变了的重新下载，撤销了的做上标记。
 * 其他情况（包括断网）都让保存的副本保持原样。
 */
export async function refreshSharedLibrary(library: SharedScheduleLibrary, api: SharedScheduleApi, now = Date.now) {
  let next = library;
  for (const saved of library.schedules) {
    if (saved.revoked) continue;
    const code = saved.meta.code;
    const download = async () => readSharedSchedule(await api.get(code), now());
    try {
      const meta = await api.meta(code);
      if (meta.updatedAt === saved.meta.updatedAt) continue;
      next = refreshSharedSchedule(next, await download());
    } catch (error) {
      if (!isNotFoundError(error)) continue;
      // 还没有摘要接口的旧服务端对每个码都回 404。只有分享本身也不在了，才是真的撤销了。
      try {
        next = refreshSharedSchedule(next, await download());
      } catch (inner) {
        if (isNotFoundError(inner)) next = markSharedScheduleRevoked(next, code);
      }
    }
  }
  return next;
}

// MARK: 发布自己的课表

/**
 * 发布用的请求体。只带读取方画出课表需要的东西：发布者的学期列表、
 * 把课程和账号绑在一起的编辑身份都留在本地。
 */
export function buildSharePublishBody(input: {
  semester: string;
  schedule: ScheduleResult;
  calendar: CalendarResult;
  ownerName?: string | null;
}) {
  const cells = (input.schedule.cells ?? []).flatMap((cell) => {
    const courses = (cell.courses ?? []).flatMap((course) => {
      const name = String(course.name ?? "").trim();
      if (!name) return [];
      const item: ScheduleCourse = { name, weeks: course.weeks ?? "", weekList: course.weekList ?? [] };
      if (course.teacher) item.teacher = course.teacher;
      if (course.location) item.location = course.location;
      if (course.slotNote) item.slotNote = course.slotNote;
      if (Number.isFinite(course.startSlot)) item.startSlot = course.startSlot;
      if (Number.isFinite(course.endSlot)) item.endSlot = course.endSlot;
      if (course.customStartTime) item.customStartTime = course.customStartTime;
      if (course.customEndTime) item.customEndTime = course.customEndTime;
      return [item];
    });
    return courses.length ? [{ day: cell.day, bigSlot: cell.bigSlot, courses }] : [];
  });
  const weeks = input.calendar.weeks ?? [];
  const firstWeek = weeks[0]?.week ?? 1;
  const ownerName = String(input.ownerName ?? "").trim().slice(0, 40);
  return {
    semester: input.semester,
    ...(ownerName ? { ownerName } : {}),
    schedule: {
      scope: "semester" as const,
      semesters: [],
      weeks: weeks.map((week) => ({ value: String(week.week), label: `第 ${week.week} 周`, current: false })),
      currentSemester: input.semester,
      currentWeek: String(firstWeek),
      cells,
    } satisfies ScheduleResult,
    calendar: {
      currentSemester: input.semester,
      currentWeek: firstWeek,
      semesterStart: input.calendar.semesterStart,
      semesterEnd: input.calendar.semesterEnd,
      weeks: weeks.map((week) => ({ week: week.week, days: week.days, monday: week.monday, sunday: week.sunday })),
      periods: input.calendar.periods ?? [],
      adjustments: input.calendar.adjustments ?? [],
    } satisfies CalendarResult,
  };
}

/** 发给朋友的文字：分享码、在哪里输入，以及在浏览器里直接打开同一份课表的链接。 */
export function shareInvitationText(code: string, origin: string) {
  const base = origin.replace(/\/+$/u, "");
  return `我的课表分享码：${code}\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：${base}/schedule/share/${code}`;
}

/** 「更新于 10月7日」，取自服务端的 ISO 时间。 */
export function shareUpdatedText(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" })
    .formatToParts(new Date(time));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? `更新于 ${month}月${day}日` : null;
}
