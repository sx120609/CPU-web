/**
 * 教务（jwxt.cpu.edu.cn/jsxsd）里课表、成绩、考试之外的数据：
 * 等级考试、选课、教材、毕业审核、学籍、转专业、空教室、全校课表检索、成绩单。
 *
 * 每类数据只挑出要展示的字段；上游行里的学号、姓名、证件号、教工号和各种内部主键都不外传。
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import { Errors } from "../utils/response";
import type { EcertTranscriptLanguage, JwxtModernFile } from "./jwxtClient";
import type { SemesterOption } from "./jwxtParser";

export const JWXT_RECORD_KINDS = [
  "level-exams",
  "term-courses",
  "enrollment",
  "textbooks",
  "graduation-audit",
  "election-rounds",
  "student-status",
  "major-transfer",
  "retake-options",
  "grade-summary",
  "free-rooms",
  "timetable-search",
  "class-timetable",
  "transcript",
] as const;

export type JwxtRecordKind = typeof JWXT_RECORD_KINDS[number];

export const JWXT_TIMETABLE_SCOPES = ["teacher", "classroom", "course"] as const;
export type JwxtTimetableScope = typeof JWXT_TIMETABLE_SCOPES[number];

export const JWXT_TRANSCRIPT_VARIANTS = ["ecert-zh", "ecert-en", "jwxt"] as const;
export type JwxtTranscriptVariant = typeof JWXT_TRANSCRIPT_VARIANTS[number];

export const jwxtRecordsArgsSchema = z.object({
  kind: z.enum(JWXT_RECORD_KINDS),
  semester: z.string().max(16).optional(),
  date: z.string().max(16).optional(),
  scope: z.enum(JWXT_TIMETABLE_SCOPES).optional(),
  keyword: z.string().max(64).optional(),
  variant: z.enum(JWXT_TRANSCRIPT_VARIANTS).optional(),
  grade: z.string().max(8).optional(),
  major: z.string().max(64).optional(),
  classId: z.string().max(64).optional(),
});

export interface JwxtRecordsArgs {
  kind: JwxtRecordKind;
  semester?: string;
  /** 空教室：查询日期（YYYY-MM-DD，北京时间），缺省为今天。 */
  date?: string;
  /** 全校课表检索：按教师、教室还是课程查。 */
  scope?: JwxtTimetableScope;
  keyword?: string;
  /** 成绩单：电子证明平台的中文／英文预览件，或教务系统导出的版本。 */
  variant?: JwxtTranscriptVariant;
  /** 班级课表：入学年级、专业、班级，逐级选。 */
  grade?: string;
  major?: string;
  classId?: string;
}

export interface JwxtRecordsSource {
  get(path: string): Promise<string>;
  post(path: string, form: Record<string, string>): Promise<string>;
  pdf(path: string, form: Record<string, string>): Promise<JwxtModernFile>;
  ecertPdf(language: EcertTranscriptLanguage): Promise<JwxtModernFile>;
}

type Row = Record<string, unknown>;

const SEMESTER_PATTERN = /^\d{4}-\d{4}-[1-3]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LIST_PAGE_SIZE = 500;
const LIST_MAX_PAGES = 20;
const LIST_MAX_ROWS = 3000;
const RECENT_SEMESTER_LIMIT = 12;
const TIMETABLE_SEARCH_LIMIT = 200;
const TERM_START_CACHE_TTL_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const UNREADABLE = "学校教务暂时没有返回可识别的数据";

// ============ 通用 ============

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  const out = String(value).replace(/<br\s*\/?>/gi, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return out === "null" || out === "undefined" ? "" : out;
}

function optional(value: unknown) {
  return text(value) || undefined;
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 上游用 0 表示“还没有这项成绩”。 */
function positive(value: unknown) {
  const parsed = num(value);
  return parsed && parsed > 0 ? parsed : undefined;
}

function splitLines(value: unknown, separator: RegExp) {
  if (value === null || value === undefined) return [];
  return String(value).split(separator).map((part) => text(part));
}

/** 上课时间与地点按位置一一对应，重复的组合只留一条。 */
function pairSessions(times: string[], places: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  times.forEach((time, index) => {
    if (!time) return;
    const place = places[index] && places[index] !== "无" ? places[index] : "";
    const label = place ? `${time} · ${place}` : time;
    if (seen.has(label)) return;
    seen.add(label);
    out.push(label);
  });
  return out;
}

function stripStaffNo(value: unknown) {
  return text(value).replace(/\[[^\]]*\]/g, "").replace(/\s*,\s*/g, "、");
}

