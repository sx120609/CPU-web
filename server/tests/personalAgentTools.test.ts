import assert from "node:assert/strict";
import test from "node:test";
import { getSchool } from "../src/schools/registry";
import { completeSchoolPeriods } from "../src/schools/periods";
import { normalizeAgendaItem, type AgendaItem } from "../src/shared/agenda";
import { courseEditKey, type EditableScheduleCell } from "../src/shared/scheduleEdits";
import { HttpError } from "../src/utils/response";
import {
  academicTools,
  buildGradesToolResult,
  compactRecordsResult,
  inspectSettledParts,
  runWithJwxtSession,
  schoolHasAcademicView,
  TOOL_RESULT_CHAR_BUDGET,
} from "../src/services/personalAgent/academicTools";
import {
  analyzeCollabGroup,
  bigSlotsFromPeriods,
  buildTimetablePlan,
  computeSharedFreeSlots,
  prepareScheduleCells,
  recommendFreeRooms,
  renderTimetableResult,
  resolveScheduleDay,
  weeksNeededForDates,
  type ScheduleDayContext,
} from "../src/services/personalAgent/scheduleTools";
import { defaultPersonalAgentPermissions } from "../src/services/personalAgent/store";
import { JwxtReauthRequiredError, type PersonalAgentToolContext } from "../src/services/personalAgent/types";

const cpuPeriods = completeSchoolPeriods(undefined, getSchool("cpu").defaultPeriods);
const authExpired = () => new HttpError(401, 4011, "教务登录已过期");

function makeCtx(overrides: Partial<PersonalAgentToolContext> = {}): PersonalAgentToolContext {
  return {
    userId: 7,
    username: "20240007",
    nickname: "阿药",
    studentSso: true,
    role: "user",
    schoolId: "cpu",
    forumAccessEnabled: true,
    permissions: { ...defaultPersonalAgentPermissions(), academic: true, schedule: true, collab: true },
    jwxtToken: "token",
    retriedAfterRecover: false,
    blockedScopes: new Set(),
    needsManualJwxtReauth: false,
    now: new Date("2026-11-26T04:00:00Z"),
    ...overrides,
  };
}

function calendarWeeks(firstMonday: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const monday = new Date(Date.parse(`${firstMonday}T00:00:00Z`) + index * 7 * 86_400_000);
    const days = Array.from({ length: 7 }, (_, day) => new Date(monday.getTime() + day * 86_400_000).toISOString().slice(0, 10));
    return { week: index + 1, monday: days[0], days, sunday: days[6] };
  });
}

function agenda(input: Record<string, unknown>): AgendaItem {
  const item = normalizeAgendaItem({ id: "abc123", title: "事项", ...input });
  assert.ok(item);
  return item;
}

// ============ 教务会话与并行读取 ============

test("inspectSettledParts rethrows an expired session, throws when everything failed, reports partial errors", async () => {
  const [expired, ok] = await Promise.allSettled([Promise.reject(authExpired()), Promise.resolve(1)]);
  assert.throws(() => inspectSettledParts({ exams: expired, midterm: ok }), (err: unknown) => err instanceof HttpError && err.code === 4011);

  const [down] = await Promise.allSettled([Promise.reject(new HttpError(502, 5022, "暂时连不上学校教务系统"))]);
  assert.throws(() => inspectSettledParts({ exams: down, midterm: null }), /连不上/u);

  const errors = inspectSettledParts({ exams: down, midterm: ok });
  assert.deepEqual(Object.keys(errors), ["exams"]);
});

test("runWithJwxtSession hands an expired session from parallel reads to silent recovery, then to the manual card", async () => {
  const action = async () => {
    const settled = await Promise.allSettled([Promise.reject(authExpired()), Promise.resolve([])]);
    inspectSettledParts({ a: settled[0], b: settled[1] });
    return "unreachable";
  };
  await assert.rejects(runWithJwxtSession(makeCtx(), action), (err: unknown) => err instanceof JwxtReauthRequiredError);

  const retried = makeCtx({ retriedAfterRecover: true });
  const result = await runWithJwxtSession(retried, action);
  assert.equal(result.ok, false);
  assert.equal(retried.needsManualJwxtReauth, true);
});

test("runWithJwxtSession does not attach the SSO reauth card for site-only accounts", async () => {
  const ctx = makeCtx({ studentSso: false, jwxtToken: null });
  const result = await runWithJwxtSession(ctx, async () => "x");
  assert.equal(result.ok, false);
  assert.equal(ctx.needsManualJwxtReauth, false);

  const expiredCtx = makeCtx({ studentSso: false });
  const expiredResult = await runWithJwxtSession(expiredCtx, async () => { throw authExpired(); });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredCtx.needsManualJwxtReauth, false);
});

