/**
 * 强智 jsxsd（中国药科大学 /zgykdx/）页面解析器
 */
import * as cheerio from "cheerio";

// ============ 通用：学期下拉解析 ============

export interface SemesterOption {
  value: string;
  label: string;
  current: boolean;
}

function parseSelectOptions($: cheerio.CheerioAPI, selectId: string): SemesterOption[] {
  const opts: SemesterOption[] = [];
  $(`#${selectId} option`).each((_, el) => {
    const $o = $(el);
    const value = $o.attr("value") ?? "";
    if (!value) return;
    opts.push({
      value,
      label: $o.text().trim(),
      current: $o.attr("selected") !== undefined,
    });
  });
  return opts;
}

// ============ 课表（学期理论课表）============

export interface ScheduleCourse {
  /** 课程名 */
  name: string;
  /** 任课教师 */
  teacher?: string;
  /** 1-17(周) / 1-17(单周) / 1-17(双周) 原始文本 */
  weeks: string;
  /** 解析后的周次数组：[1,2,3,...,17] */
  weekList: number[];
  /** "D109" 教室 */
  location?: string;
  /** "01-02节" 备注（实际占用的小节） */
  slotNote?: string;
  /** 小节起 / 小节止（解析自 slotNote） */
  startSlot?: number;
  endSlot?: number;
}

export interface ScheduleCell {
  /** 周几 1=周一 ... 7=周日 */
  day: number;
  /** 大节 1=第一大节 ... */
  bigSlot: number;
  courses: ScheduleCourse[];
}

export interface ScheduleResult {
  title: string;
  semesters: SemesterOption[];
  /** 当前选中的学期 */
  currentSemester: string;
  weeks: SemesterOption[];     // 周次下拉
  currentWeek: string;
  /** 单元格列表（已展开） */
  cells: ScheduleCell[];
  /** 调试：原表头 */
  headers?: string[];
}

export function parseSchedule(html: string): ScheduleResult {
  const $ = cheerio.load(html);
  const title = $("title").text().trim();
  const semesters = parseSelectOptions($, "xnxq01id");
  const weeks = parseSelectOptions($, "zc");
  const currentSemester = semesters.find((s) => s.current)?.value ?? "";
  const currentWeek = weeks.find((s) => s.current)?.value ?? "";

  const $tbl = $("table#kbtable");
  const cells: ScheduleCell[] = [];
  let bigSlot = 0;
  $tbl.find("> tbody > tr, > tr").each((_, tr) => {
    const $tr = $(tr);
    const $th = $tr.find("> th");
    // 跳过表头行
    if ($th.length >= 7 && $tr.find("> td").length === 0) return;
    // 大节行：左侧 th 含"第X大节"
    const slotLabel = $th.first().text().trim();
    if (!/大节/.test(slotLabel)) return;
    bigSlot++;
    $tr.find("> td").each((dayIdx, td) => {
      const $td = $(td);
      const day = dayIdx + 1;
      // 取 hover 版本（含老师）的 div.kbcontent
      const $contents = $td.find("div.kbcontent");
      const courses: ScheduleCourse[] = [];
      $contents.each((_, c) => {
        const html = $(c).html() ?? "";
        if (!html.trim()) return;
        // 多门课用 "----------------------" 分隔（实际看到的是 <br/>---------------------<br>）
        const parts = html.split(/<br\s*\/?\s*>\s*-{5,}\s*<br\s*\/?\s*>/i);
        for (const seg of parts) {
          const c2 = cheerio.load(`<div>${seg}</div>`);
          // 课程名 = 首个文本节点（在第一个 <font> 之前）
          const root = c2("div").first();
          const firstFont = root.find("font").first();
          let courseName = "";
          if (firstFont.length) {
            // 用首个 font 之前的文本
            const before = root.html()?.split(/<font/i)[0] ?? "";
            courseName = cheerio.load(`<div>${before}</div>`)("div").text().trim();
          } else {
            courseName = root.text().trim();
          }
          if (!courseName) continue;
          const teacher = root.find('font[title="老师"]').text().trim() || undefined;
          const weeksText = root.find('font[title="周次(节次)"]').text().trim();
          const location = root.find('font[title="教室"]').text().trim() || undefined;
          const slotNote = root.find('font[title="节次备注"]').text().trim() || undefined;
          courses.push({
            name: courseName,
            teacher,
            weeks: weeksText,
            weekList: parseWeeks(weeksText),
            location,
            slotNote,
            ...parseSlotRange(slotNote),
          });
        }
      });
      if (courses.length) cells.push({ day, bigSlot, courses });
    });
  });

  return {
    title,
    semesters,
    currentSemester,
    weeks,
    currentWeek,
    cells: normalizeScheduleCells(cells),
  };
}

