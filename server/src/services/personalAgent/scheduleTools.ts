import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/response";
import { getSchool } from "../../schools/registry";
import { completeSchoolPeriods } from "../../schools/periods";
import {
  AGENDA_COLLECTION,
  AGENDA_MAX_ITEMS,
  agendaAddDays,
  agendaDayNumber,
  agendaOn,
  agendaOpen,
  agendaOverdue,
  agendaWeekday,
  normalizeAgendaItem,
  type AgendaItem,
  type AgendaOccurrence,
} from "../../shared/agenda";
import { adjustmentForDate } from "../../shared/scheduleAdjustments";
import { courseCustomTime, customClockMinutes } from "../../shared/scheduleCustomTime";
import {
  applyScheduleEditsToCells,
  normalizeScheduleEditsState,
  type EditableScheduleCell,
  type EditableScheduleCourse,
  type ScheduleEditState,
} from "../../shared/scheduleEdits";
import { applyOccurrenceChanges, weekdayOf } from "../../shared/scheduleOccurrences";
import { courseMatchesWeek } from "../../shared/scheduleWeeks";
import { withCache } from "../cache";
import { getCoupleSchedules, getCoupleStatus } from "../coupleSchedule";
import { getDormSchedules, getDormStatus } from "../dormSchedule";
import { graduateScheduleData } from "../graduateScheduleData";
import type { CalendarResult } from "../jwxtParser";
import type { FreeRoomRow, FreeRoomSlot } from "../jwxtRecords";
import { getRecords } from "../jwxtTransport";
import { scheduleData } from "../scheduleData";
import {
  dropEmptyFields,
  fitByListLimit,
  fitToolResult,
  inspectSettledParts,
  jwxtAuthExpiredError,
  jwxtCacheId,
  jwxtErrorMessage,
  runWithJwxtSession,
  schoolHasAcademicView,
} from "./academicTools";
import {
  guardToolScope,
  shanghaiNowParts,
  type PersonalAgentToolContext,
  type PersonalAgentToolDefinition,
} from "./types";

const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 一次最多额外读取几周课表（当前周之外）。14 天的窗口最多跨 3 周，再加调休补课的来源周。 */
const MAX_EXTRA_WEEK_FETCHES = 4;
const FREE_ROOMS_TTL_MS = 5 * 60_000;

type Period = { id: number; start: string; end: string };

// ============ 节次与大节 ============

export interface BigSlotInfo {
  bigSlot: number;
  /** 包含的小节，如 "1-2" */
  periods: string;
  start: string;
  end: string;
  label: string;
}

/**
 * 按本校作息把小节两两并成大节：第 N 大节 = 第 2N-1、2N 节，和课表网格、解析器的约定一致。
 * minCount 用来容纳作息表之外仍有课的大节。
 */
export function bigSlotsFromPeriods(periods: ReadonlyArray<Period>, minCount = 0): BigSlotInfo[] {
  const byId = new Map(periods.map((period) => [period.id, period]));
  const maxId = periods.reduce((max, period) => Math.max(max, period.id), 0);
  const count = Math.max(Math.ceil(maxId / 2), minCount);
  const out: BigSlotInfo[] = [];
  for (let bigSlot = 1; bigSlot <= count; bigSlot += 1) {
    const first = bigSlot * 2 - 1;
    const last = byId.has(bigSlot * 2) ? bigSlot * 2 : first;
    const start = byId.get(first)?.start || "";
    const end = byId.get(last)?.end || "";
    const periodsText = first === last ? `${first}` : `${first}-${last}`;
    out.push({
      bigSlot,
      periods: periodsText,
      start,
      end,
      label: `第${bigSlot}大节(第${periodsText}节${start && end ? ` ${start}-${end}` : ""})`,
    });
  }
  return out;
}

function schoolPeriods(ctx: Pick<PersonalAgentToolContext, "schoolId">, supplied?: CalendarResult["periods"] | null) {
  return completeSchoolPeriods(supplied, getSchool(ctx.schoolId).defaultPeriods);
}

export interface DescribedCourse {
  bigSlot: number;
  /** 这门课实际占到的大节（跨大节的课不止一个）。 */
  bigSlots: number[];
  startSlot: number;
  endSlot: number;
  periods: string;
  start: string;
  end: string;
  name: string;
  location: string;
  teacher: string;
}

/** 一门课的小节范围、占用的大节和上下课时间（自定义时间优先，其次按作息表）。 */
export function describeCourse(bigSlot: number, course: EditableScheduleCourse, periods: ReadonlyArray<Period>): DescribedCourse {
  const startSlot = Number.isFinite(course.startSlot) ? Number(course.startSlot) : bigSlot * 2 - 1;
  const endSlot = Math.max(startSlot, Number.isFinite(course.endSlot) ? Number(course.endSlot) : bigSlot * 2);
  const custom = courseCustomTime(course);
  const byId = new Map(periods.map((period) => [period.id, period]));
  const bigSlots: number[] = [];
  for (let slot = Math.max(1, Math.ceil(startSlot / 2)); slot <= Math.max(1, Math.ceil(endSlot / 2)); slot += 1) bigSlots.push(slot);
  return {
    bigSlot,
    bigSlots,
    startSlot,
    endSlot,
    periods: startSlot === endSlot ? `${startSlot}` : `${startSlot}-${endSlot}`,
    start: custom?.start ?? byId.get(startSlot)?.start ?? "",
    end: custom?.end ?? byId.get(endSlot)?.end ?? "",
    name: course.name,
    location: course.location || "",
    teacher: course.teacher || "",
  };
}

