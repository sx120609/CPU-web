import crypto from "node:crypto";
import { z } from "zod";
import { getSchool, type AcademicView } from "../../schools/registry";
import { HttpError } from "../../utils/response";
import { withCache } from "../cache";
import { classifyJwxtError, JWXT_AUTH_EXPIRED_CODE } from "../jwxtErrors";
import {
  getExams,
  getGrades,
  getMidtermGrades,
  getProgress,
  getPyfa,
  getRecords,
} from "../jwxtTransport";
import {
  analyzeAcademicGrades,
  isPendingFinalGrade,
  isTranscriptMakeup,
  transcriptGradePoint,
  type TranscriptGradeRow,
} from "../../shared/jwxtGradeStats";
import {
  guardToolScope,
  JwxtReauthRequiredError,
  shanghaiNowParts,
  type PersonalAgentToolContext,
  type PersonalAgentToolDefinition,
} from "./types";

const JWXT_SOURCE_CACHE_REVISION = "source-v8";
const GRADES_TTL_MS = 30 * 60_000;
const EXAMS_TTL_MS = 30 * 60_000;
const PROGRESS_TTL_MS = 30 * 60_000;
const PYFA_TTL_MS = 6 * 60 * 60_000;
const RECORDS_TTL_MS = 30 * 60_000;
const UPSTREAM_FALLBACK_MESSAGE = "学校教务系统暂时未能返回可识别的数据";

/**
 * 工具结果的字符预算。引擎会把超过 9000 字符的结果整个换成截断的预览，
 * 这里留出余量，每个工具按预算收紧列表条数和字段。
 */
export const TOOL_RESULT_CHAR_BUDGET = 7_500;

/** 依次尝试由宽到窄的几种结果，返回第一个不超预算的；都超出时返回最后一个。 */
export function fitToolResult<T>(variants: Iterable<() => T>): T {
  let last: T | undefined;
  for (const build of variants) {
    last = build();
    if (JSON.stringify(last).length <= TOOL_RESULT_CHAR_BUDGET) return last;
  }
  return last as T;
}

/** 按条数上限依次收紧：build(limit) 生成结果。 */
export function fitByListLimit<T>(build: (limit: number) => T, limits: readonly number[] = [40, 25, 15, 8, 4]): T {
  return fitToolResult(limits.map((limit) => () => build(limit)));
}

/** 去掉值为空字符串、null、undefined 的字段，减小结果体积。 */
export function dropEmptyFields<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as T;
}

export function jwxtCacheId(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
}

/** 教务授权过期（4011）时返回归类后的错误，否则为 null。 */
export function jwxtAuthExpiredError(error: unknown): HttpError | null {
  const classified = classifyJwxtError(error);
  return classified instanceof HttpError && classified.code === JWXT_AUTH_EXPIRED_CODE ? classified : null;
}

export function jwxtErrorMessage(error: unknown) {
  const classified = classifyJwxtError(error);
  return classified instanceof Error && classified.message ? classified.message : UPSTREAM_FALLBACK_MESSAGE;
}

/**
 * 并行读取的几部分（null 表示本次没读这一部分）：
 * - 任何一部分是教务授权过期，就整体按过期抛出，交给 runWithJwxtSession 走静默恢复或授权卡片；
 * - 全部失败时抛出第一个错误，工具整体回 ok:false；
 * - 部分失败时返回各部分的错误说明，成功的部分照常给出。
 */
export function inspectSettledParts(parts: Record<string, PromiseSettledResult<unknown> | null>): Record<string, string> {
  const entries = Object.entries(parts).filter((entry): entry is [string, PromiseSettledResult<unknown>] => entry[1] !== null);
  const failed = entries.filter((entry): entry is [string, PromiseRejectedResult] => entry[1].status === "rejected");
  for (const [, result] of failed) {
    const expired = jwxtAuthExpiredError(result.reason);
    if (expired) throw expired;
  }
  if (entries.length && failed.length === entries.length) throw failed[0][1].reason;
  return Object.fromEntries(failed.map(([key, result]) => [key, jwxtErrorMessage(result.reason)]));
}

