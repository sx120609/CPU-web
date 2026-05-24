import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  assertToolUsable,
  hasToolContentManagePermission,
  hasToolManagerPermission,
  isServiceToolCode,
  listContentManageableToolCodes,
  listManagerToolCodes,
  listToolSettings,
  managerSelect,
  SERVICE_TOOL_CODES,
  SERVICE_TOOL_META,
  updateToolSetting,
} from "../services/serviceTools";
import {
  ensureSystemQuestionnaires,
  normalizeQuestionnaire,
  normalizeResponse,
  parseFields,
  type QuestionnaireField,
} from "../services/questionnaires";

export const toolsRouter = Router();

const fieldSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, "字段 ID 仅支持英文、数字、下划线和中划线"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "textarea", "single", "multiple", "number", "date", "rating"]),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  description: z.string().trim().max(300).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
  maxLength: z.number().int().positive().max(2000).optional(),
});

const QUESTIONNAIRE_TOOL_CODES = ["feedback", "questionnaire"] as const;
const questionnaireToolCodeSchema = z.enum(QUESTIONNAIRE_TOOL_CODES);

const createQuestionnaireSchema = z.object({
  toolCode: questionnaireToolCodeSchema.default("questionnaire"),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  allowAnonymous: z.boolean().optional(),
  oneResponsePerUser: z.boolean().optional(),
  fields: z.array(fieldSchema).min(1).max(30),
});

const patchQuestionnaireSchema = createQuestionnaireSchema.partial().extend({
  status: z.enum(["draft", "open", "closed"]).optional(),
});

const responseSchema = z.object({
  answers: z.record(z.union([z.string(), z.array(z.string())])),
});

const gradeCheckCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const gradeCheckRowSchema = z.record(gradeCheckCellSchema);
const createGradeCheckSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  studentIdColumn: z.string().trim().min(1).max(80).default("学号"),
  columns: z.array(z.string().trim().min(1).max(80)).min(2).max(80),
  rows: z.array(gradeCheckRowSchema).min(1).max(10000),
});
const patchGradeCheckSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  studentIdColumn: z.string().trim().min(1).max(80).optional(),
  columns: z.array(z.string().trim().min(1).max(80)).min(2).max(80).optional(),
  rows: z.array(gradeCheckRowSchema).min(1).max(10000).optional(),
});

const managerCreateSchema = z.object({
  userId: z.number().int().positive().optional(),
  username: z.string().trim().min(1).max(40).optional(),
}).refine((value) => value.userId || value.username, {
  message: "请选择用户或输入用户名",
});

const toolSettingPatchSchema = z.object({
  requireLogin: z.boolean().optional(),
  allowPublicManage: z.boolean().optional(),
});

toolsRouter.use(async (_req, _res, next) => {
  try {
    await ensureSystemQuestionnaires();
    next();
  } catch (e) {
    next(e);
  }
});

toolsRouter.get("/", authOptional, async (req, res, next) => {
  try {
    const managerCodes = await listManagerToolCodes(req.user);
    const manageableCodes = await listContentManageableToolCodes(req.user);
    const settings = await listToolSettings();
    ok(res, SERVICE_TOOL_CODES.map((code) => ({
      ...SERVICE_TOOL_META[code],
      requireLogin: settings.get(code)?.requireLogin ?? false,
      allowPublicManage: settings.get(code)?.allowPublicManage ?? false,
      canManage: manageableCodes.includes(code),
      canAdmin: managerCodes.includes(code),
    })));
  } catch (e) { next(e); }
});

toolsRouter.patch("/:toolCode/settings", authRequired, validate(toolSettingPatchSchema), async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagerPermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const row = await updateToolSetting(toolCode, {
      requireLogin: req.body.requireLogin,
      allowPublicManage: req.body.allowPublicManage,
    });
    ok(res, {
      toolCode: row.toolCode,
      requireLogin: row.requireLogin,
      allowPublicManage: row.allowPublicManage,
      updatedAt: row.updatedAt,
    });
  } catch (e) { next(e); }
});