function parseJson(raw: string): unknown {
  const body = String(raw || "").trim();
  if (!body.startsWith("{") && !body.startsWith("[")) throw Errors.badGateway(UNREADABLE);
  try {
    return JSON.parse(body);
  } catch {
    throw Errors.badGateway(UNREADABLE);
  }
}

function parseEnvelope(raw: string) {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Errors.badGateway(UNREADABLE);
  const envelope = parsed as Row;
  if (!Array.isArray(envelope.data)) throw Errors.badGateway(UNREADABLE);
  const rows = envelope.data.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return { envelope, rows, count: num(envelope.count) };
}

function withQuery(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/** 列表接口的分页大小各不相同（有的固定 20 条，有的一次给全），按 count 翻到取完为止。 */
async function fetchList(source: JwxtRecordsSource, path: string, params: Record<string, string> = {}) {
  const rows: Row[] = [];
  let total = 0;
  let previousFirst = "";
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const current = parseEnvelope(await source.get(withQuery(path, {
      ...params,
      pageNum: String(page),
      pageSize: String(LIST_PAGE_SIZE),
    })));
    const first = current.rows.length ? JSON.stringify(current.rows[0]) : "";
    // 不认页码的接口每次都返回同一页。
    if (page > 1 && first && first === previousFirst) break;
    previousFirst = first;
    rows.push(...current.rows);
    total = Math.max(current.count ?? 0, rows.length);
    if (!current.rows.length || rows.length >= total || rows.length >= LIST_MAX_ROWS) break;
  }
  return { rows, total };
}

function selectOptions(html: string, name: string): SemesterOption[] {
  const $ = cheerio.load(html);
  const options = new Map<string, SemesterOption>();
  $(`select[name="${name}"] option, select#${name} option`).each((_, el) => {
    const value = text($(el).attr("value"));
    if (!value) return;
    const previous = options.get(value);
    const current = $(el).attr("selected") !== undefined;
    options.set(value, previous
      ? { ...previous, current: previous.current || current }
      : { value, label: text($(el).text()) || value, current });
  });
  return [...options.values()];
}

function inputValue(html: string, name: string) {
  const $ = cheerio.load(html);
  return text($(`input[name="${name}"]`).first().attr("value"));
}

function requestedSemester(args: JwxtRecordsArgs) {
  const semester = text(args.semester);
  if (!semester) return "";
  if (!SEMESTER_PATTERN.test(semester)) throw Errors.badRequest("学期格式不正确");
  return semester;
}

function pickSemester(args: JwxtRecordsArgs, semesters: SemesterOption[]) {
  return requestedSemester(args)
    || semesters.find((item) => item.current)?.value
    || semesters[0]?.value
    || "";
}

/** 教务的学期下拉会一直列到二十多年前，只保留当前学期起最近的几个。 */
function recentSemesters(semesters: SemesterOption[], selected: string) {
  const sorted = [...semesters].sort((a, b) => b.value.localeCompare(a.value));
  const start = Math.max(0, sorted.findIndex((item) => item.current));
  const recent = sorted.slice(start, start + RECENT_SEMESTER_LIMIT);
  if (selected && !recent.some((item) => item.value === selected)) {
    recent.push({ value: selected, label: selected, current: false });
  }
  return recent;
}

function sumCredits(list: Array<{ credits?: number }>) {
  return Math.round(list.reduce((sum, item) => sum + (item.credits ?? 0), 0) * 100) / 100;
}

// ============ 等级考试 ============

export interface LevelExamRow {
  name: string;
  subject?: string;
  level?: string;
  date?: string;
  endDate?: string;
  score?: number;
  written?: number;
  practical?: number;
  grade?: string;
  note?: string;
}

async function loadLevelExams(source: JwxtRecordsSource) {
  const { rows } = await fetchList(source, "/jsxsd/kscj/djkscj_list", { type: "listData" });
  const list = rows.flatMap((row): LevelExamRow[] => {
    const subject = text(row.skkcmc);
    const level = text(row.skdjmc);
    const name = text(row.skkcdjmc) || [subject, level].filter(Boolean).join(" ");
    if (!name) return [];
    return [{
      name,
      subject: subject || undefined,
      level: level || undefined,
      date: optional(row.kssj),
      endDate: optional(row.jssj),
      score: positive(row.fslcj),
      written: positive(row.fslbscj),
      practical: positive(row.fslsjcj),
      grade: optional(row.skcjdj) ?? optional(row.djlzcj),
      note: optional(row.bz),
    }];
  });
  list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { kind: "level-exams" as const, list };
}

// ============ 本学期课程（教学班） ============

export interface TermCourseRow {
  courseName: string;
  courseCode?: string;
  teacher?: string;
  className?: string;
  department?: string;
  campus?: string;
  group?: string;
  sessions: string[];
  credits?: number;
  hours?: number;
  weeklyHours?: number;
  hourBreakdown: Array<{ label: string; hours: number }>;
  enrolled?: number;
  capacity?: number;
  assessment?: string;
  nature?: string;
  category?: string;
}