test("exam lookup is gated on the school's academic views before touching the session", async () => {
  assert.equal(schoolHasAcademicView({ schoolId: "cpu" }, "exams"), false);
  assert.equal(schoolHasAcademicView({ schoolId: "njmu" }, "exams"), true);
  const tool = academicTools.find((item) => item.name === "academic_exams_and_midterm")!;
  // 没有教务会话也不该请求静默恢复：药大不提供考试安排，只问考试时直接说明。
  const result = await tool.execute({ includeMidterm: false }, makeCtx({ jwxtToken: null })) as { ok: boolean; errorCode: string };
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "UNSUPPORTED");
});

// ============ 成绩 ============

test("grade details use the transcript grade point and stay within budget", () => {
  const rows = [
    { semester: "2025-2026-1", courseCode: "C02", courseName: "高等数学", score: "52", credits: 3, gpa: 0.2, examType: "正常考试" },
    { semester: "2025-2026-1", courseCode: "C02", courseName: "高等数学", score: "78", credits: 3, gpa: 2.8, examType: "补考一" },
    ...Array.from({ length: 80 }, (_, index) => ({
      semester: "2025-2026-1",
      courseCode: `X${index}`,
      courseName: `专业选修课程第${index}门`,
      score: String(60 + (index % 40)),
      credits: 2,
      courseAttr: "专业选修",
      examType: "正常考试",
      usual: "90",
      usualWeight: "30%",
      final: "80",
      finalWeight: "70%",
    })),
  ];
  const result = buildGradesToolResult(rows, { semester: "2025-2026-1" });
  assert.ok(JSON.stringify(result).length <= TOOL_RESULT_CHAR_BUDGET);
  assert.equal(result.matchingCoursesTotal, 82);
  const makeup = result.matchingCourses!.find((row) => row.courseName === "高等数学" && row.makeup);
  assert.equal(makeup?.gpa, 1);
  assert.doesNotMatch(result.calculationNote, /学校电子成绩单口径/u);
});

test("records lookup caps long lists with totals", () => {
  const raw = {
    kind: "timetable-search",
    scope: "course",
    keyword: "药理",
    semester: "2025-2026-1",
    semesters: Array.from({ length: 12 }, (_, i) => ({ value: `s${i}`, label: `学期${i}`, current: i === 0 })),
    list: Array.from({ length: 200 }, (_, i) => ({
      courseName: `药理学${i}`, teacher: "张老师", room: "D101", building: "D", weekday: "星期一", periods: "01-02", weeks: "1-16", className: "药学2401", department: "药学院", credits: 3, hours: 48, nature: "必修", category: "专业课", assessment: "考试",
    })),
    total: 200,
    truncated: false,
  };
  const result = compactRecordsResult(raw) as Record<string, unknown>;
  assert.ok(JSON.stringify(result).length <= TOOL_RESULT_CHAR_BUDGET);
  assert.equal(result.listTotal, 200);
  assert.ok((result.list as unknown[]).length < 200);
  assert.equal((result.semesterOptions as unknown[]).length, 8);
});

// ============ 大节与周次 ============

test("big slots follow the school's own periods (2N-1, 2N) instead of fixed labels", () => {
  const cpu = bigSlotsFromPeriods(cpuPeriods);
  assert.equal(cpu.length, 6);
  assert.deepEqual(cpu[2], { bigSlot: 3, periods: "5-6", start: "13:30", end: "15:10", label: "第3大节(第5-6节 13:30-15:10)" });
  const njmu = bigSlotsFromPeriods(completeSchoolPeriods(undefined, getSchool("njmu").defaultPeriods));
  assert.equal(njmu.length, 8);
  assert.equal(njmu[7].periods, "15");
});

function dayContext(cellsByWeek: Map<number, EditableScheduleCell[]>, adjustments: ScheduleDayContext["adjustments"] = []): ScheduleDayContext {
  const weeks = calendarWeeks("2026-09-07", 18);
  return {
    hasCalendar: true,
    adjustments,
    weekOf: (date) => weeks.find((week) => week.days.includes(date))?.week ?? null,
    cellsForWeek: (week) => (week === null ? null : cellsByWeek.get(week) ?? null),
    periods: cpuPeriods,
  };
}