toolsRouter.get("/permissions/me", authRequired, async (req, res, next) => {
  try {
    const [toolCodes, adminToolCodes] = await Promise.all([
      listContentManageableToolCodes(req.user),
      listManagerToolCodes(req.user),
    ]);
    ok(res, { toolCodes, adminToolCodes });
  } catch (e) { next(e); }
});

toolsRouter.get("/:toolCode/managers", authRequired, async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagerPermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const rows = await prisma.toolPermission.findMany({
      where: { toolCode },
      orderBy: [{ createdAt: "desc" }],
      select: managerSelect(),
    });
    ok(res, rows);
  } catch (e) { next(e); }
});

toolsRouter.post("/:toolCode/managers", authRequired, validate(managerCreateSchema), async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagerPermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");

    const target = req.body.userId
      ? await prisma.user.findUnique({ where: { id: req.body.userId } })
      : await prisma.user.findUnique({ where: { username: req.body.username } });
    if (!target) throw Errors.notFound("用户不存在");
    if (target.status === "banned") throw Errors.badRequest("不能分配给已封禁用户");

    const row = await prisma.toolPermission.upsert({
      where: { toolCode_userId: { toolCode, userId: target.id } },
      update: { role: "manager" },
      create: { toolCode, userId: target.id, role: "manager" },
      select: managerSelect(),
    });
    ok(res, row);
  } catch (e) { next(e); }
});

toolsRouter.delete("/:toolCode/managers/:userId", authRequired, async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    const userId = Number(req.params.userId);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagerPermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    if (userId === req.user!.userId && req.user!.role !== "admin") {
      throw Errors.badRequest("不能移除自己的管理权限");
    }
    await prisma.toolPermission.delete({
      where: { toolCode_userId: { toolCode, userId } },
    }).catch(() => null);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/grade-checks", authRequired, async (req, res, next) => {
  try {
    if (req.query.manage !== "1") {
      ok(res, []);
      return;
    }
    if (!(await hasToolContentManagePermission("grade_check", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const isManager = await hasToolManagerPermission("grade_check", req.user);
    const list = await prisma.gradeCheckTable.findMany({
      where: isManager ? {} : { createdById: req.user!.userId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, list.map(normalizeGradeCheckTable));
  } catch (e) { next(e); }
});

toolsRouter.get("/grade-checks/related", authRequired, async (req, res, next) => {
  try {
    await ensureToolUsableForRequest("grade_check", req.user);
    const studentId = normalizeStudentId(req.user!.studentId);
    const rows = await prisma.gradeCheckRow.findMany({
      where: {
        studentId,
        table: { status: "open" },
      },
      include: {
        table: {
          include: {
            createdBy: { select: { id: true, username: true, nickname: true, role: true } },
          },
        },
      },
    });
    ok(res, rows
      .map((row) => normalizeGradeCheckTable(row.table))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  } catch (e) { next(e); }
});

toolsRouter.get("/grade-checks/:slug", authRequired, async (req, res, next) => {
  try {
    const table = await prisma.gradeCheckTable.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    if (!table) throw Errors.notFound("查询表不存在");
    const canManage = await canManageGradeCheckTable(table, req.user);
    if (!canManage) await ensureToolUsableForRequest("grade_check", req.user);
    if (table.status !== "open" && !canManage) throw Errors.notFound("查询表不存在或未开放");

    const studentId = normalizeStudentId(req.user!.studentId);
    const row = await prisma.gradeCheckRow.findUnique({
      where: {
        tableId_studentId: {
          tableId: table.id,
          studentId,
        },
      },
    });
    ok(res, {
      table: normalizeGradeCheckTable(table),
      studentId,
      row: row ? parseGradePayload(row.payload) : null,
      canManage,
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/grade-checks", authRequired, validate(createGradeCheckSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("grade_check", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const normalized = normalizeGradeCheckInput(req.body);
    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.gradeCheckTable.create({
        data: {
          slug: await nextGradeCheckSlug(req.body.title),
          title: req.body.title,
          description: req.body.description || null,
          status: req.body.status ?? "open",
          studentIdColumn: normalized.studentIdColumn,
          columns: JSON.stringify(normalized.columns),
          rowCount: normalized.rows.length,
          createdById: req.user!.userId,
          publishedAt: (req.body.status ?? "open") === "open" ? now : null,
          closedAt: req.body.status === "closed" ? now : null,
        },
      });
      await tx.gradeCheckRow.createMany({
        data: normalized.rows.map((item) => ({
          tableId: created.id,
          studentId: item.studentId,
          payload: JSON.stringify(item.payload),
        })),
      });
      return tx.gradeCheckTable.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        },
      });
    });
    ok(res, normalizeGradeCheckTable(row));
  } catch (e) { next(e); }
});

toolsRouter.patch("/grade-checks/:id", authRequired, validate(patchGradeCheckSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.gradeCheckTable.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("查询表不存在");
    if (!(await canManageGradeCheckTable(current, req.user))) throw Errors.forbidden("没有该查询表的管理权限");

    const hasRows = Boolean(req.body.rows || req.body.columns || req.body.studentIdColumn);
    if (hasRows && !req.body.rows) throw Errors.badRequest("更新行列时需要重新上传完整数据");
    const normalized = hasRows ? normalizeGradeCheckInput({
      studentIdColumn: req.body.studentIdColumn ?? current.studentIdColumn,
      columns: req.body.columns ?? parseGradeColumns(current.columns),
      rows: req.body.rows ?? [],
    }) : null;

    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.gradeCheckTable.update({
        where: { id },
        data: {
          title: req.body.title,
          description: req.body.description === undefined ? undefined : (req.body.description || null),
          status: req.body.status,
          studentIdColumn: normalized?.studentIdColumn,
          columns: normalized ? JSON.stringify(normalized.columns) : undefined,
          rowCount: normalized?.rows.length,
          publishedAt: req.body.status === "open" && !current.publishedAt ? now : undefined,
          closedAt: req.body.status === "closed" ? now : req.body.status === "open" ? null : undefined,
        },
      });
      if (normalized) {
        await tx.gradeCheckRow.deleteMany({ where: { tableId: id } });
        await tx.gradeCheckRow.createMany({
          data: normalized.rows.map((item) => ({
            tableId: id,
            studentId: item.studentId,
            payload: JSON.stringify(item.payload),
          })),
        });
      }
      return tx.gradeCheckTable.findUniqueOrThrow({
        where: { id: updated.id },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        },
      });
    });
    ok(res, normalizeGradeCheckTable(row));
  } catch (e) { next(e); }
});