function minutesRange(start?: string, end?: string): [number, number] | null {
  const from = customClockMinutes(start);
  if (from === null) return null;
  const to = customClockMinutes(end);
  return [from, to !== null && to > from ? to : from + 1];
}

function rangesOverlap(a: [number, number] | null, b: [number, number] | null) {
  return Boolean(a && b && Math.max(a[0], b[0]) < Math.min(a[1], b[1]));
}

// ============ 教学周 ============

type CalendarWeekLike = { week?: unknown; days?: unknown; monday?: unknown };

/** 某天在一份校历里是第几周；校历没有这一天时为 null。 */
export function calendarWeekForDate(calendar: { weeks?: unknown } | null | undefined, date: string): number | null {
  const weeks = Array.isArray(calendar?.weeks) ? calendar!.weeks as CalendarWeekLike[] : [];
  for (const week of weeks) {
    if (Array.isArray(week?.days) && week.days.includes(date)) return Number(week.week) || null;
  }
  const mondays = weeks
    .filter((week) => typeof week?.monday === "string" && Number(week.week) > 0)
    .map((week) => ({ week: Number(week.week), monday: String(week.monday) }));
  return weekdayOf(date, mondays)?.week ?? null;
}

/** 没有校历时按「今天是第几周」往前后推。 */
export function estimateTeachingWeek(currentWeek: number, today: string, date: string): number | null {
  if (!(currentWeek > 0)) return null;
  const monday = agendaAddDays(today, 1 - agendaWeekday(today));
  const from = agendaDayNumber(monday);
  const to = agendaDayNumber(date);
  if (from === null || to === null) return null;
  const week = currentWeek + Math.floor((to - from) / 7);
  return week >= 1 ? week : null;
}

// ============ 某一天的课 ============

export interface ScheduleDayContext {
  /** 有校历时，不在校历里的日子按「不在教学周内」处理；没有校历时只能按当前周推算。 */
  hasCalendar: boolean;
  adjustments?: ReadonlyArray<{ date: string; kind: "off" | "swap"; source?: string; note?: string }>;
  weekOf: (date: string) => number | null;
  /** 某一周（合并了改课和单次停课/调课）的课表格子；尚未取到时为 null。week 为 null 表示周次未知。 */
  cellsForWeek: (week: number | null) => EditableScheduleCell[] | null;
  periods: ReadonlyArray<Period>;
}

export interface ResolvedScheduleDay {
  date: string;
  week: number | null;
  status: "ok" | "off" | "outOfTerm" | "unavailable";
  note: string | null;
  sourceDate?: string;
  sourceWeek?: number | null;
  courses: DescribedCourse[];
}

/** 这一天实际要上哪天的课：放假为 null，调休补课为来源日期。 */
export function scheduleSourceDate(date: string, ctx: Pick<ScheduleDayContext, "adjustments">) {
  const adjustment = adjustmentForDate(ctx.adjustments, date);
  if (adjustment?.kind === "off") return null;
  return adjustment?.kind === "swap" && adjustment.source ? adjustment.source : date;
}

/** 这些日子要用到的教学周（含调休补课的来源周）。 */
export function weeksNeededForDates(dates: readonly string[], ctx: Pick<ScheduleDayContext, "adjustments" | "weekOf">) {
  const weeks = new Set<number>();
  for (const date of dates) {
    const source = scheduleSourceDate(date, ctx);
    const week = source ? ctx.weekOf(source) : null;
    if (week) weeks.add(week);
  }
  return [...weeks].sort((a, b) => a - b);
}

export function resolveScheduleDay(date: string, ctx: ScheduleDayContext): ResolvedScheduleDay {
  const adjustment = adjustmentForDate(ctx.adjustments, date);
  const week = ctx.weekOf(date);
  if (adjustment?.kind === "off") {
    return { date, week, status: "off", note: (adjustment as { note?: string }).note || "放假停课", courses: [] };
  }
  const swap = adjustment?.kind === "swap" && adjustment.source ? adjustment.source : null;
  const sourceDate = swap ?? date;
  const sourceWeek = swap ? ctx.weekOf(swap) : week;
  const note = swap ? `调休：上 ${swap}（${WEEKDAY_NAMES[agendaWeekday(swap)] || ""}）的课` : null;
  const swapFields = swap ? { sourceDate: swap, sourceWeek } : {};
  if (sourceWeek === null && ctx.hasCalendar) {
    return { date, week, status: "outOfTerm", note: note ?? "不在本学期教学周内", courses: [], ...swapFields };
  }
  const cells = ctx.cellsForWeek(sourceWeek);
  if (!cells) {
    return { date, week, status: "unavailable", note: "这一周的课表暂未取到", courses: [], ...swapFields };
  }
  const dow = agendaWeekday(sourceDate);
  const courses = cells
    .filter((cell) => cell.day === dow)
    .flatMap((cell) => cell.courses
      .filter((course) => courseMatchesWeek(course, sourceWeek ?? 0))
      .map((course) => describeCourse(cell.bigSlot, course, ctx.periods)))
    .sort((a, b) => a.startSlot - b.startSlot || a.start.localeCompare(b.start));
  return { date, week, status: "ok", note, courses, ...swapFields };
}

// ============ 日程 ============

