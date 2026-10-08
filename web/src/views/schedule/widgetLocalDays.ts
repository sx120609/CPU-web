import { watch } from "vue";
import { dayOfWeekForCalendarYmd, normalizeCalendarWeekDays } from "./calendar";
import { classroomOnly } from "./nowIndicator";
import { smallSlots } from "./slots";
import type { CalendarResult, WeekCourseBlock } from "./types";

/**
 * 安卓小组件读的本地课表（docs/schedule-widget-rules.md 第 7 节）。字段与 iOS
 * NativeWidgetLocalSchedule 的 Record 一致；多带一个 `complete`，原生端据此决定
 * 是整份覆盖还是只替换这几周（同一学期的其他日子保留）。
 */
export interface ScheduleWidgetLocalCourse {
  name: string;
  teacher: string | null;
  location: string | null;
  note: string | null;
  slotNote: string | null;
  startTime: string | null;
  endTime: string | null;
  startSlot: number | null;
  endSlot: number | null;
}

export interface ScheduleWidgetLocalDay {
  day: number;
  label: string;
  date: string;
  week: number;
  courses: ScheduleWidgetLocalCourse[];
}

export interface ScheduleWidgetLocalRecord {
  semester: string;
  complete: boolean;
  days: ScheduleWidgetLocalDay[];
  holidays: Array<{ date: string; name: string }>;
}

export interface ScheduleWidgetLocalInput {
  semester: string;
  calendar: CalendarResult | null;
  /** 整学期都拿到了：写全部教学周；否则只写 `weeks` 里这几周。 */
  complete: boolean;
  weeks: number[];
  /** 这一周已经套用调休（放假日没课、补课日换成被调换那天的课）和自定义课程的课块。 */
  blocksForWeek: (week: number) => WeekCourseBlock[];
}

/** 七个法定节日的名字，服务端调休说明里认的就是这几个。 */
export const STATUTORY_HOLIDAY_NAMES = ["元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节"];

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/**
 * 从调休表的放假行里挑出法定假日（照 iOS `PublishedHoliday.fromOffDays`）：说明里提到哪个
 * 法定节日就算哪个，「国庆节、中秋节」取先出现的「国庆节」。学校自己的停课不算。
 */
export function publishedHolidaysFromOffDays(days: Array<{ date: string; note?: string }>) {
  const result: Array<{ date: string; name: string }> = [];
  for (const day of days) {
    const note = day.note ?? "";
    let best = "";
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const name of STATUTORY_HOLIDAY_NAMES) {
      const index = note.indexOf(name);
      if (index >= 0 && index < bestIndex) {
        best = name;
        bestIndex = index;
      }
    }
    if (best && day.date) result.push({ date: day.date, name: best });
  }
  return result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function periodTimes(calendar: CalendarResult | null) {
  const configured = (calendar?.periods ?? [])
    .filter((period) => Number.isInteger(period.id) && period.id > 0 && period.start && period.end);
  const source = configured.length
    ? configured.map((period) => ({ no: period.id, start: period.start, end: period.end }))
    : smallSlots;
  return new Map(source.map((period) => [period.no, period]));
}

