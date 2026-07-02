import { Router, type RequestHandler } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { readFile, unlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  buildOfficeViewerUrl,
  canUseOfficeWebViewer,
  isOfficePreviewFile,
  joinPublicUrl,
  normalizePreviewPublicOrigin,
  officeWebViewerLimitMessage,
  requestPublicOrigin,
  signFileCollectPreviewToken,
  verifyFileCollectPreviewToken,
} from "../utils/officePreview";
import { normalizeMulterOriginalNames, normalizeUploadOriginalName } from "../utils/uploadFilename";
import { getSiteOrigin } from "../services/siteSettings";
import {
  assertToolUsable,
  hasToolContentManagePermission,
  hasToolManagerPermission,
  isServiceToolCode,
  isSiteAdmin,
  listContentManageableToolCodes,
  listManagerToolCodes,
  listToolSettings,
  managerSelect,
  SERVICE_TOOL_CODES,
  SERVICE_TOOL_META,
  updateToolSetting,
} from "../services/serviceTools";
import {
  deleteMediaAsset,
  ensureMediaLocalPathFromUploadUrl,
  saveMediaAsset,
} from "../services/mediaStorage";
import {
  getOneDriveChinaItemMetadata,
  resolveOneDriveChinaDirectDownloadUrl,
  resolveOneDriveChinaPreviewUrl,
} from "../services/oneDriveChina";
import {
  ensureSystemQuestionnaires,
  normalizeQuestionnaire,
  normalizeResponse,
  parseFields,
  type QuestionnaireField,
} from "../services/questionnaires";
import { repairFileCollectTaskFilenames } from "../services/fileCollectFilenameRepair";
import {
  listToolQqReminderItems,
  normalizeToolQqReminderTargetType,
  notifyFileCollectSubmissionForQqBot,
  notifyGradeCheckLookupForQqBot,
  notifyQuestionnaireResponseForQqBot,
  updateToolQqReminderItem,
} from "../services/toolQqReminders";

export const toolsRouter = Router();

