import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/response";
import { getSchool } from "../../schools/registry";
import { completeSchoolPeriods } from "../../schools/periods";
import { adjustmentForDate } from "../../shared/scheduleAdjustments";
import {
  applyScheduleEditsToCells,
  normalizeScheduleEditsState,
  type EditableScheduleCell,
  type EditableScheduleCourse,
} from "../../shared/scheduleEdits";
import { withCache } from "../cache";
import { getCoupleSchedules, getCoupleStatus } from "../coupleSchedule";
import { getDormSchedules, getDormStatus } from "../dormSchedule";
import { graduateScheduleData } from "../graduateScheduleData";
import { getRecords } from "../jwxtTransport";
import { scheduleData } from "../scheduleData";
import { jwxtCacheId, runWithJwxtSession } from "./academicTools";
import {
  guardToolScope,
  shanghaiNowParts,
  type PersonalAgentToolContext,
  type PersonalAgentToolDefinition,
} from "./types";

const BIG_SLOT_LABELS: Record<number, string> = {
  1: "第1大节(上午1-2节)",
  2: "第2大节(上午3-5节)",
  3: "第3大节(下午6-7节)",
  4: "第4大节(下午8-9节)",
  5: "第5大节(晚上10-12节)",
};

const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const BIG_SLOT_DEFAULT_PERIOD_RANGE: Record<number, [number, number]> = {
  1: [1, 2],
  2: [3, 5],
  3: [6, 7],
  4: [8, 9],
  5: [10, 12],
};

export interface StoredAgendaRecord {
  id: string;
  kind: "event" | "todo";
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  note: string;
  remind: number;
  repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  until: string;
  done: boolean;
  doneDates: string[];
}

export async function loadUserAgendaItems(userId: number): Promise<StoredAgendaRecord[]> {
  const rows = await prisma.nextSyncRecord.findMany({
    where: { userId, collection: "agenda", deletedAt: null },
    orderBy: [{ clientUpdatedAt: "desc" }],
    take: 600,
    select: { id: true, data: true },
  });
  const out: StoredAgendaRecord[] = [];
  for (const row of rows) {
    if (!row.data) continue;
    try {
      const parsed = JSON.parse(row.data);
      if (!parsed || typeof parsed.title !== "string") continue;
      out.push({
        id: String(parsed.id || row.id),
        kind: parsed.kind === "todo" ? "todo" : "event",
        title: parsed.title,
        date: typeof parsed.date === "string" ? parsed.date : "",
        start: typeof parsed.start === "string" ? parsed.start : "",
        end: typeof parsed.end === "string" ? parsed.end : "",
        location: typeof parsed.location === "string" ? parsed.location : "",
        note: typeof parsed.note === "string" ? parsed.note : "",
        remind: typeof parsed.remind === "number" ? parsed.remind : -1,
        repeat: ["none", "daily", "weekdays", "weekly", "monthly"].includes(parsed.repeat) ? parsed.repeat : "none",
        until: typeof parsed.until === "string" ? parsed.until : "",
        done: Boolean(parsed.done),
        doneDates: Array.isArray(parsed.doneDates) ? parsed.doneDates.filter((d: unknown) => typeof d === "string") : [],
      });
    } catch {
      // skip invalid record
    }
  }
  return out;
}