export function schoolHasAcademicView(ctx: Pick<PersonalAgentToolContext, "schoolId">, view: AcademicView) {
  return getSchool(ctx.schoolId).academicViews.includes(view);
}

export async function runWithJwxtSession<T>(
  ctx: PersonalAgentToolContext,
  action: (token: string) => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; errorCode: string; message: string }> {
  const token = ctx.jwxtToken;
  if (!token) {
    if (ctx.studentSso && !ctx.retriedAfterRecover) {
      throw new JwxtReauthRequiredError("未检测到有效教务会话，请求静默恢复");
    }
    // 站内独立账号没有统一认证可恢复，不附加「恢复教务授权」卡片。
    if (ctx.studentSso) ctx.needsManualJwxtReauth = true;
    return {
      ok: false,
      errorCode: "JWXT_REAUTH_NEEDED",
      message: ctx.studentSso
        ? "学校统一认证会话已过期或尚未授权教务。请明确告知用户点击回答下方的「恢复教务授权」卡片完成验证，不要猜测任何个人教务数据。"
        : "当前为站内独立账号，未绑定学校统一认证会话。请提示用户前往教务或登录页使用学校统一认证登录。",
    };
  }
  try {
    const data = await action(token);
    return { ok: true, data };
  } catch (rawError) {
    if (rawError instanceof JwxtReauthRequiredError) throw rawError;
    if (jwxtAuthExpiredError(rawError)) {
      if (ctx.studentSso && !ctx.retriedAfterRecover) {
        throw new JwxtReauthRequiredError(jwxtErrorMessage(rawError));
      }
      if (ctx.studentSso) ctx.needsManualJwxtReauth = true;
      return {
        ok: false,
        errorCode: "JWXT_REAUTH_NEEDED",
        message: ctx.studentSso
          ? "学校统一认证登录已过期，无法读取实时教务数据。请提示用户点击下方的「恢复教务授权」卡片后再继续。"
          : "教务登录已过期，无法读取实时教务数据。请提示用户前往教务页使用学校统一认证重新登录。",
      };
    }
    return {
      ok: false,
      errorCode: "JWXT_UPSTREAM_ERROR",
      message: jwxtErrorMessage(rawError),
    };
  }
}