function normalizeScheduleCells(cells: ScheduleCell[]): ScheduleCell[] {
  type CourseEntry = { day: number; bigSlot: number; course: ScheduleCourse };
  const groups = new Map<string, CourseEntry[]>();

  for (const cell of cells) {
    for (const course of cell.courses) {
      const range = slotRangeForTablePosition(course, cell.bigSlot);
      const normalized: ScheduleCourse = {
        ...course,
        startSlot: range.startSlot,
        endSlot: range.endSlot,
        slotNote: formatSlotRange(range.startSlot, range.endSlot),
      };
      const key = [
        cell.day,
        normalizeKeyPart(normalized.name),
        normalizeKeyPart(normalized.teacher),
        normalizeKeyPart(normalized.location),
        normalizeKeyPart(normalized.weeks),
      ].join("|");
      const list = groups.get(key) ?? [];
      list.push({ day: cell.day, bigSlot: cell.bigSlot, course: normalized });
      groups.set(key, list);
    }
  }

  const mergedCells = new Map<string, ScheduleCourse[]>();

  for (const list of groups.values()) {
    const sorted = list.sort((a, b) => {
      const aStart = a.course.startSlot ?? (a.bigSlot * 2 - 1);
      const bStart = b.course.startSlot ?? (b.bigSlot * 2 - 1);
      return a.day - b.day || aStart - bStart;
    });
    const merged: CourseEntry[] = [];

    for (const entry of sorted) {
      const prev = merged[merged.length - 1];
      const start = entry.course.startSlot ?? (entry.bigSlot * 2 - 1);
      const end = entry.course.endSlot ?? Math.max(start, entry.bigSlot * 2);
      if (prev && start <= (prev.course.endSlot ?? start) + 1) {
        const nextStart = Math.min(prev.course.startSlot ?? start, start);
        const nextEnd = Math.max(prev.course.endSlot ?? end, end);
        prev.bigSlot = Math.max(1, Math.ceil(nextStart / 2));
        prev.course = {
          ...prev.course,
          startSlot: nextStart,
          endSlot: nextEnd,
          slotNote: formatSlotRange(nextStart, nextEnd),
          weekList: mergeNumberLists(prev.course.weekList, entry.course.weekList),
        };
      } else {
        merged.push({
          ...entry,
          bigSlot: Math.max(1, Math.ceil(start / 2)),
          course: {
            ...entry.course,
            startSlot: start,
            endSlot: end,
            slotNote: formatSlotRange(start, end),
          },
        });
      }
    }

    for (const entry of merged) {
      const key = `${entry.day}:${entry.bigSlot}`;
      const courses = mergedCells.get(key) ?? [];
      courses.push(entry.course);
      mergedCells.set(key, courses);
    }
  }

  return [...mergedCells.entries()]
    .map(([key, courses]) => {
      const [day, bigSlot] = key.split(":").map(Number);
      return { day, bigSlot, courses };
    })
    .sort((a, b) => a.bigSlot - b.bigSlot || a.day - b.day);
}

function slotRangeForTablePosition(course: ScheduleCourse, bigSlot: number) {
  const fallbackStart = Math.max(1, bigSlot * 2 - 1);
  const fallbackEnd = Math.max(fallbackStart, bigSlot * 2);
  const parsedStart = course.startSlot;
  const parsedEnd = course.endSlot;
  if (Number.isFinite(parsedStart) && Number.isFinite(parsedEnd)) {
    const start = Number(parsedStart);
    const end = Number(parsedEnd);
    const overlapsCurrentBigSlot = end >= fallbackStart && start <= fallbackEnd;
    if (overlapsCurrentBigSlot) return { startSlot: start, endSlot: end };
  }
  return { startSlot: fallbackStart, endSlot: fallbackEnd };
}

