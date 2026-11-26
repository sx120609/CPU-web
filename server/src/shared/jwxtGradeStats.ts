/**
 * 成绩单汇总与深度学业精算（前后端共用口径）。
 *
 * 教务成绩列表会保留不及格记录、补考前记录和重复的课程记录；学校电子
 * 成绩单的统计则只保留每门课的一条有效记录，再按课程学分加权。两者不能
 * 直接对原始列表求平均。
 */

export interface TranscriptGradeRow {
  semester?: string;
  courseCode?: string;
  courseName: string;
  score?: string;
  scoreNum?: number | null;
  credits?: number;
  gpa?: number;
  courseAttr?: string;
  courseNature?: string;
  examType?: string;
  usual?: string;
  midterm?: string;
  final?: string;
  usualWeight?: string;
  midtermWeight?: string;
  finalWeight?: string;
  remark?: string;
}

const ABSENT_MARK = /缺考|缓考|旷考|作弊|违纪|取消/;

function percentValue(raw?: string) {
  const n = Number.parseFloat(String(raw ?? "").replace(/[%％\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 期末还没出分时，教务会先按已出的平时、期中折算一个总评（期中 93 × 30% → 总评 28）。
 * 这不是最终成绩：不按不及格标红，也不计入绩点和学分统计。
 * 期末有占比、期末分为空或 0、且没有缺考等标记时视为期末未出。
 */
export function isPendingFinalGrade(row: TranscriptGradeRow) {
  if (!String(row.score ?? "").trim()) return false;
  if (isTranscriptMakeup(row)) return false;
  const weight = percentValue(row.finalWeight);
  if (weight === null || weight <= 0) return false;
  const final = String(row.final ?? "").trim();
  if (final && Number.parseFloat(final) !== 0) return false;
  const marks = [row.score, row.final, row.remark, row.examType].map((v) => String(v ?? "")).join(" ");
  return !ABSENT_MARK.test(marks);
}

const PASS_LEVELS = new Set([
  "优秀", "优", "良好", "良", "中等", "中", "及格", "合格", "通过",
]);

/** 等级成绩与教务详情和电子成绩单的绩点口径保持一致。 */
const TRANSCRIPT_LEVEL_GPA: Record<string, number> = {
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

const TRANSCRIPT_LEVEL_EQUIV_SCORE: Record<string, number> = {
  优秀: 95,
  优: 95,
  良好: 85,
  良: 85,
  中等: 75,
  中: 75,
  及格: 65,
  合格: 65,
  通过: 65,
  不及格: 0,
  不合格: 0,
  不通过: 0,
  未通过: 0,
};

function normalizedScore(row: TranscriptGradeRow) {
  const raw = String(row.score ?? "").trim();
  const scoreNum = typeof row.scoreNum === "number" && Number.isFinite(row.scoreNum)
    ? row.scoreNum
    : Number.parseFloat(raw);
  return { raw, level: raw.replace(/\s+/g, ""), scoreNum };
}

export function isTranscriptPassing(row: TranscriptGradeRow) {
  const { level, scoreNum } = normalizedScore(row);
  if (Number.isFinite(scoreNum)) return scoreNum >= 60;
  return PASS_LEVELS.has(level);
}

export function isTranscriptMakeup(row: TranscriptGradeRow) {
  return String(row.examType ?? "").replace(/\s+/g, "").includes("补考");
}

export function transcriptGradePoint(row: TranscriptGradeRow): number | undefined {
  const { level, scoreNum } = normalizedScore(row);
  // 补考成绩无论分数高低，绩点均按 1.0 计算。
  if (isTranscriptMakeup(row)) return 1;
  if (Object.prototype.hasOwnProperty.call(TRANSCRIPT_LEVEL_GPA, level)) {
    return TRANSCRIPT_LEVEL_GPA[level];
  }
  if (!Number.isFinite(scoreNum)) return undefined;
  if (scoreNum < 60) return 0;
  const gpa = (scoreNum - 50) / 10;
  return Math.min(5, Math.max(0, Math.round(gpa * 100) / 100));
}

function numericEquivalentScore(row: TranscriptGradeRow): number | undefined {
  const { level, scoreNum } = normalizedScore(row);
  if (Number.isFinite(scoreNum)) return scoreNum;
  if (Object.prototype.hasOwnProperty.call(TRANSCRIPT_LEVEL_EQUIV_SCORE, level)) {
    return TRANSCRIPT_LEVEL_EQUIV_SCORE[level];
  }
  return undefined;
}

function transcriptCourseKey(row: TranscriptGradeRow) {
  const semester = String(row.semester ?? "").trim();
  const code = String(row.courseCode ?? "").trim();
  const name = String(row.courseName ?? "").trim();
  return `${semester}\u0000${code || name}`;
}

function attemptRank(row: TranscriptGradeRow) {
  const { level, scoreNum } = normalizedScore(row);
  if (Number.isFinite(scoreNum)) return scoreNum;
  return Object.prototype.hasOwnProperty.call(TRANSCRIPT_LEVEL_GPA, level)
    ? TRANSCRIPT_LEVEL_GPA[level]
    : Number.NEGATIVE_INFINITY;
}

/** 同一课程优先保留补考记录；无补考时优先通过记录，再取更高的成绩。 */
export function collapseTranscriptGrades<T extends TranscriptGradeRow>(rows: T[]) {
  const byCourse = new Map<string, T>();
  for (const row of rows) {
    const key = transcriptCourseKey(row);
    const previous = byCourse.get(key);
    if (!previous) {
      byCourse.set(key, row);
      continue;
    }
    const currentMakeup = isTranscriptMakeup(row);
    const previousMakeup = isTranscriptMakeup(previous);
    const currentPassed = isTranscriptPassing(row);
    const previousPassed = isTranscriptPassing(previous);
    const shouldReplace = currentMakeup !== previousMakeup
      ? currentMakeup
      : currentPassed !== previousPassed
        ? currentPassed
        : attemptRank(row) > attemptRank(previous);
    if (shouldReplace) {
      byCourse.set(key, row);
    }
  }
  return Array.from(byCourse.values());
}

export interface TranscriptGradeStats<T extends TranscriptGradeRow = TranscriptGradeRow> {
  rows: T[];
  credits: number;
  gpa: number;
}

/** 对当前筛选/选择范围按电子成绩单口径统计。 */
export function transcriptGradeStats<T extends TranscriptGradeRow>(rows: T[]): TranscriptGradeStats<T> {
  const countedRows = collapseTranscriptGrades(rows.filter((row) => !isPendingFinalGrade(row))).filter((row) => {
    return (isTranscriptMakeup(row) || isTranscriptPassing(row))
      && typeof row.credits === "number"
      && Number.isFinite(row.credits)
      && row.credits > 0
      && typeof transcriptGradePoint(row) === "number";
  });
  const credits = countedRows.reduce((sum, row) => sum + (row.credits ?? 0), 0);
  const points = countedRows.reduce((sum, row) => {
    return sum + (transcriptGradePoint(row) ?? 0) * (row.credits ?? 0);
  }, 0);
  return { rows: countedRows, credits, gpa: credits ? points / credits : 0 };
}

export interface SemesterGradeSummary {
  semester: string;
  courseCount: number;
  credits: number;
  gpa: number;
  weightedScore: number | null;
}

export interface RetakeImpactSimulation {
  courseName: string;
  semester: string;
  credits: number;
  currentScore: string;
  currentGpa: number;
  courseAttr: string;
  /** 若重修取得 85 分（绩点 3.5）后的新总 GPA 与提升值 */
  gpaIf85: number;
  deltaIf85: number;
  /** 若重修取得 90 分（绩点 4.0）后的新总 GPA 与提升值 */
  gpaIf90: number;
  deltaIf90: number;
}

export interface DeepAcademicGradeAnalysis {
  totalRawRows: number;
  countedCourseCount: number;
  earnedCredits: number;
  overallGpa: number;
  weightedScore: number | null;
  requiredCredits: number;
  requiredGpa: number | null;
  electiveCredits: number;
  electiveGpa: number | null;
  bySemester: SemesterGradeSummary[];
  topCourses: Array<{
    courseName: string;
    semester: string;
    credits: number;
    score: string;
    gpa: number;
    courseAttr: string;
  }>;
  dragCourses: RetakeImpactSimulation[];
  failedUnresolved: Array<{
    courseName: string;
    semester: string;
    credits: number;
    score: string;
    courseAttr: string;
    examType: string;
  }>;
  pendingFinal: Array<{
    courseName: string;
    semester: string;
    credits: number;
    usual: string;
    midterm: string;
    finalWeight: string;
  }>;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function isRequiredCourseAttr(row: TranscriptGradeRow) {
  const attr = `${row.courseAttr ?? ""} ${row.courseNature ?? ""}`;
  if (/选修|任选|公选|通识选/u.test(attr) && !/必修/u.test(attr)) return false;
  return /必修/u.test(attr);
}

function weightedAverageScore(rows: TranscriptGradeRow[]): number | null {
  let creditSum = 0;
  let scoreWeightSum = 0;
  for (const row of rows) {
    const eq = numericEquivalentScore(row);
    const credits = row.credits ?? 0;
    if (eq === undefined || !Number.isFinite(credits) || credits <= 0) continue;
    creditSum += credits;
    scoreWeightSum += eq * credits;
  }
  return creditSum > 0 ? round2(scoreWeightSum / creditSum) : null;
}

/**
 * 面向个人 Agent 的全量成绩确定性精算：
 * 一次性算出总绩点、加权分、必修/选修拆分、分学期趋势、高分优势课、低绩点拖后腿课（含重修刷分敏感度模拟）、未通过课与期末待出分课。
 */
export function analyzeAcademicGrades(rows: TranscriptGradeRow[]): DeepAcademicGradeAnalysis {
  const pendingFinal = rows
    .filter((row) => isPendingFinalGrade(row))
    .map((row) => ({
      courseName: row.courseName,
      semester: row.semester || "",
      credits: row.credits ?? 0,
      usual: row.usual || "",
      midterm: row.midterm || "",
      finalWeight: row.finalWeight || "",
    }));

  const nonPending = rows.filter((row) => !isPendingFinalGrade(row));
  const collapsed = collapseTranscriptGrades(nonPending);
  const overall = transcriptGradeStats(rows);
  const totalPoints = overall.rows.reduce((sum, row) => sum + (transcriptGradePoint(row) ?? 0) * (row.credits ?? 0), 0);

  const requiredRows = overall.rows.filter((row) => isRequiredCourseAttr(row));
  const electiveRows = overall.rows.filter((row) => !isRequiredCourseAttr(row));
  const requiredStats = transcriptGradeStats(requiredRows);
  const electiveStats = transcriptGradeStats(electiveRows);

  const semesterMap = new Map<string, TranscriptGradeRow[]>();
  for (const row of overall.rows) {
    const sem = String(row.semester || "未知学期").trim() || "未知学期";
    const list = semesterMap.get(sem) ?? [];
    list.push(row);
    semesterMap.set(sem, list);
  }
  const bySemester: SemesterGradeSummary[] = [...semesterMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semester, list]) => {
      const stats = transcriptGradeStats(list);
      return {
        semester,
        courseCount: stats.rows.length,
        credits: round2(stats.credits),
        gpa: round4(stats.gpa),
        weightedScore: weightedAverageScore(stats.rows),
      };
    });

  const topCourses = [...overall.rows]
    .sort((a, b) => (
      (transcriptGradePoint(b) ?? 0) - (transcriptGradePoint(a) ?? 0)
      || (b.credits ?? 0) - (a.credits ?? 0)
    ))
    .slice(0, 8)
    .map((row) => ({
      courseName: row.courseName,
      semester: row.semester || "",
      credits: row.credits ?? 0,
      score: String(row.score ?? ""),
      gpa: round2(transcriptGradePoint(row) ?? 0),
      courseAttr: row.courseAttr || "",
    }));

  const dragCourses: RetakeImpactSimulation[] = [...overall.rows]
    .filter((row) => (transcriptGradePoint(row) ?? 5) < 3.5 && (row.credits ?? 0) > 0)
    .map((row) => {
      const credits = row.credits ?? 0;
      const currentGpa = transcriptGradePoint(row) ?? 0;
      const gpaIf85 = overall.credits > 0
        ? (totalPoints + Math.max(0, 3.5 - currentGpa) * credits) / overall.credits
        : 0;
      const gpaIf90 = overall.credits > 0
        ? (totalPoints + Math.max(0, 4.0 - currentGpa) * credits) / overall.credits
        : 0;
      return {
        courseName: row.courseName,
        semester: row.semester || "",
        credits,
        currentScore: String(row.score ?? ""),
        currentGpa: round2(currentGpa),
        courseAttr: row.courseAttr || "",
        gpaIf85: round4(gpaIf85),
        deltaIf85: round4(gpaIf85 - overall.gpa),
        gpaIf90: round4(gpaIf90),
        deltaIf90: round4(gpaIf90 - overall.gpa),
      };
    })
    .sort((a, b) => b.deltaIf90 - a.deltaIf90 || a.currentGpa - b.currentGpa)
    .slice(0, 8);

  // 按课程代码或课程名汇总跨学期是否最终已通过，找出至今仍未及格的课程
  const passedByIdentity = new Set<string>();
  for (const row of collapsed) {
    const idKey = String(row.courseCode || row.courseName).trim();
    if (idKey && (isTranscriptPassing(row) || isTranscriptMakeup(row) && (transcriptGradePoint(row) ?? 0) > 0 && normalizedScore(row).scoreNum >= 60)) {
      passedByIdentity.add(idKey);
    } else if (idKey && isTranscriptPassing(row)) {
      passedByIdentity.add(idKey);
    }
  }
  const failedUnresolved = collapsed
    .filter((row) => !isTranscriptPassing(row) && !passedByIdentity.has(String(row.courseCode || row.courseName).trim()))
    .map((row) => ({
      courseName: row.courseName,
      semester: row.semester || "",
      credits: row.credits ?? 0,
      score: String(row.score ?? ""),
      courseAttr: row.courseAttr || "",
      examType: row.examType || "",
    }));

  return {
    totalRawRows: rows.length,
    countedCourseCount: overall.rows.length,
    earnedCredits: round2(overall.credits),
    overallGpa: round4(overall.gpa),
    weightedScore: weightedAverageScore(overall.rows),
    requiredCredits: round2(requiredStats.credits),
    requiredGpa: requiredStats.credits > 0 ? round4(requiredStats.gpa) : null,
    electiveCredits: round2(electiveStats.credits),
    electiveGpa: electiveStats.credits > 0 ? round4(electiveStats.gpa) : null,
    bySemester,
    topCourses,
    dragCourses,
    failedUnresolved,
    pendingFinal,
  };
}
