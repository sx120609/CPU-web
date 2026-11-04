import { Errors } from "../../utils/response";
import type { JwxtRecordsArgs } from "../../services/jwxtRecords";
import {
  ZF_ROOM_SLOTS,
  mergeZfFreeRooms,
  parseZfCheckup,
  parseZfCreditStats,
  parseZfLevelExams,
  periodMask,
  type ZfProgressResult,
} from "./records";
import { njmuSchool } from "./profile";
import { jwJson, jwRequest, loadSession } from "./client";
import {
  parseZfCalendar,
  parseZfExams,
  parseZfGrades,
  parseZfPeriods,
  parseZfSchedule,
  semesterValue,
  zfTerm,
  ZF_LAST_TEACHING_PERIOD,
} from "./parser";

/** 南医教务的查询，返回值和药大那套（jwxtFacade）同形，路由和课表缓存层不用区分学校。 */

export { beginLogin, logout, submitLogin, pollMfa, refreshMfaQr, isNjmuToken } from "./client";

const PATHS = {
  calendar: "/jwglxt/xtgl/index_cxAreaFive.html",
  periods: "/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151",
  schedule: "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151",
  grades: "/jwglxt/cjcx/cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005",
  exams: "/jwglxt/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105",
  creditStats: "/jwglxt/cjcx/cjcx_cxXsxftj.html?gnmkdm=N305005",
  checkup: "/jwglxt/cjpmtj/cjpmtj_cxXsxytjdIndex.html?gnmkdm=N309175&layout=default",
  levelExams: "/jwglxt/kjgl/kjbm_cxXskjbm.html?doType=query&xmlbfl=1001&gnmkdm=N2510",
  freeRooms: "/jwglxt/cdjy/cdjy_cxKxcdlb.html?doType=query&gnmkdm=N2155",
};

/** 江宁校区；从学生课表里认不出校区时用它。 */
const DEFAULT_CAMPUS_ID = "2";

const listQuery = { _search: "false", "queryModel.showCount": "500", "queryModel.currentPage": "1", "queryModel.sortName": "", "queryModel.sortOrder": "asc", time: "0" };

function unsupported(): never {
  throw Errors.notFound("南医教务暂不支持这项查询");
}

export async function getStatus(token: string | undefined | null) {
  const session = await loadSession(token);
  return session ? { active: true, since: session.createdAt, username: session.username } : { active: false };
}

export async function sessionStats() {
  return { active: 0, pending: 0 };
}

async function currentCalendar(token: string) {
  const html = await jwRequest(token, PATHS.calendar, { localeKey: "zh_CN" });
  return parseZfCalendar(html);
}

async function currentSemester(token: string) {
  const calendar = await currentCalendar(token).catch(() => null);
  if (!calendar) throw Errors.badGateway("南医教务没有返回当前学期");
  return calendar.currentSemester;
}

async function periodsFor(token: string, semester: string) {
  const term = zfTerm(semester);
  const fallback = njmuSchool.defaultPeriods.map((item) => ({ id: item.no, name: item.name, start: item.start, end: item.end }));
  if (!term) return fallback;
  const raw = await jwJson<unknown>(token, PATHS.periods, { xnm: term.xnm, xqm: term.xqm, xqh_id: "" }).catch(() => null);
  const periods = parseZfPeriods(raw).filter((item) => item.id <= ZF_LAST_TEACHING_PERIOD);
  return periods.length ? periods : fallback;
}

export async function getCalendar(token: string, args: { semester?: string } = {}) {
  const calendar = await currentCalendar(token);
  if (!calendar) throw Errors.badGateway("南医教务暂未返回可用校历");
  const semester = String(args.semester ?? "").trim();
  // 正方只给当前学期的起止日期；别的学期由后台按学校配置的学期起始日补齐。
  if (semester && semester !== calendar.currentSemester) throw Errors.badGateway("南医教务只提供当前学期的校历");
  calendar.periods = await periodsFor(token, calendar.currentSemester);
  return { ...calendar, source: "modern" as const };
}

/** 学生入学年份到当前学期之间的所有学期，给学期下拉用。 */
function semestersSince(enrollYear: number, current: string) {
  const term = zfTerm(current);
  if (!term || !(enrollYear >= 2000)) return [];
  const out: string[] = [];
  for (let year = enrollYear; year <= Number(term.xnm); year++) {
    for (const no of [1, 2]) {
      const value = `${year}-${year + 1}-${no}`;
      if (value <= current) out.push(value);
    }
  }
  return out;
}

export async function getSchedule(token: string, args: { semester?: string; week?: string } = {}) {
  const requested = String(args.semester || "").trim();
  // 学期下拉要从入学一直列到当前学期，不管正在看哪个学期。
  const current = await currentSemester(token).catch(() => requested);
  const semester = requested || current;
  if (!semester) throw Errors.badGateway("南医教务没有返回当前学期");
  const term = zfTerm(semester);
  if (!term) throw Errors.badRequest("学期格式不正确");
  const raw = await jwJson<Record<string, unknown>>(token, PATHS.schedule, { xnm: term.xnm, xqm: term.xqm, kzlx: "ck" });
  const info = (raw.xsxx && typeof raw.xsxx === "object" ? raw.xsxx : {}) as Record<string, unknown>;
  const returned = semesterValue(info.XNM, info.XQM);
  if (returned && returned !== semester) throw Errors.badGateway("南医教务返回的课表学期与请求不一致");
  const enrollYear = Number(String(info.NJDM_ID ?? info.NJMC ?? "").slice(0, 4)) || Number(String(info.XH ?? "").slice(0, 4));
  const parsed = parseZfSchedule(raw, { semester, week: args.week, knownSemesters: semestersSince(enrollYear, current > semester ? current : semester) });
  return { ...parsed, source: "modern" as const };
}