function formatSlotRange(start: number, end: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function mergeNumberLists(a: number[] = [], b: number[] = []) {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/** 解析教务周次文本：1-17(周)、1-17(单周)、1-8周,10-12周、1、3、5周 等。 */
function parseWeeks(text: string): number[] {
  const source = normalizeWeekText(text);
  if (!source) return [];
  const out = new Set<number>();
  const clauses = source.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);

  for (const clause of clauses.length ? clauses : [source]) {
    const kind = parseWeekKind(clause);
    const matches = [...clause.matchAll(/(\d{1,2})\s*(?:[-~至到]\s*(\d{1,2}))?/g)];
    for (const match of matches) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(64, Math.max(start, end));
      for (let i = min; i <= max; i++) {
        if (kind === "odd" && i % 2 === 0) continue;
        if (kind === "even" && i % 2 === 1) continue;
        out.add(i);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

function normalizeWeekText(text: string) {
  return String(text ?? "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－–—~～]/g, "-")
    .replace(/第/g, "")
    .replace(/\s+/g, "");
}

function parseWeekKind(text: string): "all" | "odd" | "even" {
  if (/单双周/.test(text)) return "all";
  if (/单周|\(单\)|[^双]单/.test(text)) return "odd";
  if (/双周|\(双\)|双/.test(text)) return "even";
  return "all";
}

/** "(01-02节)" → { startSlot: 1, endSlot: 2 } */
function parseSlotRange(note?: string): { startSlot?: number; endSlot?: number } {
  if (!note) return {};
  const nums = (note.match(/\d{1,2}/g) ?? []).map(Number).filter((n) => n >= 1 && n <= 14);
  if (!nums.length) return {};
  return { startSlot: nums[0], endSlot: nums[nums.length - 1] };
}

// ============ 成绩 ============

export interface GradeRow {
  semester: string;
  courseCode?: string;
  courseName: string;
  /** 总成绩（原始字符串，可能含 "优"/"良"/"及格"/数字） */
  score: string;
  /** 总成绩数值，无法解析时为 null */
  scoreNum: number | null;
  usual?: string;     // 平时成绩
  midterm?: string;   // 期中成绩
  final?: string;     // 期末成绩
  credits?: number;
  hours?: number;
  /** 学校列表不返回绩点，由总成绩计算（5.0 制） */
  gpa?: number;
  /** 课程性质（必修/选修/任选） */
  courseAttr?: string;
  examType?: string;
  remark?: string;
}

export interface GradesResult {
  semesters: SemesterOption[];
  list: GradeRow[];
}

/**
 * 5.0 制绩点换算（中国药科大学使用）
 *   数字成绩：gpa = max(0, (score - 50) / 10)，封顶 5.0
 *   等级成绩：优秀/优 4.5；良好/良 3.5；中等/中 2.5；及格/合格 1.5；不及格/不合格 0
 */
export function scoreToGpa(score: string): number | undefined {
  const level = score.replace(/\s+/g, "");
  const levelMap: Record<string, number> = {
    优秀: 4.5,
    优: 4.5,
    良好: 3.5,
    良: 3.5,
    中等: 2.5,
    中: 2.5,
    及格: 1.5,
    合格: 1.5,
    通过: 1.5,
    不及格: 0,
    不合格: 0,
    不通过: 0,
    未通过: 0,
  };
  if (Object.prototype.hasOwnProperty.call(levelMap, level)) return levelMap[level];

  const s = parseFloat(score);
  if (!Number.isFinite(s)) return undefined;
  if (s < 60) return 0;
  const g = (s - 50) / 10;
  return Math.min(5.0, Math.max(0, Math.round(g * 100) / 100));
}

export function normalizeGradesResult(result: GradesResult): GradesResult {
  return {
    ...result,
    list: result.list.map((row) => {
      if (typeof row.gpa === "number") return row;
      return { ...row, gpa: scoreToGpa(row.score) };
    }),
  };
}

export function parseGrades(html: string): GradesResult {
  const $ = cheerio.load(html);
  // 优先从 select 拿（query 页有）；list 页没有，后面从数据聚合兜底
  let semesters = parseSelectOptions($, "kksj");
  const list: GradeRow[] = [];
  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const headRow = $tbl.find("tr").first();
    const headers = headRow.find("th,td").map((_, c) => $(c).text().trim()).get();
    // 必含"课程名称"且至少有"总成绩"或"成绩"列才认为是成绩表
    if (!headers.some((h) => /课程名称/.test(h))) return;
    if (!headers.some((h) => /总成绩|^成绩$/.test(h))) return;

    const find = (...kws: (string | RegExp)[]) =>
      headers.findIndex((h) => kws.some((k) => typeof k === "string" ? h.includes(k) : k.test(h)));
    const idxSem    = find("开课学期");
    const idxCode   = find("课程编号", "课程代码");
    const idxName   = find("课程名称");
    const idxScore  = find("总成绩", /^成绩$/);
    const idxUsual  = find("平时成绩", "平时");
    const idxMid    = find("期中成绩", "期中");
    const idxFinal  = find("期末成绩", "期末");
    const idxCredit = find("学分");
    const idxHours  = find("总学时", "学时");
    const idxAttr   = find("课程属性", "课程性质");
    const idxExam   = find("考试性质", "考试类型");
    const idxRemark = find("备注");

    $tbl.find("tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c).text().replace(/ /g, " ").trim()).get();
      if (!cells.length) return;
      const courseName = idxName >= 0 ? cells[idxName] : "";
      if (!courseName) return;
      const score = idxScore >= 0 ? cells[idxScore] : "";
      const scoreNum = parseFloat(score);
      const credits = idxCredit >= 0 ? parseFloat(cells[idxCredit]) : NaN;
      list.push({
        semester: idxSem >= 0 ? cells[idxSem] : "",
        courseCode: idxCode >= 0 ? cells[idxCode] : undefined,
        courseName,
        score,
        scoreNum: Number.isFinite(scoreNum) ? scoreNum : null,
        usual: idxUsual >= 0 ? cells[idxUsual] : undefined,
        midterm: idxMid >= 0 ? cells[idxMid] : undefined,
        final: idxFinal >= 0 ? cells[idxFinal] : undefined,
        credits: Number.isFinite(credits) ? credits : undefined,
        hours: idxHours >= 0 ? (parseFloat(cells[idxHours]) || undefined) : undefined,
        gpa: scoreToGpa(score),
        courseAttr: idxAttr >= 0 ? cells[idxAttr] : undefined,
        examType: idxExam >= 0 ? cells[idxExam] : undefined,
        remark: idxRemark >= 0 ? cells[idxRemark] : undefined,
      });
    });
  });

  // 兜底：list 页通常没有 select，从结果数据聚合出学期
  if (!semesters.length) {
    const semSet = new Set<string>();
    for (const g of list) if (g.semester) semSet.add(g.semester);
    semesters = Array.from(semSet)
      .sort()
      .reverse() // 最新学期排前面
      .map((value) => ({ value, label: value, current: false }));
  }

  return normalizeGradesResult({ semesters, list });
}

export function parseMidtermGrades(html: string): GradesResult {
  const $ = cheerio.load(html);
  let semesters = parseSelectOptions($, "kksj");
  const list: GradeRow[] = [];

  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const headers = $tbl.find("tr").first().find("th,td").map((_, c) => $(c).text().trim()).get();
    if (!headers.some((h) => /课程名称/.test(h))) return;
    if (!headers.some((h) => /期中成绩|期中/.test(h))) return;

    const find = (...kws: (string | RegExp)[]) =>
      headers.findIndex((h) => kws.some((k) => typeof k === "string" ? h.includes(k) : k.test(h)));
    const idxSem = find("开课学期", "学期");
    const idxCode = find("课程编号", "课程代码");
    const idxName = find("课程名称");
    const idxScore = find("总成绩", /^成绩$/);
    const idxUsual = find("平时成绩", "平时");
    const idxMid = find("期中成绩", /^期中$/);
    const idxFinal = find("期末成绩", "期末");
    const idxCredit = find("学分");
    const idxHours = find("总学时", "学时");
    const idxAttr = find("课程属性", "课程性质");
    const idxExam = find("考试性质", "考试类型");
    const idxRemark = find("备注");

    $tbl.find("tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c).text().replace(/ /g, " ").trim()).get();
      if (!cells.length) return;
      const courseName = idxName >= 0 ? cells[idxName] : "";
      if (!courseName) return;
      const score = idxScore >= 0 ? cells[idxScore] : "";
      const scoreNum = parseFloat(score);
      const credits = idxCredit >= 0 ? parseFloat(cells[idxCredit]) : NaN;
      list.push({
        semester: idxSem >= 0 ? cells[idxSem] : "",
        courseCode: idxCode >= 0 ? cells[idxCode] : undefined,
        courseName,
        score,
        scoreNum: Number.isFinite(scoreNum) ? scoreNum : null,
        usual: idxUsual >= 0 ? cells[idxUsual] : undefined,
        midterm: idxMid >= 0 ? cells[idxMid] : undefined,
        final: idxFinal >= 0 ? cells[idxFinal] : undefined,
        credits: Number.isFinite(credits) ? credits : undefined,
        hours: idxHours >= 0 ? (parseFloat(cells[idxHours]) || undefined) : undefined,
        gpa: score ? scoreToGpa(score) : undefined,
        courseAttr: idxAttr >= 0 ? cells[idxAttr] : undefined,
        examType: idxExam >= 0 ? cells[idxExam] : undefined,
        remark: idxRemark >= 0 ? cells[idxRemark] : undefined,
      });
    });
  });

  if (!semesters.length) {
    const semSet = new Set<string>();
    for (const g of list) if (g.semester) semSet.add(g.semester);
    semesters = Array.from(semSet)
      .sort()
      .reverse()
      .map((value) => ({ value, label: value, current: false }));
  }

  return normalizeGradesResult({ semesters, list });
}