async function loadTermCourses(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const page = await source.get("/jsxsd/xskb/xskb_list.do?viweType=1");
  const semesters = selectOptions(page, "xnxq01id");
  const semester = pickSemester(args, semesters);
  if (!semester) return { kind: "term-courses" as const, semester, semesters, list: [] as TermCourseRow[] };
  const hourLabels = inputValue(page, "xsflMapListJsonStr").split(",").map((label) => label.trim());
  const { rows } = await fetchList(source, "/jsxsd/xskb/xskb_list.do", {
    viweType: "1",
    needData: "1",
    xnxq01id: semester,
    zc: "",
  });
  const list = rows.flatMap((row): TermCourseRow[] => {
    const courseName = text(row.kc_mc ?? row.kcmc);
    if (!courseName) return [];
    const hourBreakdown = hourLabels.flatMap((label, index) => {
      const hours = positive(row[`xsfl${index}`]);
      return label && hours ? [{ label, hours }] : [];
    });
    return [{
      courseName,
      courseCode: optional(row.kch),
      teacher: stripStaffNo(row.jg0101mc) || undefined,
      className: optional(row.kt_mc),
      department: optional(row.kkyx),
      campus: optional(row.skxqmc),
      group: optional(row.fzmc),
      sessions: pairSessions(splitLines(row.sktime, /;/), splitLines(row.skddmc, /;/)),
      credits: num(row.xf),
      hours: num(row.zxs),
      weeklyHours: positive(row.zhouxs),
      hourBreakdown,
      enrolled: num(row.xkrs),
      capacity: num(row.pkrs),
      assessment: optional(row.khfs),
      nature: optional(row.kcxz),
      category: optional(row.kclb),
    }];
  });
  return { kind: "term-courses" as const, semester, semesters, list, credits: sumCredits(list) };
}

// ============ 选课与退课记录 ============

export interface EnrollmentRow {
  courseName: string;
  courseCode?: string;
  teacher?: string;
  className?: string;
  department?: string;
  sessions: string[];
  credits?: number;
  hours?: number;
  category?: string;
  nature?: string;
  status?: string;
  comment?: string;
}

export interface DroppedCourseRow {
  courseName: string;
  courseCode?: string;
  teacher?: string;
  time?: string;
  credits?: number;
  nature?: string;
  selectionType?: string;
  dropType?: string;
  droppedAt?: string;
  note?: string;
}

async function loadEnrollment(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const page = await source.get("/jsxsd/xkgl/loadXsxkjgList?lx=xkrz");
  const allSemesters = selectOptions(page, "xnxqid");
  const semester = pickSemester(args, allSemesters);
  const semesters = recentSemesters(allSemesters, semester);
  if (!semester) {
    return { kind: "enrollment" as const, semester, semesters, selected: [] as EnrollmentRow[], dropped: [] as DroppedCourseRow[] };
  }
  const selectedRows = await fetchList(source, "/jsxsd/xkgl/loadXsxkjgList", { lx: "xkrz", type: "list", xnxqid: semester });
  const droppedRows = await fetchList(source, "/jsxsd/xkgl/loadXsxkjgList", {
    lx: "tkrz",
    type: "list",
    cxsj: "tkjg",
    xnxqid: semester,
  });
  const selected = selectedRows.rows.flatMap((row): EnrollmentRow[] => {
    const courseName = text(row.kc_mc);
    if (!courseName) return [];
    return [{
      courseName,
      courseCode: optional(row.kch),
      teacher: stripStaffNo(row.xm) || undefined,
      className: optional(row.ktmc),
      department: optional(row.yx_mc),
      sessions: pairSessions(splitLines(row.sksj, /<br\s*\/?>/i), splitLines(row.skdd, /<br\s*\/?>/i)),
      credits: num(row.xf),
      hours: num(row.zxs),
      category: optional(row.kclb_mc),
      nature: optional(row.kcxz_mc),
      status: optional(row.shzt),
      comment: optional(row.yy),
    }];
  });
  const dropped = droppedRows.rows.flatMap((row): DroppedCourseRow[] => {
    const courseName = text(row.kc_mc);
    if (!courseName) return [];
    return [{
      courseName,
      courseCode: optional(row.kch),
      teacher: stripStaffNo(row.skls) || undefined,
      time: optional(row.sksj),
      credits: num(row.xf),
      nature: optional(row.kcsxmc),
      selectionType: optional(row.xfkl_mc),
      dropType: optional(row.tklx),
      droppedAt: optional(row.tksj),
      note: optional(row.tksm),
    }];
  });
  return { kind: "enrollment" as const, semester, semesters, selected, dropped, credits: sumCredits(selected) };
}

