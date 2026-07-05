import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { Errors, ok } from "../../utils/response";
import { validate } from "../../middleware/validate";
import {
  buildQqBotDebugExport,
  dispatchRecentQqNotifications,
  formatQqBotGroup,
  formatQqBotConfig,
  getQqBotConfigRaw,
  normalizeQqBotQqIdList,
  normalizeQqBotGroupNotifyAudiences,
  normalizeQqBotGroupNotifyCategories,
  sendQqMessage,
  updateQqBotConfig,
} from "../../services/qqbot";

export const qqBotAdminRouter = Router();

const configPatchSchema = z.object({
  enabled: z.boolean().optional(),
  botQqId: z.string().trim().max(40).optional(),
  napcatBaseUrl: z.string().trim().max(240).optional(),
  accessToken: z.string().trim().max(240).optional(),
  clearAccessToken: z.boolean().optional(),
  webhookSecret: z.string().trim().max(120).optional(),
  defaultBoardSlug: z.string().trim().max(80).optional(),
  allowPrivatePost: z.boolean().optional(),
  allowGroupPost: z.boolean().optional(),
  notificationEnabled: z.boolean().optional(),
  notifyCategories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  superAdminQqIds: z.array(z.string().trim().min(5).max(20)).max(50).optional(),
});

qqBotAdminRouter.get("/config", async (_req, res, next) => {
  try {
    ok(res, formatQqBotConfig(await getQqBotConfigRaw()));
  } catch (e) { next(e); }
});

qqBotAdminRouter.patch("/config", validate(configPatchSchema), async (req, res, next) => {
  try {
    ok(res, await updateQqBotConfig(req.body));
  } catch (e) { next(e); }
});

qqBotAdminRouter.get("/bindings", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const rows = await prisma.qqBotBinding.findMany({
      where: q
        ? {
            OR: [
              { qqId: { contains: q } },
              { nickname: { contains: q } },
              { user: { is: { username: { contains: q } } } },
              { user: { is: { nickname: { contains: q } } } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true } } },
    });
    ok(res, rows);
  } catch (e) { next(e); }
});

qqBotAdminRouter.patch("/bindings/:id", validate(z.object({ enabled: z.boolean() })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("绑定 ID 不合法");
    ok(res, await prisma.qqBotBinding.update({ where: { id }, data: { enabled: req.body.enabled } }));
  } catch (e) { next(e); }
});

qqBotAdminRouter.delete("/bindings/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("绑定 ID 不合法");
    await prisma.qqBotBinding.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

qqBotAdminRouter.get("/groups", async (_req, res, next) => {
  try {
    const rows = await prisma.qqBotGroup.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
    ok(res, rows.map((row) => formatQqBotGroup(row)));
  } catch (e) { next(e); }
});

const groupUpsertSchema = z.object({
  groupId: z.string().trim().min(1).max(40),
  name: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
  allowPosting: z.boolean().optional(),
  defaultBoardSlug: z.string().trim().max(80).nullable().optional(),
  notificationEnabled: z.boolean().optional(),
  notifyCategories: z.array(z.enum(["system", "school-feed"])).max(10).optional(),
  notifyAudiences: z.array(z.enum(["public", "staff"])).max(10).optional(),
  memberWelcomeEnabled: z.boolean().optional(),
  memberWelcomeMessage: z.string().trim().max(1500).optional(),
  adFilterEnabled: z.boolean().optional(),
  joinReviewEnabled: z.boolean().optional(),
  allowMute: z.boolean().optional(),
  allowKick: z.boolean().optional(),
  allowKickAndBlock: z.boolean().optional(),
  commandUserQqIds: z.array(z.string().trim().min(5).max(20)).max(50).optional(),
});

qqBotAdminRouter.post("/groups", validate(groupUpsertSchema), async (req, res, next) => {
  try {
    if (req.body.defaultBoardSlug) {
      const board = await prisma.board.findUnique({ where: { slug: req.body.defaultBoardSlug }, select: { id: true } });
      if (!board) throw Errors.badRequest("群默认投稿板块不存在");
    }
    const payload = {
      groupId: req.body.groupId,
      name: req.body.name,
      enabled: req.body.enabled,
      allowPosting: req.body.allowPosting,
      defaultBoardSlug: req.body.defaultBoardSlug,
      notificationEnabled: req.body.notificationEnabled,
      notifyCategories: JSON.stringify(normalizeQqBotGroupNotifyCategories(req.body.notifyCategories)),
      notifyAudiences: JSON.stringify(normalizeQqBotGroupNotifyAudiences(req.body.notifyAudiences)),
      memberWelcomeEnabled: req.body.memberWelcomeEnabled,
      memberWelcomeMessage: req.body.memberWelcomeMessage,
      adFilterEnabled: req.body.adFilterEnabled,
      joinReviewEnabled: req.body.joinReviewEnabled,
      allowMute: req.body.allowMute,
      allowKick: req.body.allowKick,
      allowKickAndBlock: req.body.allowKickAndBlock,
      commandUserQqIds: JSON.stringify(normalizeQqBotQqIdList(req.body.commandUserQqIds)),
    };
    const row = await prisma.qqBotGroup.upsert({
      where: { groupId: req.body.groupId },
      create: payload,
      update: payload,
    });
    ok(res, formatQqBotGroup(row));
  } catch (e) { next(e); }
});

qqBotAdminRouter.delete("/groups/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("群 ID 不合法");
    await prisma.qqBotGroup.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

qqBotAdminRouter.get("/logs", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size ?? 30)));
    const status = String(req.query.status ?? "").trim();
    const eventType = String(req.query.eventType ?? "").trim();
    const where: any = {};
    if (status) where.status = status;
    if (eventType) where.eventType = eventType;
    const [list, total] = await Promise.all([
      prisma.qqBotMessageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: { user: { select: { id: true, username: true, nickname: true } } },
      }),
      prisma.qqBotMessageLog.count({ where }),
    ]);
    ok(res, { page, size, total, list });
  } catch (e) { next(e); }
});

qqBotAdminRouter.get("/debug-export", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "").trim();
    const eventType = String(req.query.eventType ?? "").trim();
    const take = Math.min(200, Math.max(20, Number(req.query.take ?? 80) || 80));
    const payload = await buildQqBotDebugExport({ status, eventType, take });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"qqbot-debug-${stamp}.json\"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) { next(e); }
});

qqBotAdminRouter.post("/test-message", validate(z.object({
  qqId: z.string().trim().max(40).optional(),
  groupId: z.string().trim().max(40).optional(),
  message: z.string().trim().min(1).max(1000),
})), async (req, res, next) => {
  try {
    if (!req.body.qqId && !req.body.groupId) throw Errors.badRequest("请填写 QQ 号或群号");
    await sendQqMessage({ qqId: req.body.qqId, groupId: req.body.groupId }, req.body.message);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

qqBotAdminRouter.post("/dispatch-notifications", async (_req, res, next) => {
  try {
    ok(res, await dispatchRecentQqNotifications());
  } catch (e) { next(e); }
});
