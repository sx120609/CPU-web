/**
 * 成绩单汇总口径。
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
  examType?: string;
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

export function transcriptGradePoint(row: TranscriptGradeRow): number | undefined {
  const { level, scoreNum } = normalizedScore(row);
  // 学校规定补考及格后的成绩如实记载，但绩点统一按 1.0 计算。
  if (String(row.examType ?? "").replace(/\s+/g, "").includes("补考")
    && isTranscriptPassing(row)) {
    return 1;
  }
  if (Object.prototype.hasOwnProperty.call(TRANSCRIPT_LEVEL_GPA, level)) {
    return TRANSCRIPT_LEVEL_GPA[level];
  }
  if (!Number.isFinite(scoreNum)) return undefined;
  if (scoreNum < 60) return 0;
  const gpa = (scoreNum - 50) / 10;
  return Math.min(5, Math.max(0, Math.round(gpa * 100) / 100));
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

/** 保留每门课的通过成绩；同一课程优先通过记录，再取更高的成绩。 */
export function collapseTranscriptGrades<T extends TranscriptGradeRow>(rows: T[]) {
  const byCourse = new Map<string, T>();
  for (const row of rows) {
    const key = transcriptCourseKey(row);
    const previous = byCourse.get(key);
    if (!previous) {
      byCourse.set(key, row);
      continue;
    }
    const currentPassed = isTranscriptPassing(row);
    const previousPassed = isTranscriptPassing(previous);
    if (currentPassed !== previousPassed || attemptRank(row) > attemptRank(previous)) {
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
  const countedRows = collapseTranscriptGrades(rows).filter((row) => {
    return isTranscriptPassing(row)
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