// ============ 考试 ============

export interface ExamRow {
  semester?: string;
  examName?: string;
  courseCode?: string;
  courseName: string;
  examTime?: string;
  location?: string;
  seat?: string;
  examType?: string;
}

export interface ExamsResult {
  semesters: SemesterOption[];
  list: ExamRow[];
}

export function parseExams(html: string): ExamsResult {
  const $ = cheerio.load(html);
  const semesters = parseSelectOptions($, "xnxqid");
  const list: ExamRow[] = [];
  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const headers = $tbl.find("tr").first().find("th,td").map((_, c) => $(c).text().trim()).get();
    if (!headers.some((h) => /课程名称|考试时间|考试地点|考场/.test(h))) return;
    const colIdx = (kw: string | RegExp) => headers.findIndex((h) => typeof kw === "string" ? h.includes(kw) : kw.test(h));
    const idxName = colIdx("课程名称");
    const idxCode = colIdx("课程编号");
    const idxTime = colIdx(/考试时间|考试日期/);
    const idxLoc = colIdx(/考试地点|考场/);
    const idxSeat = colIdx(/座位号|座号/);
    const idxType = colIdx(/考试性质|考试类型/);
    const idxSem = colIdx("学期");
    $tbl.find("tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c).text().trim().replace(/\s+/g, " ")).get();
      if (!cells.length) return;
      const name = idxName >= 0 ? cells[idxName] : "";
      if (!name) return;
      list.push({
        semester: idxSem >= 0 ? cells[idxSem] : undefined,
        courseCode: idxCode >= 0 ? cells[idxCode] : undefined,
        courseName: name,
        examTime: idxTime >= 0 ? cells[idxTime] : undefined,
        location: idxLoc >= 0 ? cells[idxLoc] : undefined,
        seat: idxSeat >= 0 ? cells[idxSeat] : undefined,
        examType: idxType >= 0 ? cells[idxType] : undefined,
      });
    });
  });
  return { semesters, list };
}

