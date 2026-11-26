import crypto from "node:crypto";
import { z } from "zod";
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
import { analyzeAcademicGrades } from "../../shared/jwxtGradeStats";
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

export function jwxtCacheId(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
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
    ctx.needsManualJwxtReauth = true;
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
    const classified = classifyJwxtError(rawError);
    if (classified instanceof HttpError && classified.code === JWXT_AUTH_EXPIRED_CODE) {
      if (ctx.studentSso && !ctx.retriedAfterRecover) {
        throw new JwxtReauthRequiredError(classified.message);
      }
      ctx.needsManualJwxtReauth = true;
      return {
        ok: false,
        errorCode: "JWXT_REAUTH_NEEDED",
        message: "学校统一认证登录已过期，无法读取实时教务数据。请提示用户点击下方的「恢复教务授权」卡片后再继续。",
      };
    }
    const message = classified instanceof Error ? classified.message : "学校教务系统暂时未能返回可识别的数据";
    return {
      ok: false,
      errorCode: "JWXT_UPSTREAM_ERROR",
      message,
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

const gradesAnalysisSchema = z.object({
  semester: z.string().trim().max(20).optional().describe("可选：重点查看某学期的课程明细，如 2025-2026-1；留空仍会返回全部学期汇总趋势"),
  courseKeyword: z.string().trim().max(40).optional().describe("可选：按课程名关键词筛选具体单科平时/期中/期末构成"),
}).strict();

const examsAndMidtermSchema = z.object({
  semester: z.string().trim().max(20).optional().describe("可选：指定学期如 2025-2026-1，留空为当前默认学期"),
  includeMidterm: z.boolean().optional().default(true).describe("是否同时读取期中成绩列表"),
}).strict();

const graduationAuditSchema = z.object({
  courseKeyword: z.string().trim().max(40).optional().describe("可选：筛选培养方案或未修课程关键词，如 公选 / 药理 / 英语"),
}).strict();

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
  semester: z.string().trim().max(20).optional(),
  scope: z.enum(["teacher", "classroom", "course"]).optional().describe("仅 timetable-search 时必填"),
  keyword: z.string().trim().max(60).optional().describe("timetable-search 搜索词或课程筛选词"),
}).strict();