// ============ 教材 ============

export interface TextbookRow {
  title: string;
  isbn?: string;
  author?: string;
  publisher?: string;
  edition?: string;
  price?: number;
  courseName?: string;
  courseCode?: string;
  teacher?: string;
  department?: string;
  nature?: string;
}

async function loadTextbooks(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const page = await source.get("/jsxsd/nxsjc/jccx");
  const semesters = selectOptions(page, "xnxqid");
  const semester = pickSemester(args, semesters);
  if (!semester) return { kind: "textbooks" as const, semester, semesters, list: [] as TextbookRow[] };
  const { rows } = await fetchList(source, "/jsxsd/nxsjc/xsjcqr", { xnxqid: semester });
  const list = rows.flatMap((row): TextbookRow[] => {
    const title = text(row.jcmc);
    if (!title) return [];
    return [{
      title,
      isbn: optional(row.isbn),
      author: optional(row.jczz),
      publisher: optional(row.cbsmc),
      edition: optional(row.jcbc),
      price: positive(row.jcdj),
      courseName: optional(row.kcmc),
      courseCode: optional(row.kch),
      teacher: stripStaffNo(row.skjs) || undefined,
      department: optional(row.dwmc),
      nature: optional(row.kcxz) ?? optional(row.kcsx),
      // 源站的“征订状态”说的是这本教材学校有没有征订，不是学生本人订没订，容易误读，不外传。
    }];
  });
  return { kind: "textbooks" as const, semester, semesters, list };
}

// ============ 毕业审核课程清单 ============

export interface AuditCourseRow {
  semester?: string;
  courseName: string;
  courseCode?: string;
  system?: string;
  category?: string;
  nature?: string;
  credits?: number;
  hours?: number;
  score?: string;
}

const AUDIT_GROUPS = [
  { key: "earned", label: "应修已得学分", path: "/jsxsd/bygl/bygl_ckxsList_yxsd", type: "1" },
  { key: "unearned", label: "应修未得学分", path: "/jsxsd/bygl/bygl_ckxsList_yxwd", type: "2" },
  { key: "extra", label: "已修但不在计划内", path: "/jsxsd/bygl/bygl_ckxsList_yxjhn", type: "3" },
  { key: "remaining", label: "计划内尚未修读", path: "/jsxsd/bygl/bygl_ckxsList_yxjhw", type: "4" },
] as const;

async function loadGraduationAudit(source: JwxtRecordsSource) {
  const groups = [];
  for (const group of AUDIT_GROUPS) {
    const { rows } = await fetchList(source, group.path, { type: group.type, bs: "list" });
    const list = rows.flatMap((row): AuditCourseRow[] => {
      const courseName = text(row.kc_mc);
      if (!courseName) return [];
      return [{
        semester: optional(row.xqmc),
        courseName,
        courseCode: optional(row.kcbh),
        system: optional(row.kctx_mc),
        category: optional(row.kclbmc),
        nature: optional(row.kcxzmc),
        credits: num(row.xf),
        hours: num(row.zxs),
        score: optional(row.cjxs),
      }];
    });
    groups.push({ key: group.key, label: group.label, credits: sumCredits(list), list });
  }
  return { kind: "graduation-audit" as const, groups };
}

// ============ 选课安排 ============

export interface ElectionRoundRow {
  name: string;
  semester?: string;
  startsAt?: string;
  endsAt?: string;
  policy?: string;
}

async function loadElectionRounds(source: JwxtRecordsSource) {
  const { rows } = await fetchList(source, "/jsxsd/xsxk/xklc_list_data");
  const list = rows.flatMap((row): ElectionRoundRow[] => {
    const name = text(row.xklc_mc);
    if (!name) return [];
    return [{
      name,
      semester: optional(row.xqmc) ?? optional(row.xnxq01id),
      startsAt: optional(row.xkkssj),
      endsAt: optional(row.xkjzsj),
      policy: optional(row.txkzmc),
    }];
  });
  return { kind: "election-rounds" as const, list };
}

// ============ 学籍预警与异动 ============

export interface StatusWarningRow {
  semester?: string;
  name: string;
  reason?: string;
  target?: string;
  outcome?: string;
  result?: string;
}

export interface StatusChangeRow {
  type: string;
  from: string[];
  to: string[];
  review?: string;
}