export async function getGrades(token: string, args: { semester?: string } = {}) {
  const raw = await jwJson<unknown>(token, PATHS.grades, { xnm: "", xqm: "", ...listQuery });
  const parsed = parseZfGrades(raw);
  const semester = String(args.semester || "").trim();
  const list = semester ? parsed.list.filter((row) => row.semester === semester) : parsed.list;
  return { ...parsed, list, source: "modern" as const };
}

export async function getMidtermGrades(_token: string, _args: { semester?: string } = {}) {
  return { semesters: [], list: [], source: "modern" as const };
}

export async function getExams(token: string, args: { semester?: string; type?: string } = {}) {
  const semester = String(args.semester || "").trim() || await currentSemester(token);
  const term = zfTerm(semester);
  if (!term) throw Errors.badRequest("学期格式不正确");
  const raw = await jwJson<unknown>(token, PATHS.exams, { xnm: term.xnm, xqm: term.xqm, ksmcdmb_id: "", kch: "", kc: "", ksrq: "", ...listQuery });
  const parsed = parseZfExams(raw);
  const semesters = parsed.semesters.some((item) => item.value === semester)
    ? parsed.semesters
    : [{ value: semester, label: semester, current: true }, ...parsed.semesters];
  return { ...parsed, semesters, currentSemester: semester, source: "modern" as const };
}

/** 学业：按课程性质的通过学分，加上学业体检单里的绩点、四级、不及格课程和毕业／学位要求。 */
export async function getProgress(token: string): Promise<ZfProgressResult> {
  const [stats, checkupHtml] = await Promise.all([
    jwJson<unknown>(token, PATHS.creditStats, { xnm: "", xqm: "" }),
    jwRequest(token, PATHS.checkup).catch(() => ""),
  ]);
  const progress: ZfProgressResult = parseZfCreditStats(stats);
  const checkup = checkupHtml ? parseZfCheckup(checkupHtml) : null;
  if (checkup) progress.checkup = checkup;
  return progress;
}

/** 学生课表里最常出现的校区，空教室默认查这个校区。 */
async function campusOf(token: string, semester: string) {
  const term = zfTerm(semester);
  if (!term) return DEFAULT_CAMPUS_ID;
  const raw = await jwJson<Record<string, unknown>>(token, PATHS.schedule, { xnm: term.xnm, xqm: term.xqm, kzlx: "ck" }).catch(() => null);
  const counts = new Map<string, number>();
  for (const row of Array.isArray(raw?.kbList) ? raw!.kbList as Array<Record<string, unknown>> : []) {
    const id = String(row.xqh_id ?? "").trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_CAMPUS_ID;
}

async function loadFreeRooms(token: string, args: JwxtRecordsArgs) {
  const calendar = await currentCalendar(token);
  if (!calendar) throw Errors.badGateway("南医教务暂未返回本学期的教学周");
  const date = String(args.date || "").trim() || calendar.today;
  const week = calendar.weeks.find((item) => item.days.includes(date));
  if (!week) throw Errors.badRequest("所选日期不在本学期的教学周内");
  const day = week.days.indexOf(date) + 1;
  const semester = calendar.currentSemester;
  const term = zfTerm(semester)!;
  const [campus, periods] = await Promise.all([campusOf(token, semester), periodsFor(token, semester)]);
  const results = [];
  // 依次查，别对学校并发打一串请求。
  for (const slot of ZF_ROOM_SLOTS) {
    const rows = await jwJson<unknown>(token, PATHS.freeRooms, {
      fwzt: "cx",
      xqh_id: campus,
      xnm: term.xnm,
      xqm: term.xqm,
      cdlb_id: "",
      cdejlb_id: "",
      qszws: "",
      jszws: "",
      cdmc: "",
      lh: "",
      jyfs: "0",
      cdjylx: "",
      zcd: String(2 ** (week.week - 1)),
      xqj: String(day),
      jcd: String(periodMask(slot.from, slot.to)),
      ...listQuery,
      "queryModel.showCount": "1000",
      "queryModel.sortName": "cdbh",
    });
    results.push({ slot, rows });
  }
  const { slots, rooms } = mergeZfFreeRooms(results, periods);
  return { kind: "free-rooms" as const, semester, date, week: week.week, day, slots, rooms };
}

export async function getRecords(token: string, args: JwxtRecordsArgs) {
  if (args.kind === "level-exams") return parseZfLevelExams(await jwJson<unknown>(token, PATHS.levelExams, listQuery));
  if (args.kind === "free-rooms") return loadFreeRooms(token, args);
  return unsupported();
}

export const getPyfa = unsupported;
export const getIApps = unsupported;
export const getPortalNotices = unsupported;
export const getGraduateSchedule = unsupported;
export const debugSnapshot = unsupported;