export const academicTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "academic_grades_analysis",
    scope: "academic",
    label: (args) => args?.courseKeyword
      ? `正在查询「${args.courseKeyword}」成绩明细并精算绩点…`
      : "正在读取成绩单并精算总绩点、必修绩点与刷分敏感度…",
    description: "读取本人全部教务成绩，由服务端代码按电子成绩单口径精确计算总学分、总GPA、加权平均分、必修/选修拆分GPA、各学期绩点趋势、高分课、低绩点拖分课（含重修至85/90分后的GPA提升模拟）、挂科未通过及期末待出分课程。",
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
        const analysis = analyzeAcademicGrades(grades.list);
        const keyword = String(args.courseKeyword || "").trim().toLowerCase();
        const semFilter = String(args.semester || "").trim();
        const filteredRows = (keyword || semFilter)
          ? grades.list
            .filter((row) => (
              (!semFilter || row.semester === semFilter)
              && (!keyword || row.courseName.toLowerCase().includes(keyword) || String(row.courseCode || "").toLowerCase().includes(keyword))
            ))
            .slice(0, 40)
            .map((row) => ({
              semester: row.semester || "",
              courseName: row.courseName,
              credits: row.credits ?? 0,
              score: row.score,
              gpa: row.gpa,
              courseAttr: row.courseAttr || "",
              examType: row.examType || "",
              usual: row.usual || "",
              usualWeight: row.usualWeight || "",
              midterm: row.midterm || "",
              midtermWeight: row.midtermWeight || "",
              final: row.final || "",
              finalWeight: row.finalWeight || "",
            }))
          : undefined;
        return {
          calculationNote: "以下GPA与学分已由服务端按学校电子成绩单口径精确算出（自动折叠重修补考、补考记1.0绩点、剔除期末未出分折算项），请直接引用数字，不要自行重算。",
          summary: analysis,
          ...(filteredRows ? { matchingCourses: filteredRows } : {}),
        };
      });
    },
  },
  {
    name: "academic_exams_and_midterm",
    scope: "academic",
    label: () => "正在读取考试安排、考场座位与期中成绩…",
    description: "查询本人的期末/补考考试时间、考场地点、座位号、倒计时天数，以及期中成绩单。",
    schema: examsAndMidtermSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const semester = String(args.semester || "").trim();
        const today = shanghaiNowParts(ctx.now).date;
        const [examsSettled, midtermSettled] = await Promise.allSettled([
          withCache(
            "jwxt-exams",
            [JWXT_SOURCE_CACHE_REVISION, cacheId, semester || "_", "_"],
            EXAMS_TTL_MS,
            () => getExams(token, { semester }),
          ),
          args.includeMidterm !== false
            ? withCache(
              "jwxt-midterm-grades",
              [JWXT_SOURCE_CACHE_REVISION, cacheId, semester || "_"],
              GRADES_TTL_MS,
              () => getMidtermGrades(token, { semester }),
            )
            : Promise.resolve(null),
        ]);

        const examRows = examsSettled.status === "fulfilled" ? examsSettled.value.list : [];
        const annotatedExams = examRows.map((exam) => {
          const examDate = extractDateFromExamTime(exam.examTime);
          const daysUntil = examDate ? diffCalendarDays(today, examDate) : null;
          return {
            semester: exam.semester || semester || "",
            courseName: exam.courseName,
            examTime: exam.examTime || "待定",
            location: exam.location || "待定",
            seat: exam.seat || "",
            examType: exam.examType || exam.examName || "",
            daysUntil,
          };
        });

        const upcomingExams = annotatedExams
          .filter((item) => item.daysUntil === null || item.daysUntil >= 0)
          .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
        const finishedExams = annotatedExams
          .filter((item) => item.daysUntil !== null && item.daysUntil < 0)
          .sort((a, b) => (b.daysUntil ?? 0) - (a.daysUntil ?? 0));

        const midtermRows = midtermSettled.status === "fulfilled" && midtermSettled.value
          ? midtermSettled.value.list.slice(0, 40).map((row) => ({
            semester: row.semester || "",
            courseName: row.courseName,
            score: row.score,
            credits: row.credits ?? 0,
            courseAttr: row.courseAttr || "",
          }))
          : [];

        return {
          today,
          upcomingExams,
          finishedExamsCount: finishedExams.length,
          recentFinishedExams: finishedExams.slice(0, 10),
          midtermGrades: midtermRows,
        };
      });
    },
  },
  {
    name: "academic_graduation_audit",
    scope: "academic",
    label: () => "正在比对学业完成情况、培养方案与毕业学分缺口…",
    description: "联合查询学业完成情况（xywcqk）、专业培养方案（pyfa）与毕业审核数据，精确核算各课程模块已获学分、要求学分、差额缺口及未修课程清单。",
    schema: graduationAuditSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "academic");
      if (blocked) return blocked;
      return runWithJwxtSession(ctx, async (token) => {
        const cacheId = jwxtCacheId(token);
        const [progressRes, pyfaRes, auditRes] = await Promise.allSettled([
          withCache("jwxt-progress", [JWXT_SOURCE_CACHE_REVISION, cacheId], PROGRESS_TTL_MS, () => getProgress(token)),
          withCache("jwxt-pyfa", [JWXT_SOURCE_CACHE_REVISION, cacheId], PYFA_TTL_MS, () => getPyfa(token)),
          withCache("jwxt-records", [JWXT_SOURCE_CACHE_REVISION, cacheId, "graduation-audit", "_", "_", "_", "_", "_", "_", "_"], RECORDS_TTL_MS, () => getRecords(token, { kind: "graduation-audit" })),
        ]);

        const progress = progressRes.status === "fulfilled" ? progressRes.value : null;
        const pyfa = pyfaRes.status === "fulfilled" ? pyfaRes.value : null;
        const audit = auditRes.status === "fulfilled" ? auditRes.value : null;
        const keyword = String(args.courseKeyword || "").trim().toLowerCase();

        const moduleGaps = (progress?.summary ?? []).filter((m) => m.leftMust > 0 || m.leftOpt > 0);
        const uncompleted = (progress?.uncompleted ?? [])
          .filter((c) => !keyword || c.courseName.toLowerCase().includes(keyword) || String(c.attr || "").toLowerCase().includes(keyword))
          .slice(0, 35);
        const pyfaMatches = keyword && pyfa
          ? pyfa.list
            .filter((c) => c.courseName.toLowerCase().includes(keyword) || String(c.attr || "").toLowerCase().includes(keyword) || String(c.semester || "").includes(keyword))
            .slice(0, 35)
          : (pyfa?.list ?? []).slice(0, 20);

        return {
          totals: progress?.totals
            ? {
              ...progress.totals,
              totalRequired: Math.round((progress.totals.requiredMust + progress.totals.requiredOpt) * 100) / 100,
              totalEarned: Math.round((progress.totals.earnedMust + progress.totals.earnedOpt) * 100) / 100,
              totalGap: Math.round((progress.totals.leftMust + progress.totals.leftOpt) * 100) / 100,
            }
            : null,
          moduleGaps,
          allModules: progress?.summary ?? [],
          uncompletedCount: progress?.uncompleted.length ?? 0,
          uncompletedCoursesSample: uncompleted,
          pyfaBySemester: pyfa?.bySemester ?? [],
          pyfaCoursesSample: pyfaMatches,
          graduationAuditSummary: audit ? JSON.parse(JSON.stringify(audit)).rows?.slice?.(0, 20) ?? audit : null,
        };
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
      if (args.kind === "timetable-search" && (!args.scope || !args.keyword?.trim())) {
        return { ok: false, errorCode: "INVALID_ARGS", message: "全校课表检索（timetable-search）必须同时提供 scope（teacher|classroom|course）和 keyword" };
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
            args.keyword || "_",
            "_",
            "_",
            "_",
          ],
          RECORDS_TTL_MS,
          () => getRecords(token, {
            kind: args.kind,
            semester: args.semester,
            scope: args.scope,
            keyword: args.keyword,
          }),
        );
        const plain = JSON.parse(JSON.stringify(res)) as Record<string, unknown>;
        if (Array.isArray(plain.rows) && plain.rows.length > 40) {
          plain.totalRows = plain.rows.length;
          plain.rows = plain.rows.slice(0, 40);
        }
        return plain;
      });
    },
  },
];