async function loadStudentStatus(source: JwxtRecordsSource) {
  const warningRows = await fetchList(source, "/jsxsd/xsxj/xsyjxx_list.do");
  const changeRows = await fetchList(source, "/jsxsd/xsxj/xsydxx.do", { type: "list" });
  const warnings = warningRows.rows.flatMap((row): StatusWarningRow[] => {
    const name = text(row.yjmc);
    if (!name) return [];
    return [{
      semester: optional(row.xnxq01id),
      name,
      reason: optional(row.tjzdname),
      target: optional(row.jsdx),
      outcome: optional(row.yjjg),
      result: optional(row.dmmc),
    }];
  });
  const changes = changeRows.rows.flatMap((row): StatusChangeRow[] => {
    const type = text(row.ydlb);
    if (!type) return [];
    return [{
      type,
      from: [text(row.yxy), text(row.yzy), text(row.ybj), text(row.yxj)].filter(Boolean),
      to: [text(row.xxy), text(row.xzy), text(row.xbj), text(row.xxj)].filter(Boolean),
      review: optional(row.zszt),
    }];
  });
  return { kind: "student-status" as const, warnings, changes };
}

// ============ 转专业计划 ============

export interface MajorTransferRow {
  semester?: string;
  college?: string;
  major: string;
  grade?: string;
  quota?: number;
  applicants?: number;
  assessment?: string;
  condition?: string;
  excluded?: string;
  window?: string;
}

async function loadMajorTransfer(source: JwxtRecordsSource) {
  const { rows } = await fetchList(source, "/jsxsd/yxszzy/yxszzy_list");
  const list = rows.flatMap((row): MajorTransferRow[] => {
    const major = text(row.zymc);
    if (!major) return [];
    const window = text(row.sqsj);
    return [{
      semester: optional(row.xnxq),
      college: optional(row.dwmc),
      major,
      grade: optional(row.nj),
      quota: num(row.njsrs),
      applicants: num(row.ysqrs),
      assessment: optional(row.khfs),
      condition: optional(row.tj_ms),
      excluded: optional(row.xsbq),
      window: window && window !== "-" ? window : undefined,
    }];
  });
  list.sort((a, b) => (b.semester ?? "").localeCompare(a.semester ?? "")
    || (a.college ?? "").localeCompare(b.college ?? "", "zh-Hans-CN")
    || a.major.localeCompare(b.major, "zh-Hans-CN"));
  return { kind: "major-transfer" as const, list };
}

// ============ 重修报名可选课程 ============

export interface RetakeOptionRow {
  courseName: string;
  courseCode?: string;
  semester?: string;
  examType?: string;
  category?: string;
  nature?: string;
  credits?: number;
  hours?: number;
  bestScore?: string;
  /** 本学期是否开课。 */
  offered: boolean;
  qualified: boolean;
  registered: boolean;
  selected: boolean;
}

function isYes(value: unknown) {
  return /^(1|是|√|true)$/i.test(text(value));
}

async function loadRetakeOptions(source: JwxtRecordsSource) {
  const page = await source.get("/jsxsd/kscj/cxbmxk_query");
  const window = cheerio.load(page).root().text().match(/报名时间[:：]\s*([\d\- :]+~[\d\- :]+)/)?.[1]?.trim();
  const { rows } = await fetchList(source, "/jsxsd/kscj/cxbmxk_query1");
  const list = rows.flatMap((row): RetakeOptionRow[] => {
    const courseName = text(row.kcmc);
    if (!courseName) return [];
    return [{
      courseName,
      courseCode: optional(row.kch),
      semester: optional(row.xqmc),
      examType: optional(row.ksxzmc),
      category: optional(row.kclbmc),
      nature: optional(row.kcxzkcxz),
      credits: num(row.xf),
      hours: num(row.zxs),
      bestScore: optional(row.zhcj),
      offered: isYes(row.iskk),
      qualified: isYes(row.qdzg),
      registered: isYes(row.sfbm),
      selected: isYes(row.sfxk),
    }];
  });
  // 开课的排前面，其次按最好成绩从低到高，方便找到最该重修的课。
  list.sort((a, b) => Number(b.offered) - Number(a.offered)
    || (num(a.bestScore) ?? 999) - (num(b.bestScore) ?? 999)
    || a.courseName.localeCompare(b.courseName, "zh-Hans-CN"));
  return { kind: "retake-options" as const, window: window || undefined, list };
}

// ============ 学校统计的成绩汇总 ============

async function loadGradeSummary(source: JwxtRecordsSource) {
  const { envelope } = parseEnvelope(await source.get(withQuery("/jsxsd/kscj/cjcx_list", {
    pageNum: "1",
    pageSize: "1",
    kksj: "",
    kcxz: "",
    kcsx: "",
    kcmc: "",
    xsfs: "all",
    sfxsbcxq: "1",
  })));
  return {
    kind: "grade-summary" as const,
    averageScore: positive(envelope.pjcj),
    creditWeightedAverage: positive(envelope.pjxfj),
    gradePoint: positive(envelope.pjxfjd),
    totalCredits: positive(envelope.sxzxf),
    courseCount: positive(envelope.sxms),
    computedAt: optional(envelope.tjsj),
  };
}