export async function loadUserAgendaItems(userId: number): Promise<AgendaItem[]> {
  const rows = await prisma.nextSyncRecord.findMany({
    where: { userId, collection: AGENDA_COLLECTION, deletedAt: null },
    orderBy: [{ clientUpdatedAt: "desc" }],
    take: AGENDA_MAX_ITEMS,
    select: { data: true },
  });
  const out: AgendaItem[] = [];
  for (const row of rows) {
    if (!row.data) continue;
    try {
      const item = normalizeAgendaItem(JSON.parse(row.data));
      if (item) out.push(item);
    } catch {
      // 跳过损坏的记录
    }
  }
  return out;
}

function agendaTimeText(item: Pick<AgendaItem, "start" | "end">) {
  if (!item.start) return "全天";
  return item.end ? `${item.start}-${item.end}` : item.start;
}

// ============ 课表 + 日程计划 ============

export interface TimetablePlanDay {
  date: string;
  weekday: string;
  resolved: ResolvedScheduleDay | null;
  agenda: AgendaOccurrence[];
}

export interface TimetablePlan {
  days: TimetablePlanDay[];
  conflicts: Array<{ date: string; agendaId: string; agendaTitle: string; agendaTime: string; courseName: string; courseTime: string }>;
  openTodos: AgendaItem[];
  today: string;
}

export function buildTimetablePlan(input: {
  dates: readonly string[];
  day: ScheduleDayContext | null;
  agenda: AgendaItem[];
  today: string;
}): TimetablePlan {
  const days = input.dates.map((date) => ({
    date,
    weekday: WEEKDAY_NAMES[agendaWeekday(date)] || "",
    resolved: input.day ? resolveScheduleDay(date, input.day) : null,
    agenda: agendaOn(input.agenda, date),
  }));
  const conflicts: TimetablePlan["conflicts"] = [];
  for (const day of days) {
    for (const occurrence of day.agenda) {
      if (occurrence.done || !occurrence.item.start) continue;
      const agendaRange = minutesRange(occurrence.item.start, occurrence.item.end);
      for (const course of day.resolved?.courses ?? []) {
        if (!course.start || !course.end) continue;
        if (!rangesOverlap(agendaRange, minutesRange(course.start, course.end))) continue;
        conflicts.push({
          date: day.date,
          agendaId: occurrence.item.id,
          agendaTitle: occurrence.item.title,
          agendaTime: agendaTimeText(occurrence.item),
          courseName: course.name,
          courseTime: `${course.start}-${course.end}`,
        });
      }
    }
  }
  return { days, conflicts, openTodos: agendaOpen(input.agenda, input.today), today: input.today };
}

export function formatTimetablePlan(plan: TimetablePlan, options: {
  legend: BigSlotInfo[];
  teacher: boolean;
  location: boolean;
  maxDays: number;
  todoLimit: number;
  conflictLimit: number;
}) {
  const shownDays = plan.days.slice(0, Math.max(1, options.maxDays));
  return {
    conflictsTotal: plan.conflicts.length,
    conflicts: plan.conflicts.slice(0, options.conflictLimit),
    openTodosTotal: plan.openTodos.length,
    openTodos: plan.openTodos.slice(0, options.todoLimit).map((item) => dropEmptyFields({
      id: item.id,
      title: item.title,
      date: item.date,
      overdue: agendaOverdue(item, plan.today) || undefined,
      location: options.location ? item.location : "",
      note: item.note.slice(0, 60),
    })),
    dailyPlan: shownDays.map((day) => {
      const resolved = day.resolved;
      const busy = new Set((resolved?.courses ?? []).flatMap((course) => course.bigSlots));
      const knowsCourses = resolved !== null && resolved.status !== "unavailable";
      return dropEmptyFields({
        date: day.date,
        weekday: day.weekday,
        week: resolved?.week ?? null,
        note: resolved?.note ?? null,
        courses: resolved
          ? resolved.courses.map((course) => dropEmptyFields({
            time: course.start && course.end ? `${course.start}-${course.end}` : "",
            periods: course.periods,
            name: course.name,
            location: options.location ? course.location : "",
            teacher: options.teacher ? course.teacher : "",
          }))
          : undefined,
        agenda: day.agenda.map((occurrence) => dropEmptyFields({
          id: occurrence.item.id,
          title: occurrence.item.title,
          time: agendaTimeText(occurrence.item),
          location: options.location ? occurrence.item.location : "",
          done: occurrence.done || undefined,
          repeat: occurrence.item.repeat === "none" ? "" : occurrence.item.repeat,
        })),
        // 引用上面 bigSlots 图例里的大节编号。
        freeBigSlots: knowsCourses ? options.legend.filter((slot) => !busy.has(slot.bigSlot)).map((slot) => slot.bigSlot) : undefined,
      });
    }),
    ...(shownDays.length < plan.days.length
      ? { omittedDays: plan.days.length - shownDays.length, omittedNote: "结果过长，后面的日子未列出，请缩小日期范围后再查" }
      : {}),
  };
}

function legendOf(slots: BigSlotInfo[]) {
  return slots.map((slot) => ({ bigSlot: slot.bigSlot, periods: slot.periods, time: slot.start && slot.end ? `${slot.start}-${slot.end}` : "" }));
}

// ============ 读取本人课表 ============

async function loadScheduleEdits(userId: number, semester: string): Promise<ScheduleEditState | null> {
  const row = await prisma.userScheduleEdit.findUnique({
    where: { userId_semester: { userId, semester: semester || "current" } },
    select: { payload: true },
  });
  if (!row?.payload) return null;
  try {
    return normalizeScheduleEditsState(JSON.parse(row.payload));
  } catch {
    return null;
  }
}

