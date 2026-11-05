import * as cheerio from "cheerio";
import type {
  CalendarResult,
  CalendarWeek,
  ExamRow,
  ExamsResult,
  GradeRow,
  GradesResult,
  ProgressCourseRow,
  ProgressResult,
  ProgressSummaryRow,
  ScheduleCell,
  ScheduleCourse,
  ScheduleResult,
  SemesterOption,
} from "../../services/jwxtParser";
import type { FreeRoomRow, FreeRoomSlot, LevelExamRow } from "../../services/jwxtRecords";
import { formatZfWeeks, shanghaiDate } from "../njmu/parser";

/**
 * 树维教务（南中医 jwgl.njucm.edu.cn/student）的接口转成站内统一的课表、成绩、考试、校历、学业格式。
 * 学期名本来就是「2026-2027-1」，和站内写法一致；接口按学期的内部编号查，编号从课表页的学期下拉里取。
 * 上游行里的学号、姓名、证件号和内部主键都不外传。
 */

type Row = Record<string, unknown>;

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/gu, " ").trim();
}

function numberOrUndefined(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

const SEMESTER_PATTERN = /^\d{4}-\d{4}-[1-3]$/u;

export function semesterLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{4})-(\d)$/u);
  if (!match) return value;
  const names: Record<string, string> = { "1": "第一学期", "2": "第二学期", "3": "第三学期" };
  return `${match[1]}-${match[2]}学年${names[match[3]] ?? `第${match[3]}学期`}`;
}

// ============ 学期 ============

export type EamsSemester = { id: string; name: string; selected: boolean };

/** 课表页的学期下拉 select#allSemesters：value 是内部编号，文字是「2026-2027-1」，selected 是当前学期。 */
export function parseEamsSemesters(html: string): EamsSemester[] {
  const $ = cheerio.load(html);
  const out: EamsSemester[] = [];
  $("#allSemesters option").each((_, el) => {
    const id = text($(el).attr("value"));
    const name = text($(el).text());
    if (!/^\d+$/u.test(id) || !SEMESTER_PATTERN.test(name)) return;
    if (out.some((item) => item.id === id)) return;
    out.push({ id, name, selected: $(el).attr("selected") !== undefined });
  });
  return out;
}

/** 课表页把学生内部编号写在跳转后的地址里，页面上也有 dataId；跳转没带上时从页面里取。 */
export function parseEamsStudentId(html: string) {
  return html.match(/var\s+dataId\s*=\s*(\d+)/u)?.[1] ?? html.match(/print-data\/(\d+)/u)?.[1] ?? "";
}

/** 学期名排序（新的在前）。 */
export function sortSemesterNames(values: string[]) {
  return [...new Set(values.filter((value) => SEMESTER_PATTERN.test(value)))].sort((a, b) => b.localeCompare(a));
}

// ============ 作息 ============

export type EamsPeriod = { id: number; name: string; start: string; end: string };