function extractDateFromExamTime(examTime?: string): string | null {
  if (!examTime) return null;
  const match = examTime.match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/u);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function diffCalendarDays(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 成绩精算结果：汇总在前、课程明细在后，并按预算收紧各列表。 */
export function buildGradesToolResult(
  rows: TranscriptGradeRow[],
  filter: { semester?: string; courseKeyword?: string } = {},
) {
  const analysis = analyzeAcademicGrades(rows);
  const keyword = String(filter.courseKeyword || "").trim().toLowerCase();
  const semFilter = String(filter.semester || "").trim();
  const matching = (keyword || semFilter)
    ? rows.filter((row) => (
      (!semFilter || row.semester === semFilter)
      && (!keyword || row.courseName.toLowerCase().includes(keyword) || String(row.courseCode || "").toLowerCase().includes(keyword))
    ))
    : null;

  return fitByListLimit((limit) => {
    const sectionLimit = Math.min(limit, 8);
    return {
      calculationNote: "以下GPA、学分与加权平均分已由服务端代码统一算出（同一门课只取一条有效记录、补考记1.0绩点、期末未出分的折算成绩不计入；等级制成绩按 优95/良85/中75/及格65 折算加权平均分），可能与学校官方成绩单略有出入。请直接引用这些数字，不要自行重算。",
      summary: {
        totalRawRows: analysis.totalRawRows,
        countedCourseCount: analysis.countedCourseCount,
        earnedCredits: analysis.earnedCredits,
        overallGpa: analysis.overallGpa,
        weightedScore: analysis.weightedScore,
        requiredCredits: analysis.requiredCredits,
        requiredGpa: analysis.requiredGpa,
        electiveCredits: analysis.electiveCredits,
        electiveGpa: analysis.electiveGpa,
        bySemester: analysis.bySemester,
        topCourses: analysis.topCourses.slice(0, sectionLimit).map(dropEmptyFields),
        dragCourses: analysis.dragCourses.slice(0, sectionLimit).map(dropEmptyFields),
        failedUnresolved: analysis.failedUnresolved.slice(0, limit).map(dropEmptyFields),
        ...(analysis.failedUnresolved.length > limit ? { failedUnresolvedTotal: analysis.failedUnresolved.length } : {}),
        pendingFinal: analysis.pendingFinal.slice(0, limit).map(dropEmptyFields),
        ...(analysis.pendingFinal.length > limit ? { pendingFinalTotal: analysis.pendingFinal.length } : {}),
      },
      ...(matching
        ? {
          matchingCoursesTotal: matching.length,
          matchingCourses: matching.slice(0, limit).map((row) => {
            const pending = isPendingFinalGrade(row);
            return dropEmptyFields({
              semester: row.semester || "",
              courseName: row.courseName,
              credits: row.credits ?? 0,
              score: row.score,
              // 与汇总同一口径：补考按 1.0；期末未出分的折算成绩不给绩点。
              gpa: pending ? null : transcriptGradePoint(row) ?? null,
              pendingFinal: pending || undefined,
              makeup: isTranscriptMakeup(row) || undefined,
              courseAttr: row.courseAttr || "",
              examType: row.examType || "",
              usual: row.usual || "",
              usualWeight: row.usualWeight || "",
              midterm: row.midterm || "",
              midtermWeight: row.midtermWeight || "",
              final: row.final || "",
              finalWeight: row.finalWeight || "",
            });
          }),
        }
        : {}),
    };
  });
}

/** 教务扩展档案：列表按预算截断并给出总数，学期下拉只留名称。 */
export function compactRecordsResult(raw: unknown) {
  const plain = JSON.parse(JSON.stringify(raw ?? {})) as Record<string, unknown>;
  return fitByListLimit((limit) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(plain)) {
      if (key === "source") continue;
      if (key === "semesters" && Array.isArray(value)) {
        out.semesterOptions = value.slice(0, 8).map((item) => {
          if (!item || typeof item !== "object") return String(item);
          const option = item as Record<string, unknown>;
          return String(option.label || option.value || "");
        });
        continue;
      }
      if (Array.isArray(value)) {
        out[key] = value.slice(0, limit).map((item) => {
          if (!item || typeof item !== "object") return item;
          const row = dropEmptyFields(item as Record<string, unknown>);
          // 毕业审核等分组结构：组内课程同样截断。
          if (Array.isArray(row.list)) {
            return { ...row, listTotal: row.list.length, list: (row.list as unknown[]).slice(0, limit).map(dropEmptyFields) };
          }
          return row;
        });
        if (value.length > limit) out[`${key}Total`] = value.length;
        continue;
      }
      out[key] = value;
    }
    return out;
  });
}

const gradesAnalysisSchema = z.object({
  semester: z.string().trim().max(20).optional().describe("可选：只列出某学期的课程明细，如 2025-2026-1；汇总仍覆盖全部学期"),
  courseKeyword: z.string().trim().max(40).optional().describe("可选：按课程名或课程号关键词筛选单科的平时/期中/期末构成"),
});

const examsAndMidtermSchema = z.object({
  semester: z.string().trim().max(20).optional().describe("可选：学期如 2025-2026-1，留空为当前学期"),
  includeMidterm: z.boolean().optional().default(true).describe("是否同时读取期中成绩，默认是"),
});

const graduationAuditSchema = z.object({
  courseKeyword: z.string().trim().max(40).optional().describe("可选：筛选培养方案或未修课程的关键词，如 公选 / 药理 / 英语"),
});

const recordsLookupSchema = z.object({
  kind: z.enum([
    "level-exams",
    "enrollment",
    "textbooks",
    "retake-options",
    "student-status",
    "major-transfer",
    "timetable-search",
  ]).describe("数据类型：level-exams 等级考试(四六级等)、enrollment 本学期选课记录、textbooks 教材、retake-options 可重修课程、student-status 学籍状态、major-transfer 转专业、timetable-search 全校教师/教室/课程课表检索"),
  semester: z.string().trim().max(20).optional().describe("可选：学期如 2025-2026-1，留空为当前学期"),
  scope: z.enum(["teacher", "classroom", "course"]).optional().describe("仅 timetable-search 时必填：按教师、教室还是课程检索"),
  keyword: z.string().trim().max(30).optional().describe("timetable-search 的检索词（至少两个字）"),
});

