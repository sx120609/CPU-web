import type {
  CalendarResult,
  CalendarWeek,
  ExamRow,
  ExamsResult,
  GradeRow,
  GradesResult,
  ScheduleCell,
  ScheduleCourse,
  ScheduleResult,
  SemesterOption,
} from "../../services/jwxtParser";

/**
 * 正方教务（V9，南医 jwpt.njmu.edu.cn）的 JSON 接口转成站内统一的课表、成绩、考试、校历格式。
 * 学期在站内写作「2026-2027-1」；正方用学年起始年 xnm 和学期代码 xqm（3=第一学期，12=第二学期，16=第三学期）。
 */

/** 南医一天 15 节课。作息接口给到第 19 节，第 15 节以后只用来挂没排具体时间的学时（地点「未排地点」），课表只显示到第 15 节。 */
export const ZF_LAST_TEACHING_PERIOD = 15;

const TERM_CODES: Record<string, string> = { "1": "3", "2": "12", "3": "16" };
const TERM_NUMBERS: Record<string, string> = { "3": "1", "12": "2", "16": "3" };

export type ZfTerm = { xnm: string; xqm: string };

export function semesterValue(xnm: unknown, xqm: unknown) {
  const year = Number(xnm);
  const term = TERM_NUMBERS[String(xqm ?? "").trim()];
  if (!Number.isInteger(year) || year < 2000 || !term) return "";
  return `${year}-${year + 1}-${term}`;
}

export function semesterLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{4})-(\d)$/u);
  if (!match) return value;
  const names: Record<string, string> = { "1": "第一学期", "2": "第二学期", "3": "第三学期" };
  return `${match[1]}-${match[2]}学年${names[match[3]] ?? `第${match[3]}学期`}`;
}

/** 「2026-2027-1」→ { xnm: "2026", xqm: "3" }；格式不对时返回 null。 */
export function zfTerm(semester: string): ZfTerm | null {
  const match = String(semester || "").trim().match(/^(\d{4})-(\d{4})-(\d)$/u);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  const xqm = TERM_CODES[match[3]];
  return xqm ? { xnm: match[1], xqm } : null;
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/gu, " ").trim();
}