// ============ 教学周历（calendar）============

export interface CalendarWeek {
  week: number;
  days: string[];
  monday: string;
  sunday: string;
  note?: string;
}

export interface CalendarResult {
  semesters: SemesterOption[];
  currentSemester: string;
  semesterStart: string;
  semesterEnd: string;
  weeks: CalendarWeek[];
  currentWeek: number;
  today: string;
}

function dayOfWeekForCalendarYmd(ymd: string) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

function addDaysToCalendarYmd(ymd: string, days: number) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function normalizeCalendarWeekDays(days: string[]) {
  const raw = (days ?? []).map((item) => String(item || "").trim());
  if (raw.length >= 7 && dayOfWeekForCalendarYmd(raw[0]) === 7 && dayOfWeekForCalendarYmd(raw[1]) === 1) {
    return [...raw.slice(1, 7), addDaysToCalendarYmd(raw[6], 1)];
  }

  const normalized = Array.from({ length: 7 }, () => "");
  for (const date of raw) {
    const day = dayOfWeekForCalendarYmd(date);
    if (day >= 1 && day <= 7) normalized[day - 1] = date;
  }
  return normalized.some(Boolean) ? normalized : raw;
}

export function parseCalendar(html: string): CalendarResult {
  const $ = cheerio.load(html);
  const semesters = parseSelectOptions($, "xnxqid")
    .concat(parseSelectOptions($, "xnxq01id"))
    .concat(parseSelectOptions($, "xqdm"));
  const currentSemester = semesters.find((s) => s.current)?.value ?? "";

  // 推算学期基准年份
  let baseYear = new Date().getFullYear();
  const m = currentSemester.match(/(\d{4})-(\d{4})-(\d)/);
  if (m) baseYear = m[3] === "1" ? parseInt(m[1]) : parseInt(m[2]);

  // 找到含星期表头的 table（取最深的内层）
  let foundTable: any = null;
  let maxDepth = -1;
  $("table").each((_, t) => {
    const text = $(t).text();
    if (!text.includes("星期一") || !text.includes("星期日")) return;
    const depth = $(t).parents("table").length;
    if (depth > maxDepth) { maxDepth = depth; foundTable = t; }
  });
  if (!foundTable) return emptyCalendar(semesters, currentSemester);

  const $tbl = $(foundTable);
  const weeks: CalendarWeek[] = [];
  let lastSeenMonth = currentSemester.endsWith("-2") ? 3 : 9;

  $tbl.find("> tbody > tr, > tr").each((_, tr) => {
    const tds = $(tr).find("> th, > td").map((_, c) => $(c).text().replace(/ /g, " ").trim()).get();
    if (tds.length < 8) return;
    const wk = parseInt(tds[0]);
    if (!Number.isFinite(wk) || wk < 1 || wk > 30) return;
    let curYear = baseYear;
    let curMonth = lastSeenMonth;
    let lastDay = 0;
    const days: string[] = [];
    for (let k = 1; k <= 7; k++) {
      const cell = tds[k] ?? "";
      const mMD = cell.match(/(\d{1,2})月\s*(\d{1,2})/);
      const mD = cell.match(/^(\d{1,2})$/);
      if (mMD) {
        const mo = parseInt(mMD[1]);
        const da = parseInt(mMD[2]);
        if (mo < curMonth) curYear += 1;
        curMonth = mo;
        lastDay = da;
        days.push(`${curYear}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`);
      } else if (mD) {
        const da = parseInt(mD[1]);
        // 如果日期突然变小，说明月份切了
        if (da < lastDay) {
          curMonth = curMonth % 12 + 1;
          if (curMonth === 1) curYear += 1;
        }
        lastDay = da;
        days.push(`${curYear}-${String(curMonth).padStart(2, "0")}-${String(da).padStart(2, "0")}`);
      } else {
        days.push("");
      }
    }
    lastSeenMonth = curMonth;
    weeks.push({
      week: wk,
      days,
      monday: days[0] || "",
      sunday: days[6] || "",
      note: tds[8] || undefined,
    });
  });

  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  const semesterStart = firstWeek?.days.find(Boolean) ?? "";
  const semesterEnd = [...(lastWeek?.days ?? [])].reverse().find(Boolean) ?? "";

  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayValue = (type: string) => todayParts.find((part) => part.type === type)?.value ?? "";
  const todayStr = `${todayValue("year")}-${todayValue("month")}-${todayValue("day")}`;
  let currentWeek = 0;
  for (const w of weeks) {
    const normalizedDays = normalizeCalendarWeekDays(w.days);
    const mondayYmd = normalizedDays[0] || w.monday;
    if (!mondayYmd) continue;
    const monday = new Date(mondayYmd + "T00:00:00");
    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const todayD = new Date(todayStr + "T12:00:00");
    if (todayD >= monday && todayD < nextMonday) {
      currentWeek = w.week;
      break;
    }
  }

  return { semesters, currentSemester, semesterStart, semesterEnd, weeks, currentWeek, today: todayStr };
}