/** 合并自定义改课，再去掉单次停课、补上单次调课（顺序与各端一致）。 */
export function prepareScheduleCells(
  cells: EditableScheduleCell[],
  edits: ScheduleEditState | null,
  weeks: ReadonlyArray<{ week: number; monday: string }>,
) {
  const edited = edits ? applyScheduleEditsToCells(cells, edits) : cells;
  return edits?.occurrences?.length && weeks.length ? applyOccurrenceChanges(edited, edits.occurrences, weeks) : edited;
}

/** 课表 + 日程结果：冲突和待办在前，按预算依次去掉教师、地点，最后减少天数。 */
export function renderTimetableResult(plan: TimetablePlan, head: Record<string, unknown>, legend: BigSlotInfo[]) {
  const dayCount = plan.days.length;
  const variant = (teacher: boolean, location: boolean, maxDays: number, todoLimit: number) => () => ({
    ...head,
    bigSlots: legendOf(legend),
    ...formatTimetablePlan(plan, { legend, teacher, location, maxDays, todoLimit, conflictLimit: 15 }),
  });
  return fitToolResult([
    variant(true, true, dayCount, 15),
    variant(false, true, dayCount, 15),
    variant(false, false, dayCount, 8),
    ...Array.from({ length: Math.max(0, dayCount - 1) }, (_, index) => variant(false, false, dayCount - 1 - index, 5)),
  ]);
}

/**
 * 本人课表：教务按周给课（选了第几周只返回那一周的课），所以窗口跨到别的周时要另外读那一周。
 * 每一周都合并自定义改课和单次停课/调课。
 */
async function openScheduleSource(ctx: PersonalAgentToolContext, token: string) {
  let calendar: CalendarResult | null = null;
  let semester = "";
  let currentWeek = 0;
  let baseCells: EditableScheduleCell[] = [];
  let baseWeek: number | null = null;
  let semesterWide = false;

  try {
    const ug = await scheduleData.readSchedule(token, { week: "" });
    calendar = ug.calendar;
    semester = ug.parsed.currentSemester || calendar?.currentSemester || "";
    currentWeek = calendar?.currentWeek || Number(ug.parsed.currentWeek) || 0;
    baseCells = (ug.parsed.cells ?? []) as EditableScheduleCell[];
    const fetchedWeek = Number(ug.parsed.currentWeek) || 0;
    semesterWide = ug.parsed.scope === "semester" || fetchedWeek <= 0;
    baseWeek = semesterWide ? null : fetchedWeek;
  } catch (err) {
    if (jwxtAuthExpiredError(err)) throw err;
    // 研究生课表回退：研究生系统一次给整学期。
    try {
      const grad = await graduateScheduleData.read(token, {});
      semester = grad.parsed.currentSemester || "";
      currentWeek = Number(grad.parsed.currentWeek) || 0;
      baseCells = (grad.parsed.cells ?? []) as EditableScheduleCell[];
      semesterWide = true;
    } catch {
      throw err;
    }
  }

  const edits = await loadScheduleEdits(ctx.userId, semester);
  const calendarWeeks = calendar?.weeks ?? [];
  const prepare = (cells: EditableScheduleCell[]) => prepareScheduleCells(cells, edits, calendarWeeks);
  const preparedBase = prepare(baseCells);
  const extra = new Map<number, EditableScheduleCell[]>();
  const today = shanghaiNowParts(ctx.now).date;
  const hasCalendar = calendarWeeks.length > 0;
  const periods = schoolPeriods(ctx, calendar?.periods);

  const day: ScheduleDayContext = {
    hasCalendar,
    adjustments: calendar?.adjustments ?? [],
    weekOf: (date) => (hasCalendar ? calendarWeekForDate(calendar, date) : estimateTeachingWeek(currentWeek, today, date)),
    cellsForWeek: (week) => {
      if (semesterWide || week === null || week === baseWeek) return preparedBase;
      return extra.get(week) ?? null;
    },
    periods,
  };

  /** 读入这些周的课表；授权过期直接抛出，其余失败按周记下。 */
  async function loadWeeks(weeks: readonly number[]): Promise<Record<string, string>> {
    const errors: Record<string, string> = {};
    if (semesterWide) return errors;
    const missing = [...new Set(weeks)].filter((week) => week !== baseWeek && !extra.has(week));
    const toFetch = missing.slice(0, MAX_EXTRA_WEEK_FETCHES);
    const settled = await Promise.allSettled(toFetch.map((week) => scheduleData.readSchedule(token, { semester, week: String(week) })));
    settled.forEach((result, index) => {
      const week = toFetch[index];
      if (result.status === "fulfilled") {
        extra.set(week, prepare((result.value.parsed.cells ?? []) as EditableScheduleCell[]));
        return;
      }
      const expired = jwxtAuthExpiredError(result.reason);
      if (expired) throw expired;
      errors[`第${week}周`] = jwxtErrorMessage(result.reason);
    });
    for (const week of missing.slice(MAX_EXTRA_WEEK_FETCHES)) {
      errors[`第${week}周`] = `一次最多读取 ${MAX_EXTRA_WEEK_FETCHES + 1} 周课表，请缩小日期范围`;
    }
    return errors;
  }

  /** 第 week 教学周的周一。 */
  function mondayOfWeek(week: number): string | null {
    const found = calendarWeeks.find((item) => item.week === week);
    if (found) return found.monday || found.days?.[0] || null;
    if (hasCalendar || !(currentWeek > 0)) return null;
    return agendaAddDays(agendaAddDays(today, 1 - agendaWeekday(today)), (week - currentWeek) * 7) || null;
  }

  return { semester, currentWeek, periods, day, loadWeeks, mondayOfWeek };
}