toolsRouter.delete("/grade-checks/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.gradeCheckTable.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("查询表不存在");
    if (!(await canManageGradeCheckTable(current, req.user))) throw Errors.forbidden("没有该查询表的管理权限");
    await prisma.gradeCheckTable.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/questionnaires", authOptional, async (req, res, next) => {
  try {
    const requestedToolCode = req.query.toolCode ? String(req.query.toolCode) : undefined;
    if (requestedToolCode && !isServiceToolCode(requestedToolCode)) throw Errors.badRequest("小工具不合法");
    const toolCode = requestedToolCode && isServiceToolCode(requestedToolCode) ? requestedToolCode : undefined;
    const includeDraft = req.query.manage === "1";
    if (!includeDraft) {
      ok(res, []);
      return;
    }
    const [contentManageCodes, managerCodes] = req.user
      ? await Promise.all([listContentManageableToolCodes(req.user), listManagerToolCodes(req.user)])
      : [[], []];
    if (includeDraft && toolCode && !contentManageCodes.includes(toolCode)) throw Errors.forbidden("没有该小工具的管理权限");
    if (includeDraft && !toolCode && !contentManageCodes.length) throw Errors.forbidden("没有小工具管理权限");
    const isManagerForRequestedTool = Boolean(toolCode && managerCodes.includes(toolCode));
    const manageScope = toolCode
      ? (isManagerForRequestedTool ? {} : { createdById: req.user!.userId })
      : { OR: [{ toolCode: { in: managerCodes } }, { createdById: req.user!.userId }] };
    const list = await prisma.questionnaire.findMany({
      where: {
        ...(toolCode ? { toolCode } : { toolCode: { in: contentManageCodes } }),
        ...manageScope,
      },
      orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { responses: true } },
      },
    });
    ok(res, list.map((row) => normalizeQuestionnaire(row, {
      includeFields: includeDraft && canManageQuestionnaireRow(row, req.user, managerCodes),
      includeStats: canManageQuestionnaireRow(row, req.user, managerCodes),
    })));
  } catch (e) { next(e); }
});

