import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import { generateVipGiftCode } from "../../services/vipGiftCodes";

export const vipGiftCodesAdminRouter = Router();

const dateValue = z.string().trim().max(64).nullable().optional();
const createSchema = z.object({
  quantity: z.number().int().min(1).max(100).default(1),
  vipLevel: z.number().int().min(1).max(3).default(1),
  durationDays: z.number().int().min(1).max(3650),
  maxUses: z.number().int().min(1).max(100000).default(1),
  startsAt: dateValue,
  expiresAt: dateValue,
  note: z.string().trim().max(240).nullable().optional(),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(100000).optional(),
  startsAt: dateValue,
  expiresAt: dateValue,
  note: z.string().trim().max(240).nullable().optional(),
});

function parseDate(value: string | null | undefined, field: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw Errors.badRequest(`${field}格式不正确`);
  return parsed;
}

function normalizeWindow(startsAt: string | null | undefined, expiresAt: string | null | undefined) {
  const start = parseDate(startsAt, "开始时间");
  const end = parseDate(expiresAt, "结束时间");
  if (start && end && start >= end) throw Errors.badRequest("结束时间必须晚于开始时间");
  return { startsAt: start, expiresAt: end };
}

function publicGiftCode(item: any) {
  return {
    id: item.id,
    codePreview: item.codePreview,
    vipLevel: item.vipLevel,
    durationDays: item.durationDays,
    maxUses: item.maxUses,
    usedCount: item.usedCount,
    enabled: item.enabled,
    startsAt: item.startsAt,
    expiresAt: item.expiresAt,
    note: item.note,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

vipGiftCodesAdminRouter.get("/", adminOnly, async (_req, res, next) => {
  try {
    const list = await prisma.vipGiftCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    ok(res, list.map(publicGiftCode));
  } catch (error) { next(error); }
});

vipGiftCodesAdminRouter.post("/", adminOnly, validate(createSchema), async (req, res, next) => {
  try {
    const { startsAt, expiresAt } = normalizeWindow(req.body.startsAt, req.body.expiresAt);
    const created: Array<{ code: string; item: any }> = [];
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < req.body.quantity; i += 1) {
        const generated = generateVipGiftCode();
        const item = await tx.vipGiftCode.create({
          data: {
            codeHash: generated.codeHash,
            codePreview: generated.codePreview,
            vipLevel: req.body.vipLevel,
            durationDays: req.body.durationDays,
            maxUses: req.body.maxUses,
            startsAt,
            expiresAt,
            note: req.body.note?.trim() || null,
            createdById: req.user!.userId,
          },
        });
        created.push({ code: generated.code, item });
      }
    });
    ok(res, { items: created.map(({ item }) => publicGiftCode(item)), codes: created.map(({ code }) => code) });
  } catch (error) { next(error); }
});

vipGiftCodesAdminRouter.patch("/:id", adminOnly, validate(patchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("礼品码 ID 无效");
    const existing = await prisma.vipGiftCode.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("礼品码不存在");
    const startsAt = req.body.startsAt === undefined ? existing.startsAt : parseDate(req.body.startsAt, "开始时间");
    const expiresAt = req.body.expiresAt === undefined ? existing.expiresAt : parseDate(req.body.expiresAt, "结束时间");
    if (startsAt && expiresAt && startsAt >= expiresAt) throw Errors.badRequest("结束时间必须晚于开始时间");
    const maxUses = req.body.maxUses ?? existing.maxUses;
    if (maxUses < existing.usedCount) throw Errors.badRequest("使用上限不能小于已使用次数");
    const updated = await prisma.vipGiftCode.update({
      where: { id },
      data: {
        enabled: req.body.enabled,
        maxUses,
        startsAt,
        expiresAt,
        note: req.body.note === undefined ? undefined : (req.body.note?.trim() || null),
      },
    });
    ok(res, publicGiftCode(updated));
  } catch (error) { next(error); }
});