// ============ 情侣 / 宿舍 共同空闲 ============

export interface CollabMemberTimetable {
  name: string;
  isMe: boolean;
  cells: EditableScheduleCell[];
  /** 这个人自己的教学周（各自校历不同）；不填则用统一的周次。 */
  week?: number;
}

export interface SharedFreeSlotsSummary {
  week: number;
  memberNames: string[];
  /** 每天全员均没课的大节列表 */
  allFreeByDay: Array<{
    day: number;
    weekday: string;
    freeBigSlots: Array<{ bigSlot: number; label: string }>;
  }>;
  /** 每天各时段谁有课的精简占用表 */
  busySlots: Array<{
    day: number;
    weekday: string;
    bigSlot: number;
    slotLabel: string;
    busyMembers: Array<{ member: string; courseName: string; location: string }>;
    freeMembers: string[];
  }>;
}

/**
 * 多人协同课表（情侣/宿舍）空闲时段交集与占用矩阵确定性算法。
 * 大节按本校作息（bigSlots）给出；没给作息时按课表里出现过的最大大节为准。
 */
export function computeSharedFreeSlots(
  members: CollabMemberTimetable[],
  week: number,
  bigSlots: BigSlotInfo[] = [],
): SharedFreeSlotsSummary {
  const memberNames = members.map((m) => m.name);
  const allFreeByDay: SharedFreeSlotsSummary["allFreeByDay"] = [];
  const busySlots: SharedFreeSlotsSummary["busySlots"] = [];

  // 每人每天每个大节上的第一门课。
  const occupancy = members.map((member) => {
    const memberWeek = member.week ?? week;
    const byKey = new Map<string, EditableScheduleCourse>();
    for (const cell of member.cells) {
      for (const course of cell.courses ?? []) {
        if (!courseMatchesWeek(course, memberWeek)) continue;
        for (const slot of describeCourse(cell.bigSlot, course, []).bigSlots) {
          const key = `${cell.day}:${slot}`;
          if (!byKey.has(key)) byKey.set(key, course);
        }
      }
    }
    return byKey;
  });
  const maxUsed = members.reduce((max, member) => member.cells.reduce((inner, cell) => (
    Math.max(inner, ...(cell.courses ?? []).flatMap((course) => describeCourse(cell.bigSlot, course, []).bigSlots), cell.bigSlot)
  ), max), 0);
  const slotCount = Math.max(bigSlots.length, maxUsed);
  const labelOf = (bigSlot: number) => bigSlots.find((slot) => slot.bigSlot === bigSlot)?.label || `第${bigSlot}大节`;

  for (let day = 1; day <= 7; day += 1) {
    const freeBigSlots: Array<{ bigSlot: number; label: string }> = [];
    for (let bigSlot = 1; bigSlot <= slotCount; bigSlot += 1) {
      const busyMembers: Array<{ member: string; courseName: string; location: string }> = [];
      const freeMembers: string[] = [];
      members.forEach((member, index) => {
        const course = occupancy[index].get(`${day}:${bigSlot}`);
        if (course) busyMembers.push({ member: member.name, courseName: course.name, location: course.location || "" });
        else freeMembers.push(member.name);
      });
      const label = labelOf(bigSlot);
      if (busyMembers.length === 0) {
        freeBigSlots.push({ bigSlot, label });
      } else {
        busySlots.push({
          day,
          weekday: WEEKDAY_NAMES[day] || `周${day}`,
          bigSlot,
          slotLabel: label,
          busyMembers,
          freeMembers,
        });
      }
    }
    allFreeByDay.push({ day, weekday: WEEKDAY_NAMES[day] || `周${day}`, freeBigSlots });
  }

  return { week, memberNames, allFreeByDay, busySlots };
}

/** 给模型看的精简版：level 越高越省字段。 */
export function compactSharedFreeSlots(summary: SharedFreeSlotsSummary, level: number) {
  return {
    memberNames: summary.memberNames,
    allFreeByDay: summary.allFreeByDay.map((day) => ({ weekday: day.weekday, freeBigSlots: day.freeBigSlots.map((slot) => slot.bigSlot) })),
    ...(level >= 2
      ? { busySlotsCount: summary.busySlots.length }
      : {
        busySlots: summary.busySlots.map((slot) => ({
          weekday: slot.weekday,
          bigSlot: slot.bigSlot,
          busy: slot.busyMembers.map((item) => (
            level === 0 && item.location ? `${item.member}:${item.courseName}@${item.location}` : `${item.member}:${item.courseName}`
          )),
        })),
      }),
  };
}

interface SnapshotLike {
  semester?: string;
  syncedAt?: string;
  schedule?: { cells?: EditableScheduleCell[] } | null;
  calendar?: { weeks?: unknown; periods?: CalendarResult["periods"] } | null;
}

interface CollabMemberInput {
  name: string;
  isMe: boolean;
  snapshot: SnapshotLike | null;
}

/**
 * 按参照日期在每个人自己的校历里找教学周，比对共同空闲。
 * 指定 week 时，参照日期取本人校历里那一周的周一；本人没有校历时所有人统一用这个周次。
 */