toolsRouter.get("/questionnaires/:slug", authOptional, async (req, res, next) => {
  try {
    const row = await prisma.questionnaire.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { responses: true } },
      },
    });
    if (!row) throw Errors.notFound("问卷不存在");
    const canManage = await canManageQuestionnaire(row, req.user);
    if (!canManage) await ensureToolUsableForRequest(row.toolCode, req.user);
    if (row.status !== "open" && !canManage) throw Errors.notFound("问卷不存在或未开放");
    if (row.visibility === "login" && !req.user?.userId && !canManage) throw Errors.unauthorized("请先登录后填写");
    ok(res, {
      ...normalizeQuestionnaire(row, { includeFields: true, includeStats: canManage }),
      canManage,
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/questionnaires", authRequired, validate(createQuestionnaireSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission(req.body.toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    validateFields(req.body.fields);
    const now = new Date();
    const row = await prisma.questionnaire.create({
      data: {
        toolCode: req.body.toolCode,
        slug: await nextQuestionnaireSlug(req.body.title),
        title: req.body.title,
        description: req.body.description || null,
        status: req.body.status ?? "draft",
        visibility: req.body.visibility ?? "public",
        allowAnonymous: req.body.allowAnonymous ?? true,
        oneResponsePerUser: req.body.oneResponsePerUser ?? false,
        isSystem: false,
        fields: JSON.stringify(req.body.fields),
        createdById: req.user!.userId,
        publishedAt: (req.body.status ?? "draft") === "open" ? now : null,
        closedAt: req.body.status === "closed" ? now : null,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { responses: true } },
      },
    });
    ok(res, normalizeQuestionnaire(row, { includeFields: true, includeStats: true }));
  } catch (e) { next(e); }
});

toolsRouter.patch("/questionnaires/:id", authRequired, validate(patchQuestionnaireSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.questionnaire.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("问卷不存在");
    const targetToolCode = req.body.toolCode ?? current.toolCode;
    if (!(await canManageQuestionnaire(current, req.user))) throw Errors.forbidden("没有该问卷的管理权限");
    if (targetToolCode !== current.toolCode && !(await hasToolContentManagePermission(targetToolCode, req.user))) {
      throw Errors.forbidden("没有目标小工具的管理权限");
    }
    if (req.body.fields) validateFields(req.body.fields);
    const now = new Date();
    const row = await prisma.questionnaire.update({
      where: { id },
      data: {
        toolCode: req.body.toolCode,
        title: req.body.title,
        description: req.body.description === undefined ? undefined : (req.body.description || null),
        status: req.body.status,
        visibility: req.body.visibility,
        allowAnonymous: req.body.allowAnonymous,
        oneResponsePerUser: req.body.oneResponsePerUser,
        fields: req.body.fields ? JSON.stringify(req.body.fields) : undefined,
        publishedAt: req.body.status === "open" && !current.publishedAt ? now : undefined,
        closedAt: req.body.status === "closed" ? now : req.body.status === "open" ? null : undefined,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { responses: true } },
      },
    });
    ok(res, normalizeQuestionnaire(row, { includeFields: true, includeStats: true }));
  } catch (e) { next(e); }
});

