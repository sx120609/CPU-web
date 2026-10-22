import { dayOfWeekForCalendarYmd } from "./calendar";
import {
  chinaClock,
  createSnapshotDayReader,
  periodsFor,
  toMinutes,
  type CoupleScheduleSnapshot,
  type SlotTime,
  type TimedCourse,
} from "./couple";

/** 每人一种颜色，和服务端的 DORM_COLORS 一致。共 8 种，正好覆盖宿舍人数上限。 */
export const DORM_COLORS = ["blue", "pink", "purple", "teal", "green", "amber", "orange", "red"] as const;
export type DormColor = (typeof DORM_COLORS)[number];
export const DORM_COLOR_NAMES: Record<DormColor, string> = {
  blue: "蓝", pink: "粉", purple: "紫", teal: "青", green: "绿", amber: "黄", orange: "橙", red: "红",
};

export const DORM_COLOR_FAMILIES: Record<DormColor, { hue: number }> = {
  blue: { hue: 214 }, pink: { hue: 338 }, purple: { hue: 268 }, teal: { hue: 178 },
  green: { hue: 138 }, amber: { hue: 42 }, orange: { hue: 22 }, red: { hue: 358 },
};

/**
 * 一个人的颜色：这个人所有的课都用它。
 * name 是直接写在页面底色上的人名颜色，border 只用于描边和色点，对比度不够当文字用。
 */
export function dormPersonTone(color: DormColor, dark: boolean) {
  const hue = (DORM_COLOR_FAMILIES[color] ?? DORM_COLOR_FAMILIES.blue).hue;
  return dark
    ? { bg: `hsl(${hue} 48% 29%)`, border: `hsl(${hue} 62% 50%)`, text: "#f5f7ff", name: `hsl(${hue} 75% 74%)` }
    : { bg: `hsl(${hue} 88% 93%)`, border: `hsl(${hue} 72% 77%)`, text: `hsl(${hue} 58% 27%)`, name: `hsl(${hue} 62% 30%)` };
}

export const DORM_WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

/** 没有节次表时的默认时间窗：早上八点到晚上九点四十。 */
export const DORM_DEFAULT_WINDOW = { start: 8 * 60, end: 21 * 60 + 40 };

export interface DormMemberSchedule {
  id: number;
  nickname: string;
  color: DormColor;
  snapshot: CoupleScheduleSnapshot | null;
}

/** 一位室友的课表读取器；同一份快照会被缓存在这里，避免逐日重复解析。 */
export interface DormDayReader {
  id: number;
  nickname: string;
  color: DormColor;
  snapshot: CoupleScheduleSnapshot | null;
  periods: SlotTime[];
  /** 当天所有课程；null 表示这天没有可用数据（没同步或不在学期内）。 */
  coursesForDate: (ymd: string) => TimedCourse[] | null;
}

export function createDormReader(member: DormMemberSchedule): DormDayReader {
  const reader = createSnapshotDayReader(member.snapshot);
  return {
    id: member.id,
    nickname: member.nickname,
    color: member.color,
    snapshot: member.snapshot,
    periods: member.snapshot ? periodsFor(member.snapshot.calendar) : [],
    coursesForDate: (ymd) => reader.timedCoursesForDate(ymd),
  };
}

export function createDormReaders(members: DormMemberSchedule[]) {
  return members.map(createDormReader);
}

export interface DormMinuteSpan {
  start: number;
  end: number;
}