// ============ 成绩单 ============

async function loadTranscript(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const variant = args.variant ?? "jwxt";
  const file = variant === "jwxt"
    ? await source.pdf("/jsxsd/kscj/printXscjk?xsfs=all&xnxq=", {})
    : await source.ecertPdf(variant === "ecert-en" ? "en" : "zh");
  return { kind: "transcript" as const, variant, file };
}

// ============ 空教室 ============

export type RoomSlotState = "" | "class" | "graduate" | "borrowed" | "rescheduled" | "busy";

export interface FreeRoomSlot {
  name: string;
  periods: string;
  start: string;
  end: string;
}

export interface FreeRoomRow {
  name: string;
  type?: string;
  seats?: number;
  examSeats?: number;
  states: RoomSlotState[];
}

const termStartCache = new Map<string, { monday: string; expiresAt: number }>();

export function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function dateToUtc(ymd: string) {
  const [year, month, day] = ymd.split("-").map((part) => Number.parseInt(part, 10));
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw Errors.badRequest("日期格式不正确");
  }
  return time;
}

async function termFirstMonday(source: JwxtRecordsSource, semester: string) {
  const cached = termStartCache.get(semester);
  if (cached && cached.expiresAt > Date.now()) return cached.monday;
  const parsed = parseJson(await source.get(withQuery("/jsxsd/kbxx/jsjy_rqAjax", {
    tt: semester,
    zc: "1",
    xq: "1",
    xnxqh: semester,
  })));
  const monday = text((parsed as Row | null)?.mxrq);
  if (!DATE_PATTERN.test(monday)) throw Errors.badGateway("学校教务暂时没有返回本学期的教学周安排");
  termStartCache.set(semester, { monday, expiresAt: Date.now() + TERM_START_CACHE_TTL_MS });
  return monday;
}

function roomSlotState(value: unknown): RoomSlotState {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw.trim()) return "";
  if (/y-icon/.test(raw)) return "graduate";
  if (/jieyong/.test(raw)) return "borrowed";
  if (/tiaoke/.test(raw)) return "rescheduled";
  if (/shangke/.test(raw)) return "class";
  return "busy";
}

function parseSeats(value: unknown) {
  const match = text(value).match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return {};
  return { seats: Number.parseInt(match[1], 10), examSeats: Number.parseInt(match[2], 10) };
}