function addDaysYmd(ymd: string, delta: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

function dayOfWeek1To7(ymd: string): number {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function agendaAppliesOnDate(item: StoredAgendaRecord, date: string): { applies: boolean; isDone: boolean } {
  if (!item.date) return { applies: false, isDone: item.done };
  if (item.until && date > item.until) return { applies: false, isDone: false };
  if (date < item.date) return { applies: false, isDone: false };
  if (item.repeat === "none") {
    return { applies: item.date === date, isDone: item.done || item.doneDates.includes(date) };
  }
  const done = item.doneDates.includes(date);
  if (item.repeat === "daily") return { applies: true, isDone: done };
  if (item.repeat === "weekdays") {
    const dow = dayOfWeek1To7(date);
    return { applies: dow >= 1 && dow <= 5, isDone: done };
  }
  if (item.repeat === "weekly") {
    return { applies: dayOfWeek1To7(date) === dayOfWeek1To7(item.date), isDone: done };
  }
  if (item.repeat === "monthly") {
    return { applies: date.slice(8, 10) === item.date.slice(8, 10), isDone: done };
  }
  return { applies: false, isDone: false };
}

function parseMinutes(hhmm?: string): number | null {
  if (!hhmm || !/^\d{2}:\d{2}$/u.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a0 = parseMinutes(startA);
  const a1 = parseMinutes(endA);
  const b0 = parseMinutes(startB);
  const b1 = parseMinutes(endB);
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return Math.max(a0, b0) < Math.min(a1, b1);
}

function resolveCourseTimeRange(
  bigSlot: number,
  course: EditableScheduleCourse,
  periods: Array<{ id: number; start: string; end: string }>,
): { start: string; end: string } {
  if (course.customStartTime && course.customEndTime) {
    return { start: course.customStartTime, end: course.customEndTime };
  }
  const fallback = BIG_SLOT_DEFAULT_PERIOD_RANGE[bigSlot] ?? [1, 2];
  const startId = course.startSlot ?? fallback[0];
  const endId = course.endSlot ?? fallback[1];
  const pStart = periods.find((p) => p.id === startId) ?? periods[startId - 1];
  const pEnd = periods.find((p) => p.id === endId) ?? periods[endId - 1];
  return {
    start: pStart?.start || "",
    end: pEnd?.end || "",
  };
}

export interface CollabMemberTimetable {
  name: string;
  isMe: boolean;
  cells: EditableScheduleCell[];
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
 */
export function computeSharedFreeSlots(
  members: CollabMemberTimetable[],
  week: number,
): SharedFreeSlotsSummary {
  const memberNames = members.map((m) => m.name);
  const allFreeByDay: SharedFreeSlotsSummary["allFreeByDay"] = [];
  const busySlots: SharedFreeSlotsSummary["busySlots"] = [];

  for (let day = 1; day <= 7; day += 1) {
    const freeBigSlots: Array<{ bigSlot: number; label: string }> = [];
    for (let bigSlot = 1; bigSlot <= 5; bigSlot += 1) {
      const busyMembers: Array<{ member: string; courseName: string; location: string }> = [];
      const freeMembers: string[] = [];
      for (const member of members) {
        const cell = member.cells.find((c) => c.day === day && c.bigSlot === bigSlot);
        const activeCourses = (cell?.courses ?? []).filter((course) => (
          !Array.isArray(course.weekList) || course.weekList.length === 0 || course.weekList.includes(week)
        ));
        if (activeCourses.length > 0) {
          const top = activeCourses[0];
          busyMembers.push({
            member: member.name,
            courseName: top.name,
            location: top.location || "",
          });
        } else {
          freeMembers.push(member.name);
        }
      }
      const label = BIG_SLOT_LABELS[bigSlot] || `第${bigSlot}大节`;
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
    allFreeByDay.push({
      day,
      weekday: WEEKDAY_NAMES[day] || `周${day}`,
      freeBigSlots,
    });
  }

  return {
    week,
    memberNames,
    allFreeByDay,
    busySlots,
  };
}

async function loadMergedUserSchedule(ctx: PersonalAgentToolContext, token: string, semesterArg = "") {
  let cells: EditableScheduleCell[] = [];
  let calendar: Awaited<ReturnType<typeof scheduleData.readSchedule>>["calendar"] = null;
  let currentSemester = semesterArg;
  let currentWeek = 0;

  try {
    const ug = await scheduleData.readSchedule(token, { semester: semesterArg, week: "" });
    calendar = ug.calendar;
    currentSemester = ug.parsed.currentSemester || calendar?.currentSemester || semesterArg;
    currentWeek = calendar?.currentWeek || Number(ug.parsed.currentWeek) || 0;
    cells = ug.parsed.cells as EditableScheduleCell[];
  } catch (err) {
    // 尝试研究生课表回退
    try {
      const grad = await graduateScheduleData.read(token, { semester: semesterArg });
      currentSemester = grad.parsed.currentSemester || semesterArg;
      currentWeek = Number(grad.parsed.currentWeek) || 0;
      cells = (grad.parsed.cells ?? []) as EditableScheduleCell[];
    } catch {
      throw err;
    }
  }

  if (currentSemester) {
    const savedEdit = await prisma.userScheduleEdit.findUnique({
      where: { userId_semester: { userId: ctx.userId, semester: currentSemester } },
      select: { payload: true },
    });
    if (savedEdit?.payload) {
      try {
        const editState = normalizeScheduleEditsState(JSON.parse(savedEdit.payload));
        cells = applyScheduleEditsToCells(cells, editState);
      } catch {
        // ignore invalid custom edit payload
      }
    }
  }

  const periods = completeSchoolPeriods(calendar?.periods, getSchool(ctx.schoolId).defaultPeriods);
  return {
    cells,
    calendar,
    currentSemester,
    currentWeek,
    periods,
  };
}

const myTimetableSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("起始日期 YYYY-MM-DD，默认今天"),
  days: z.number().int().min(1).max(14).optional().default(7).describe("连续查看天数（1-14，默认7天）"),
  week: z.number().int().min(1).max(30).optional().describe("可选：按指定教学周查看整周排课"),
  includeCourses: z.boolean().optional().default(true).describe("是否读取教务课程表（默认 true；仅看个人待办可设 false）"),
}).strict();

const collabFreeSlotsSchema = z.object({
  target: z.enum(["auto", "couple", "dorm"]).optional().default("auto").describe("查询情侣课表(couple)、宿舍课表(dorm)或全部已绑定关系(auto)"),
  week: z.number().int().min(1).max(30).optional().describe("指定教学周次，默认当前周"),
}).strict();

const freeRoomsSmartSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("查询日期 YYYY-MM-DD，默认今天"),
  keyword: z.string().trim().max(30).optional().describe("可选教学楼或校区筛选关键词，如 江宁 / 教学楼A / D / E"),
}).strict();

export const scheduleTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "schedule_my_timetable_and_agenda",
    scope: "schedule",
    label: () => "正在读取个人课表、调休安排与日程待办并检测冲突…",
    description: "读取本人指定日期窗口或教学周的完整课表（已合并调休与自定义改课）以及全平台同步的个人日程/待办（含 id，供修改/完成/删除引用），并自动检测时间冲突与空闲时段。",
    schema: myTimetableSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "schedule");
      if (blocked) return blocked;

      const nowInfo = shanghaiNowParts(ctx.now);
      const startDate = args.startDate || nowInfo.date;
      const daysCount = args.days ?? 7;
      const agendaItems = await loadUserAgendaItems(ctx.userId);

      const unscheduledTodos = agendaItems
        .filter((item) => !item.done && (!item.date || item.date < nowInfo.date && item.repeat === "none"))
        .slice(0, 40)
        .map((item) => ({
          id: item.id,
          title: item.title,
          dueDate: item.date || "",
          overdue: Boolean(item.date && item.date < nowInfo.date),
          location: item.location,
          note: item.note.slice(0, 120),
        }));

      let scheduleBundle: Awaited<ReturnType<typeof loadMergedUserSchedule>> | null = null;
      let jwxtNotice: string | null = null;

      if (args.includeCourses !== false) {
        const jwxtRes = await runWithJwxtSession(ctx, (token) => loadMergedUserSchedule(ctx, token));
        if (jwxtRes.ok) {
          scheduleBundle = jwxtRes.data;
        } else {
          jwxtNotice = jwxtRes.message;
        }
      }

      // 若指定了 week 且有校历，定位到该周的周一
      let effectiveStart = startDate;
      if (args.week && scheduleBundle?.calendar?.weeks?.length) {
        const matchedWeek = scheduleBundle.calendar.weeks.find((w) => w.week === args.week);
        if (matchedWeek?.monday) effectiveStart = matchedWeek.monday;
      }

      const dailyPlan: Array<{
        date: string;
        weekday: string;
        teachingWeek: number | null;
        holidayNote: string | null;
        courses: Array<{
          bigSlot: number;
          start: string;
          end: string;
          name: string;
          location: string;
          teacher: string;
        }>;
        agenda: Array<{
          id: string;
          title: string;
          start: string;
          end: string;
          location: string;
          done: boolean;
          repeat: string;
        }>;
        freeBigSlots: string[];
      }> = [];

      const conflicts: Array<{
        date: string;
        agendaId: string;
        agendaTitle: string;
        agendaTime: string;
        courseName: string;
        courseTime: string;
      }> = [];

      for (let i = 0; i < daysCount; i += 1) {
        const date = addDaysYmd(effectiveStart, i);
        const dow = dayOfWeek1To7(date);
        const weekday = WEEKDAY_NAMES[dow] || "";

        let weekNum: number | null = args.week ?? null;
        let effectiveSourceDow = dow;
        let holidayOff = false;
        let holidayNote: string | null = null;

        if (scheduleBundle?.calendar) {
          const cal = scheduleBundle.calendar;
          const adj = adjustmentForDate(cal.adjustments, date);
          if (adj?.kind === "off") {
            holidayOff = true;
            holidayNote = "法定节假日停课";
          } else if (adj?.kind === "swap" && adj.source) {
            effectiveSourceDow = dayOfWeek1To7(adj.source);
            const srcWeek = cal.weeks.find((w) => w.days.includes(adj.source!));
            if (srcWeek) weekNum = srcWeek.week;
            holidayNote = `调休补上 ${adj.source} 的课`;
          }
          if (weekNum === null) {
            weekNum = cal.weeks.find((w) => w.days.includes(date))?.week ?? (scheduleBundle.currentWeek || null);
          }
        } else if (scheduleBundle?.currentWeek && weekNum === null) {
          weekNum = scheduleBundle.currentWeek;
        }

        const dayCourses: Array<{
          bigSlot: number;
          start: string;
          end: string;
          name: string;
          location: string;
          teacher: string;
        }> = [];
        const occupiedBigSlots = new Set<number>();

        if (scheduleBundle && !holidayOff) {
          for (const cell of scheduleBundle.cells) {
            if (cell.day !== effectiveSourceDow) continue;
            for (const course of cell.courses) {
              const active = !weekNum
                || !Array.isArray(course.weekList)
                || course.weekList.length === 0
                || course.weekList.includes(weekNum);
              if (!active) continue;
              occupiedBigSlots.add(cell.bigSlot);
              const range = resolveCourseTimeRange(cell.bigSlot, course, scheduleBundle.periods);
              dayCourses.push({
                bigSlot: cell.bigSlot,
                start: range.start,
                end: range.end,
                name: course.name,
                location: course.location || "",
                teacher: course.teacher || "",
              });
            }
          }
          dayCourses.sort((a, b) => a.bigSlot - b.bigSlot || a.start.localeCompare(b.start));
        }

        const dayAgenda = agendaItems
          .map((item) => ({ item, match: agendaAppliesOnDate(item, date) }))
          .filter(({ match }) => match.applies)
          .map(({ item, match }) => ({
            id: item.id,
            title: item.title,
            start: item.start,
            end: item.end,
            location: item.location,
            done: match.isDone,
            repeat: item.repeat,
          }))
          .sort((a, b) => (a.start || "99:99").localeCompare(b.start || "99:99"));

        for (const ag of dayAgenda) {
          if (ag.done || !ag.start) continue;
          const agEnd = ag.end || ag.start;
          for (const c of dayCourses) {
            if (c.start && c.end && rangesOverlap(ag.start, agEnd === ag.start ? addOneMinute(ag.start) : agEnd, c.start, c.end)) {
              conflicts.push({
                date,
                agendaId: ag.id,
                agendaTitle: ag.title,
                agendaTime: ag.end ? `${ag.start}-${ag.end}` : ag.start,
                courseName: c.name,
                courseTime: `${c.start}-${c.end}`,
              });
            }
          }
        }

        const freeBigSlots: string[] = [];
        for (let slot = 1; slot <= 5; slot += 1) {
          if (!occupiedBigSlots.has(slot)) {
            freeBigSlots.push(BIG_SLOT_LABELS[slot] || `第${slot}大节`);
          }
        }

        dailyPlan.push({
          date,
          weekday,
          teachingWeek: weekNum,
          holidayNote,
          courses: dayCourses,
          agenda: dayAgenda,
          freeBigSlots,
        });
      }

      return {
        ok: true,
        now: nowInfo.isoMinute,
        currentSemester: scheduleBundle?.currentSemester || null,
        currentWeek: scheduleBundle?.currentWeek || null,
        ...(jwxtNotice ? { courseFetchNotice: jwxtNotice } : {}),
        dailyPlan,
        unscheduledOrOverdueTodos: unscheduledTodos,
        conflicts,
      };
    },
  },
  {
    name: "schedule_collab_free_slots",
    scope: "collab",
    label: () => "正在比对情侣课表 / 宿舍室友课表的共同空闲时段…",
    description: "读取本人已绑定的情侣课表和/或宿舍课表快照，由服务端精确计算指定周次每天全员共同没课的节次，以及各时段谁在上什么课。",
    schema: collabFreeSlotsSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "collab");
      if (blocked) return blocked;

      const result: Record<string, unknown> = { ok: true };

      if (args.target === "auto" || args.target === "couple") {
        try {
          const status = await getCoupleStatus(ctx.userId);
          if (status.status === "active") {
            const schedules = await getCoupleSchedules(ctx.userId);
            const partnerName = status.partner?.nickname || "另一半";
            const week = args.week
              || schedules.me?.calendar?.currentWeek
              || schedules.partner?.calendar?.currentWeek
              || 1;
            const members: CollabMemberTimetable[] = [];
            if (schedules.me?.schedule?.cells) {
              members.push({ name: "我", isMe: true, cells: schedules.me.schedule.cells });
            }
            if (schedules.partner?.schedule?.cells) {
              members.push({ name: partnerName, isMe: false, cells: schedules.partner.schedule.cells });
            }
            result.couple = {
              bound: true,
              partnerName,
              anniversary: status.anniversary || null,
              meSynced: Boolean(schedules.me),
              partnerSynced: Boolean(schedules.partner),
              analysis: members.length >= 2 ? computeSharedFreeSlots(members, week) : null,
            };
          } else {
            result.couple = { bound: false, status: status.status };
          }
        } catch (err) {
          if (!(err instanceof HttpError && err.status === 404)) {
            result.couple = { bound: false };
          }
        }
      }

      if (args.target === "auto" || args.target === "dorm") {
        try {
          const status = await getDormStatus(ctx.userId);
          if (status.status === "active") {
            const dormData = await getDormSchedules(ctx.userId);
            type DormMemberItem = (typeof dormData.members)[number];
            const firstCalWeek = dormData.members.find((m: DormMemberItem) => m.snapshot?.calendar?.currentWeek)?.snapshot?.calendar?.currentWeek;
            const week = args.week || firstCalWeek || 1;
            const syncedMembers: CollabMemberTimetable[] = dormData.members
              .filter((m: DormMemberItem) => Array.isArray(m.snapshot?.schedule?.cells))
              .map((m: DormMemberItem) => ({
                name: m.id === ctx.userId ? `我(${m.nickname || "本人"})` : (m.nickname || `室友#${m.id}`),
                isMe: m.id === ctx.userId,
                cells: m.snapshot!.schedule.cells,
              }));
            const unsyncedMembers = dormData.members
              .filter((m: DormMemberItem) => !Array.isArray(m.snapshot?.schedule?.cells))
              .map((m: DormMemberItem) => m.nickname || `室友#${m.id}`);
            result.dorm = {
              bound: true,
              dormName: status.name || "我的宿舍",
              totalMembers: dormData.members.length,
              syncedCount: syncedMembers.length,
              unsyncedMembers,
              analysis: syncedMembers.length >= 2 ? computeSharedFreeSlots(syncedMembers, week) : null,
            };
          } else {
            result.dorm = { bound: false };
          }
        } catch {
          result.dorm = { bound: false };
        }
      }

      return result;
    },
  },
  {
    name: "schedule_free_rooms_smart",
    scope: "schedule",
    label: (args) => `正在结合个人无课时段查询${args?.date || "今日"}空闲自习教室…`,
    description: "查询学校教务系统的空闲教室列表，并自动对照用户当天本人的无课大节，推荐适合连续自习的教室。",
    schema: freeRoomsSmartSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "schedule");
      if (blocked) return blocked;
      const date = args.date || shanghaiNowParts(ctx.now).date;
      const kw = String(args.keyword || "").trim().toLowerCase();

      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const [roomsSettled, schedSettled] = await Promise.allSettled([
          withCache(
            "jwxt-records",
            ["source-v8", cacheId, "free-rooms", "_", date, "_", "_", "_", "_", "_"],
            5 * 60_000,
            () => getRecords(token, { kind: "free-rooms", date }),
          ),
          loadMergedUserSchedule(ctx, token),
        ]);

        let myFreeSlots: string[] = [];
        let myBusyCourses: string[] = [];
        if (schedSettled.status === "fulfilled") {
          const sched = schedSettled.value;
          const dow = dayOfWeek1To7(date);
          const weekNum = sched.calendar?.weeks.find((w) => w.days.includes(date))?.week || sched.currentWeek || 0;
          const busySet = new Set<number>();
          for (const cell of sched.cells) {
            if (cell.day !== dow) continue;
            for (const c of cell.courses) {
              if (!weekNum || !c.weekList?.length || c.weekList.includes(weekNum)) {
                busySet.add(cell.bigSlot);
                myBusyCourses.push(`${BIG_SLOT_LABELS[cell.bigSlot] || `第${cell.bigSlot}大节`}: ${c.name}(${c.location || ""})`);
              }
            }
          }
          for (let s = 1; s <= 5; s += 1) {
            if (!busySet.has(s)) myFreeSlots.push(BIG_SLOT_LABELS[s] || `第${s}大节`);
          }
        }

        const rawRooms = roomsSettled.status === "fulfilled"
          ? JSON.parse(JSON.stringify(roomsSettled.value)) as Record<string, unknown>
          : null;
        const rows = Array.isArray(rawRooms?.rows) ? rawRooms.rows as Array<Record<string, unknown>> : [];
        const filtered = kw
          ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(kw))
          : rows;

        return {
          date,
          myFreeBigSlotsOnDate: myFreeSlots,
          myCoursesOnDate: myBusyCourses,
          totalMatchingRooms: filtered.length,
          roomsSample: filtered.slice(0, 35),
        };
      });
    },
  },
];

function addOneMinute(hhmm: string): string {
  const mins = parseMinutes(hhmm);
  if (mins === null) return hhmm;
  const next = Math.min(23 * 60 + 59, mins + 1);
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}
