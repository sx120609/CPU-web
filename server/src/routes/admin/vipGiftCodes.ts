import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import { buildVipRedemptionPath, generateVipGiftCode } from "../../services/vipGiftCodes";

export const vipGiftCodesAdminRouter = Router();

const createSchema = z.object({
  quantity: z.number().int().min(1).max(100).default(1),
  maxUses: z.number().int().min(1).max(100000).default(1),
  note: z.string().trim().max(240).nullable().optional(),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(100000).optional(),
  note: z.string().trim().max(240).nullable().optional(),
});

function publicGiftCode(item: any) {
  return {
    id: item.id,
    codePreview: item.codePreview,
    maxUses: item.maxUses,
    usedCount: item.usedCount,
    enabled: item.enabled,
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
    const created: Array<{ code: string; item: any }> = [];
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < req.body.quantity; i += 1) {
        const generated = generateVipGiftCode();
        const item = await tx.vipGiftCode.create({
          data: {
            codeHash: generated.codeHash,
            codePreview: generated.codePreview,
            maxUses: req.body.maxUses,
            note: req.body.note?.trim() || null,
            createdById: req.user!.userId,
          },
        });
        created.push({ code: generated.code, item });
      }
    });
    const codes = created.map(({ code }) => code);
    ok(res, {
      items: created.map(({ item }) => publicGiftCode(item)),
      codes,
      redemptionPaths: codes.map(buildVipRedemptionPath),
    });
  } catch (error) { next(error); }
});

vipGiftCodesAdminRouter.patch("/:id", adminOnly, validate(patchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("礼品码 ID 无效");
    const existing = await prisma.vipGiftCode.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("礼品码不存在");
    const maxUses = req.body.maxUses ?? existing.maxUses;
    if (maxUses < existing.usedCount) throw Errors.badRequest("使用上限不能小于已使用次数");
    const updated = await prisma.vipGiftCode.update({
      where: { id },
      data: {
        enabled: req.body.enabled,
        maxUses,
        note: req.body.note === undefined ? undefined : (req.body.note?.trim() || null),
      },
    });
    ok(res, publicGiftCode(updated));
  } catch (error) { next(error); }
});
