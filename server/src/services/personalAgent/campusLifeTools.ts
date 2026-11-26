import { z } from "zod";
import { prisma } from "../../prisma";
import { schoolDriverFor, schoolDriverForToken } from "../../schools/drivers";
import { isSchoolModuleEnabled, isSchoolPathEnabled } from "../../schools/modules";
import { resolveSchoolId } from "../../schools/registry";
import { queryDormElectric } from "../dormElectric";
import { assertToolUsable, type ServiceToolCode } from "../serviceTools";
import { isFeatureOn } from "../siteSettings";
import { runWithJwxtSession } from "./academicTools";
import {
  guardToolScope,
  shanghaiNowParts,
  type PersonalAgentToolContext,
  type PersonalAgentToolDefinition,
} from "./types";

const emptyArgsSchema = z.object({}).strict();

const libraryStatusSchema = z.object({
  includeHistory: z.boolean().optional().default(false).describe("是否同时查询历史借阅记录第 1 页，默认否"),
}).strict();

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function shanghaiMinute(date: Date) {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 把学校驱动等外部来源返回的任意结构压成给模型看的大小：数组截断并注明总数、长字符串截断、
 * 过深的层级折叠。结构不变，字段名不变。
 */
export function compactForAgent(
  value: unknown,
  options: { maxArray?: number; maxString?: number; maxDepth?: number; maxKeys?: number } = {},
  depth = 0,
): unknown {
  const maxArray = options.maxArray ?? 15;
  const maxString = options.maxString ?? 160;
  const maxDepth = options.maxDepth ?? 5;
  const maxKeys = options.maxKeys ?? 30;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= maxDepth) return Array.isArray(value) ? `[${value.length} 项]` : "{…}";
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map((item) => compactForAgent(item, options, depth + 1));
    return value.length > maxArray ? [...items, `…另有 ${value.length - maxArray} 项未列出`] : items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, maxKeys)) out[key] = compactForAgent(item, options, depth + 1);
  return out;
}

/** 查分单按站内账号学号匹配，规则与查分单页相同：去掉空白后精确匹配。 */
export function normalizeGradeCheckStudentId(username: string | null | undefined) {
  return String(username ?? "").trim().replace(/\s+/gu, "");
}

/**
 * 文件收集的应交名单每行一个身份（与收集统计同一格式），也兼容“姓名 学号”“姓名,学号”这类一行多列的写法；
 * 学号必须作为完整的一项出现，不能只是某一项的一部分。
 */
export function rosterIncludesStudent(expectedEntries: string | null | undefined, studentId: string) {
  const target = String(studentId || "").trim().toLowerCase();
  if (!target) return false;
  return String(expectedEntries || "")
    .split(/\r?\n/u)
    .some((line) => line.split(/[\s,，;；、|\t]+/u).some((token) => token.trim().toLowerCase() === target));
}

/** 小工具是否对本人可用：本校开着这个工具入口，且通过工具自身的使用限制（与工具页同一判断）。 */
async function isServiceToolUsableForAgent(code: ServiceToolCode, ctx: PersonalAgentToolContext) {
  if (!isSchoolPathEnabled(resolveSchoolId(ctx.schoolId), `/services/tools/${code}`)) return false;
  try {
    await assertToolUsable(code, { userId: ctx.userId, role: ctx.role });
    return true;
  } catch {
    return false;
  }
}