function numberOrUndefined(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function itemsOf(input: unknown): Record<string, unknown>[] {
  const list = input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)
    ? (input as { items: unknown[] }).items
    : [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

/**
 * 「1-2周」「3-4周,6周,11-12周,14周」「第7周」「4-6周(双)」「1-15周(单)」→ 周次数组。
 * 单双周标记只作用于它所在的那一段。
 */
export function parseZfWeeks(raw: string): number[] {
  const weeks = new Set<number>();
  for (const piece of String(raw || "").split(/[,，、]/u)) {
    const segment = piece.trim();
    if (!segment) continue;
    const parity = /\(单\)|（单）|单周/u.test(segment) ? 1 : /\(双\)|（双）|双周/u.test(segment) ? 0 : -1;
    const match = segment.replace(/^第/u, "").match(/^(\d+)(?:\s*-\s*(\d+))?/u);
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!start || end < start || end > 60) continue;
    for (let week = start; week <= end; week++) {
      if (parity === -1 || week % 2 === parity) weeks.add(week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

/** [1,2,3,6,11,12] → 「1-3周,6周,11-12周」 */
export function formatZfWeeks(weeks: number[]) {
  const parts: string[] = [];
  for (let i = 0; i < weeks.length; i++) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1] === weeks[j] + 1) j++;
    parts.push(i === j ? `${weeks[i]}周` : `${weeks[i]}-${weeks[j]}周`);
    i = j;
  }
  return parts.join(",");
}

function slotRange(raw: string) {
  const match = String(raw || "").match(/(\d+)\s*(?:-\s*(\d+))?/u);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return start >= 1 && end >= start && end <= 30 ? { start, end } : null;
}

function formatSlotNote(start: number, end: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

function weekOptions(maxWeek: number, current: number): SemesterOption[] {
  return Array.from({ length: maxWeek }, (_, index) => ({
    value: String(index + 1),
    label: `第${index + 1}周`,
    current: index + 1 === current,
  }));
}

export type ZfScheduleArgs = {
  /** 站内学期值；不传时用响应里学生信息给出的学年学期。 */
  semester?: string;
  week?: string;
  /** 已知的学期列表（来自成绩等），合并进下拉选项。 */
  knownSemesters?: string[];
};

/** kbcx/xskbcx_cxXsgrkb.html 的响应。正方一次返回整学期课程，每门课自带周次，所以结果按整学期给出。 */
export function parseZfSchedule(input: unknown, args: ZfScheduleArgs = {}): ScheduleResult {
  const data = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const info = (data.xsxx && typeof data.xsxx === "object" ? data.xsxx : {}) as Record<string, unknown>;
  const kbList = Array.isArray(data.kbList) ? data.kbList as Record<string, unknown>[] : null;
  const currentSemester = args.semester || semesterValue(info.XNM, info.XQM);
  // 同一门课同一时段同一地点，南医按带教老师或周次拆成多条（PBL 一个时段能有九条），合成一门：周次取并集，老师合并。
  const merged = new Map<string, { day: number; range: { start: number; end: number }; course: ScheduleCourse; weeks: Set<number>; teachers: string[] }>();
  let maxWeek = 0;
  for (const row of kbList ?? []) {
    const name = text(row.kcmc);
    const day = Number(text(row.xqj));
    const range = slotRange(text(row.jcs) || text(row.jc));
    if (!name || !(day >= 1 && day <= 7) || !range) continue;
    // 第 15 节以后不是真在那时上课，是挂在深夜占位的未排时间学时。
    if (range.start > ZF_LAST_TEACHING_PERIOD) continue;
    const weekList = parseZfWeeks(text(row.zcd));
    maxWeek = Math.max(maxWeek, ...weekList);
    const location = text(row.cdmc) || undefined;
    const key = [name, day, range.start, range.end, location ?? ""].join("|");
    const entry = merged.get(key) ?? {
      day,
      range,
      course: {
        name,
        weeks: "",
        weekList: [],
        location,
        slotNote: formatSlotNote(range.start, range.end),
        startSlot: range.start,
        endSlot: range.end,
      } as ScheduleCourse,
      weeks: new Set<number>(),
      teachers: [],
    };
    for (const week of weekList) entry.weeks.add(week);
    const teacher = text(row.xm);
    if (teacher && !entry.teachers.includes(teacher)) entry.teachers.push(teacher);
    const sourceKey = text(row.jxb_id) || text(row.jxbmc);
    if (sourceKey && !entry.course.sourceKey) entry.course.sourceKey = sourceKey;
    merged.set(key, entry);
  }
  const byCell = new Map<string, ScheduleCell>();
  for (const { day, range, course, weeks, teachers } of merged.values()) {
    course.weekList = [...weeks].sort((a, b) => a - b);
    course.weeks = formatZfWeeks(course.weekList);
    if (teachers.length) course.teacher = teachers.length > 3 ? `${teachers.slice(0, 3).join("、")}等${teachers.length}人` : teachers.join("、");
    const bigSlot = Math.max(1, Math.ceil(range.start / 2));
    const cellKey = `${day}:${bigSlot}`;
    const cell = byCell.get(cellKey) ?? { day, bigSlot, courses: [] };
    cell.courses.push(course);
    byCell.set(cellKey, cell);
  }
  const cells = [...byCell.values()].sort((a, b) => a.day - b.day || a.bigSlot - b.bigSlot);
  const requestedWeek = Number(args.week) || 0;
  const semesters = [...new Set([currentSemester, ...(args.knownSemesters ?? [])].filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({ value, label: semesterLabel(value), current: value === currentSemester }));
  return {
    title: `${semesterLabel(currentSemester)}课表`,
    pageRecognized: kbList !== null,
    scope: "semester",
    semesters,
    currentSemester,
    weeks: weekOptions(Math.max(maxWeek, requestedWeek, 20), requestedWeek),
    currentWeek: requestedWeek ? String(requestedWeek) : "",
    cells,
  };
}

/** sjkList：没有排到具体时间的实践课、网课。 */
export function parseZfUnscheduledCourses(input: unknown) {
  const data = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const list = Array.isArray(data.sjkList) ? data.sjkList as Record<string, unknown>[] : [];
  return list.flatMap((row) => {
    const name = text(row.kcmc);
    if (!name) return [];
    return [{ name, weeks: text(row.qsjsz), note: text(row.sjkcgs), credits: numberOrUndefined(row.xf) }];
  });
}

const GRADE_WORDS: Record<string, number> = { 优秀: 95, 良好: 85, 中等: 75, 及格: 65, 合格: 75, 不及格: 0, 不合格: 0 };

/** cjcx/cjcx_cxDgXscj.html?doType=query 的响应。 */
export function parseZfGrades(input: unknown): GradesResult {
  const list = itemsOf(input).flatMap((row): GradeRow[] => {
    const courseName = text(row.kcmc);
    if (!courseName) return [];
    const score = text(row.cj);
    const numeric = numberOrUndefined(score);
    const percent = numberOrUndefined(row.bfzcj);
    const word = GRADE_WORDS[score];
    const grade: GradeRow = {
      semester: semesterValue(row.xnm, row.xqm),
      courseCode: text(row.kch) || undefined,
      courseName,
      score,
      scoreNum: numeric ?? percent ?? (word === undefined ? null : word),
      credits: numberOrUndefined(row.xf),
      gpa: numberOrUndefined(row.jd),
      courseAttr: text(row.kcxzmc) || text(row.kclbmc) || undefined,
      examType: text(row.ksxz) || undefined,
    };
    const remark = [text(row.kcbj), text(row.khfsmc)].filter(Boolean).join(" · ");
    if (remark) grade.remark = remark;
    return [grade];
  });
  return { semesters: semesterOptions(list.map((row) => row.semester)), list };
}

/** kwgl/kscx_cxXsksxxIndex.html?doType=query 的响应。 */
export function parseZfExams(input: unknown): ExamsResult {
  const list = itemsOf(input).flatMap((row): ExamRow[] => {
    const courseName = text(row.kcmc);
    if (!courseName) return [];
    const room = text(row.cdmc);
    const campus = text(row.cdxqmc);
    return [{
      semester: semesterValue(row.xnm, row.xqm) || undefined,
      examName: text(row.ksmc) || undefined,
      courseCode: text(row.kch) || undefined,
      courseName,
      examTime: text(row.kssj) || undefined,
      location: [campus, room].filter(Boolean).join(" ") || undefined,
      seat: text(row.zwh) || undefined,
      examType: text(row.cxbj) === "是" ? "重修" : text(row.ksmc) || undefined,
    }];
  });
  return { semesters: semesterOptions(list.map((row) => row.semester || "")), list };
}

function semesterOptions(values: string[]): SemesterOption[] {
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => b.localeCompare(a));
  return unique.map((value, index) => ({ value, label: semesterLabel(value), current: index === 0 }));
}

/** kbcx/xskbcx_cxRjc.html：[{ jcmc: "1", qssj: "08:00", jssj: "08:40" }, ...] */
export function parseZfPeriods(input: unknown): NonNullable<CalendarResult["periods"]> {
  const list = Array.isArray(input) ? input : [];
  const periods = list.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = Number(text(item.jcmc));
    const start = text(item.qssj);
    const end = text(item.jssj);
    if (!(id >= 1) || !/^\d{2}:\d{2}$/u.test(start) || !/^\d{2}:\d{2}$/u.test(end)) return [];
    return [{ id, name: `第${id}节`, start, end }];
  });
  return periods.sort((a, b) => a.id - b.id);
}

function addDays(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function mondayOf(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(ymd, weekday === 0 ? -6 : 1 - weekday);
}

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * 首页 index_cxAreaFive.html 里的校历，形如「2026-2027学年1学期(2026-09-07至2027-02-21)」。
 * 正方只给当前学期的起止日，周次从起始日所在的周一开始数。
 */
export function parseZfCalendar(html: string, periods: CalendarResult["periods"] = [], now = new Date()): CalendarResult | null {
  const plain = String(html || "").replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/\s+/gu, "");
  const match = plain.match(/(\d{4})-(\d{4})学年(\d)学期\((\d{4}-\d{2}-\d{2})至(\d{4}-\d{2}-\d{2})\)/u);
  if (!match) return null;
  const [, firstYear, secondYear, term, start, end] = match;
  if (Number(secondYear) !== Number(firstYear) + 1 || end < start) return null;
  const currentSemester = `${firstYear}-${secondYear}-${term}`;
  const firstMonday = mondayOf(start);
  const weeks: CalendarWeek[] = [];
  for (let monday = firstMonday, week = 1; monday <= end && week <= 40; monday = addDays(monday, 7), week++) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    weeks.push({ week, days, monday, sunday: days[6] });
  }
  const today = shanghaiDate(now);
  return {
    source: "modern",
    calendarSource: "teaching-calendar",
    semesters: [{ value: currentSemester, label: semesterLabel(currentSemester), current: true }],
    currentSemester,
    semesterStart: firstMonday,
    semesterEnd: weeks.at(-1)?.sunday ?? end,
    weeks,
    currentWeek: weeks.find((item) => item.days.includes(today))?.week ?? 0,
    today,
    periods: periods && periods.length ? periods : undefined,
  };
}