function trimmed(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildScheduleWidgetLocalRecord(input: ScheduleWidgetLocalInput): ScheduleWidgetLocalRecord | null {
  const { calendar } = input;
  const semester = String(input.semester || "").trim();
  if (!semester || !calendar?.weeks?.length) return null;
  const covered = input.complete ? null : new Set(input.weeks);
  const periods = periodTimes(calendar);
  const offDates = new Set((calendar.adjustments ?? []).filter((item) => item.kind === "off").map((item) => item.date));
  const byDate = new Map<string, ScheduleWidgetLocalDay>();

  for (const week of calendar.weeks) {
    const weekNo = Number(week.week);
    if (!Number.isInteger(weekNo) || weekNo <= 0) continue;
    if (covered && !covered.has(weekNo)) continue;
    const blocks = input.blocksForWeek(weekNo);
    for (const date of normalizeCalendarWeekDays(week.days)) {
      // 星期按日期本身算：教务的周历有的从周日排起，下标不一定是星期几。
      const day = dayOfWeekForCalendarYmd(date);
      if (!day || byDate.has(date)) continue;
      const courses = offDates.has(date)
        ? []
        : blocks
          .filter((block) => block.day === day)
          .map((block): ScheduleWidgetLocalCourse => {
            const course = block.course;
            const slotNote = trimmed(course.slotNote);
            return {
              name: course.name,
              teacher: trimmed(course.teacher),
              location: classroomOnly(trimmed(course.location) ?? "") || trimmed(course.location),
              // 和服务端一样：先节次备注，没有就写上课周次。
              note: slotNote ?? trimmed(course.weeks),
              slotNote,
              startTime: trimmed(course.customStartTime) ?? periods.get(block.startSlot)?.start ?? null,
              endTime: trimmed(course.customEndTime) ?? periods.get(block.endSlot)?.end ?? null,
              startSlot: block.startSlot,
              endSlot: block.endSlot,
            };
          })
          .sort((a, b) => (
            (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.name.localeCompare(b.name)
          ));
      byDate.set(date, { day, label: DAY_LABELS[day - 1] ?? `周${day}`, date, week: weekNo, courses });
    }
  }
  if (!byDate.size) return null;
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const holidays = publishedHolidaysFromOffDays(
    (calendar.adjustments ?? []).filter((item) => item.kind === "off"),
  );
  return { semester, complete: input.complete, days, holidays };
}

interface AndroidLocalDaysBridge {
  saveScheduleWidgetLocalDays?: (json: string) => boolean;
  clearScheduleWidgetLocalDays?: () => void;
}

function androidBridge(): AndroidLocalDaysBridge | null {
  if (typeof window === "undefined") return null;
  // 只认安卓壳：iOS 和鸿蒙有自己的本地课表通路。
  return ((window as any).CPUAndroid ?? null) as AndroidLocalDaysBridge | null;
}

export function supportsAndroidScheduleWidgetLocalDays() {
  return typeof androidBridge()?.saveScheduleWidgetLocalDays === "function";
}

let lastSent = "";

export function saveAndroidScheduleWidgetLocalDays(record: ScheduleWidgetLocalRecord | null) {
  const bridge = androidBridge();
  if (!record || typeof bridge?.saveScheduleWidgetLocalDays !== "function") return false;
  const json = JSON.stringify(record);
  // 切周、重渲染都会触发；内容没变就不打扰原生端。
  if (json === lastSent) return true;
  try {
    const accepted = bridge.saveScheduleWidgetLocalDays(json) !== false;
    if (accepted) lastSent = json;
    return accepted;
  } catch {
    return false;
  }
}

export function clearAndroidScheduleWidgetLocalDays() {
  lastSent = "";
  const bridge = androidBridge();
  if (typeof bridge?.clearScheduleWidgetLocalDays !== "function") return;
  try {
    bridge.clearScheduleWidgetLocalDays();
  } catch {
    /* 旧版客户端没有这个方法 */
  }
}

const OWNER_KEY = "cpu-android-widget-owner";

/**
 * 退出登录、换账号时删掉本地课表。记下写入时的账号，App 关着的时候换了号、
 * 下次打开也能发现。`account` 为空表示已确认没登录。
 */
export function syncAndroidScheduleWidgetOwner(account: string) {
  if (!supportsAndroidScheduleWidgetLocalDays()) return;
  let previous = "";
  try { previous = localStorage.getItem(OWNER_KEY) || ""; } catch { /* ignore */ }
  if (previous === account) return;
  if (previous) clearAndroidScheduleWidgetLocalDays();
  try {
    if (account) localStorage.setItem(OWNER_KEY, account);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* ignore */ }
}

interface AuthLike {
  ready: boolean;
  isLoggedIn: boolean;
  user?: { id?: number | string } | null;
}

export function installAndroidScheduleWidgetOwnerWatch(auth: AuthLike) {
  if (!supportsAndroidScheduleWidgetLocalDays()) return;
  watch(() => auth.user?.id ?? null, (id, previousId) => {
    // 退出登录会先把 ready 置回 false，这里直接按账号消失处理。
    if (previousId != null && id == null) syncAndroidScheduleWidgetOwner("");
  });
  watch(() => [auth.ready, auth.isLoggedIn, auth.user?.id] as const, ([ready, loggedIn, id]) => {
    // 启动时还没恢复出登录状态（ready 为 false）不算退出。
    if (!ready) return;
    syncAndroidScheduleWidgetOwner(loggedIn && id != null ? String(id) : "");
  }, { immediate: true });
}
