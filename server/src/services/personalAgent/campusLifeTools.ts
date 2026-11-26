import { z } from "zod";
import { prisma } from "../../prisma";
import { schoolDriverFor, schoolDriverForToken } from "../../schools/drivers";
import { queryDormElectric } from "../dormElectric";
import { runWithJwxtSession } from "./academicTools";
import {
  guardToolScope,
  shanghaiNowParts,
  type PersonalAgentToolDefinition,
} from "./types";

const emptyArgsSchema = z.object({}).strict();

const libraryStatusSchema = z.object({
  includeHistory: z.boolean().optional().default(false).describe("是否同时查询历史借阅记录第1页"),
}).strict();

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const campusLifeTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "life_dorm_electric",
    scope: "campusLife",
    label: () => "正在查询本宿舍剩余电费与电量…",
    description: "根据用户绑定的学号查询本宿舍电费余额、剩余电量(度)、电价、房间楼栋信息与最近抄表时间。",
    schema: emptyArgsSchema,
    async execute(_args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      if (!ctx.studentSso || !ctx.username.trim()) {
        return {
          ok: false,
          errorCode: "NO_STUDENT_ID",
          message: "当前账号未绑定学校统一认证学号，无法自动定位宿舍电表，可前往「校园服务 → 宿舍电费」查看。",
        };
      }
      try {
        const result = await queryDormElectric(ctx.username.trim());
        const lowBalance = typeof result.balance === "number" && result.balance < 20;
        const lowKwh = typeof result.remainKwh === "number" && result.remainKwh < 30;
        return {
          ok: true,
          dorm: [result.area, result.building, result.floor, result.room].filter(Boolean).join(" "),
          balanceYuan: result.balance,
          remainKwh: result.remainKwh,
          usedKwh: result.usedKwh,
          pricePerKwh: result.price,
          lastUpdate: result.lastUpdate,
          lowElectricAlert: lowBalance || lowKwh,
        };
      } catch (error) {
        return {
          ok: false,
          errorCode: "ELECTRIC_UNAVAILABLE",
          message: error instanceof Error ? error.message : "宿舍电费查询服务暂时不可用",
        };
      }
    },
  },
  {
    name: "life_library_status",
    scope: "campusLife",
    label: () => "正在读取图书馆在借图书、到期时间与开放安排…",
    description: "读取本人在图书馆的当前在借图书、应还日期、可续借信息、违章欠款（如有）、借阅历史与图书馆开放时间。",
    schema: libraryStatusSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      const openHoursPromise = schoolDriverFor(ctx.schoolId)?.library?.openHours().catch(() => null) ?? Promise.resolve(null);
      const jwxtRes = await runWithJwxtSession(ctx, async (token) => {
        const lib = schoolDriverForToken(token)?.library;
        if (!lib) {
          return { supported: false, message: "当前学校暂未接入图书馆借阅查询" };
        }
        const [overview, history] = await Promise.all([
          lib.overview(token, ctx.signal),
          args.includeHistory ? lib.history(token, 1, ctx.signal).catch(() => null) : Promise.resolve(null),
        ]);
        return { supported: true, overview, history };
      });
      const openHours = await openHoursPromise;
      if (!jwxtRes.ok) {
        return { ...jwxtRes, openHours };
      }
      return {
        ok: true,
        today: shanghaiNowParts(ctx.now).date,
        ...jwxtRes.data,
        openHours,
      };
    },
  },
  {
    name: "life_my_campus_tasks",
    scope: "campusLife",
    label: () => "正在检索我的平时分核对单、问卷与文件收集待办…",
    description: "汇总站内小工具中与本人相关的事项：老师发布的成绩核对单（含本人的平时分/实验分明细行）、本人填写或开放中的问卷、文件收集任务及提交状态。",
    schema: emptyArgsSchema,
    async execute(_args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      const studentId = ctx.username.trim().toUpperCase();

      const [gradeRows, mySubmissions, openFileTasks, myQuestionnaireResponses] = await Promise.all([
        studentId
          ? prisma.gradeCheckRow.findMany({
            where: {
              studentId: { equals: studentId, mode: "insensitive" },
              table: { status: "open" },
            },
            take: 15,
            orderBy: { createdAt: "desc" },
            include: {
              table: {
                select: {
                  slug: true,
                  title: true,
                  description: true,
                  columns: true,
                  updatedAt: true,
                  createdBy: { select: { nickname: true } },
                },
              },
            },
          })
          : Promise.resolve([]),
        prisma.fileCollectSubmission.findMany({
          where: { submitterId: ctx.userId },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: {
            taskId: true,
            status: true,
            createdAt: true,
            task: { select: { slug: true, title: true, status: true, deadline: true } },
          },
        }),
        prisma.fileCollectTask.findMany({
          where: {
            OR: [
              { createdById: ctx.userId },
              { status: "open", expectedEntries: studentId ? { contains: studentId } : undefined },
            ].filter(Boolean) as any,
          },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            deadline: true,
            createdById: true,
          },
        }),
        prisma.questionnaireResponse.findMany({
          where: { respondentId: ctx.userId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            createdAt: true,
            questionnaire: { select: { slug: true, title: true, status: true } },
          },
        }),
      ]);

      const submittedTaskIds = new Set(mySubmissions.map((s) => s.taskId));

      const gradeChecks = gradeRows.map((row) => {
        const payload = safeJsonParse<Record<string, unknown>>(row.payload, {});
        return {
          title: row.table.title,
          description: row.table.description || "",
          publisher: row.table.createdBy?.nickname || "教师/管理员",
          url: `/services/tools/grade_check?slug=${encodeURIComponent(row.table.slug)}`,
          updatedAt: row.table.updatedAt.toISOString().slice(0, 10),
          myRowValues: payload,
        };
      });

      const fileTasks = openFileTasks.map((task) => ({
        title: task.title,
        status: task.status,
        isCreatedByMe: task.createdById === ctx.userId,
        submittedByMe: submittedTaskIds.has(task.id),
        deadline: task.deadline ? task.deadline.toISOString().slice(0, 16).replace("T", " ") : null,
        url: `/services/tools/file_collect?slug=${encodeURIComponent(task.slug)}`,
      }));

      return {
        ok: true,
        gradeCheckTablesForMe: gradeChecks,
        fileCollectionTasks: fileTasks,
        recentSubmittedFiles: mySubmissions.slice(0, 8).map((s) => ({
          title: s.task.title,
          submittedAt: s.createdAt.toISOString().slice(0, 16).replace("T", " "),
          url: `/services/tools/file_collect?slug=${encodeURIComponent(s.task.slug)}`,
        })),
        recentFilledQuestionnaires: myQuestionnaireResponses.map((r) => ({
          title: r.questionnaire.title,
          filledAt: r.createdAt.toISOString().slice(0, 10),
          url: `/services/tools/questionnaire?slug=${encodeURIComponent(r.questionnaire.slug)}`,
        })),
      };
    },
  },
];