export const academicTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "academic_grades_analysis",
    scope: "academic",
    label: (args) => args?.courseKeyword
      ? `正在查询「${args.courseKeyword}」成绩明细并精算绩点…`
      : "正在读取成绩单并精算总绩点、必修绩点与刷分敏感度…",
    description: "读取本人全部教务成绩，由服务端代码统一计算总学分、总GPA、加权平均分、必修/选修拆分GPA、各学期绩点趋势、高分课、低绩点拖分课（含重修至85/90分后的GPA提升模拟）、挂科未通过及期末待出分课程。",
    schema: gradesAnalysisSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const grades = await withCache(
          "jwxt-grades",
          [JWXT_SOURCE_CACHE_REVISION, cacheId, "_"],
          GRADES_TTL_MS,
          () => getGrades(token, { semester: "" }),
        );
        return buildGradesToolResult(grades.list, { semester: args.semester, courseKeyword: args.courseKeyword });
      });
    },
  },
  {
    name: "academic_exams_and_midterm",
    scope: "academic",
    label: () => "正在读取考试安排、考场座位与期中成绩…",
    description: "查询本人的期末/补考考试时间、考场地点、座位号、倒计时天数，以及期中成绩单（部分学校教务不提供考试安排）。",
    schema: examsAndMidtermSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      const examsSupported = schoolHasAcademicView(ctx, "exams");
      const wantMidterm = args.includeMidterm !== false;
      if (!examsSupported && !wantMidterm) {
        return {
          ok: false,
          errorCode: "UNSUPPORTED",
          message: "本校教务系统不提供考试安排查询，请提示用户以学院或教务处通知为准。",
        };
      }
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const semester = String(args.semester || "").trim();
        const today = shanghaiNowParts(ctx.now).date;
        const [examsSettled, midtermSettled] = await Promise.allSettled([
          examsSupported
            ? withCache(
              "jwxt-exams",
              [JWXT_SOURCE_CACHE_REVISION, cacheId, semester || "_", "_"],
              EXAMS_TTL_MS,
              () => getExams(token, { semester }),
            )
            : Promise.resolve(null),
          wantMidterm
            ? withCache(
              "jwxt-midterm-grades",
              [JWXT_SOURCE_CACHE_REVISION, cacheId, semester || "_"],
              GRADES_TTL_MS,
              () => getMidtermGrades(token, { semester }),
            )
            : Promise.resolve(null),
        ]);
        const errors = inspectSettledParts({
          exams: examsSupported ? examsSettled : null,
          midterm: wantMidterm ? midtermSettled : null,
        });

        const examRows = examsSettled.status === "fulfilled" && examsSettled.value ? examsSettled.value.list : [];
        const annotatedExams = examRows.map((exam) => {
          const examDate = extractDateFromExamTime(exam.examTime);
          return {
            daysUntil: examDate ? diffCalendarDays(today, examDate) : null,
            exam: dropEmptyFields({
              semester: exam.semester || semester || "",
              courseName: exam.courseName,
              examTime: exam.examTime || "待定",
              location: exam.location || "待定",
              seat: exam.seat || "",
              examType: exam.examType || exam.examName || "",
            }),
          };
        });
        const present = (item: (typeof annotatedExams)[number]) => ({ ...item.exam, daysUntil: item.daysUntil });
        const upcoming = annotatedExams
          .filter((item) => item.daysUntil === null || item.daysUntil >= 0)
          .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999))
          .map(present);
        const finished = annotatedExams
          .filter((item) => item.daysUntil !== null && item.daysUntil < 0)
          .sort((a, b) => (b.daysUntil ?? 0) - (a.daysUntil ?? 0))
          .map(present);
        const midtermList = midtermSettled.status === "fulfilled" && midtermSettled.value ? midtermSettled.value.list : [];

        return fitByListLimit((limit) => ({
          today,
          ...(Object.keys(errors).length ? { partialErrors: errors } : {}),
          ...(examsSupported
            ? {
              upcomingExamsTotal: upcoming.length,
              upcomingExams: upcoming.slice(0, limit),
              finishedExamsCount: finished.length,
              recentFinishedExams: finished.slice(0, Math.min(limit, 5)),
            }
            : { examsNotice: "本校教务系统不提供考试安排查询，请提示用户以学院或教务处通知为准，不要猜测考试时间。" }),
          ...(wantMidterm
            ? {
              midtermGradesTotal: midtermList.length,
              midtermGrades: midtermList.slice(0, limit).map((row) => dropEmptyFields({
                semester: row.semester || "",
                courseName: row.courseName,
                score: row.score,
                credits: row.credits ?? 0,
                courseAttr: row.courseAttr || "",
              })),
            }
            : {}),
        }));
      });
    },
  },
  {
    name: "academic_graduation_audit",
    scope: "academic",
    label: () => "正在比对学业完成情况、培养方案与毕业学分缺口…",
    description: "联合查询学业完成情况、专业培养方案与毕业审核数据，核算各课程模块已获学分、要求学分、差额缺口及未修课程清单（按本校教务开放的部分）。",
    schema: graduationAuditSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      const wantProgress = schoolHasAcademicView(ctx, "progress");
      const wantPyfa = schoolHasAcademicView(ctx, "pyfa");
      const wantAudit = schoolHasAcademicView(ctx, "graduationAudit");
      if (!wantProgress && !wantPyfa && !wantAudit) {
        return {
          ok: false,
          errorCode: "UNSUPPORTED",
          message: "本校教务系统暂不提供学业完成情况、培养方案或毕业审核查询。",
        };
      }
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const [progressRes, pyfaRes, auditRes] = await Promise.allSettled([
          wantProgress
            ? withCache("jwxt-progress", [JWXT_SOURCE_CACHE_REVISION, cacheId], PROGRESS_TTL_MS, () => getProgress(token))
            : Promise.resolve(null),
          wantPyfa
            ? withCache("jwxt-pyfa", [JWXT_SOURCE_CACHE_REVISION, cacheId], PYFA_TTL_MS, () => getPyfa(token))
            : Promise.resolve(null),
          wantAudit
            ? withCache(
              "jwxt-records",
              [JWXT_SOURCE_CACHE_REVISION, cacheId, "graduation-audit", "_", "_", "_", "_", "_", "_", "_"],
              RECORDS_TTL_MS,
              () => getRecords(token, { kind: "graduation-audit" }),
            )
            : Promise.resolve(null),
        ]);
        const errors = inspectSettledParts({
          progress: wantProgress ? progressRes : null,
          pyfa: wantPyfa ? pyfaRes : null,
          graduationAudit: wantAudit ? auditRes : null,
        });

        const progress = progressRes.status === "fulfilled" ? progressRes.value : null;
        const pyfa = pyfaRes.status === "fulfilled" ? pyfaRes.value : null;
        const auditValue = auditRes.status === "fulfilled" ? auditRes.value : null;
        const audit = auditValue && auditValue.kind === "graduation-audit" ? auditValue : null;
        const keyword = String(args.courseKeyword || "").trim().toLowerCase();
        const matches = (...values: Array<string | undefined>) => (
          !keyword || values.some((value) => String(value || "").toLowerCase().includes(keyword))
        );

        const moduleGaps = (progress?.summary ?? []).filter((m) => m.leftMust > 0 || m.leftOpt > 0);
        const completedModules = (progress?.summary ?? []).filter((m) => m.leftMust <= 0 && m.leftOpt <= 0).map((m) => m.name);
        const uncompleted = (progress?.uncompleted ?? []).filter((c) => matches(c.courseName, c.attr));
        const pyfaMatches = keyword && pyfa ? pyfa.list.filter((c) => matches(c.courseName, c.attr, c.semester)) : [];
        // 毕业审核里最有用的是「应修未得」和「计划内尚未修读」；其余分组只给学分和门数（带关键词时也列出匹配课程）。
        const auditGroups = (audit?.groups ?? []).map((group) => ({
          group,
          detailed: group.key === "unearned" || group.key === "remaining" || Boolean(keyword),
          list: group.list.filter((c) => matches(c.courseName, c.category, c.nature, c.system)),
        }));

        return fitByListLimit((limit) => ({
          ...(Object.keys(errors).length ? { partialErrors: errors } : {}),
          totals: progress?.totals
            ? {
              ...progress.totals,
              totalRequired: Math.round((progress.totals.requiredMust + progress.totals.requiredOpt) * 100) / 100,
              totalEarned: Math.round((progress.totals.earnedMust + progress.totals.earnedOpt) * 100) / 100,
              totalGap: Math.round((progress.totals.leftMust + progress.totals.leftOpt) * 100) / 100,
            }
            : null,
          moduleGapsTotal: moduleGaps.length,
          moduleGaps: moduleGaps.slice(0, limit),
          completedModules: completedModules.slice(0, limit),
          uncompletedCount: progress?.uncompleted.length ?? 0,
          ...(keyword ? { uncompletedMatching: uncompleted.length } : {}),
          uncompletedCoursesSample: uncompleted.slice(0, limit).map((c) => dropEmptyFields({
            courseName: c.courseName,
            semester: c.semester || "",
            credits: c.credits,
            attr: c.attr || "",
          })),
          pyfaBySemester: pyfa?.bySemester ?? [],
          ...(keyword
            ? {
              pyfaMatchingTotal: pyfaMatches.length,
              pyfaMatchingCourses: pyfaMatches.slice(0, limit).map((c) => dropEmptyFields({
                semester: c.semester || "",
                courseName: c.courseName,
                credits: c.credits,
                attr: c.attr || "",
                examMethod: c.examMethod || "",
              })),
            }
            : {}),
          graduationAudit: audit
            ? auditGroups.map(({ group, detailed, list }) => ({
              key: group.key,
              label: group.label,
              credits: group.credits,
              courseCount: group.list.length,
              ...(detailed
                ? {
                  courses: list.slice(0, limit).map((c) => dropEmptyFields({
                    courseName: c.courseName,
                    semester: c.semester || "",
                    credits: c.credits,
                    category: c.category || "",
                    nature: c.nature || "",
                    score: c.score || "",
                  })),
                }
                : {}),
            }))
            : null,
        }));
      });
    },
  },
  {
    name: "academic_records_lookup",
    scope: "academic",
    label: (args) => {
      const names: Record<string, string> = {
        "level-exams": "正在查询四六级与等级考试成绩…",
        enrollment: "正在读取本学期选课记录…",
        textbooks: "正在读取课程教材信息…",
        "retake-options": "正在查询可重修课程…",
        "student-status": "正在读取学籍状态摘要…",
        "major-transfer": "正在查询转专业记录…",
        "timetable-search": `正在检索全校课表${args?.keyword ? `「${args.keyword}」` : ""}…`,
      };
      return names[args?.kind] || "正在查询教务扩展档案…";
    },
    description: "查询等级考试（四六级/计算机等）、选课记录、教材清单、可重修课程、学籍简况，或检索全校某位教师/教室/课程的开课排课。",
    schema: recordsLookupSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      const keyword = String(args.keyword || "").trim();
      if (args.kind === "timetable-search" && (!args.scope || keyword.length < 2)) {
        return { ok: false, errorCode: "INVALID_ARGS", message: "全校课表检索（timetable-search）必须同时提供 scope（teacher|classroom|course）和至少两个字的 keyword" };
      }
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const res = await withCache(
          "jwxt-records",
          [
            JWXT_SOURCE_CACHE_REVISION,
            cacheId,
            args.kind,
            args.semester || "_",
            "_",
            args.scope || "_",
            keyword || "_",
            "_",
            "_",
            "_",
          ],
          RECORDS_TTL_MS,
          () => getRecords(token, {
            kind: args.kind,
            semester: args.semester || undefined,
            scope: args.scope,
            keyword: keyword || undefined,
          }),
        );
        return compactRecordsResult(res);
      });
    },
  },
];