test("each date uses its own teaching week, swap days use the source week's timetable", () => {
  // 2026-11-23 是第 12 周周一，11-30 是第 13 周周一。
  const week12: EditableScheduleCell[] = [{ day: 1, bigSlot: 1, courses: [{ name: "药物化学", weeks: "1-12周", weekList: [], startSlot: 1, endSlot: 2 }] }];
  const week13: EditableScheduleCell[] = [{ day: 1, bigSlot: 3, courses: [{ name: "药剂学实验", weeks: "13-16周", weekList: [], startSlot: 5, endSlot: 6 }] }];
  const week11: EditableScheduleCell[] = [{ day: 3, bigSlot: 6, courses: [{ name: "晚间选修", weeks: "1-11周", weekList: [], startSlot: 11, endSlot: 12 }] }];
  const ctx = dayContext(new Map([[11, week11], [12, week12], [13, week13]]), [
    { date: "2026-11-28", kind: "swap", source: "2026-11-18" },
    { date: "2026-11-24", kind: "off" },
  ]);
  const dates = ["2026-11-23", "2026-11-24", "2026-11-28", "2026-11-30"];
  assert.deepEqual(weeksNeededForDates(dates, ctx), [11, 12, 13]);

  const monday12 = resolveScheduleDay("2026-11-23", ctx);
  assert.deepEqual(monday12.courses.map((c) => c.name), ["药物化学"]);
  assert.equal(monday12.courses[0].start, "08:00");
  assert.equal(monday12.courses[0].end, "09:40");

  const monday13 = resolveScheduleDay("2026-11-30", ctx);
  assert.equal(monday13.week, 13);
  assert.deepEqual(monday13.courses.map((c) => c.name), ["药剂学实验"]);
  assert.equal(monday13.courses[0].start, "13:30");

  assert.equal(resolveScheduleDay("2026-11-24", ctx).status, "off");

  const swap = resolveScheduleDay("2026-11-28", ctx);
  assert.equal(swap.sourceWeek, 11);
  assert.deepEqual(swap.courses.map((c) => c.name), ["晚间选修"]);
  assert.deepEqual(swap.courses[0].bigSlots, [6]);

  assert.equal(resolveScheduleDay("2027-03-01", ctx).status, "outOfTerm");
});

test("week text decides the course's weeks, and single cancelled meetings are removed", () => {
  const course = { name: "生物化学", weeks: "1-8周", weekList: [], teacher: "李老师", location: "B201", startSlot: 3, endSlot: 4 };
  const cells: EditableScheduleCell[] = [{ day: 2, bigSlot: 2, courses: [course] }];
  const weeks = calendarWeeks("2026-09-07", 18);
  const prepared = prepareScheduleCells(cells, {
    hidden: [],
    custom: [],
    occurrences: [{ key: courseEditKey(2, 2, course), date: "2026-09-15", cancelled: true }],
  }, weeks);
  const ctx = dayContext(new Map([[2, prepared], [3, prepared], [12, prepared]]));
  // 第 2 周周二那一次停课。
  assert.equal(resolveScheduleDay("2026-09-15", ctx).courses.length, 0);
  assert.equal(resolveScheduleDay("2026-09-22", ctx).courses.length, 1);
  // 「1-8周」的课不出现在第 12 周，即使 weekList 为空。
  assert.equal(resolveScheduleDay("2026-11-24", ctx).courses.length, 0);
});

// ============ 日程计划 ============