function emptyCalendar(semesters: SemesterOption[], currentSemester: string): CalendarResult {
  return {
    semesters, currentSemester,
    semesterStart: "", semesterEnd: "",
    weeks: [], currentWeek: 0,
    today: new Date().toISOString().slice(0, 10),
  };
}

// ============ 学业完成情况（xywcqk）============

export interface ProgressSummaryRow {
  name: string;
  requiredMust: number;
  requiredOpt: number;
  earnedMust: number;
  earnedOpt: number;
  leftMust: number;
  leftOpt: number;
}

export interface ProgressCourseRow {
  courseName: string;
  courseCode?: string;
  semester?: string;
  hours?: number;
  credits?: number;
  attr?: string;
  score?: string;
  passed: boolean;
}

export interface ProgressResult {
  summary: ProgressSummaryRow[];
  totals: { requiredMust: number; requiredOpt: number; earnedMust: number; earnedOpt: number; leftMust: number; leftOpt: number };
  completed: ProgressCourseRow[];
  uncompleted: ProgressCourseRow[];
}

export function parseProgress(html: string): ProgressResult {
  const $ = cheerio.load(html);
  const summary: ProgressSummaryRow[] = [];
  const completed: ProgressCourseRow[] = [];
  const uncompleted: ProgressCourseRow[] = [];

  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const allRows = $tbl.find("tr");
    if (allRows.length < 2) return;
    const firstRowText = allRows.eq(0).text().trim();

    if (/课程体系名称/.test(firstRowText)) {
      // 跳过两级表头，从第 3 行起取数据
      allRows.slice(2).each((_, tr) => {
        const cells = $(tr).find("th, td").map((_, c) => $(c).text().trim()).get();
        if (cells.length < 7) return;
        const name = cells[0];
        if (!name) return;
        summary.push({
          name,
          requiredMust: parseFloat(cells[1]) || 0,
          requiredOpt:  parseFloat(cells[2]) || 0,
          earnedMust:   parseFloat(cells[3]) || 0,
          earnedOpt:    parseFloat(cells[4]) || 0,
          leftMust:     parseFloat(cells[5]) || 0,
          leftOpt:      parseFloat(cells[6]) || 0,
        });
      });
      return;
    }

    if (/已完成必修课程|未完成必修课程/.test(firstRowText)) {
      const isCompleted = /已完成/.test(firstRowText);
      const headers = allRows.eq(1).find("th, td").map((_, c) => $(c).text().trim()).get();
      const find = (kw: string | RegExp) =>
        headers.findIndex((h) => typeof kw === "string" ? h.includes(kw) : kw.test(h));
      const idxName    = find("课程名称");
      const idxCode    = find("课程编号");
      const idxSem     = find("学年学期");
      const idxHours   = find("学时");
      const idxCredits = find("学分");
      const idxAttr    = find("课程属性");
      const idxScore   = find("成绩");
      allRows.slice(2).each((_, tr) => {
        // 学校把数据行也用 <th>，所以同时查 th + td
        const cells = $(tr).find("th, td").map((_, c) => $(c).text().trim()).get();
        if (!cells.length) return;
        const name = idxName >= 0 ? cells[idxName] : "";
        if (!name) return;
        const score = idxScore >= 0 ? cells[idxScore] : "";
        const passed = isCompleted && score !== "未通过" && score !== "";
        const row: ProgressCourseRow = {
          courseName: name,
          courseCode: idxCode >= 0 ? cells[idxCode] : undefined,
          semester: idxSem >= 0 ? cells[idxSem] : undefined,
          hours: idxHours >= 0 ? (parseFloat(cells[idxHours]) || undefined) : undefined,
          credits: idxCredits >= 0 ? (parseFloat(cells[idxCredits]) || undefined) : undefined,
          attr: idxAttr >= 0 ? cells[idxAttr] : undefined,
          score: score || undefined,
          passed,
        };
        if (isCompleted) completed.push(row);
        else uncompleted.push(row);
      });
    }
  });

  const totals = summary.reduce((t, r) => ({
    requiredMust: t.requiredMust + r.requiredMust,
    requiredOpt:  t.requiredOpt  + r.requiredOpt,
    earnedMust:   t.earnedMust   + r.earnedMust,
    earnedOpt:    t.earnedOpt    + r.earnedOpt,
    leftMust:     t.leftMust     + r.leftMust,
    leftOpt:      t.leftOpt      + r.leftOpt,
  }), { requiredMust: 0, requiredOpt: 0, earnedMust: 0, earnedOpt: 0, leftMust: 0, leftOpt: 0 });

  return { summary, totals, completed, uncompleted };
}

