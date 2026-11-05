import { Errors } from "../../utils/response";
import type { JwxtRecordsArgs } from "../../services/jwxtRecords";
import { njucmSchool } from "./profile";
import { jwJson, jwRequest, loadSession } from "./client";
import {
  EAMS_ROOM_SLOTS,
  buildEamsCalendar,
  mergeEamsFreeRooms,
  parseEamsExams,
  parseEamsGrades,
  parseEamsLevelExams,
  parseEamsPeriods,
  parseEamsProgramCompletion,
  parseEamsSchedule,
  parseEamsSemesterSpan,
  parseEamsSemesters,
  semesterLabel,
  type EamsPeriod,
  type EamsSemester,
  type SemesterSpan,
} from "./parser";

/** 南中医教务的查询，返回值和药大那套（jwxtFacade）同形，路由和课表缓存层不用区分学校。 */

export { beginLogin, logout, submitLogin, isNjucmToken } from "./client";

const PATHS = {
  courseTable: "/student/for-std/course-table/info/{studentId}",
  printData: (semesterId: string) => `/student/for-std/course-table/semester/${semesterId}/print-data/{studentId}?hasExperiment=true`,
  semester: (semesterId: string) => `/student/ws/semester/get/${semesterId}`,
  grades: "/student/for-std/grade/sheet/info/{studentId}?semester=",
  exams: "/student/for-std/exam-arrange/info/{studentId}",
  levelExams: "/student/for-std/other-exam-signup/index/{studentId}?semeters=",
  programCompletion: "/student/for-std/program-completion-preview/json/{studentId}",
  freeRooms: "/student/ws/room-borrow/free-list",
};

function unsupported(): never {
  throw Errors.notFound("南中医教务暂不支持这项查询");
}

export async function getStatus(token: string | undefined | null) {
  const session = await loadSession(token);
  return session ? { active: true, since: session.createdAt, username: session.username } : { active: false };
}

export async function sessionStats() {
  return { active: 0, pending: 0 };
}

const SEMESTER_SPAN_TTL_MS = 6 * 60 * 60_000;
const spanCache = new Map<string, { span: SemesterSpan | null; expiresAt: number }>();

/** 学期起止日期全校一样，按编号缓存几小时。 */
async function semesterSpan(token: string, semester: EamsSemester): Promise<SemesterSpan | null> {
  const cached = spanCache.get(semester.id);
  if (cached && cached.expiresAt > Date.now()) return cached.span;
  const span = parseEamsSemesterSpan(await jwJson<unknown>(token, PATHS.semester(semester.id)).catch(() => null));
  spanCache.set(semester.id, { span, expiresAt: Date.now() + SEMESTER_SPAN_TTL_MS });
  return span;
}

type Context = {
  semesters: EamsSemester[];
  current: EamsSemester;
};

/** 课表页的学期下拉：全校所有学期和当前学期（selected）。 */
async function context(token: string): Promise<Context> {
  const { body } = await jwRequest(token, PATHS.courseTable);
  const semesters = parseEamsSemesters(body);
  const current = semesters.find((item) => item.selected) ?? semesters[0];
  if (!current) throw Errors.badGateway("南中医教务没有返回学期列表");
  return { semesters, current };
}

/** print-data 里学生的年级（入学年份）。 */
function gradeOf(printData: Record<string, unknown> | null) {
  const grade = Number(String((printData?.studentTableVm as Record<string, unknown> | undefined)?.grade ?? "").slice(0, 4));
  return grade >= 2000 ? grade : 0;
}

/** 入学以来到下一学期（下学期课表排出来就能看）的学期名，给学期下拉。 */
function visibleSemesters(ctx: Context, grade = 0) {
  const currentIndex = ctx.semesters.findIndex((item) => item.id === ctx.current.id);
  return ctx.semesters
    .filter((item, index) => index >= Math.max(0, currentIndex - 1))
    .map((item) => item.name)
    .filter((name) => !grade || Number(name.slice(0, 4)) >= grade);
}

function findSemester(ctx: Context, name: string) {
  const value = String(name || "").trim();
  if (!value) return ctx.current;
  const found = ctx.semesters.find((item) => item.name === value);
  if (!found) throw Errors.badRequest("学期格式不正确");
  return found;
}

async function loadPrintData(token: string, semester: EamsSemester) {
  return jwJson<Record<string, unknown>>(token, PATHS.printData(semester.id));
}

function defaultPeriods(): EamsPeriod[] {
  return njucmSchool.defaultPeriods.map((item) => ({ id: item.no, name: item.name, start: item.start, end: item.end }));
}

function periodsOf(printData: Record<string, unknown> | null): EamsPeriod[] {
  const periods = parseEamsPeriods((printData?.studentTableVm as Record<string, unknown> | undefined)?.timeTableLayout);
  return periods.length ? periods : defaultPeriods();
}

export async function getCalendar(token: string, args: { semester?: string } = {}) {
  const ctx = await context(token);
  const semester = findSemester(ctx, String(args.semester ?? ""));
  const span = await semesterSpan(token, semester);
  if (!span) throw Errors.badGateway("南中医教务暂未返回可用校历");
  const printData = await loadPrintData(token, semester).catch(() => null);
  return { ...buildEamsCalendar(span, { semesters: visibleSemesters(ctx, gradeOf(printData)), periods: periodsOf(printData) }), source: "modern" as const };
}