export function analyzeCollabGroup(input: {
  members: CollabMemberInput[];
  referenceDate: string;
  requestedWeek?: number;
  bigSlots: BigSlotInfo[];
}) {
  const me = input.members.find((member) => member.isMe) ?? null;
  let referenceDate = input.referenceDate;
  let forcedWeek: number | null = null;
  if (input.requestedWeek) {
    const weeks = Array.isArray(me?.snapshot?.calendar?.weeks) ? me!.snapshot!.calendar!.weeks as CalendarWeekLike[] : [];
    const found = weeks.find((week) => Number(week?.week) === input.requestedWeek);
    const monday = found && (typeof found.monday === "string" ? found.monday : Array.isArray(found.days) ? String(found.days[0] || "") : "");
    if (monday) referenceDate = monday;
    else forcedWeek = input.requestedWeek;
  }
  const referenceSemester = me?.snapshot?.semester || "";
  const synced: CollabMemberTimetable[] = [];
  const memberWeeks: Array<{ member: string; week: number | null; semester: string; syncedAt: string }> = [];
  const unsyncedMembers: string[] = [];
  const outOfTermMembers: string[] = [];
  const semesterMismatch: string[] = [];
  for (const member of input.members) {
    const cells = member.snapshot?.schedule?.cells;
    if (!member.snapshot || !Array.isArray(cells)) {
      unsyncedMembers.push(member.name);
      continue;
    }
    if (referenceSemester && member.snapshot.semester && member.snapshot.semester !== referenceSemester) {
      semesterMismatch.push(member.name);
    }
    const week = forcedWeek ?? calendarWeekForDate(member.snapshot.calendar, referenceDate);
    memberWeeks.push({ member: member.name, week, semester: member.snapshot.semester || "", syncedAt: member.snapshot.syncedAt || "" });
    if (!week) {
      outOfTermMembers.push(member.name);
      continue;
    }
    synced.push({ name: member.name, isMe: member.isMe, cells, week });
  }
  const summary = synced.length >= 2
    ? computeSharedFreeSlots(synced, synced.find((member) => member.isMe)?.week ?? synced[0].week ?? 1, input.bigSlots)
    : null;
  return {
    referenceDate,
    bigSlots: legendOf(input.bigSlots),
    memberWeeks,
    unsyncedMembers,
    ...(outOfTermMembers.length ? { outOfTermMembers, outOfTermNote: "这些人的课表快照里没有这一周（可能已放假或快照是旧学期的），未参与比对" } : {}),
    ...(semesterMismatch.length ? { semesterMismatch, semesterMismatchNote: "这些人同步的课表学期与本人不同，结果可能不准，请提醒对方重新同步课表" } : {}),
    summary,
  };
}

// ============ 空教室 ============

function periodRange(text: string): [number, number] | null {
  const match = String(text || "").match(/(\d+)(?:\s*-\s*(\d+))?/u);
  if (!match) return null;
  const a = Number.parseInt(match[1], 10);
  const b = Number.parseInt(match[2] || match[1], 10);
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** 某个空教室时段里本人有没有课：两边都有时间就按时间比，否则按节次比。 */
function slotOverlapsCourse(slot: FreeRoomSlot, course: DescribedCourse) {
  const slotTime = slot.start && slot.end ? minutesRange(slot.start, slot.end) : null;
  const courseTime = course.start && course.end ? minutesRange(course.start, course.end) : null;
  if (slotTime && courseTime) return rangesOverlap(slotTime, courseTime);
  const range = periodRange(slot.periods);
  return Boolean(range && Math.max(range[0], course.startSlot) <= Math.min(range[1], course.endSlot));
}

export function recommendFreeRooms(input: {
  slots: FreeRoomSlot[];
  rooms: FreeRoomRow[];
  myCourses: DescribedCourse[] | null;
  keyword?: string;
  limit: number;
}) {
  const keyword = String(input.keyword || "").trim().toLowerCase();
  const myFree = input.slots.map((slot) => (input.myCourses ? !input.myCourses.some((course) => slotOverlapsCourse(slot, course)) : null));
  const candidateSlots = myFree.map((free, index) => (free === false ? -1 : index)).filter((index) => index >= 0);
  const matching = keyword
    ? input.rooms.filter((room) => [room.name, room.building, room.type].some((value) => String(value || "").toLowerCase().includes(keyword)))
    : input.rooms;
  const ranked = matching
    .map((room) => {
      const free = candidateSlots.filter((index) => room.states[index] === "");
      let longest = 0;
      let run = 0;
      let runEnd = -1;
      let bestEnd = -1;
      for (const index of free) {
        run = index === runEnd + 1 ? run + 1 : 1;
        runEnd = index;
        if (run > longest) { longest = run; bestEnd = index; }
      }
      return { room, free, longest, longestFrom: bestEnd - longest + 1, longestTo: bestEnd };
    })
    .filter((item) => item.free.length > 0)
    .sort((a, b) => b.free.length - a.free.length || b.longest - a.longest || (b.room.seats ?? 0) - (a.room.seats ?? 0));
  return {
    slots: input.slots.map((slot, index) => dropEmptyFields({
      index,
      name: slot.name,
      time: slot.start && slot.end ? `${slot.start}-${slot.end}` : "",
      iAmFree: myFree[index] ?? undefined,
    })),
    myFreeSlotIndexes: input.myCourses ? candidateSlots : null,
    totalRooms: input.rooms.length,
    matchingRooms: matching.length,
    recommendedTotal: ranked.length,
    recommendedRooms: ranked.slice(0, input.limit).map((item) => dropEmptyFields({
      name: item.room.name,
      building: item.room.building || "",
      type: item.room.type || "",
      seats: item.room.seats,
      // 引用上面 slots 的 index。
      freeSlots: item.free,
      longestFree: item.longest > 1
        ? `${input.slots[item.longestFrom]?.name}至${input.slots[item.longestTo]?.name}`
        : input.slots[item.longestTo]?.name || "",
    })),
  };
}

// ============ 工具定义 ============

const myTimetableSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("起始日期 YYYY-MM-DD，默认今天"),
  days: z.number().int().min(1).max(14).optional().default(7).describe("连续查看天数（1-14，默认7天）"),
  week: z.number().int().min(1).max(30).optional().describe("可选：教学周次，按该周周一起查看（覆盖 startDate）"),
  includeCourses: z.boolean().optional().default(true).describe("是否读取教务课程表（默认是；只看个人日程待办时设为否）"),
});