async function loadFreeRooms(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const date = text(args.date) || shanghaiToday();
  if (!DATE_PATTERN.test(date)) throw Errors.badRequest("日期格式不正确");
  const page = await source.get("/jsxsd/kbxx/jsjy_query");
  const semester = pickSemester({ kind: "free-rooms" }, selectOptions(page, "xnxq"));
  const periodMode = selectOptions(page, "kbjcmsid")[0]?.value ?? "";
  if (!semester || !periodMode) throw Errors.badGateway("学校教务暂时没有开放教室使用情况查询");
  const campus = selectOptions(page, "xqbh")[0]?.value ?? "";
  const $ = cheerio.load(page);
  const periodCodes = $('input[name="jc"]').map((_, el) => text($(el).attr("value"))).get().filter((code) => /^\d{4}$/.test(code));
  const firstPeriod = periodCodes[0]?.slice(0, 2) ?? "01";
  const lastPeriod = periodCodes[periodCodes.length - 1]?.slice(2) ?? "16";

  const monday = await termFirstMonday(source, semester);
  const offset = Math.round((dateToUtc(date) - dateToUtc(monday)) / DAY_MS);
  const week = Math.floor(offset / 7) + 1;
  const day = ((offset % 7) + 7) % 7 + 1;
  if (week < 1 || week > 30) throw Errors.badRequest("所选日期不在本学期的教学周内");

  const parsed = parseJson(await source.post("/jsxsd/kbxx/jsjy_query2", {
    xnxq: semester,
    xnxqh: semester,
    jyms: "0",
    kbjcmsid: periodMode,
    xqbh: campus,
    typewhere: "jszq",
    zc: String(week),
    zc2: String(week),
    xq: String(day),
    xq2: String(day),
    jc: firstPeriod,
    jc2: lastPeriod,
    selectZc: String(week),
    selectXq: String(day),
    selectJc: "",
  }));
  if (!Array.isArray(parsed)) {
    throw Errors.badGateway(text((parsed as Row | null)?.msg) || UNREADABLE);
  }
  const slotRows = Array.isArray(parsed[0]) ? parsed[0] as Row[] : [];
  const roomRows = Array.isArray(parsed[4]) ? parsed[4] as unknown[][] : [];
  if (!slotRows.length) throw Errors.badGateway(UNREADABLE);

  const order = slotRows
    .map((slot, index) => ({ index, start: text(slot.kssj) }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.index - b.index)
    .map((item) => item.index);
  const slots: FreeRoomSlot[] = order.map((index) => {
    const slot = slotRows[index];
    const from = text(slot.jc1);
    const to = text(slot.jc3) || text(slot.jc2) || from;
    return {
      name: text(slot.djmc) || text(slot.djdymc) || `${from}-${to}`,
      periods: from === to ? from : `${from}-${to}`,
      start: text(slot.kssj),
      end: text(slot.jssj),
    };
  });
  const rooms = roomRows.flatMap((row): FreeRoomRow[] => {
    if (!Array.isArray(row) || row.length < slotRows.length + 1) return [];
    const name = text(row[0]);
    if (!name) return [];
    const raw = row.slice(1, 1 + slotRows.length);
    const tail = row.slice(1 + slotRows.length);
    return [{
      name,
      type: optional(tail[2]),
      ...parseSeats(tail[1]),
      states: order.map((index) => roomSlotState(raw[index])),
    }];
  });
  return { kind: "free-rooms" as const, semester, date, week, day, slots, rooms };
}

// ============ 全校课表检索 ============

export interface TimetableSearchRow {
  courseName: string;
  courseCode?: string;
  teacher?: string;
  teacherTitle?: string;
  room?: string;
  building?: string;
  weekday?: string;
  periods?: string;
  weeks?: string;
  weekType?: string;
  className?: string;
  department?: string;
  credits?: number;
  hours?: number;
  enrolled?: number;
  seats?: number;
  nature?: string;
  category?: string;
  assessment?: string;
}

const TIMETABLE_SOURCES: Record<JwxtTimetableScope, { page: string; list: string; param: string }> = {
  teacher: { page: "/jsxsd/kbcx/kbxx_teacher", list: "/jsxsd/kbcx/kbxx_teacher_ifr", param: "jsxx" },
  classroom: { page: "/jsxsd/kbcx/kbxx_classroom", list: "/jsxsd/kbcx/kbxx_classroom_ifr", param: "jsmc" },
  course: { page: "/jsxsd/kbcx/kbxx_kc", list: "/jsxsd/kbcx/kbxx_kc_ifr", param: "kcxx" },
};

const WEEKDAY_ORDER = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function firstNumber(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 99;
}

function timetableRow(row: Row): TimetableSearchRow[] {
  const courseName = text(row.kcmc);
  if (!courseName) return [];
  const weekType = text(row.sjbz);
  return [{
    courseName,
    courseCode: optional(row.kch),
    teacher: stripStaffNo(row.xm ?? row.jsxm) || undefined,
    teacherTitle: optional(row.jszc),
    room: optional(row.jsmc),
    building: optional(row.jzwmc),
    weekday: optional(row.zzdweek),
    periods: optional(row.jc),
    weeks: optional(row.kkzc),
    weekType: weekType && weekType !== "全部" ? weekType : undefined,
    className: optional(row.ktmc) ?? optional(row.bj),
    department: optional(row.kkdw),
    credits: num(row.xf),
    hours: num(row.zxs),
    enrolled: num(row.xkrs),
    seats: num(row.yxzws),
    nature: optional(row.zzdkcxz),
    category: optional(row.zzdkclb),
    assessment: optional(row.zzdksfs),
  }];
}

function sortTimetable(list: TimetableSearchRow[]) {
  return list.sort((a, b) => {
    const dayA = WEEKDAY_ORDER.indexOf(a.weekday ?? "");
    const dayB = WEEKDAY_ORDER.indexOf(b.weekday ?? "");
    return (dayA < 0 ? 9 : dayA) - (dayB < 0 ? 9 : dayB)
      || firstNumber(a.periods) - firstNumber(b.periods)
      || firstNumber(a.weeks) - firstNumber(b.weeks)
      || a.courseName.localeCompare(b.courseName, "zh-Hans-CN");
  });
}

// ============ 班级课表 ============

export interface ClassOption { value: string; label: string }

const GRADE_LIMIT = 8;
const OPTION_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

function optionRows(raw: string, value: string, label: string): ClassOption[] {
  const parsed = parseJson(raw);
  const data = (parsed as Row | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): ClassOption[] => {
    if (!item || typeof item !== "object") return [];
    const id = text((item as Row)[value]);
    const name = text((item as Row)[label]);
    return OPTION_ID_PATTERN.test(id) && name ? [{ value: id, label: name }] : [];
  });
}