export async function getSchedule(token: string, args: { semester?: string; week?: string } = {}) {
  const ctx = await context(token);
  const semester = findSemester(ctx, String(args.semester || ""));
  const raw = await loadPrintData(token, semester);
  const parsed = parseEamsSchedule(raw, { semester: semester.name, week: args.week, knownSemesters: visibleSemesters(ctx, gradeOf(raw)) });
  return { ...parsed, source: "modern" as const };
}

export async function getGrades(token: string, args: { semester?: string } = {}) {
  const parsed = parseEamsGrades(await jwJson<unknown>(token, PATHS.grades));
  const semester = String(args.semester || "").trim();
  const list = semester ? parsed.list.filter((row) => row.semester === semester) : parsed.list;
  return { ...parsed, list, source: "modern" as const };
}

export async function getMidtermGrades(_token: string, _args: { semester?: string } = {}) {
  return { semesters: [], list: [], source: "modern" as const };
}

export async function getExams(token: string, args: { semester?: string; type?: string } = {}) {
  const ctx = await context(token);
  // 当前学期按真实起止归类（寒假前后的考试不会归错），其他学期按考试月份推算，不再逐个查学期起止。
  const [span, { body }] = await Promise.all([semesterSpan(token, ctx.current), jwRequest(token, PATHS.exams)]);
  const parsed = parseEamsExams(body, span ? [span] : []);
  const semester = String(args.semester || "").trim();
  const list = semester ? parsed.list.filter((row) => row.semester === semester) : parsed.list;
  const currentSemester = semester || ctx.current.name;
  const semesters = parsed.semesters.some((item) => item.value === currentSemester)
    ? parsed.semesters.map((item) => ({ ...item, current: item.value === currentSemester }))
    : [{ value: currentSemester, label: semesterLabel(currentSemester), current: true }, ...parsed.semesters.map((item) => ({ ...item, current: false }))];
  return { semesters, list, currentSemester, source: "modern" as const };
}

/** 学业：培养方案完成情况（各课程模块的要求学分、已修学分和课程清单）。 */
export async function getProgress(token: string) {
  return parseEamsProgramCompletion(await jwJson<unknown>(token, PATHS.programCompletion));
}

/** 学生课表里最常出现的校区，空教室默认查这个校区。 */
function campusOf(printData: Record<string, unknown> | null) {
  const vm = (printData?.studentTableVm ?? {}) as Record<string, unknown>;
  const counts = new Map<string, number>();
  for (const lesson of [...(Array.isArray(vm.lessonSearchVms) ? vm.lessonSearchVms : []), ...(Array.isArray(vm.arrangedLessonSearchVms) ? vm.arrangedLessonSearchVms : [])]) {
    const id = String((lesson as { campus?: { id?: unknown } })?.campus?.id ?? "").trim();
    if (/^\d+$/u.test(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_CAMPUS_ID;
}

/** 仙林校区；从学生课表里认不出校区时用它。 */
const DEFAULT_CAMPUS_ID = "5";

async function loadFreeRooms(token: string, args: JwxtRecordsArgs) {
  const ctx = await context(token);
  const span = await semesterSpan(token, ctx.current);
  if (!span) throw Errors.badGateway("南中医教务暂未返回本学期的教学周");
  const calendar = buildEamsCalendar(span, { semesters: [] });
  const date = String(args.date || "").trim() || calendar.today;
  const week = calendar.weeks.find((item) => item.days.includes(date));
  if (!week) throw Errors.badRequest("所选日期不在本学期的教学周内");
  const day = week.days.indexOf(date) + 1;
  const printData = await loadPrintData(token, ctx.current).catch(() => null);
  const periods = periodsOf(printData);
  const campusId = Number(campusOf(printData));
  const results = [];
  // 依次查，别对学校并发打一串请求。
  for (const slot of EAMS_ROOM_SLOTS) {
    const units = Array.from({ length: slot.to - slot.from + 1 }, (_, index) => slot.from + index);
    const rows = await jwJson<unknown>(token, PATHS.freeRooms, {
      json: {
        needMultimedia: 0,
        buildingId: "",
        campusId,
        roomId: "",
        dateTimeSegmentCmd: { startDateTime: date, endDateTime: date, startTime: "", endTime: "", weeks: [], weekdays: [], units },
        seatsForLessonGte: "",
      },
    });
    results.push({ slot, rows });
  }
  const { slots, rooms } = mergeEamsFreeRooms(results, periods);
  return { kind: "free-rooms" as const, semester: ctx.current.name, date, week: week.week, day, slots, rooms };
}

export async function getRecords(token: string, args: JwxtRecordsArgs) {
  if (args.kind === "level-exams") {
    const { body } = await jwRequest(token, PATHS.levelExams);
    return parseEamsLevelExams(body);
  }
  if (args.kind === "free-rooms") return loadFreeRooms(token, args);
  return unsupported();
}

export const getPyfa = unsupported;
export const getIApps = unsupported;
export const getPortalNotices = unsupported;
export const getGraduateSchedule = unsupported;
export const debugSnapshot = unsupported;