const collabFreeSlotsSchema = z.object({
  target: z.enum(["auto", "couple", "dorm"]).optional().default("auto").describe("查询情侣课表(couple)、宿舍课表(dorm)或全部已绑定关系(auto)"),
  week: z.number().int().min(1).max(30).optional().describe("可选：本人校历的教学周次，默认今天所在周"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("可选：按这一天所在的教学周比对 YYYY-MM-DD，默认今天"),
});

const freeRoomsSmartSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("查询日期 YYYY-MM-DD，默认今天"),
  keyword: z.string().trim().max(30).optional().describe("可选：教室名、教学楼或教室类型关键词，如 江宁 / D / 多媒体"),
});

export const scheduleTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "schedule_my_timetable_and_agenda",
    scope: "schedule",
    label: () => "正在读取个人课表、调休安排与日程待办并检测冲突…",
    description: "读取本人指定日期窗口或教学周的完整课表（已合并调休、自定义改课和单次停课/调课）以及全平台同步的个人日程/待办（含 id，供修改/完成/删除引用），并检测日程与课程的时间冲突、列出每天没课的大节。",
    schema: myTimetableSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "schedule");
      if (blocked) return blocked;

      const nowInfo = shanghaiNowParts(ctx.now);
      const daysCount = args.days ?? 7;
      const agendaItems = await loadUserAgendaItems(ctx.userId);

      let source: Awaited<ReturnType<typeof openScheduleSource>> | null = null;
      let dates: string[] = [];
      let courseFetchNotice: string | null = null;
      let weekErrors: Record<string, string> = {};
      const datesFrom = (start: string) => Array.from({ length: daysCount }, (_, index) => agendaAddDays(start, index));

      if (args.includeCourses !== false) {
        const jwxtRes = await runWithJwxtSession(ctx, async (token) => {
          const opened = await openScheduleSource(ctx, token);
          let start = args.startDate || nowInfo.date;
          let notice: string | null = null;
          if (args.week) {
            const monday = opened.mondayOfWeek(args.week);
            if (monday) start = monday;
            else notice = `校历中没有第${args.week}周，已改为从 ${start} 开始查看`;
          }
          const windowDates = datesFrom(start);
          const errors = await opened.loadWeeks(weeksNeededForDates(windowDates, opened.day));
          return { opened, windowDates, errors, notice };
        });
        if (jwxtRes.ok) {
          source = jwxtRes.data.opened;
          dates = jwxtRes.data.windowDates;
          weekErrors = jwxtRes.data.errors;
          courseFetchNotice = jwxtRes.data.notice;
        } else {
          courseFetchNotice = jwxtRes.message;
        }
      }
      if (!dates.length) dates = datesFrom(args.startDate || nowInfo.date);

      const plan = buildTimetablePlan({ dates, day: source?.day ?? null, agenda: agendaItems, today: nowInfo.date });
      const usedBigSlots = plan.days.reduce((max, day) => Math.max(max, ...(day.resolved?.courses ?? []).flatMap((course) => course.bigSlots)), 0);
      const legend = bigSlotsFromPeriods(source?.periods ?? schoolPeriods(ctx), usedBigSlots);
      const head = {
        ok: true,
        now: nowInfo.isoMinute,
        semester: source?.semester || null,
        currentWeek: source?.currentWeek || null,
        ...(courseFetchNotice ? { courseFetchNotice } : {}),
        ...(Object.keys(weekErrors).length ? { weekFetchErrors: weekErrors } : {}),
      };
      return renderTimetableResult(plan, head, legend);
    },
  },
  {
    name: "schedule_collab_free_slots",
    scope: "collab",
    label: () => "正在比对情侣课表 / 宿舍室友课表的共同空闲时段…",
    description: "读取本人已绑定的情侣课表和/或宿舍课表快照，按每个人自己的校历确定教学周，由服务端计算每天全员共同没课的大节，以及各时段谁在上什么课。",
    schema: collabFreeSlotsSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "collab");
      if (blocked) return blocked;

      const referenceDate = args.date || shanghaiNowParts(ctx.now).date;
      const parts: Record<string, Record<string, unknown>> = {};
      let failures = 0;
      let attempted = 0;
      const failure = (label: string, err: unknown) => {
        failures += 1;
        return { ok: false, errorCode: "COLLAB_READ_FAILED", message: `${label}暂时读取失败：${err instanceof Error ? err.message : "未知错误"}` };
      };
      const analyze = (members: CollabMemberInput[]) => {
        const mine = members.find((member) => member.isMe)?.snapshot;
        const bigSlots = bigSlotsFromPeriods(schoolPeriods(ctx, mine?.calendar?.periods));
        return analyzeCollabGroup({ members, referenceDate, requestedWeek: args.week, bigSlots });
      };

      if (args.target === "auto" || args.target === "couple") {
        attempted += 1;
        try {
          const status = await getCoupleStatus(ctx.userId);
          if (status.status === "active") {
            const schedules = await getCoupleSchedules(ctx.userId);
            const partnerName = status.partner?.nickname || "另一半";
            parts.couple = {
              bound: true,
              partnerName,
              anniversary: status.anniversary || null,
              analysis: analyze([
                { name: "我", isMe: true, snapshot: schedules.me as SnapshotLike | null },
                { name: partnerName, isMe: false, snapshot: schedules.partner as SnapshotLike | null },
              ]),
            };
          } else {
            parts.couple = { bound: false, status: status.status };
          }
        } catch (err) {
          parts.couple = err instanceof HttpError && err.status === 404 ? { bound: false } : failure("情侣课表", err);
        }
      }

      if (args.target === "auto" || args.target === "dorm") {
        attempted += 1;
        try {
          const status = await getDormStatus(ctx.userId);
          if (status.status === "active") {
            const dormData = await getDormSchedules(ctx.userId);
            parts.dorm = {
              bound: true,
              dormName: status.name || "我的宿舍",
              totalMembers: dormData.members.length,
              analysis: analyze(dormData.members.map((member) => ({
                name: member.id === ctx.userId ? `我(${member.nickname || "本人"})` : (member.nickname || `室友#${member.id}`),
                isMe: member.id === ctx.userId,
                snapshot: member.snapshot as SnapshotLike | null,
              }))),
            };
          } else {
            parts.dorm = { bound: false };
          }
        } catch (err) {
          parts.dorm = err instanceof HttpError && err.status === 404 ? { bound: false } : failure("宿舍课表", err);
        }
      }

      if (attempted > 0 && failures === attempted) {
        return { ok: false, errorCode: "COLLAB_READ_FAILED", message: "情侣/宿舍课表暂时读取失败，请稍后再试", ...parts };
      }

      const render = (level: number) => {
        const out: Record<string, unknown> = { ok: true, referenceDate };
        for (const [key, part] of Object.entries(parts)) {
          const analysis = part.analysis as ReturnType<typeof analyzeCollabGroup> | undefined;
          if (!analysis) {
            out[key] = part;
            continue;
          }
          const { summary, ...rest } = analysis;
          out[key] = {
            ...part,
            analysis: {
              ...rest,
              shared: summary ? compactSharedFreeSlots(summary, level) : null,
              ...(summary ? {} : { sharedNote: "已同步课表且在教学周内的人不足两位，无法比对" }),
            },
          };
        }
        return out;
      };
      return fitToolResult([0, 1, 2].map((level) => () => render(level)));
    },
  },
  {
    name: "schedule_free_rooms_smart",
    scope: "schedule",
    label: (args) => `正在结合个人无课时段查询${args?.date || "今日"}空闲自习教室…`,
    description: "查询学校教务系统的空闲教室，并对照本人当天的课表（已合并调休和改课），推荐在本人没课的时段里空着、能连续自习的教室。",
    schema: freeRoomsSmartSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "schedule");
      if (blocked) return blocked;
      if (!schoolHasAcademicView(ctx, "freeRooms")) {
        return { ok: false, errorCode: "UNSUPPORTED", message: "本校教务系统暂不提供空教室查询。" };
      }
      const date = args.date || shanghaiNowParts(ctx.now).date;

      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const [roomsSettled, schedSettled] = await Promise.allSettled([
          withCache(
            "jwxt-records",
            ["source-v8", cacheId, "free-rooms", "_", date, "_", "_", "_", "_", "_"],
            FREE_ROOMS_TTL_MS,
            () => getRecords(token, { kind: "free-rooms", date }),
          ),
          (async () => {
            const opened = await openScheduleSource(ctx, token);
            const errors = await opened.loadWeeks(weeksNeededForDates([date], opened.day));
            return { day: resolveScheduleDay(date, opened.day), errors };
          })(),
        ]);
        const errors = inspectSettledParts({ rooms: roomsSettled, schedule: schedSettled });
        // 空教室是这个工具的核心：取不到就整体失败。
        if (roomsSettled.status === "rejected") throw roomsSettled.reason;
        const roomsValue = roomsSettled.value;
        if (!roomsValue || roomsValue.kind !== "free-rooms") throw new Error("学校教务暂时没有返回空教室数据");

        const mine = schedSettled.status === "fulfilled" ? schedSettled.value.day : null;
        const myCourses = mine && mine.status !== "unavailable" ? mine.courses : null;
        const scheduleNotes = {
          ...(errors.schedule ? { scheduleError: `${errors.schedule}（未能排除本人有课的时段）` } : {}),
          ...(schedSettled.status === "fulfilled" && Object.keys(schedSettled.value.errors).length ? { scheduleWeekErrors: schedSettled.value.errors } : {}),
          ...(mine?.note ? { myScheduleNote: mine.note } : {}),
        };
        return fitByListLimit((limit) => ({
          date,
          weekday: WEEKDAY_NAMES[agendaWeekday(date)] || "",
          teachingWeek: roomsValue.week,
          ...scheduleNotes,
          myCoursesOnDate: (myCourses ?? []).map((course) => dropEmptyFields({
            time: course.start && course.end ? `${course.start}-${course.end}` : "",
            periods: course.periods,
            name: course.name,
            location: course.location,
          })),
          ...recommendFreeRooms({ slots: roomsValue.slots, rooms: roomsValue.rooms, myCourses, keyword: args.keyword, limit }),
        }), [30, 20, 12, 6]);
      });
    },
  },
];