const fileCollectTmpDir = path.resolve(process.cwd(), "runtime", "file-collect-tmp");
mkdirSync(fileCollectTmpDir, { recursive: true });
const fileCollectUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fileCollectTmpDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(normalizeUploadOriginalName(file.originalname))}`),
  }),
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024,
    fieldSize: 1024 * 1024,
  },
});
const questionnaireBranchRuleSchema = z.object({
  action: z.enum(["end", "jump"]),
  targetId: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, "字段 ID 仅支持英文、数字、下划线和中划线").optional(),
});

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
  branching: z.record(questionnaireBranchRuleSchema).optional(),
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

const toolQqReminderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  timing: z.enum(["instant", "after", "deadline"]).optional(),
  afterAt: z.string().datetime().nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  beforeDeadlineHours: z.number().int().min(1).max(720).nullable().optional(),
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

const fileCollectFieldSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, "字段 ID 仅支持中文、英文、数字和下划线"),
  label: z.string().trim().min(1).max(80),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  pattern: z.string().trim().max(200).optional(),
});
const fileCollectRuleSchema = z.object({
  allowedTypes: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]+$/)).max(30).default([]),
  maxSizeMb: z.number().positive().max(100).default(20),
  maxCount: z.number().int().positive().max(20).default(1),
});
const createFileCollectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  fields: z.array(fileCollectFieldSchema).min(1).max(20),
  fileRules: fileCollectRuleSchema,
  renameTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  folderTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  expectedEntries: z.string().trim().max(20000).optional(),
});
const patchFileCollectSchema = createFileCollectSchema.partial().extend({
  status: z.enum(["draft", "open", "closed"]).optional(),
});
const createFileCollectTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  fields: z.array(fileCollectFieldSchema).min(1).max(20),
  fileRules: fileCollectRuleSchema,
  renameTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  folderTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  expectedEntries: z.string().trim().max(20000).optional(),
});

const managerCreateSchema = z.object({
  userId: z.number().int().positive().optional(),
  username: z.string().trim().min(1).max(40).optional(),
}).refine((value) => value.userId || value.username, {
  message: "请选择用户或输入用户名",
});

const toolSettingPatchSchema = z.object({
  isVisible: z.boolean().optional(),
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
      isVisible: settings.get(code)?.isVisible ?? true,
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
      isVisible: req.body.isVisible,
      requireLogin: req.body.requireLogin,
      allowPublicManage: req.body.allowPublicManage,
    });
    ok(res, {
      toolCode: row.toolCode,
      isVisible: row.isVisible,
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

toolsRouter.get("/qqbot-reminders", authRequired, async (req, res, next) => {
  try {
    const [items, binding] = await Promise.all([
      listToolQqReminderItems(req.user),
      prisma.qqBotBinding.findFirst({
        where: { userId: req.user!.userId },
        orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
        select: { id: true, qqId: true, nickname: true, enabled: true, updatedAt: true },
      }),
    ]);
    ok(res, { binding, items });
  } catch (e) { next(e); }
});

toolsRouter.patch("/qqbot-reminders/:targetType/:id", authRequired, validate(toolQqReminderPatchSchema), async (req, res, next) => {
  try {
    const targetType = normalizeToolQqReminderTargetType(req.params.targetType);
    const id = Number(req.params.id);
    if (!targetType || !Number.isInteger(id) || id <= 0) throw Errors.badRequest("提醒对象不合法");
    ok(res, await updateToolQqReminderItem(req.user, targetType, id, req.body));
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
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.gradeCheckTable.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
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
    const feedbackQuestionnaireSlug = row ? await ensureGradeCheckFeedbackQuestionnaire(table) : table.feedbackQuestionnaireSlug;
    if (row) {
      await notifyGradeCheckLookupForQqBot({
        table,
        studentId,
        actorUserId: req.user!.userId,
      }).catch((error) => console.warn("[tools] grade check qqbot reminder failed", error));
    }
    ok(res, {
      table: normalizeGradeCheckTable(table),
      studentId,
      row: row ? parseGradePayload(row.payload) : null,
      feedbackQuestionnaireSlug,
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
      const feedbackSlug = await nextQuestionnaireSlug(`${req.body.title} 问题反馈`);
      await tx.questionnaire.create({
        data: {
          toolCode: "questionnaire",
          slug: feedbackSlug,
          title: `${req.body.title} 问题反馈`,
          description: "如成绩或个人信息存在问题，请在这里提交说明，发起者会在结果中查看。",
          status: gradeFeedbackStatus(req.body.status ?? "open"),
          visibility: "login",
          allowAnonymous: false,
          oneResponsePerUser: false,
          isSystem: false,
          fields: JSON.stringify(buildGradeCheckFeedbackFields(normalized.columns, normalized.studentIdColumn)),
          createdById: req.user!.userId,
          publishedAt: (req.body.status ?? "open") === "open" ? now : null,
          closedAt: req.body.status === "closed" ? now : null,
        },
      });
      await tx.gradeCheckTable.update({
        where: { id: created.id },
        data: { feedbackQuestionnaireSlug: feedbackSlug },
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
          feedbackQuestionnaireSlug: normalized ? null : undefined,
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
      const refreshed = await tx.gradeCheckTable.findUniqueOrThrow({
        where: { id: updated.id },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        },
      });
      if (normalized) {
        const slug = await nextQuestionnaireSlug(`${refreshed.title} 问题反馈`);
        await tx.questionnaire.create({
          data: {
            toolCode: "questionnaire",
            slug,
            title: `${refreshed.title} 问题反馈`,
            description: "如核对项目存在问题，请提交说明。",
            status: gradeFeedbackStatus(refreshed.status),
            visibility: "login",
            allowAnonymous: false,
            oneResponsePerUser: false,
            isSystem: false,
            fields: JSON.stringify(buildGradeCheckFeedbackFields(normalized.columns, normalized.studentIdColumn)),
            createdById: refreshed.createdById,
            publishedAt: refreshed.status === "open" ? now : null,
            closedAt: refreshed.status === "closed" ? now : null,
          },
        });
        const rowWithFeedback = await tx.gradeCheckTable.update({
          where: { id: updated.id },
          data: { feedbackQuestionnaireSlug: slug },
          include: {
            createdBy: { select: { id: true, username: true, nickname: true, role: true } },
          },
        });
        if (current.feedbackQuestionnaireSlug) {
          await tx.questionnaire.deleteMany({ where: { slug: current.feedbackQuestionnaireSlug } });
        }
        return rowWithFeedback;
      }
      if (current.feedbackQuestionnaireSlug) {
        const feedback = await tx.questionnaire.findUnique({
          where: { slug: current.feedbackQuestionnaireSlug },
          select: { publishedAt: true },
        });
        if (feedback) {
          await tx.questionnaire.update({
            where: { slug: current.feedbackQuestionnaireSlug },
            data: {
              title: req.body.title === undefined ? undefined : `${refreshed.title} 问题反馈`,
              status: req.body.status === undefined ? undefined : gradeFeedbackStatus(refreshed.status),
              publishedAt: req.body.status === "open" && !feedback.publishedAt ? now : undefined,
              closedAt: req.body.status === "closed" ? now : req.body.status === "open" ? null : undefined,
            },
          });
        }
      }
      return refreshed;
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
    await prisma.$transaction(async (tx) => {
      await tx.gradeCheckTable.delete({ where: { id } });
      if (current.feedbackQuestionnaireSlug) {
        await tx.questionnaire.deleteMany({ where: { slug: current.feedbackQuestionnaireSlug } });
      }
    });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collection-templates", authRequired, async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.fileCollectTemplate.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, list.map(normalizeFileCollectTemplate));
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collection-templates", authRequired, validate(createFileCollectTemplateSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const payload = normalizeFileCollectTemplateInput(req.body);
    const row = await prisma.fileCollectTemplate.create({
      data: {
        name: payload.name,
        description: payload.description || null,
        visibility: payload.visibility ?? "public",
        fields: JSON.stringify(payload.fields),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries || "",
        createdById: req.user!.userId,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, normalizeFileCollectTemplate(row));
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-templates/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.fileCollectTemplate.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("模板不存在");
    const canDelete = current.createdById === req.user!.userId || isSiteAdmin(req.user?.role);
    if (!canDelete) throw Errors.forbidden("没有该模板的管理权限");
    await prisma.fileCollectTemplate.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections", authRequired, async (req, res, next) => {
  try {
    if (req.query.manage !== "1") {
      ok(res, []);
      return;
    }
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.fileCollectTask.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, list.map(normalizeFileCollectTask));
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections/:slug", authOptional, async (req, res, next) => {
  try {
    const task = await prisma.fileCollectTask.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    if (!task) throw Errors.notFound("收集任务不存在");
    const canManage = await canManageFileCollectTask(task, req.user);
    if (!canManage) await ensureToolUsableForRequest("file_collect", req.user);
    if (task.status !== "open" && !canManage) throw Errors.notFound("收集任务不存在或未开放");
    if (task.visibility === "login" && !req.user?.userId && !canManage) throw Errors.unauthorized("请先登录后提交");
    ok(res, {
      ...normalizeFileCollectTask(task),
      canManage,
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections", authRequired, validate(createFileCollectSchema), async (req, res, next) => {
  try {
    if (!(await hasToolContentManagePermission("file_collect", req.user))) throw Errors.forbidden("没有该小工具的管理权限");
    const payload = normalizeFileCollectInput(req.body);
    const now = new Date();
    const row = await prisma.fileCollectTask.create({
      data: {
        slug: await nextFileCollectSlug(payload.title),
        title: payload.title,
        description: payload.description || null,
        status: payload.status ?? "open",
        visibility: payload.visibility ?? "public",
        fields: JSON.stringify(payload.fields),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries || "",
        createdById: req.user!.userId,
        publishedAt: (payload.status ?? "open") === "open" ? now : null,
        closedAt: payload.status === "closed" ? now : null,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, normalizeFileCollectTask(row));
  } catch (e) { next(e); }
});

toolsRouter.patch("/file-collections/:id", authRequired, validate(patchFileCollectSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(current, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    const payload = normalizeFileCollectPatch(req.body);
    const now = new Date();
    const row = await prisma.fileCollectTask.update({
      where: { id },
      data: {
        title: payload.title,
        description: req.body.description === undefined ? undefined : (payload.description || null),
        status: payload.status,
        visibility: payload.visibility,
        fields: payload.fields ? JSON.stringify(payload.fields) : undefined,
        fileRules: payload.fileRules ? JSON.stringify(payload.fileRules) : undefined,
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: req.body.expectedEntries === undefined ? undefined : (payload.expectedEntries || ""),
        publishedAt: payload.status === "open" && !current.publishedAt ? now : undefined,
        closedAt: payload.status === "closed" ? now : payload.status === "open" ? null : undefined,
      },
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    ok(res, normalizeFileCollectTask(row));
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collections/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(current, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    await prisma.fileCollectTask.delete({ where: { id } });
    await rm(path.resolve(process.cwd(), "uploads", "file-collect", String(id)), { recursive: true, force: true });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.get("/file-collections/:id/submissions", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const task = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(task, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    const list = await prisma.fileCollectSubmission.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "desc" },
      include: {
        submitter: { select: { id: true, username: true, nickname: true, role: true } },
        files: { orderBy: { id: "asc" } },
      },
    });
    ok(res, {
      task: normalizeFileCollectTask(task),
      list: list.map(normalizeFileCollectSubmission),
    });
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections/:id/repair-filenames", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const task = await prisma.fileCollectTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound("收集任务不存在");
    if (!(await canManageFileCollectTask(task, req.user))) throw Errors.forbidden("没有该收集任务的管理权限");
    ok(res, await repairFileCollectTaskFilenames(id));
  } catch (e) { next(e); }
});

toolsRouter.post("/file-collections/:slug/submissions", authOptional, fileCollectUpload.array("files", 20), async (req, res, next) => {
  const uploadedFiles = normalizeMulterOriginalNames((req.files as Express.Multer.File[] | undefined) ?? []);
  const storedRelativePaths: string[] = [];
  try {
    const task = await prisma.fileCollectTask.findUnique({ where: { slug: String(req.params.slug) } });
    if (!task) throw Errors.notFound("收集任务不存在");
    await ensureToolUsableForRequest("file_collect", req.user);
    if (task.status !== "open") throw Errors.badRequest("收集任务当前未开放提交");
    if (task.visibility === "login" && !req.user?.userId) throw Errors.unauthorized("请先登录后提交");

    const fields = parseFileCollectFields(task.fields);
    const rules = parseFileCollectRules(task.fileRules);
    const data = normalizeFileCollectSubmissionData(fields, parseJsonObject(String(req.body.data || "{}")));
    validateFileCollectUpload(uploadedFiles, rules);
    const identity = fileCollectIdentity(data, fields);

    const result = await prisma.$transaction(async (tx) => {
      if (identity) {
        const oldRows = await tx.fileCollectSubmission.findMany({
          where: { taskId: task.id, identity },
          include: { files: true },
        });
        for (const old of oldRows) {
          await tx.fileCollectSubmission.delete({ where: { id: old.id } });
          for (const file of old.files) await unlinkFileCollectPath(file.path);
        }
      }

      const submission = await tx.fileCollectSubmission.create({
        data: {
          taskId: task.id,
          submitterId: req.user?.userId ?? null,
          identity,
          data: JSON.stringify(data),
          ip: req.ip,
        },
      });
      const fileRows = [];
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index];
        const storedName = renderFileCollectName(task.renameTemplate, data, file.originalname, index + 1, uploadedFiles.length);
        const physicalName = `${submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`;
        const relativePath = path.posix.join("file-collect", String(task.id), physicalName);
        const buffer = await readFile(file.path);
        await saveMediaAsset({
          relativePath,
          buffer,
          contentType: file.mimetype || "application/octet-stream",
        });
        storedRelativePaths.push(relativePath);
        await unlink(file.path).catch(() => null);
        fileRows.push(await tx.fileCollectFile.create({
          data: {
            submissionId: submission.id,
            originalName: file.originalname,
            storedName,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size,
            path: relativePath,
          },
        }));
      }
      await tx.fileCollectTask.update({
        where: { id: task.id },
        data: {
          submissionCount: await tx.fileCollectSubmission.count({ where: { taskId: task.id } }),
          fileCount: await tx.fileCollectFile.count({ where: { submission: { taskId: task.id } } }),
        },
      });
      return { submission, files: fileRows };
    });
    await notifyFileCollectSubmissionForQqBot({
      task,
      submission: {
        id: result.submission.id,
        identity: result.submission.identity,
        submitterId: result.submission.submitterId,
        data: result.submission.data,
      },
      fileCount: result.files.length,
    }).catch((error) => console.warn("[tools] file collect qqbot reminder failed", error));
    ok(res, {
      id: result.submission.id,
      createdAt: result.submission.createdAt,
      files: result.files.map((file) => file.storedName),
    });
  } catch (e) {
    await Promise.all([
      ...uploadedFiles.map((file) => unlink(file.path).catch(() => null)),
      ...storedRelativePaths.map((relativePath) => unlinkFileCollectPath(relativePath)),
    ]);
    next(e);
  }
});

toolsRouter.get("/file-collection-files/:id/access", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的下载权限");
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    const rawRemoteUrl = meta?.kind === "file"
      ? meta.downloadUrl || await resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => "")
      : "";
    const remoteDownloadNameSafe = meta?.kind === "file" && remoteDownloadNameMatchesStoredName(meta.name, file.storedName);
    const action = req.query.action === "preview" ? "preview" : "download";
    const remoteUrl = action === "download" && !remoteDownloadNameSafe ? "" : rawRemoteUrl;
    const remotePreviewUrl = action === "preview" && rawRemoteUrl
      ? await resolveOneDriveChinaPreviewUrl(file.path).catch(() => "")
      : "";
    const origin = normalizePreviewPublicOrigin(getSiteOrigin()) || requestPublicOrigin(req);
    const previewToken = signFileCollectPreviewToken(file);
    const publicOfficePreviewUrl = origin && action === "preview" && !remotePreviewUrl && !remoteUrl && canUseOfficeWebViewer(file)
      ? joinPublicUrl(origin, `/api/tools/file-collection-files/${file.id}/public-preview/${encodeURIComponent(previewToken)}/${encodeURIComponent(file.storedName)}`)
      : "";
    const previewSourceUrl = action === "preview" && isOfficePreviewFile(file.storedName)
      ? publicOfficePreviewUrl
      : "";
    const viewerUrl = previewSourceUrl ? buildOfficeViewerUrl(previewSourceUrl) : "";
    const previewUrl = remotePreviewUrl || viewerUrl;
    const previewMessage = action === "preview" && isOfficePreviewFile(file.storedName) && !previewUrl
      ? officeWebViewerLimitMessage(file) || "该文件暂不支持在线预览，请下载后查看。"
      : "";
    ok(res, {
      id: file.id,
      action,
      backend: remoteUrl ? "onedrive-cn" : "local",
      url: action === "preview" ? previewUrl : remoteUrl,
      viewer: remotePreviewUrl ? "onedrive" : (viewerUrl ? "office" : null),
      previewMessage,
      filename: file.storedName,
      mimeType: file.mimeType || "application/octet-stream",
    });
  } catch (e) { next(e); }
});

const fileCollectPublicPreviewHandler: RequestHandler = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const token = String(req.params.token || req.query.token || "");
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !verifyFileCollectPreviewToken(token, file)) {
      throw Errors.notFound("文件不存在");
    }
    if (!isOfficePreviewFile(file.storedName)) throw Errors.badRequest("该文件不支持在线预览");
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    const remoteUrl = meta?.kind === "file"
      ? meta.downloadUrl || await resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => "")
      : "";
    if (remoteUrl) {
      res.redirect(302, remoteUrl);
      return;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw Errors.notFound("文件已丢失");
    res.type(file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
    res.sendFile(absolute);
  } catch (e) { next(e); }
};

toolsRouter.get("/file-collection-files/:id/public-preview/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.head("/file-collection-files/:id/public-preview/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.get("/file-collection-files/:id/public-preview/:token/:filename?", fileCollectPublicPreviewHandler);
toolsRouter.head("/file-collection-files/:id/public-preview/:token/:filename?", fileCollectPublicPreviewHandler);

toolsRouter.get("/file-collection-files/:id/:action(download|preview)", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的下载权限");
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw Errors.notFound("文件已丢失");
    if (req.params.action === "preview") {
      res.type(file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
      res.sendFile(absolute);
      return;
    }
    res.download(absolute, file.storedName);
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-files/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const file = await prisma.fileCollectFile.findUnique({
      where: { id },
      include: { submission: { include: { task: true } } },
    });
    if (!file) throw Errors.notFound("文件不存在");
    if (!(await canManageFileCollectTask(file.submission.task, req.user))) throw Errors.forbidden("没有该文件的管理权限");
    await prisma.fileCollectFile.delete({ where: { id } });
    await unlinkFileCollectPath(file.path);
    await refreshFileCollectStats(file.submission.taskId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

toolsRouter.delete("/file-collection-submissions/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const submission = await prisma.fileCollectSubmission.findUnique({
      where: { id },
      include: { task: true, files: true },
    });
    if (!submission) throw Errors.notFound("提交记录不存在");
    if (!(await canManageFileCollectTask(submission.task, req.user))) throw Errors.forbidden("没有该提交记录的管理权限");
    await prisma.fileCollectSubmission.delete({ where: { id } });
    await Promise.all(submission.files.map((file) => unlinkFileCollectPath(file.path)));
    await refreshFileCollectStats(submission.taskId);
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
    const contentManageCodes = req.user ? await listContentManageableToolCodes(req.user) : [];
    if (includeDraft && toolCode && !contentManageCodes.includes(toolCode)) throw Errors.forbidden("没有该小工具的管理权限");
    if (includeDraft && !toolCode && !contentManageCodes.length) throw Errors.forbidden("没有小工具管理权限");
    const canSeeAll = isSiteAdmin(req.user?.role);
    const manageScope = toolCode
      ? (canSeeAll ? {} : { createdById: req.user!.userId })
      : (canSeeAll ? {} : { createdById: req.user!.userId });
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
      includeFields: includeDraft && canManageQuestionnaireRow(row, req.user),
      includeStats: canManageQuestionnaireRow(row, req.user),
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
    await notifyQuestionnaireResponseForQqBot({
      questionnaire: row,
      responseId: created.id,
      respondentId: req.user?.userId ?? null,
    }).catch((error) => console.warn("[tools] questionnaire qqbot reminder failed", error));
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

async function nextFileCollectSlug(title: string) {
  const rawBase = slugify(title);
  const base = rawBase && !rawBase.startsWith("q-") ? rawBase : "file-collect";
  let slug = base;
  for (let i = 0; i < 20; i += 1) {
    const exists = await prisma.fileCollectTask.findUnique({ where: { slug }, select: { id: true } });
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

type FileCollectField = z.infer<typeof fileCollectFieldSchema>;
type FileCollectRules = z.infer<typeof fileCollectRuleSchema>;

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseFileCollectFields(raw: string | null | undefined): FileCollectField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => fileCollectFieldSchema.parse(item)) : [];
  } catch {
    return [];
  }
}

function parseFileCollectRules(raw: string | null | undefined): FileCollectRules {
  if (!raw) return fileCollectRuleSchema.parse({});
  try {
    return fileCollectRuleSchema.parse(JSON.parse(raw));
  } catch {
    return fileCollectRuleSchema.parse({});
  }
}

function normalizeFileCollectInput(input: z.infer<typeof createFileCollectSchema>) {
  const fieldIds = new Set<string>();
  for (const field of input.fields) {
    if (fieldIds.has(field.id)) throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        throw Errors.badRequest(`字段“${field.label}”的正则规则不合法`);
      }
    }
    fieldIds.add(field.id);
  }
  return {
    ...input,
    status: input.status ?? "open",
    visibility: input.visibility ?? "public",
    description: input.description ?? "",
    expectedEntries: input.expectedEntries ?? "",
    renameTemplate: input.renameTemplate || "{name}-{student_id}",
    folderTemplate: input.folderTemplate || "{name}-{student_id}",
    fileRules: fileCollectRuleSchema.parse(input.fileRules ?? {}),
  };
}

function normalizeFileCollectPatch(input: z.infer<typeof patchFileCollectSchema>) {
  const merged = { ...input };
  if (merged.fields) normalizeFileCollectInput({
    title: merged.title || "patch",
    fields: merged.fields,
    fileRules: merged.fileRules ?? fileCollectRuleSchema.parse({}),
    renameTemplate: merged.renameTemplate ?? "{name}-{student_id}",
    folderTemplate: merged.folderTemplate ?? "{name}-{student_id}",
  });
  if (merged.fileRules) merged.fileRules = fileCollectRuleSchema.parse(merged.fileRules);
  return merged;
}

function normalizeFileCollectTemplateInput(input: z.infer<typeof createFileCollectTemplateSchema>) {
  const normalized = normalizeFileCollectInput({
    title: input.name,
    description: input.description,
    visibility: input.visibility ?? "public",
    fields: input.fields,
    fileRules: input.fileRules,
    renameTemplate: input.renameTemplate,
    folderTemplate: input.folderTemplate,
    expectedEntries: input.expectedEntries,
  });
  return {
    name: input.name,
    description: normalized.description,
    visibility: normalized.visibility,
    fields: normalized.fields,
    fileRules: normalized.fileRules,
    renameTemplate: normalized.renameTemplate,
    folderTemplate: normalized.folderTemplate,
    expectedEntries: normalized.expectedEntries,
  };
}

function normalizeFileCollectTask(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    fields: parseFileCollectFields(row.fields),
    fileRules: parseFileCollectRules(row.fileRules),
    renameTemplate: row.renameTemplate,
    folderTemplate: row.folderTemplate,
    expectedEntries: row.expectedEntries,
    submissionCount: row.submissionCount,
    fileCount: row.fileCount,
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

function normalizeFileCollectTemplate(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    fields: parseFileCollectFields(row.fields),
    fileRules: parseFileCollectRules(row.fileRules),
    renameTemplate: row.renameTemplate,
    folderTemplate: row.folderTemplate,
    expectedEntries: row.expectedEntries,
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

function normalizeFileCollectSubmission(row: any) {
  return {
    id: row.id,
    taskId: row.taskId,
    identity: row.identity,
    data: parseJsonObject(row.data),
    ip: row.ip,
    createdAt: row.createdAt,
    submitter: row.submitter ? {
      id: row.submitter.id,
      nickname: row.submitter.nickname,
      username: row.submitter.username,
      role: row.submitter.role,
    } : null,
    files: (row.files ?? []).map((file: any) => ({
      id: file.id,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    })),
  };
}

function normalizeFileCollectSubmissionData(fields: FileCollectField[], input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = String(input[field.id] ?? "").trim();
    if (field.required && !value) throw Errors.badRequest(`请填写：${field.label}`);
    if (value && field.pattern && !(new RegExp(field.pattern).test(value))) {
      throw Errors.badRequest(`“${field.label}”格式不正确`);
    }
    result[field.id] = value.slice(0, 300);
  }
  return result;
}

function validateFileCollectUpload(files: Express.Multer.File[], rules: FileCollectRules) {
  if (!files.length) throw Errors.badRequest("请至少上传一个文件");
  if (files.length > rules.maxCount) throw Errors.badRequest(`最多只能上传 ${rules.maxCount} 个文件`);
  const allowed = new Set(rules.allowedTypes);
  const maxBytes = rules.maxSizeMb * 1024 * 1024;
  for (const file of files) {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    if (allowed.size && !allowed.has(ext)) throw Errors.badRequest(`${file.originalname} 类型不允许`);
    if (file.size > maxBytes) throw Errors.badRequest(`${file.originalname} 超过 ${rules.maxSizeMb} MB`);
  }
}

function fileCollectIdentity(data: Record<string, string>, fields: FileCollectField[]) {
  const preferred = ["student_id", "exam_id", "id", "name"];
  const preferredKey = preferred.find((key) => data[key]);
  if (preferredKey) return data[preferredKey].replace(/\s+/g, "");
  const firstRequired = fields.find((field) => field.required && data[field.id]);
  return firstRequired ? data[firstRequired.id].replace(/\s+/g, "") : "";
}

function safeStoredFilename(value: string) {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "file";
}

function remoteDownloadNameMatchesStoredName(remoteName: string | null | undefined, storedName: string) {
  return safeStoredFilename(String(remoteName || "")) === safeStoredFilename(storedName);
}

function renderFileCollectName(template: string, data: Record<string, string>, originalName: string, index: number, total: number) {
  const ext = path.extname(originalName || "").toLowerCase();
  const stem = path.basename(originalName || "file", path.extname(originalName || ""));
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeStoredFilename(value)])),
    original: safeStoredFilename(stem),
    index: total > 1 ? String(index) : "",
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  const base = safeStoredFilename(rendered).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
  const withIndex = total > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

function resolveFileCollectPath(relative: string) {
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const absolute = path.resolve(uploadRoot, relative);
  if (!absolute.startsWith(path.resolve(uploadRoot, "file-collect") + path.sep)) {
    throw Errors.forbidden("文件路径不合法");
  }
  return absolute;
}

async function unlinkFileCollectPath(relative: string) {
  await deleteMediaAsset(relative).catch(() => null);
}

async function refreshFileCollectStats(taskId: number) {
  const [submissionCount, fileCount] = await Promise.all([
    prisma.fileCollectSubmission.count({ where: { taskId } }),
    prisma.fileCollectFile.count({ where: { submission: { taskId } } }),
  ]);
  await prisma.fileCollectTask.update({
    where: { id: taskId },
    data: { submissionCount, fileCount },
  }).catch(() => null);
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
    feedbackQuestionnaireSlug: row.feedbackQuestionnaireSlug,
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

function buildGradeCheckFeedbackFields(columns: string[], studentIdColumn: string): QuestionnaireField[] {
  const options = columns.filter((column) => column !== studentIdColumn).slice(0, 20);
  return [
    {
      id: "student_id",
      label: "学号",
      type: "text",
      required: true,
      placeholder: "请填写你的学号，便于发起者核对",
      maxLength: 40,
    },
    {
      id: "problem_fields",
      label: "哪些项目存在问题",
      type: "multiple",
      required: true,
      options: options.length >= 2 ? options : ["成绩信息", "个人信息", "其他"],
    },
    {
      id: "problem_type",
      label: "问题类型",
      type: "single",
      required: true,
      options: ["信息有误", "成绩有疑问", "缺少记录", "无法确认", "其他"],
    },
    {
      id: "description",
      label: "问题说明",
      type: "textarea",
      required: true,
      placeholder: "请说明你认为有问题的项目、当前显示值和你认为正确的信息。",
      maxLength: 2000,
    },
    {
      id: "contact",
      label: "联系方式",
      type: "text",
      required: false,
      placeholder: "选填，便于发起者进一步联系",
      maxLength: 120,
    },
  ];
}

function gradeFeedbackStatus(status: string) {
  if (status === "open") return "open";
  if (status === "closed") return "closed";
  return "draft";
}

async function ensureGradeCheckFeedbackQuestionnaire(table: {
  id: number;
  title: string;
  status: string;
  columns: string;
  studentIdColumn: string;
  createdById: number | null;
  feedbackQuestionnaireSlug: string | null;
}) {
  if (table.feedbackQuestionnaireSlug) {
    const exists = await prisma.questionnaire.findUnique({
      where: { slug: table.feedbackQuestionnaireSlug },
      select: { id: true },
    });
    if (exists) return table.feedbackQuestionnaireSlug;
  }

  const now = new Date();
  const slug = await nextQuestionnaireSlug(`${table.title} 问题反馈`);
  await prisma.questionnaire.create({
    data: {
      toolCode: "questionnaire",
      slug,
      title: `${table.title} 问题反馈`,
      description: "如核对项目存在问题，请提交说明。",
      status: gradeFeedbackStatus(table.status),
      visibility: "login",
      allowAnonymous: false,
      oneResponsePerUser: false,
      isSystem: false,
      fields: JSON.stringify(buildGradeCheckFeedbackFields(parseGradeColumns(table.columns), table.studentIdColumn)),
      createdById: table.createdById,
      publishedAt: table.status === "open" ? now : null,
      closedAt: table.status === "closed" ? now : null,
    },
  });
  await prisma.gradeCheckTable.update({
    where: { id: table.id },
    data: { feedbackQuestionnaireSlug: slug },
  });
  return slug;
}

async function canManageQuestionnaire(row: { toolCode: string; slug?: string; createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  if (row.slug && await canManageGradeFeedbackQuestionnaire(row.slug, user)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission(row.toolCode, user);
}

async function canManageGradeFeedbackQuestionnaire(slug: string, user: Express.Request["user"]) {
  const table = await prisma.gradeCheckTable.findFirst({
    where: { feedbackQuestionnaireSlug: slug },
    select: { createdById: true },
  });
  return table ? canManageGradeCheckTable(table, user) : false;
}

async function canManageGradeCheckTable(row: { createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission("grade_check", user);
}

async function canManageFileCollectTask(row: { createdById: number | null }, user: Express.Request["user"]) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  return row.createdById === user.userId && await hasToolContentManagePermission("file_collect", user);
}

function canManageQuestionnaireRow(
  row: { toolCode: string; createdById: number | null },
  user: Express.Request["user"],
) {
  if (!user?.userId) return false;
  return isSiteAdmin(user.role) || row.createdById === user.userId;
}

function validateFields(fields: QuestionnaireField[]) {
  const ids = new Set<string>();
  const indexById = new Map<string, number>();
  fields.forEach((field, index) => indexById.set(field.id, index));
  for (const field of fields) {
    if (ids.has(field.id)) throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      throw Errors.badRequest(`选项题“${field.label}”至少需要 2 个选项`);
    }
    if (field.branching) {
      if (field.type !== "single") throw Errors.badRequest(`只有单选题“${field.label}”可以配置分支`);
      const allowed = new Set(field.options ?? []);
      const fieldIndex = indexById.get(field.id) ?? 0;
      for (const [option, rule] of Object.entries(field.branching)) {
        if (!allowed.has(option)) throw Errors.badRequest(`题目“${field.label}”包含不存在的分支选项：${option}`);
        if (rule.action === "jump") {
          if (!rule.targetId) throw Errors.badRequest(`题目“${field.label}”的分支缺少跳转目标`);
          const targetIndex = indexById.get(rule.targetId);
          if (targetIndex === undefined || targetIndex <= fieldIndex) {
            throw Errors.badRequest(`题目“${field.label}”只能跳转到后面的题目`);
          }
        }
      }
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

function activeQuestionnaireFields(fields: QuestionnaireField[], input: Record<string, string | string[]>) {
  const result: QuestionnaireField[] = [];
  const indexById = new Map(fields.map((field, index) => [field.id, index]));
  for (let index = 0; index < fields.length;) {
    const field = fields[index];
    result.push(field);
    if (field.type === "single") {
      const raw = input[field.id];
      const value = Array.isArray(raw) ? "" : String(raw ?? "").trim();
      const rule = value ? field.branching?.[value] : undefined;
      if (rule?.action === "end") break;
      if (rule?.action === "jump" && rule.targetId) {
        const targetIndex = indexById.get(rule.targetId);
        if (targetIndex !== undefined && targetIndex > index) {
          index = targetIndex;
          continue;
        }
      }
    }
    index += 1;
  }
  return result;
}

function normalizeAnswers(fields: QuestionnaireField[], input: Record<string, string | string[]>) {
  const result: Record<string, string | string[]> = {};
  for (const field of activeQuestionnaireFields(fields, input)) {
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