function hhmm(value: unknown) {
  const raw = numberOrUndefined(value);
  if (raw === undefined || raw < 0 || raw >= 2400) return "";
  const hours = Math.floor(raw / 100);
  const minutes = raw % 100;
  return minutes < 60 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` : "";
}

/** print-data 里 studentTableVm.timeTableLayout.courseUnitList：{ indexNo: 1, startTime: 820, endTime: 900 }。 */
export function parseEamsPeriods(layout: unknown): EamsPeriod[] {
  const units = rows(asRow(layout).courseUnitList);
  return units.flatMap((unit) => {
    const id = numberOrUndefined(unit.indexNo);
    const start = hhmm(unit.startTime);
    const end = hhmm(unit.endTime);
    if (!id || !start || !end) return [];
    return [{ id, name: `第${id}节`, start, end }];
  }).sort((a, b) => a.id - b.id);
}

// ============ 课表 ============

function weekOptions(maxWeek: number, current: number): SemesterOption[] {
  return Array.from({ length: maxWeek }, (_, index) => ({
    value: String(index + 1),
    label: `第${index + 1}周`,
    current: index + 1 === current,
  }));
}

function formatSlotNote(start: number, end: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

export type EamsScheduleArgs = {
  semester: string;
  week?: string;
  /** 学期下拉要列出的学期（入学以来到当前学期）。 */
  knownSemesters?: string[];
};

/**
 * for-std/course-table/semester/{id}/print-data/{学生}：studentTableVm.activities 每条是一门课的一个时段，
 * 自带周次数组、星期、起止节次、教室和老师。同一门课同一时段同一地点按周次或老师拆成多条的合成一门。
 */
export function parseEamsSchedule(input: unknown, args: EamsScheduleArgs): ScheduleResult {
  const vm = asRow(asRow(input).studentTableVm);
  const activities = Array.isArray(vm.activities) ? rows(vm.activities) : null;
  const merged = new Map<string, { day: number; start: number; end: number; course: ScheduleCourse; weeks: Set<number>; teachers: string[] }>();
  let maxWeek = 0;
  for (const row of activities ?? []) {
    const name = text(row.courseName);
    const day = Number(row.weekday);
    const start = Number(row.startUnit);
    const end = Number(row.endUnit);
    if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(end >= start) || end > 30) continue;
    const weekList = (Array.isArray(row.weekIndexes) ? row.weekIndexes : [])
      .map(Number)
      .filter((week) => Number.isInteger(week) && week >= 1 && week <= 60);
    if (weekList.length) maxWeek = Math.max(maxWeek, ...weekList);
    const location = text(row.room) || undefined;
    const key = [name, day, start, end, location ?? ""].join("|");
    const entry = merged.get(key) ?? {
      day,
      start,
      end,
      course: {
        name,
        weeks: "",
        weekList: [],
        location,
        slotNote: formatSlotNote(start, end),
        startSlot: start,
        endSlot: end,
      } as ScheduleCourse,
      weeks: new Set<number>(),
      teachers: [],
    };
    for (const week of weekList) entry.weeks.add(week);
    for (const teacher of Array.isArray(row.teachers) ? row.teachers : []) {
      const value = text(teacher);
      if (value && !entry.teachers.includes(value)) entry.teachers.push(value);
    }
    const sourceKey = text(row.lessonCode) || text(row.lessonId);
    if (sourceKey && !entry.course.sourceKey) entry.course.sourceKey = sourceKey;
    merged.set(key, entry);
  }
  const byCell = new Map<string, ScheduleCell>();
  for (const { day, start, course, weeks, teachers } of merged.values()) {
    course.weekList = [...weeks].sort((a, b) => a - b);
    course.weeks = formatZfWeeks(course.weekList);
    if (teachers.length) course.teacher = teachers.length > 3 ? `${teachers.slice(0, 3).join("、")}等${teachers.length}人` : teachers.join("、");
    const bigSlot = Math.max(1, Math.ceil(start / 2));
    const cellKey = `${day}:${bigSlot}`;
    const cell = byCell.get(cellKey) ?? { day, bigSlot, courses: [] };
    cell.courses.push(course);
    byCell.set(cellKey, cell);
  }
  const cells = [...byCell.values()].sort((a, b) => a.day - b.day || a.bigSlot - b.bigSlot);
  const requestedWeek = Number(args.week) || 0;
  const semesters = sortSemesterNames([args.semester, ...(args.knownSemesters ?? [])])
    .map((value) => ({ value, label: semesterLabel(value), current: value === args.semester }));
  return {
    title: `${semesterLabel(args.semester)}课表`,
    pageRecognized: activities !== null,
    scope: "semester",
    semesters,
    currentSemester: args.semester,
    weeks: weekOptions(Math.max(maxWeek, requestedWeek, 20), requestedWeek),
    currentWeek: requestedWeek ? String(requestedWeek) : "",
    cells,
  };
}

// ============ 成绩 ============

const GRADE_WORDS: Record<string, number> = { 优秀: 95, 优: 95, 良好: 85, 良: 85, 中等: 75, 中: 75, 及格: 65, 合格: 75, 通过: 75, 不及格: 0, 不合格: 0, 不通过: 0 };

function stripTags(html: string) {
  return html.replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * gradeDetail 是几段 span：「期末成绩:85.65(专项技术考核:95;体质健康测试:76.3)」「平时成绩:100」。
 * 平时、期中、期末拆进对应字段，其他项（实验、课外锻炼等）放进备注。
 */
export function parseEamsGradeDetail(html: string) {
  const parts = String(html || "").split(/<\/span>/u).map(stripTags).filter(Boolean);
  const result: Pick<GradeRow, "usual" | "midterm" | "final"> & { other: string[] } = { other: [] };
  for (const part of parts) {
    const match = part.match(/^([^:：]+)[:：]\s*(.+)$/u);
    if (!match) continue;
    const [, label, value] = match;
    if (/期末/u.test(label) && !result.final) result.final = value;
    else if (/期中/u.test(label) && !result.midterm) result.midterm = value;
    else if (/平时/u.test(label) && !result.usual) result.usual = value;
    else result.other.push(`${label.replace(/（.*?）|\(.*?\)/gu, "").trim()} ${value}`);
  }
  return result;
}

/** for-std/grade/sheet/info/{学生}?semester=：{ semesterId2studentGrades: { 编号: [成绩...] } }，空学期参数给全部学期。 */
export function parseEamsGrades(input: unknown): GradesResult {
  const bySemester = asRow(asRow(input).semesterId2studentGrades);
  const list: GradeRow[] = [];
  for (const value of Object.values(bySemester)) {
    for (const row of rows(value)) {
      const course = asRow(row.course);
      const courseName = text(course.nameZh) || text(row.courseName);
      if (!courseName) continue;
      if (row.published === false) continue;
      const semester = text(asRow(row.semester).nameZh);
      const score = text(row.gaGrade);
      const numeric = numberOrUndefined(score);
      const word = GRADE_WORDS[score];
      const detail = parseEamsGradeDetail(text(row.gradeDetail) ? String(row.gradeDetail) : "");
      const grade: GradeRow = {
        semester,
        courseCode: text(course.code) || undefined,
        courseName,
        score,
        scoreNum: numeric ?? (word === undefined ? null : word),
        credits: numberOrUndefined(course.credits),
        gpa: numberOrUndefined(row.gp),
        courseAttr: text(asRow(row.courseProperty).nameZh) || text(asRow(row.courseType).nameZh) || undefined,
        examType: text(row.examModeNameZh) || undefined,
      };
      if (detail.usual) grade.usual = detail.usual;
      if (detail.midterm) grade.midterm = detail.midterm;
      if (detail.final) grade.final = detail.final;
      const remark = [...detail.other, row.passed === false ? "未通过" : ""].filter(Boolean).join(" · ");
      if (remark) grade.remark = remark;
      list.push(grade);
    }
  }
  list.sort((a, b) => b.semester.localeCompare(a.semester) || a.courseName.localeCompare(b.courseName, "zh-CN"));
  const semesters = sortSemesterNames(list.map((row) => row.semester))
    .map((value, index) => ({ value, label: semesterLabel(value), current: index === 0 }));
  return { semesters, list };
}

// ============ 考试 ============

export type SemesterSpan = { name: string; startDate: string; endDate: string };

/**
 * 考试日期落在哪个学期里：给了学期起止（/ws/semester/get）就按起止判断，
 * 否则按学年推：8 月到次年 1 月是第一学期，2 到 7 月是第二学期。
 */
export function semesterOfDate(date: string, spans: SemesterSpan[] = []) {
  const known = spans.find((item) => item.startDate <= date && date <= item.endDate)?.name;
  if (known) return known;
  const match = date.match(/^(\d{4})-(\d{2})-\d{2}$/u);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 8) return `${year}-${year + 1}-1`;
  if (month === 1) return `${year - 1}-${year}-1`;
  return `${year - 1}-${year}-2`;
}

/**
 * for-std/exam-arrange/info/{学生}：table#exams 每行一场，未结束的显示，已结束的带 finished 类隐藏着。
 * 列是考试时间（div.time）、考试地点（校区、楼、教室几个 span）、考试科目（课程名 + 考试类型标签）、状态。
 */
export function parseEamsExams(html: string, spans: SemesterSpan[] = []): ExamsResult & { finished: number } {
  const $ = cheerio.load(html);
  const list: Array<ExamRow & { finished: boolean }> = [];
  $("#exams tbody tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("tr-empty")) return;
    const cells = $tr.children("td");
    if (cells.length < 3) return;
    const time = text($(cells[0]).find(".time").first().text() || $(cells[0]).text());
    const placeParts = $(cells[1]).find("span").map((__, el) => text($(el).text())).get().filter(Boolean);
    // 地点按「校区 楼 教室」给，教室名里常带楼号（B11-209），楼名就不重复写了。
    const room = placeParts.at(-1) ?? "";
    const location = placeParts.filter((part, index) => index === placeParts.length - 1 || !room.startsWith(part)).join(" ");
    const $course = $(cells[2]);
    const courseName = text($course.find("span").first().text());
    if (!courseName) return;
    const tags = $course.find(".tag-span").map((__, el) => text($(el).text())).get().filter(Boolean);
    const seat = text($tr.text()).match(/座位号?[:：]?\s*([A-Za-z0-9-]+)/u)?.[1];
    const date = time.match(/\d{4}-\d{2}-\d{2}/u)?.[0] ?? "";
    list.push({
      semester: date ? semesterOfDate(date, spans) : undefined,
      courseName,
      examTime: time || undefined,
      location: location || undefined,
      seat: seat || undefined,
      examType: tags.join("、") || undefined,
      examName: tags[0] || undefined,
      finished: $tr.attr("data-finished") === "true" || $tr.hasClass("finished"),
    });
  });
  list.sort((a, b) => String(b.examTime ?? "").localeCompare(String(a.examTime ?? "")));
  const semesters = sortSemesterNames(list.map((row) => row.semester ?? ""))
    .map((value, index) => ({ value, label: semesterLabel(value), current: index === 0 }));
  return {
    semesters,
    list: list.map(({ finished: _finished, ...row }) => row),
    finished: list.filter((row) => row.finished).length,
  };
}

// ============ 校历 ============

function addDays(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function mondayOf(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(ymd, weekday === 0 ? -6 : 1 - weekday);
}

/** /ws/semester/get/{编号}：{ nameZh, startDate, endDate, weekStartOnSunday }。 */
export function parseEamsSemesterSpan(input: unknown): SemesterSpan | null {
  const row = asRow(input);
  const name = text(row.nameZh);
  const startDate = text(row.startDate);
  const endDate = text(row.endDate);
  if (!SEMESTER_PATTERN.test(name) || !/^\d{4}-\d{2}-\d{2}$/u.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(endDate) || endDate < startDate) return null;
  return { name, startDate, endDate };
}

export function buildEamsCalendar(
  span: SemesterSpan,
  options: { semesters: string[]; periods?: EamsPeriod[]; now?: Date },
): CalendarResult {
  const firstMonday = mondayOf(span.startDate);
  const weeks: CalendarWeek[] = [];
  for (let monday = firstMonday, week = 1; monday <= span.endDate && week <= 40; monday = addDays(monday, 7), week++) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    weeks.push({ week, days, monday, sunday: days[6] });
  }
  const today = shanghaiDate(options.now);
  return {
    source: "modern",
    calendarSource: "teaching-calendar",
    semesters: sortSemesterNames([span.name, ...options.semesters]).map((value) => ({ value, label: semesterLabel(value), current: value === span.name })),
    currentSemester: span.name,
    semesterStart: firstMonday,
    semesterEnd: weeks.at(-1)?.sunday ?? span.endDate,
    weeks,
    currentWeek: weeks.find((item) => item.days.includes(today))?.week ?? 0,
    today,
    periods: options.periods && options.periods.length ? options.periods : undefined,
  };
}

// ============ 等级考试 ============

/**
 * for-std/other-exam-signup/index/{学生}?semeters=（不带学期给全部）：第二张表是成绩，
 * 列为考试种类、考试科目、成绩、等级、学分、是否通过、证书编号。证书编号不外传。
 */
export function parseEamsLevelExams(html: string): { kind: "level-exams"; list: LevelExamRow[] } {
  const $ = cheerio.load(html);
  const list: LevelExamRow[] = [];
  $("table").each((_, table) => {
    const headers = $(table).find("th").map((__, th) => text($(th).text())).get();
    const col = (name: string) => headers.findIndex((header) => header.includes(name));
    const subjectCol = col("考试科目");
    const scoreCol = col("成绩");
    if (subjectCol < 0 || scoreCol < 0 || col("证书编号") < 0) return;
    const kindCol = col("考试种类");
    const levelCol = col("等级");
    const creditCol = col("学分");
    $(table).find("tbody tr").each((__, tr) => {
      const cells = $(tr).children("td").map((___, td) => text($(td).text())).get();
      const name = cells[subjectCol] ?? "";
      if (!name || cells.length < headers.length) return;
      const score = numberOrUndefined(cells[scoreCol]);
      const level = levelCol >= 0 ? cells[levelCol] : "";
      const credits = creditCol >= 0 ? numberOrUndefined(cells[creditCol]) : undefined;
      list.push({
        name,
        subject: (kindCol >= 0 ? cells[kindCol] : "") || undefined,
        score: score !== undefined && score > 0 ? score : undefined,
        grade: level || (score === undefined ? cells[scoreCol] || undefined : undefined),
        note: credits ? `${credits} 学分` : undefined,
      });
    });
  });
  return { kind: "level-exams", list };
}

// ============ 学业：培养方案完成情况 ============

type ProgramModule = Row & { children?: unknown; courseList?: unknown };

const OPTIONAL_MODULE = /选修|公选|任选|限选/u;

/**
 * for-std/program-completion-preview/json/{学生}：moduleList 是培养方案的课程模块树，每个模块有要求学分、
 * 已通过学分、在读学分和课程清单。汇总表列一级模块和它的子模块；已修、未修两栏和药大一样只列必修模块的课程
 * （学业页把这两栏当必修明细算学分，选修已修学分取汇总表）。
 */
export function parseEamsProgramCompletion(input: unknown): ProgressResult {
  const data = asRow(input);
  const summary: ProgressSummaryRow[] = [];
  const completed: ProgressCourseRow[] = [];
  const uncompleted: ProgressCourseRow[] = [];
  const seenCourses = new Set<string>();

  const addRow = (module: ProgramModule, prefix: string) => {
    const name = text(module.nameZh);
    if (!name) return;
    const required = numberOrUndefined(asRow(module.requireInfo).credits) ?? 0;
    const passed = numberOrUndefined(asRow(module.completionSummary).passedCredits) ?? 0;
    const optional = OPTIONAL_MODULE.test(`${prefix}${name}`);
    const left = Math.max(0, Math.round((required - passed) * 10) / 10);
    summary.push({
      name: prefix ? `${prefix} · ${name}` : name,
      requiredMust: optional ? 0 : required,
      requiredOpt: optional ? required : 0,
      earnedMust: optional ? 0 : passed,
      earnedOpt: optional ? passed : 0,
      leftMust: optional ? 0 : left,
      leftOpt: optional ? left : 0,
    });
  };

  const collectCourses = (module: ProgramModule, moduleName: string) => {
    for (const course of rows(module.courseList)) {
      const courseName = text(course.nameZh);
      if (!courseName) continue;
      const code = text(course.code);
      const key = code || courseName;
      if (seenCourses.has(key)) continue;
      seenCourses.add(key);
      const result = text(course.finalResultType) || text(course.resultType);
      const row: ProgressCourseRow = {
        courseName,
        courseCode: code || undefined,
        credits: numberOrUndefined(course.credits),
        attr: moduleName || undefined,
        score: text(course.gradeStr) || (course.score === null || course.score === undefined ? undefined : text(course.score)),
        passed: result === "PASSED",
      };
      (row.passed ? completed : uncompleted).push(row);
    }
    for (const child of rows(module.children)) collectCourses(child, text(child.nameZh) || moduleName);
  };

  for (const top of rows(data.moduleList)) {
    const topName = text(top.nameZh);
    addRow(top, "");
    for (const child of rows(top.children)) addRow(child, topName);
    if (!OPTIONAL_MODULE.test(topName)) collectCourses(top, topName);
  }

  const topRows = summary.filter((row) => !row.name.includes(" · "));
  const totals = topRows.reduce((sum, row) => ({
    requiredMust: sum.requiredMust + row.requiredMust,
    requiredOpt: sum.requiredOpt + row.requiredOpt,
    earnedMust: sum.earnedMust + row.earnedMust,
    earnedOpt: sum.earnedOpt + row.earnedOpt,
    leftMust: sum.leftMust + row.leftMust,
    leftOpt: sum.leftOpt + row.leftOpt,
  }), { requiredMust: 0, requiredOpt: 0, earnedMust: 0, earnedOpt: 0, leftMust: 0, leftOpt: 0 });
  return { summary, totals, completed, uncompleted };
}

// ============ 空闲教室（教室借用的 /ws/room-borrow/free-list） ============

/** 按上课的时段各查一次：上午 1-2、3-5，下午 6-7、8-9，晚上 10-12。 */
export const EAMS_ROOM_SLOTS: ReadonlyArray<{ from: number; to: number }> = [
  { from: 1, to: 2 },
  { from: 3, to: 5 },
  { from: 6, to: 7 },
  { from: 8, to: 9 },
  { from: 10, to: 12 },
];

/** 自习用不上的场地：体育馆、操场、医院床边教学点、实验室、室外。 */
const NON_STUDY_ROOM = /体育|操场|室外|床边|实验|实训|医院|食堂|基地|机房/u;

export function mergeEamsFreeRooms(
  results: Array<{ slot: { from: number; to: number }; rows: unknown }>,
  periods: EamsPeriod[],
): { slots: FreeRoomSlot[]; rooms: FreeRoomRow[] } {
  const timeOf = (id: number) => periods.find((item) => item.id === id);
  const slots: FreeRoomSlot[] = results.map(({ slot }) => ({
    name: `${slot.from}-${slot.to}节`,
    periods: `${slot.from}-${slot.to}`,
    start: timeOf(slot.from)?.start ?? "",
    end: timeOf(slot.to)?.end ?? "",
  }));
  const byName = new Map<string, { building?: string; type?: string; seats?: number; free: Set<number> }>();
  results.forEach(({ rows: input }, index) => {
    for (const room of rows(asRow(input).roomList)) {
      const name = text(room.nameZh);
      if (!name || room.virtual === true) continue;
      const building = text(asRow(room.building).nameZh);
      const type = text(asRow(room.roomType).nameZh);
      if (NON_STUDY_ROOM.test(`${building} ${type}`)) continue;
      const entry = byName.get(name) ?? {
        building: building || undefined,
        type: type || undefined,
        seats: numberOrUndefined(room.seatsForLesson) ?? numberOrUndefined(room.seats),
        free: new Set<number>(),
      };
      entry.free.add(index);
      byName.set(name, entry);
    }
  });
  const rooms = [...byName.entries()].map(([name, entry]): FreeRoomRow => ({
    name,
    building: entry.building,
    type: entry.type,
    seats: entry.seats,
    states: slots.map((_, index) => (entry.free.has(index) ? "" : "class")),
  }));
  rooms.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  return { slots, rooms };
}