// ============ 培养方案（执行计划）pyfa ============

export interface PyfaCourse {
  index?: number;
  semester?: string;
  courseCode?: string;
  courseName: string;
  unit?: string;
  credits?: number;
  hours?: number;
  examMethod?: string;
  attr?: string;
  isExam?: string;
}

export interface PyfaResult {
  list: PyfaCourse[];
  bySemester: { semester: string; courses: number; credits: number }[];
}

export function parsePyfa(html: string): PyfaResult {
  const $ = cheerio.load(html);
  const list: PyfaCourse[] = [];

  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const headers = $tbl.find("tr").first().find("th, td").map((_, c) => $(c).text().trim()).get();
    if (!headers.some((h) => /课程名称/.test(h))) return;
    const find = (kw: string | RegExp) =>
      headers.findIndex((h) => typeof kw === "string" ? h.includes(kw) : kw.test(h));
    const idxIndex   = find(/^序号$/);
    const idxSem     = find("开课学期");
    const idxCode    = find("课程编号");
    const idxName    = find("课程名称");
    const idxUnit    = find("开课单位");
    const idxCredits = find("学分");
    const idxHours   = find("总学时");
    const idxExam    = find("考核方式");
    const idxAttr    = find("课程属性");
    const idxIsExam  = find("是否考试");

    $tbl.find("tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td").map((_, c) => $(c).text().trim()).get();
      if (!cells.length) return;
      const name = idxName >= 0 ? cells[idxName] : "";
      if (!name) return;
      list.push({
        index: idxIndex >= 0 ? (parseInt(cells[idxIndex]) || undefined) : undefined,
        semester: idxSem >= 0 ? cells[idxSem] : undefined,
        courseCode: idxCode >= 0 ? cells[idxCode] : undefined,
        courseName: name,
        unit: idxUnit >= 0 ? cells[idxUnit] : undefined,
        credits: idxCredits >= 0 ? (parseFloat(cells[idxCredits]) || undefined) : undefined,
        hours: idxHours >= 0 ? (parseFloat(cells[idxHours]) || undefined) : undefined,
        examMethod: idxExam >= 0 ? cells[idxExam] : undefined,
        attr: idxAttr >= 0 ? cells[idxAttr] : undefined,
        isExam: idxIsExam >= 0 ? cells[idxIsExam] : undefined,
      });
    });
  });

  const semMap = new Map<string, { courses: number; credits: number }>();
  for (const c of list) {
    const k = c.semester || "未指定";
    const cur = semMap.get(k) ?? { courses: 0, credits: 0 };
    cur.courses += 1;
    cur.credits += c.credits ?? 0;
    semMap.set(k, cur);
  }
  const bySemester = Array.from(semMap.entries())
    .map(([semester, v]) => ({ semester, courses: v.courses, credits: v.credits }))
    .sort((a, b) => a.semester.localeCompare(b.semester));

  return { list, bySemester };
}
