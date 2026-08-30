import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import {
  dispatchRecentWechatNotifications,
  formatWechatServiceConfig,
  generateWechatEncodingAesKey,
  generateWechatToken,
  getWechatServiceConfigRaw,
  publishWechatDefaultMenu,
  sendWechatTestMessage,
  syncWechatBoundTag,
  updateWechatServiceConfig,
} from "../../services/wechatService";

export const wechatAdminRouter = Router();

const configPatchSchema = z.object({
  enabled: z.boolean().optional(),
  accountName: z.string().trim().max(80).optional(),
  wechatId: z.string().trim().max(80).optional(),
  appId: z.string().trim().max(80).optional(),
  appSecret: z.string().trim().max(240).optional(),
  clearAppSecret: z.boolean().optional(),
  token: z.string().trim().max(120).optional(),
  encodingAesKey: z.string().trim().max(80).optional(),
  messageMode: z.enum(["plaintext", "compatible", "safe"]).optional(),
  notificationEnabled: z.boolean().optional(),
  assistantEnabled: z.boolean().optional(),
  notifyCategories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notificationTemplateId: z.string().trim().max(160).optional(),
  templateTitleField: z.string().trim().max(64).optional(),
  templateContentField: z.string().trim().max(64).optional(),
  templateTimeField: z.string().trim().max(64).optional(),
  templateRemarkField: z.string().trim().max(64).optional(),
  subscriptionEnabled: z.boolean().optional(),
  subscriptionTemplateId: z.string().trim().max(160).optional(),
  subscriptionTitleField: z.string().trim().max(64).optional(),
  subscriptionContentField: z.string().trim().max(64).optional(),
  subscriptionTimeField: z.string().trim().max(64).optional(),
  subscriptionRemarkField: z.string().trim().max(64).optional(),
});

wechatAdminRouter.get("/config", async (_req, res, next) => {
  try {
    ok(res, formatWechatServiceConfig(await getWechatServiceConfigRaw()));
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.patch("/config", validate(configPatchSchema), async (req, res, next) => {
  try {
    ok(res, await updateWechatServiceConfig(req.body));
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.post("/menu/publish", async (_req, res, next) => {
  try {
    ok(res, await publishWechatDefaultMenu());
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.post("/credentials", validate(z.object({ target: z.enum(["token", "encodingAesKey", "both"]) })), async (req, res, next) => {
  try {
    const patch = {
      ...(req.body.target === "token" || req.body.target === "both" ? { token: generateWechatToken() } : {}),
      ...(req.body.target === "encodingAesKey" || req.body.target === "both" ? { encodingAesKey: generateWechatEncodingAesKey() } : {}),
    };
    ok(res, await updateWechatServiceConfig(patch));
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.get("/bindings", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const rows = await prisma.wechatBinding.findMany({
      where: q ? {
        OR: [
          { user: { is: { username: { contains: q } } } },
          { user: { is: { nickname: { contains: q } } } },
        ],
      } : {},
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { user: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true } } },
    });
    ok(res, rows.map((row) => ({
      ...row,
      openId: maskOpenId(row.openId),
      unionId: row.unionId ? maskOpenId(row.unionId) : null,
    })));
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.patch("/bindings/:id", validate(z.object({ enabled: z.boolean() })), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const binding = await prisma.wechatBinding.update({ where: { id }, data: { enabled: req.body.enabled } });
    void syncWechatBoundTag(binding.openId, Boolean(binding.enabled && binding.subscribed)).catch(() => undefined);
    ok(res, binding);
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.delete("/bindings/:id", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const binding = await prisma.wechatBinding.delete({ where: { id } });
    void syncWechatBoundTag(binding.openId, false).catch(() => undefined);
    ok(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.post("/bindings/:id/test-message", validate(z.object({ message: z.string().trim().min(1).max(1800) })), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const binding = await prisma.wechatBinding.findUnique({ where: { id } });
    if (!binding) throw Errors.notFound("微信绑定不存在");
    ok(res, await sendWechatTestMessage(binding.openId, req.body.message));
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.post("/dispatch-notifications", async (_req, res, next) => {
  try {
    ok(res, await dispatchRecentWechatNotifications());
  } catch (error) {
    next(error);
  }
});

wechatAdminRouter.get("/logs", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size || 30)));
    const status = String(req.query.status || "").trim();
    const eventType = String(req.query.eventType || "").trim();
    const where = { ...(status ? { status } : {}), ...(eventType ? { eventType } : {}) };
    const [list, total] = await Promise.all([
      prisma.wechatMessageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: { user: { select: { id: true, username: true, nickname: true } } },
      }),
      prisma.wechatMessageLog.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((row) => ({ ...row, openId: row.openId ? maskOpenId(row.openId) : null, rawPayload: undefined })) });
  } catch (error) {
    next(error);
  }
});

function positiveId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("绑定 ID 不合法");
  return id;
}

function maskOpenId(value: string) {
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}
