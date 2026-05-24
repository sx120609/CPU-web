import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  hasToolManagePermission,
  isServiceToolCode,
  listManageableToolCodes,
  managerSelect,
  SERVICE_TOOL_CODES,
  SERVICE_TOOL_META,
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
  type: z.enum(["text", "textarea", "single", "multiple"]),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

const createQuestionnaireSchema = z.object({
  toolCode: z.enum(SERVICE_TOOL_CODES).default("questionnaire"),
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

const managerCreateSchema = z.object({
  userId: z.number().int().positive().optional(),
  username: z.string().trim().min(1).max(40).optional(),
}).refine((value) => value.userId || value.username, {
  message: "请选择用户或输入用户名",
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
    const manageableCodes = await listManageableToolCodes(req.user);
    ok(res, SERVICE_TOOL_CODES.map((code) => ({
      ...SERVICE_TOOL_META[code],
      canManage: manageableCodes.includes(code),
    })));
  } catch (e) { next(e); }
});

toolsRouter.get("/permissions/me", authRequired, async (req, res, next) => {
  try {
    const toolCodes = await listManageableToolCodes(req.user);
    ok(res, { toolCodes });
  } catch (e) { next(e); }
});

toolsRouter.get("/:toolCode/managers", authRequired, async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagePermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
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
    if (!(await hasToolManagePermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");

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
    if (!(await hasToolManagePermission(toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    if (userId === req.user!.userId && req.user!.role !== "admin") {
      throw Errors.badRequest("不能移除自己的管理权限");
    }
    await prisma.toolPermission.delete({
      where: { toolCode_userId: { toolCode, userId } },
    }).catch(() => null);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/questionnaires", authOptional, async (req, res, next) => {
  try {
    const toolCode = req.query.toolCode ? String(req.query.toolCode) : undefined;
    if (toolCode && !isServiceToolCode(toolCode)) throw Errors.badRequest("小工具不合法");
    const canManageAll = req.user ? await listManageableToolCodes(req.user) : [];
    const includeDraft = req.query.manage === "1";
    const manageableFilter = includeDraft ? { toolCode: { in: canManageAll } } : {};
    const list = await prisma.questionnaire.findMany({
      where: {
        ...(toolCode ? { toolCode } : {}),
        ...(includeDraft ? manageableFilter : { status: "open" }),
      },
      orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { responses: true } },
      },
    });
    ok(res, list.map((row) => normalizeQuestionnaire(row, {
      includeStats: isServiceToolCode(row.toolCode) && canManageAll.includes(row.toolCode),
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
    const canManage = await hasToolManagePermission(row.toolCode, req.user);
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
    if (!(await hasToolManagePermission(req.body.toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
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
    if (!(await hasToolManagePermission(current.toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    if (targetToolCode !== current.toolCode && !(await hasToolManagePermission(targetToolCode, req.user))) {
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
    if (!(await hasToolManagePermission(current.toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    await prisma.questionnaire.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.post("/questionnaires/:slug/responses", authOptional, validate(responseSchema), async (req, res, next) => {
  try {
    const row = await prisma.questionnaire.findUnique({ where: { slug: String(req.params.slug) } });
    if (!row) throw Errors.notFound("问卷不存在");
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
    if (!(await hasToolManagePermission(questionnaire.toolCode, req.user))) throw Errors.forbidden("没有该小工具的管理权限");
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

function slugify(text: string) {
  const ascii = text.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (/^[a-z0-9-]+$/.test(ascii)) return ascii;
  return `q-${Date.now().toString(36)}`;
}

function validateFields(fields: QuestionnaireField[]) {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      throw Errors.badRequest(`选项题“${field.label}”至少需要 2 个选项`);
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
    result[field.id] = value.slice(0, field.type === "textarea" ? 2000 : 300);
  }
  return result;
}