test("timetable plan detects conflicts, lists overdue untimed todos only, and stays within budget for 14 busy days", () => {
  const cells: EditableScheduleCell[] = [1, 2, 3, 4, 5].flatMap((day) => [1, 2, 3, 4].map((bigSlot) => ({
    day,
    bigSlot,
    courses: [{ name: `很长的课程名称用于测试体积第${day}${bigSlot}`, weeks: "1-16周", weekList: [], teacher: "某某某老师", location: "江宁校区教学楼D区201", startSlot: bigSlot * 2 - 1, endSlot: bigSlot * 2 }],
  })));
  const ctx = dayContext(new Map(Array.from({ length: 18 }, (_, i) => [i + 1, cells] as const)));
  const items = [
    agenda({ id: "meet01", title: "社团例会", date: "2026-11-23", start: "08:30", end: "09:00" }),
    agenda({ id: "past01", title: "上周的讲座", date: "2026-11-20", start: "19:00" }),
    agenda({ id: "todo01", title: "交实验报告", date: "2026-11-20" }),
    agenda({ id: "todo02", title: "买教材" }),
    ...Array.from({ length: 30 }, (_, i) => agenda({ id: `daily${String(i).padStart(2, "0")}`, title: `每日打卡事项${i}`, date: "2026-11-01", start: "21:00", end: "21:30", repeat: "daily", location: "宿舍" })),
  ];
  const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.parse("2026-11-23T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
  const plan = buildTimetablePlan({ dates, day: ctx, agenda: items, today: "2026-11-26" });
  assert.deepEqual(plan.conflicts.map((c) => `${c.agendaId}@${c.date}`), ["meet01@2026-11-23"]);
  assert.deepEqual(plan.openTodos.map((item) => item.id), ["todo01", "todo02"]);

  const result = renderTimetableResult(plan, { ok: true }, bigSlotsFromPeriods(cpuPeriods)) as Record<string, unknown>;
  assert.ok(JSON.stringify(result).length <= TOOL_RESULT_CHAR_BUDGET);
  assert.equal(result.conflictsTotal, 1);
  const first = (result.dailyPlan as Array<Record<string, unknown>>)[0];
  assert.deepEqual(first.freeBigSlots, [5, 6]);
});

// ============ 共同空闲 ============

test("shared free slots count every big slot of the school and each member's own week", () => {
  const bigSlots = bigSlotsFromPeriods(cpuPeriods);
  const summary = computeSharedFreeSlots([
    { name: "我", isMe: true, week: 12, cells: [{ day: 1, bigSlot: 6, courses: [{ name: "晚间选修", weeks: "1-16周", weekList: [], startSlot: 11, endSlot: 12 }] }] },
    { name: "TA", isMe: false, week: 3, cells: [{ day: 1, bigSlot: 1, courses: [{ name: "前八周的课", weeks: "1-8周", weekList: [] }] }] },
  ], 12, bigSlots);
  assert.deepEqual(summary.allFreeByDay[0].freeBigSlots.map((slot) => slot.bigSlot), [2, 3, 4, 5]);
});

test("collab analysis finds each member's week from their own calendar and flags stale semesters", () => {
  const mine = { semester: "2026-2027-1", syncedAt: "", calendar: { weeks: calendarWeeks("2026-09-07", 18), currentWeek: 1 }, schedule: { cells: [] } };
  // 对方三周前同步，快照里的 currentWeek 已过时；校历从 09-14 开学。
  const partner = { semester: "2026-2027-1", syncedAt: "", calendar: { weeks: calendarWeeks("2026-09-14", 18), currentWeek: 8 }, schedule: { cells: [] } };
  const old = { semester: "2025-2026-2", syncedAt: "", calendar: { weeks: calendarWeeks("2026-02-23", 18) }, schedule: { cells: [] } };
  const analysis = analyzeCollabGroup({
    members: [
      { name: "我", isMe: true, snapshot: mine },
      { name: "TA", isMe: false, snapshot: partner },
      { name: "室友", isMe: false, snapshot: old },
      { name: "没同步", isMe: false, snapshot: null },
    ],
    referenceDate: "2026-11-26",
    bigSlots: bigSlotsFromPeriods(cpuPeriods),
  });
  assert.deepEqual(analysis.memberWeeks.map((item) => [item.member, item.week]), [["我", 12], ["TA", 11], ["室友", null]]);
  assert.deepEqual(analysis.outOfTermMembers, ["室友"]);
  assert.deepEqual(analysis.semesterMismatch, ["室友"]);
  assert.deepEqual(analysis.unsyncedMembers, ["没同步"]);
  assert.equal(analysis.summary?.memberNames.length, 2);
});

// ============ 空教室 ============

test("free rooms recommend rooms that are empty while the user has no class", () => {
  const slots = [
    { name: "第一大节", periods: "1-2", start: "08:00", end: "09:40" },
    { name: "第二大节", periods: "3-4", start: "09:55", end: "11:35" },
    { name: "第三大节", periods: "5-6", start: "13:30", end: "15:10" },
  ];
  const rooms = [
    { name: "D101", seats: 120, states: ["", "", "class"] as Array<"" | "class">, building: "D" },
    { name: "D102", seats: 60, states: ["class", "", ""] as Array<"" | "class">, building: "D" },
    { name: "E201", seats: 80, states: ["", "class", "class"] as Array<"" | "class">, building: "E" },
  ];
  const myCourses = [{ bigSlot: 1, bigSlots: [1], startSlot: 1, endSlot: 2, periods: "1-2", start: "08:00", end: "09:40", name: "药物化学", location: "", teacher: "" }];
  const result = recommendFreeRooms({ slots, rooms, myCourses, limit: 10 });
  assert.deepEqual(result.myFreeSlotIndexes, [1, 2]);
  assert.deepEqual(result.recommendedRooms.map((room) => room.name), ["D102", "D101"]);
  assert.equal(result.recommendedRooms[0].longestFree, "第二大节至第三大节");

  const filtered = recommendFreeRooms({ slots, rooms, myCourses: null, keyword: "e", limit: 10 });
  assert.deepEqual(filtered.recommendedRooms.map((room) => room.name), ["E201"]);
});