/**
 * 逐级选班：只给年级时返回该年级的专业，给了专业再返回班级，给了班级才取整班课表。
 * 每一级的可选项都来自教务自己的下拉，班级编号不接受自由输入以外的字符。
 */
async function loadClassTimetable(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const grade = text(args.grade);
  const major = text(args.major);
  const classId = text(args.classId);
  if (grade && !/^\d{4}$/.test(grade)) throw Errors.badRequest("年级格式不正确");
  if (major && !OPTION_ID_PATTERN.test(major)) throw Errors.badRequest("专业编号不正确");
  if (classId && !OPTION_ID_PATTERN.test(classId)) throw Errors.badRequest("班级编号不正确");

  const page = await source.get("/jsxsd/kbcx/kbxx_xzb");
  const semesters = selectOptions(page, "xnxq01id");
  const semester = pickSemester(args, semesters);
  const periodMode = selectOptions(page, "kbjcmsid")[0]?.value ?? "";
  if (!semester) throw Errors.badGateway("学校教务暂时没有开放课表检索");
  const grades = selectOptions(page, "ksnd").slice(0, GRADE_LIMIT).map(({ value, label }) => ({ value, label: `${label} 级` }));

  const majors = grade
    ? optionRows(await source.get(withQuery("/jsxsd/comm/getZy", { xx0301id: "", ksnd: grade })), "jx01id", "zymc")
    : [];
  const classes = grade && major
    ? optionRows(await source.get(withQuery("/jsxsd/comm/getBj", { rxnf: grade, jx01id: major })), "xx04id", "bj")
    : [];

  let list: TimetableSearchRow[] = [];
  let className = "";
  if (classId) {
    const { rows } = await fetchList(source, "/jsxsd/kbcx/kbxx_xzb_ifr", {
      xnxq01id: semester,
      kbjcmsid: periodMode,
      skbj: classId,
    });
    list = sortTimetable(rows.flatMap(timetableRow));
    className = classes.find((item) => item.value === classId)?.label ?? list[0]?.className ?? "";
  }
  return {
    kind: "class-timetable" as const,
    semester,
    semesters,
    grades,
    grade,
    majors,
    major,
    classes,
    classId,
    className,
    list,
  };
}

async function loadTimetableSearch(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  const scope = args.scope ?? "course";
  const config = TIMETABLE_SOURCES[scope];
  if (!config) throw Errors.badRequest("不支持的课表检索范围");
  const keyword = text(args.keyword);
  if (keyword.length < 2) throw Errors.badRequest("请至少输入两个字再检索");
  if (keyword.length > 30) throw Errors.badRequest("检索关键词过长");

  const page = await source.get(config.page);
  const semesters = selectOptions(page, "xnxq01id");
  const semester = pickSemester(args, semesters);
  const periodMode = selectOptions(page, "kbjcmsid")[0]?.value ?? "";
  if (!semester) throw Errors.badGateway("学校教务暂时没有开放课表检索");

  const current = parseEnvelope(await source.get(withQuery(config.list, {
    xnxq01id: semester,
    kbjcmsid: periodMode,
    [config.param]: keyword,
    pageNum: "1",
    pageSize: String(TIMETABLE_SEARCH_LIMIT),
  })));
  const list = sortTimetable(current.rows.slice(0, TIMETABLE_SEARCH_LIMIT).flatMap(timetableRow));
  const total = Math.max(current.count ?? 0, list.length);
  return {
    kind: "timetable-search" as const,
    scope,
    keyword,
    semester,
    semesters,
    list,
    total,
    truncated: total > list.length,
  };
}

// ============ 入口 ============

export async function loadJwxtRecords(source: JwxtRecordsSource, args: JwxtRecordsArgs) {
  switch (args.kind) {
    case "level-exams": return loadLevelExams(source);
    case "term-courses": return loadTermCourses(source, args);
    case "enrollment": return loadEnrollment(source, args);
    case "textbooks": return loadTextbooks(source, args);
    case "graduation-audit": return loadGraduationAudit(source);
    case "election-rounds": return loadElectionRounds(source);
    case "student-status": return loadStudentStatus(source);
    case "major-transfer": return loadMajorTransfer(source);
    case "retake-options": return loadRetakeOptions(source);
    case "grade-summary": return loadGradeSummary(source);
    case "free-rooms": return loadFreeRooms(source, args);
    case "timetable-search": return loadTimetableSearch(source, args);
    case "class-timetable": return loadClassTimetable(source, args);
    case "transcript": return loadTranscript(source, args);
    default: throw Errors.badRequest("不支持的教务数据类型");
  }
}

export type JwxtRecordsResult = Awaited<ReturnType<typeof loadJwxtRecords>>;