/** 室友当天的忙碌时间块（分钟数）；没有课表数据时返回 null。 */
export function dormBusySpansForDate(reader: DormDayReader, ymd: string): DormMinuteSpan[] | null {
  const courses = reader.coursesForDate(ymd);
  if (!courses) return null;
  const spans: DormMinuteSpan[] = [];
  for (const course of courses) {
    const start = toMinutes(course.start);
    const end = toMinutes(course.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    spans.push({ start, end });
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * 全宿舍的时间窗：从所有人的节次表推出最早开始和最晚结束，再按 5 分钟取整。
 * 一个人都没有节次表时退回默认的八点到二十一点四十。
 */
export function dormDayWindow(readers: DormDayReader[]) {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const reader of readers) {
    for (const period of reader.periods) {
      const from = toMinutes(period.start);
      const to = toMinutes(period.end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      start = Math.min(start, from);
      end = Math.max(end, to);
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ...DORM_DEFAULT_WINDOW };
  return { start: Math.floor(start / 5) * 5, end: Math.ceil(end / 5) * 5 };
}

export interface DormFreeWindow {
  start: number;
  end: number;
  /** 这段时间里确定有空的室友。 */
  freeIds: number[];
}

export interface DormDayAvailability {
  ymd: string;
  weekday: number;
  window: DormMinuteSpan;
  /** 当天有课表数据、可以判断忙闲的人。 */
  knownIds: number[];
  /** 当天没有课表数据、无法判断的人。 */
  unknownIds: number[];
  /** 本次要求至少几个人有空；默认等于 knownIds.length。 */
  requiredFree: number;
  /** 要求的人数超过了有数据的人数，这天无法判断。 */
  insufficientData: boolean;
  /** 满足“至少 minFree 人有空”的连续时间块。 */
  windows: DormFreeWindow[];
  /** 当天所有室友都空闲的时间块（不考虑没有数据的人）。 */
  allFreeWindows: DormFreeWindow[];
}

export interface DormAvailabilityOptions {
  /** 至少几个人有空才算一段空档；默认所有人都要有空。 */
  minFree?: number;
  /** 少于这么多分钟的空档不显示，避免把零碎空隙刷满屏幕。 */
  minMinutes?: number;
  window?: DormMinuteSpan;
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isSubset(small: number[], large: number[]) {
  return small.every((id) => large.includes(id));
}

/**
 * 放宽人数时，短于 minMinutes 的碎片段按“同一批人”并进相邻段，避免漏报。
 * 例如 A、B 整小时都空、C 每 10 分钟上下课：{A,B,C} 和 {A,B} 交替，每段都太短，
 * 但 A、B 这一小时确实连续有空。
 *
 * 规则：短段 S 只能并进相邻段 R，且 R 的人必须是 S 的人的子集（R 的那批人在 S 期间也都空着），
 * 并后的段仍是 R 那批人；R 自己的人数要够 requiredFree。这样合并后的整段一定是同一批人空闲，
 * 不会把 {A,B} 和 {B,C} 算成“2 人有空”。两侧都能并时优先人更多的一侧，打平时并到前面。
 * 默认要求全员时，能并的只有同一批全员，和逐段合并的结果相同，所以默认语义不变。
 */
function absorbShortSegments(segments: DormFreeWindow[], requiredFree: number, minMinutes: number) {
  const list = segments.map((segment) => ({ ...segment, freeIds: [...segment.freeIds] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < list.length; index += 1) {
      const short = list[index];
      if (short.end - short.start >= minMinutes) continue;
      const candidates = [index - 1, index + 1].filter((at) => {
        const neighbour = list[at];
        return neighbour
          && neighbour.freeIds.length >= requiredFree
          && (neighbour.end === short.start || neighbour.start === short.end)
          && isSubset(neighbour.freeIds, short.freeIds);
      });
      if (!candidates.length) continue;
      const target = candidates.reduce((best, at) => (list[at].freeIds.length > list[best].freeIds.length ? at : best));
      const into = list[target];
      into.start = Math.min(into.start, short.start);
      into.end = Math.max(into.end, short.end);
      list.splice(index, 1);
      // 并完后两侧可能变成同一批人的相邻段，接起来。
      for (let at = list.length - 1; at > 0; at -= 1) {
        const before = list[at - 1];
        const after = list[at];
        if (before.end === after.start && sameIds(before.freeIds, after.freeIds)) {
          before.end = after.end;
          list.splice(at, 1);
        }
      }
      changed = true;
      break;
    }
  }
  return list;
}

/**
 * 一天的空闲分布。做法是按所有人课程的开始/结束时间把时间窗切成若干段，
 * 每一小段里人要么在上课要么没事，然后按“这段谁有空”合并相邻的段。
 * 没有课表数据的人不参与判断：既不算有空也不算有课，只在 unknownIds 里提示。
 */
export function dormDayAvailability(
  readers: DormDayReader[],
  ymd: string,
  options: DormAvailabilityOptions = {},
): DormDayAvailability {
  const weekday = dayOfWeekForCalendarYmd(ymd);
  const window = options.window ?? dormDayWindow(readers);
  const knownIds: number[] = [];
  const unknownIds: number[] = [];
  const busy = new Map<number, DormMinuteSpan[]>();

  for (const reader of readers) {
    const spans = dormBusySpansForDate(reader, ymd);
    if (!spans) {
      unknownIds.push(reader.id);
      continue;
    }
    knownIds.push(reader.id);
    busy.set(reader.id, spans
      .map((span) => ({ start: Math.max(span.start, window.start), end: Math.min(span.end, window.end) }))
      .filter((span) => span.end > span.start));
  }

  const points = new Set<number>([window.start, window.end]);
  for (const spans of busy.values()) {
    for (const span of spans) {
      points.add(span.start);
      points.add(span.end);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: DormFreeWindow[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const freeIds = knownIds.filter((id) => !(busy.get(id) ?? []).some((span) => span.start < end && span.end > start));
    const last = segments[segments.length - 1];
    if (last && last.end === start && sameIds(last.freeIds, freeIds)) last.end = end;
    else segments.push({ start, end, freeIds });
  }

  const minMinutes = Math.max(0, options.minMinutes ?? 20);
  // 明确要求 N 人时不能压到有数据的人数：只有 2 人有课表时，“至少 3 人有空”无从判断。
  const requiredFree = Math.max(1, Math.floor(options.minFree ?? knownIds.length));
  const insufficientData = requiredFree > knownIds.length;
  const usable = segments.filter((segment) => segment.end - segment.start >= minMinutes);
  const relaxed = insufficientData ? [] : absorbShortSegments(segments, requiredFree, minMinutes)
    .filter((segment) => segment.end - segment.start >= minMinutes && segment.freeIds.length >= requiredFree);
  return {
    ymd,
    weekday,
    window,
    knownIds,
    unknownIds,
    requiredFree,
    insufficientData,
    windows: relaxed,
    allFreeWindows: usable.filter((segment) => knownIds.length > 0 && segment.freeIds.length === knownIds.length),
  };
}

export interface DormMorningDuty {
  id: number;
  nickname: string;
  color: DormColor;
  course: string;
  start: string;
  end: string;
}

/**
 * 当天有早八的人。“早八”按情侣课表的口径：占用第 1 节就算，
 * 所以自定义了开始时间的课也照第 1 节的判断为准。
 */
export function dormMorningDuties(readers: DormDayReader[], ymd: string): DormMorningDuty[] {
  const duties: DormMorningDuty[] = [];
  for (const reader of readers) {
    const courses = reader.coursesForDate(ymd);
    if (!courses) continue;
    const first = courses.find((course) => course.startSlot === 1);
    if (!first) continue;
    duties.push({
      id: reader.id,
      nickname: reader.nickname,
      color: reader.color,
      course: first.course.name,
      start: first.start,
      end: first.end,
    });
  }
  return duties.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
}

export interface DormMorningDay {
  ymd: string;
  weekday: number;
  duties: DormMorningDuty[];
  /** 当天有可用课表的人数。 */
  knownCount: number;
  /** 当天有多少人没有可用课表，早八名单可能不全。 */
  unknownCount: number;
}

/** 连续若干天的早八名单，用于宿舍的“这周谁要早起”。 */
export function dormMorningDays(readers: DormDayReader[], dates: string[]): DormMorningDay[] {
  return dates.map((ymd) => {
    const unknownCount = readers.filter((reader) => !reader.coursesForDate(ymd)).length;
    return {
      ymd,
      weekday: dayOfWeekForCalendarYmd(ymd),
      duties: dormMorningDuties(readers, ymd),
      knownCount: readers.length - unknownCount,
      unknownCount,
    };
  });
}

/** 一段空档旁边的说明。有人没数据时只能说“已同步的人都有空”，不能说全宿舍。 */
export function dormFreeWindowLabel(window: DormFreeWindow, day: DormDayAvailability) {
  const count = window.freeIds.length;
  if (count < day.knownIds.length) return `${count} 人有空`;
  if (day.unknownIds.length) return `已同步的 ${count} 人都有空`;
  return count > 1 ? "全宿舍都有空" : "有空";
}

/** 这天没有空档时的说明，区分“确实凑不齐”和“数据不够没法判断”。 */
export function dormFreeEmptyText(day: DormDayAvailability, explicitMinFree: boolean) {
  if (!day.knownIds.length) return "这天大家都没有可用课表，没法判断谁有空。";
  if (day.insufficientData) {
    return `要 ${day.requiredFree} 人同时有空，但这天只有 ${day.knownIds.length} 人有课表数据，没法判断。可以放宽条件，或等室友同步课表。`;
  }
  const scope = day.unknownIds.length ? `已同步的 ${day.knownIds.length} 人里` : "这天";
  const requirement = explicitMinFree && day.requiredFree < day.knownIds.length
    ? `${day.requiredFree} 人同时有空`
    : (day.unknownIds.length ? "大家同时有空" : "全宿舍同时有空");
  return `${scope}没有${requirement}的时段。可以把条件放宽一点再看。`;
}

/** 早八列表里某一天没有人早八时的说法。 */
export function dormMorningNoneText(day: DormMorningDay) {
  if (!day.knownCount) return "没有数据";
  return day.unknownCount ? "已同步的人没有早八" : "没人早八";
}

/** 早八页顶部的总结；名单不全时不说“放心熬”。 */
export function dormMorningSummaryText(days: DormMorningDay[]) {
  if (!days.length || days.every((day) => !day.knownCount)) return `未来 ${days.length} 天大家都没有可用课表，看不出谁有早八。`;
  if (days.some((day) => day.unknownCount)) return `已同步课表的室友未来 ${days.length} 天都没有早八；还有人没同步，名单可能不全。`;
  return `未来 ${days.length} 天都没有早八，晚上可以放心熬。`;
}

export function formatMinute(value: number) {
  const minutes = Math.max(0, Math.round(value));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatWindow(span: DormMinuteSpan) {
  return `${formatMinute(span.start)}–${formatMinute(span.end)}`;
}

/** YYYY-MM-DD 加天数，按 UTC 计算避免夏令时和时区偏移。 */
export function addDaysYmd(ymd: string, days: number) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return ymd;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** 从今天开始连续 count 天的日期列表，用的仍然是北京时间的“今天”。 */
export function dormDateRange(fromYmd: string, count: number) {
  return Array.from({ length: Math.max(0, count) }, (_item, index) => addDaysYmd(fromYmd, index));
}

export function dormTodayYmd(now = new Date()) {
  return chinaClock(now).ymd;
}

/** “今天”“明天”或“周三”这样的名字；日期由调用方单独显示，避免和日期重复。 */
export function dormDayName(ymd: string, todayYmd: string) {
  if (ymd === todayYmd) return "今天";
  if (ymd === addDaysYmd(todayYmd, 1)) return "明天";
  return DORM_WEEKDAY_NAMES[dayOfWeekForCalendarYmd(ymd) - 1] ?? "";
}

/** “周二 10-27”这样的短标签，今天和明天直接说今天明天。 */
export function dormDateLabel(ymd: string, todayYmd: string) {
  const weekday = DORM_WEEKDAY_NAMES[dayOfWeekForCalendarYmd(ymd) - 1] ?? "";
  const monthDay = ymd.slice(5);
  if (ymd === todayYmd) return `今天 ${weekday}`;
  if (ymd === addDaysYmd(todayYmd, 1)) return `明天 ${weekday}`;
  return `${weekday} ${monthDay}`;
}

/** 找出下一批要早八的人；今天还有早八没开始算“接下来”。 */
export function dormNextMorning(days: DormMorningDay[], now = new Date()) {
  const clock = chinaClock(now);
  for (const day of days) {
    if (!day.duties.length) continue;
    if (day.ymd === clock.ymd) {
      const pending = day.duties.filter((duty) => toMinutes(duty.start) > clock.minutes);
      if (!pending.length) continue;
      return { ymd: day.ymd, weekday: day.weekday, duties: pending, isToday: true };
    }
    return { ymd: day.ymd, weekday: day.weekday, duties: day.duties, isToday: false };
  }
  return null;
}