toolsRouter.delete("/questionnaires/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.questionnaire.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("问卷不存在");
    if (current.isSystem) throw Errors.badRequest("系统问卷不能删除");
    if (!(await canManageQuestionnaire(current, req.user))) throw Errors.forbidden("没有该问卷的管理权限");
    await prisma.questionnaire.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.post("/questionnaires/:slug/responses", authOptional, validate(responseSchema), async (req, res, next) => {
  try {
    const row = await prisma.questionnaire.findUnique({ where: { slug: String(req.params.slug) } });
    if (!row) throw Errors.notFound("问卷不存在");
    await ensureToolUsableForRequest(row.toolCode, req.user);
    if (row.status !== "open") throw Errors.badRequest("问卷当前未开放填写");
    if (row.visibility === "login" && !req.user?.userId) throw Errors.unauthorized("请先登录后填写");
    if (!row.allowAnonymous && !req.user?.userId) throw Errors.unauthorized("请先登录后填写");
    if (row.oneResponsePerUser && req.user?.userId) {
      const exists = await prisma.questionnaireResponse.findFirst({
        where: { questionnaireId: row.id, respondentId: req.user.userId },
        select: { id: true },
      });
      if (exists) throw Errors.conflict("你已经提交过该问卷");
    }
    const fields = parseFields(row.fields);
    const answers = normalizeAnswers(fields, req.body.answers);
    const created = await prisma.questionnaireResponse.create({
      data: {
        questionnaireId: row.id,
        respondentId: req.user?.userId ?? null,
        answers: JSON.stringify(answers),
      },
    });
    ok(res, { id: created.id, createdAt: created.createdAt });
  } catch (e) { next(e); }
});

toolsRouter.get("/questionnaires/:id/responses", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const questionnaire = await prisma.questionnaire.findUnique({ where: { id } });
    if (!questionnaire) throw Errors.notFound("问卷不存在");
    if (!(await canManageQuestionnaire(questionnaire, req.user))) throw Errors.forbidden("没有该问卷的管理权限");
    const list = await prisma.questionnaireResponse.findMany({
      where: { questionnaireId: id },
      orderBy: { createdAt: "desc" },
      include: {
        respondent: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
      },
    });
    ok(res, {
      questionnaire: normalizeQuestionnaire(questionnaire, { includeFields: true }),
      list: list.map(normalizeResponse),
    });
  } catch (e) { next(e); }
});

async function nextQuestionnaireSlug(title: string) {
  const base = slugify(title) || "questionnaire";
  let slug = base;
  for (let i = 0; i < 20; i += 1) {
    const exists = await prisma.questionnaire.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
    slug = `${base}-${Date.now().toString(36).slice(-5)}${i ? `-${i}` : ""}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function nextGradeCheckSlug(title: string) {
  const rawBase = slugify(title);
  const base = rawBase && !rawBase.startsWith("q-") ? rawBase : "grade-check";
  let slug = base;
  for (let i = 0; i < 20; i += 1) {
    const exists = await prisma.gradeCheckTable.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
    slug = `${base}-${Date.now().toString(36).slice(-5)}${i ? `-${i}` : ""}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function slugify(text: string) {
  const ascii = text.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (/^[a-z0-9-]+$/.test(ascii)) return ascii;
  return `q-${Date.now().toString(36)}`;
}

function parseGradeColumns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseGradePayload(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]));
  } catch {
    return {};
  }
}

function normalizeGradeCheckTable(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    studentIdColumn: row.studentIdColumn,
    columns: parseGradeColumns(row.columns),
    rowCount: row.rowCount,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      nickname: row.createdBy.nickname,
      username: row.createdBy.username,
      role: row.createdBy.role,
    } : null,
  };
}

function normalizeGradeCheckInput(input: {
  studentIdColumn: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}) {
  const studentIdColumn = input.studentIdColumn.trim() || "学号";
  const columns = input.columns.map((item) => item.trim()).filter(Boolean);
  if (!columns.includes(studentIdColumn)) throw Errors.badRequest(`Excel 必须包含“${studentIdColumn}”字段`);
  if (new Set(columns).size !== columns.length) throw Errors.badRequest("Excel 表头不能重复");

  const seen = new Set<string>();
  const rows: Array<{ studentId: string; payload: Record<string, string> }> = [];
  input.rows.forEach((raw, index) => {
    const payload: Record<string, string> = {};
    for (const column of columns) payload[column] = formatGradeCell(raw[column]);
    if (!columns.some((column) => payload[column])) return;

    const studentId = normalizeStudentId(payload[studentIdColumn]);
    if (!studentId) throw Errors.badRequest(`第 ${index + 2} 行缺少学号`);
    if (seen.has(studentId)) throw Errors.badRequest(`学号重复：${studentId}`);
    seen.add(studentId);
    payload[studentIdColumn] = studentId;
    rows.push({ studentId, payload });
  });

  if (!rows.length) throw Errors.badRequest("Excel 至少需要 1 行有效数据");
  return { studentIdColumn, columns, rows };
}

function formatGradeCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value).trim();
}

function normalizeStudentId(value: string | number | boolean | null | undefined) {
  return formatGradeCell(value).replace(/\s+/g, "");
}

async function canManageQuestionnaire(row: { toolCode: string; createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (await hasToolManagerPermission(row.toolCode, user)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission(row.toolCode, user);
}

async function canManageGradeCheckTable(row: { createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (await hasToolManagerPermission("grade_check", user)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission("grade_check", user);
}

function canManageQuestionnaireRow(
  row: { toolCode: string; createdById: number | null },
  user: Express.Request["user"],
  managerCodes: string[],
) {
  if (!user?.userId) return false;
  return managerCodes.includes(row.toolCode) || row.createdById === user.userId;
}

function validateFields(fields: QuestionnaireField[]) {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      throw Errors.badRequest(`选项题“${field.label}”至少需要 2 个选项`);
    }
    if (field.type === "rating") {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      if (min < 0 || max > 10 || min >= max) throw Errors.badRequest(`评分题“${field.label}”的分值范围不合法`);
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      throw Errors.badRequest(`数字题“${field.label}”的最小值不能大于最大值`);
    }
  }
}

function normalizeAnswers(fields: QuestionnaireField[], input: Record<string, string | string[]>) {
  const result: Record<string, string | string[]> = {};
  for (const field of fields) {
    const raw = input[field.id];
    if (field.type === "multiple") {
      const values = Array.isArray(raw) ? raw.map(String).map((v) => v.trim()).filter(Boolean) : [];
      if (field.required && !values.length) throw Errors.badRequest(`请填写：${field.label}`);
      const allowed = new Set(field.options ?? []);
      const invalid = values.find((value) => !allowed.has(value));
      if (invalid) throw Errors.badRequest(`“${field.label}”包含无效选项`);
      result[field.id] = values;
      continue;
    }
    const value = Array.isArray(raw) ? "" : String(raw ?? "").trim();
    if (field.required && !value) throw Errors.badRequest(`请填写：${field.label}`);
    if (field.type === "single" && value) {
      const allowed = new Set(field.options ?? []);
      if (!allowed.has(value)) throw Errors.badRequest(`“${field.label}”包含无效选项`);
    }
    if (field.type === "number" && value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw Errors.badRequest(`“${field.label}”需要填写数字`);
      if (field.min !== undefined && numeric < field.min) throw Errors.badRequest(`“${field.label}”不能小于 ${field.min}`);
      if (field.max !== undefined && numeric > field.max) throw Errors.badRequest(`“${field.label}”不能大于 ${field.max}`);
    }
    if (field.type === "rating" && value) {
      const numeric = Number(value);
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        throw Errors.badRequest(`“${field.label}”评分不合法`);
      }
    }
    if (field.type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw Errors.badRequest(`“${field.label}”日期格式不合法`);
    }
    const maxLength = field.maxLength ?? (field.type === "textarea" ? 2000 : 300);
    result[field.id] = value.slice(0, Math.max(1, Math.min(maxLength, 2000)));
  }
  return result;
}

async function ensureToolUsableForRequest(toolCode: string, user: any) {
  try {
    await assertToolUsable(toolCode, user);
  } catch (e: any) {
    if (e?.message === "TOOL_LOGIN_REQUIRED") throw Errors.unauthorized("该小工具需要登录后使用");
    if (e?.message === "INVALID_TOOL_CODE") throw Errors.badRequest("小工具不合法");
    throw e;
  }
}