export const campusLifeTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "life_dorm_electric",
    scope: "campusLife",
    label: () => "正在查询本宿舍剩余电费与电量…",
    description: "根据用户绑定的学号查询本宿舍电费余额、剩余电量(度)、电价、房间楼栋信息与最近抄表时间（仅开通宿舍电费查询的学校可用）。",
    schema: emptyArgsSchema,
    async execute(_args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      // 电费查的是本校电表系统，学号只在本校内唯一：别的学校的学号不能拿去查。
      if (!isSchoolModuleEnabled(resolveSchoolId(ctx.schoolId), "dormElectric") || !isFeatureOn("electric")) {
        return {
          ok: false,
          errorCode: "FEATURE_CLOSED",
          message: "本校暂未开放宿舍电费查询",
        };
      }
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
          message: error instanceof Error ? error.message.slice(0, 120) : "宿舍电费查询服务暂时不可用",
        };
      }
    },
  },
  {
    name: "life_library_status",
    scope: "campusLife",
    label: () => "正在读取图书馆在借图书、到期时间与开放安排…",
    description: "读取本人在图书馆的当前在借图书、应还日期、可续借信息、违章欠款（如有）、借阅历史与图书馆开放时间（仅接入图书馆借阅的学校可用）。",
    schema: libraryStatusSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      const schoolId = resolveSchoolId(ctx.schoolId);
      const schoolLibrary = schoolDriverFor(schoolId)?.library;
      // 先确认本校接了图书馆，再去要教务会话：没接入的学校不必为此触发静默恢复或授权卡片。
      if (!schoolLibrary || !isSchoolModuleEnabled(schoolId, "library")) {
        return { ok: false, errorCode: "FEATURE_CLOSED", message: "本校暂未接入图书馆借阅查询" };
      }
      const openHoursPromise = schoolLibrary.openHours().catch(() => null);
      const jwxtRes = await runWithJwxtSession(ctx, async (token) => {
        const lib = schoolDriverForToken(token)?.library;
        if (!lib) {
          return { supported: false, message: "当前登录会话所属学校暂未接入图书馆借阅查询" };
        }
        const [overview, history] = await Promise.all([
          lib.overview(token, ctx.signal),
          args.includeHistory ? lib.history(token, 1, ctx.signal).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          supported: true,
          overview: compactForAgent(overview, { maxArray: 20 }),
          history: history === null ? null : compactForAgent(history, { maxArray: 12, maxString: 100 }),
        };
      });
      const openHours = compactForAgent(await openHoursPromise, { maxArray: 10, maxString: 100 });
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
    description: "汇总站内小工具中与本人相关的事项：老师发布的成绩核对单（含本人的平时分/实验分明细行）、本人填写过的问卷、文件收集任务及提交状态。",
    schema: emptyArgsSchema,
    async execute(_args, ctx) {
      const blocked = guardToolScope(ctx, "campusLife");
      if (blocked) return blocked;
      // 查分单和应交名单按学号认人，只有经学校统一认证确认过学号的账号才按学号匹配。
      const studentId = ctx.studentSso ? normalizeGradeCheckStudentId(ctx.username) : "";

      const [gradeUsable, fileUsable, questionnaireUsable] = await Promise.all([
        isServiceToolUsableForAgent("grade_check", ctx),
        isServiceToolUsableForAgent("file_collect", ctx),
        isServiceToolUsableForAgent("questionnaire", ctx),
      ]);

      const [gradeRows, candidateTasks, recentSubmissions, myQuestionnaireResponses] = await Promise.all([
        gradeUsable && studentId
          ? prisma.gradeCheckRow.findMany({
            where: { studentId, table: { status: "open" } },
            take: 10,
            orderBy: { createdAt: "desc" },
            select: {
              payload: true,
              table: {
                select: {
                  slug: true,
                  title: true,
                  description: true,
                  updatedAt: true,
                  createdBy: { select: { nickname: true } },
                },
              },
            },
          })
          : Promise.resolve([]),
        fileUsable
          ? prisma.fileCollectTask.findMany({
            where: {
              OR: [
                { createdById: ctx.userId },
                ...(studentId ? [{ status: "open", expectedEntries: { contains: studentId } }] : []),
              ],
            },
            orderBy: { createdAt: "desc" },
            take: 30,
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              deadline: true,
              createdById: true,
              expectedEntries: true,
            },
          })
          : Promise.resolve([]),
        fileUsable
          ? prisma.fileCollectSubmission.findMany({
            where: { submitterId: ctx.userId },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              createdAt: true,
              task: { select: { slug: true, title: true } },
            },
          })
          : Promise.resolve([]),
        questionnaireUsable
          ? prisma.questionnaireResponse.findMany({
            where: { respondentId: ctx.userId },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              createdAt: true,
              questionnaire: { select: { slug: true, title: true } },
            },
          })
          : Promise.resolve([]),
      ]);

      // 数据库里先粗筛包含学号的任务，再按名单逐项精确比对，避免学号只是别人一项里的一部分时误配。
      const fileTasks = candidateTasks
        .filter((task) => task.createdById === ctx.userId || rosterIncludesStudent(task.expectedEntries, studentId))
        .slice(0, 12);
      const submittedRows = fileTasks.length
        ? await prisma.fileCollectSubmission.findMany({
          where: { submitterId: ctx.userId, taskId: { in: fileTasks.map((task) => task.id) } },
          select: { taskId: true },
        })
        : [];
      const submittedTaskIds = new Set(submittedRows.map((row) => row.taskId));

      return {
        ok: true,
        ...(studentId ? {} : { note: "当前账号未经学校统一认证确认学号，未按学号匹配查分单与应交名单" }),
        gradeCheckTablesForMe: gradeRows.map((row) => ({
          title: row.table.title,
          description: (row.table.description || "").slice(0, 160),
          publisher: row.table.createdBy?.nickname || "教师/管理员",
          url: `/services/tools/grade_check?slug=${encodeURIComponent(row.table.slug)}`,
          updatedAt: row.table.updatedAt.toISOString().slice(0, 10),
          myRowValues: compactForAgent(safeJsonParse<Record<string, unknown>>(row.payload, {}), { maxString: 80, maxKeys: 40 }),
        })),
        fileCollectionTasks: fileTasks.map((task) => ({
          title: task.title,
          status: task.status,
          isCreatedByMe: task.createdById === ctx.userId,
          submittedByMe: submittedTaskIds.has(task.id),
          deadline: task.deadline ? shanghaiMinute(task.deadline) : null,
          url: `/services/tools/file_collect?slug=${encodeURIComponent(task.slug)}`,
        })),
        recentSubmittedFiles: recentSubmissions.map((s) => ({
          title: s.task.title,
          submittedAt: shanghaiMinute(s.createdAt),
          url: `/services/tools/file_collect?slug=${encodeURIComponent(s.task.slug)}`,
        })),
        recentFilledQuestionnaires: myQuestionnaireResponses.map((r) => ({
          title: r.questionnaire.title,
          filledAt: shanghaiMinute(r.createdAt).slice(0, 10),
          url: `/services/tools/questionnaire?slug=${encodeURIComponent(r.questionnaire.slug)}`,
        })),
      };
    },
  },
];
