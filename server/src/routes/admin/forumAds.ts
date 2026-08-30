import { Router } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../prisma";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import {
  FORUM_AD_PLACEMENTS,
  isForumAdPlacement,
  normalizeForumAdPlacements,
  summarizeForumAdMetrics,
} from "../../services/forumAds";
import { invalidateForumAdCaches } from "../../services/cacheInvalidation";
import { FORUM_IMAGE_MAX_SOURCE_BYTES, normalizeForumImageUpload } from "../../services/forumImageCompression";
import { resolveMediaPublicUrl, saveMediaAsset } from "../../services/mediaStorage";

export const forumAdsAdminRouter = Router();
const uploadAdImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: FORUM_IMAGE_MAX_SOURCE_BYTES } });

const placementSchema = z.enum(FORUM_AD_PLACEMENTS);
const adInputFields = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  linkUrl: z.string().trim().min(1).max(500),
  buttonText: z.string().trim().max(24).nullable().optional(),
  placement: placementSchema.optional(),
  placements: z.array(placementSchema).min(1).max(FORUM_AD_PLACEMENTS.length).optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  enabled: z.boolean().optional(),
  vipExempt: z.boolean().optional(),
  startsAt: z.string().trim().max(64).nullable().optional(),
  endsAt: z.string().trim().max(64).nullable().optional(),
});

const adInputSchema = adInputFields.refine((value) => Boolean(value.placement || value.placements?.length), {
  message: "请至少选择一个广告投放位置",
  path: ["placements"],
});
const adPatchSchema = adInputFields.partial();

function normalizeUrl(value: string | null | undefined, field: string, required = false) {
  const input = String(value ?? "").trim();
  if (!input) {
    if (required) throw Errors.badRequest(`${field}不能为空`);
    return null;
  }
  if (/^\/(?!\/)/.test(input)) return input;
  try {
    const parsed = new URL(input);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // handled below
  }
  throw Errors.badRequest(`${field}只支持站内路径或 http(s) 链接`);
}

function normalizeDate(value: string | null | undefined, field: string) {
  const input = String(value ?? "").trim();
  if (!input) return null;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) throw Errors.badRequest(`${field}时间格式不正确`);
  return date;
}

function normalizePayload(input: z.infer<typeof adInputFields>) {
  const startsAt = normalizeDate(input.startsAt, "开始");
  const endsAt = normalizeDate(input.endsAt, "结束");
  if (startsAt && endsAt && startsAt >= endsAt) throw Errors.badRequest("结束时间必须晚于开始时间");
  const placements = normalizeForumAdPlacements(input.placements, input.placement);
  if (!placements.length) throw Errors.badRequest("请至少选择一个广告投放位置");
  return {
    title: input.title,
    description: input.description?.trim() || null,
    imageUrl: normalizeUrl(input.imageUrl, "图片地址"),
    linkUrl: normalizeUrl(input.linkUrl, "跳转链接", true)!,
    buttonText: input.buttonText?.trim() || null,
    placement: placements[0],
    placements,
    sortOrder: input.sortOrder ?? 0,
    enabled: input.enabled ?? false,
    vipExempt: input.vipExempt ?? true,
    startsAt,
    endsAt,
  };
}

forumAdsAdminRouter.get("/", adminOnly, async (_req, res, next) => {
  try {
    const list = await prisma.forumAd.findMany({
      orderBy: [{ placement: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      include: {
        metrics: {
          select: { day: true, device: true, impressions: true, clicks: true },
          orderBy: { day: "asc" },
        },
      },
    });
    ok(res, list.map(({ metrics, ...item }) => ({
      ...item,
      placements: normalizeForumAdPlacements(item.placements, item.placement),
      metrics: summarizeForumAdMetrics(metrics),
    })));
  } catch (error) { next(error); }
});

forumAdsAdminRouter.post("/image", adminOnly, (req, res, next) => {
  uploadAdImage.single("file")(req, res, (error: any) => {
    if (error?.code === "LIMIT_FILE_SIZE") return next(Errors.badRequest("广告图片不能超过 32MB"));
    return error ? next(error) : next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file?.buffer?.length) throw Errors.badRequest("请先选择广告图片");
    const normalized = await normalizeForumImageUpload({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
    }).catch((error: unknown) => {
      throw Errors.badRequest(String((error as Error)?.message || "广告图片压缩失败"));
    });
    const month = new Date().toISOString().slice(0, 7).replace("-", "/");
    const relativePath = path.posix.join("forum", "ads", month, `${randomUUID()}.${normalized.extension}`);
    const saved = await saveMediaAsset({
      relativePath,
      buffer: normalized.buffer,
      contentType: normalized.mimeType,
      mediaKind: "image",
    });
    ok(res, {
      url: await resolveMediaPublicUrl(saved.url),
      size: normalized.buffer.length,
      transcoded: normalized.transcoded,
    });
  } catch (error) { next(error); }
});

forumAdsAdminRouter.post("/", adminOnly, validate(adInputSchema), async (req, res, next) => {
  try {
    const ad = await prisma.forumAd.create({
      data: { ...normalizePayload(req.body), createdById: req.user!.userId },
    });
    await invalidateForumAdCaches();
    ok(res, ad);
  } catch (error) { next(error); }
});

forumAdsAdminRouter.patch("/:id", adminOnly, validate(adPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("广告 ID 无效");
    const existing = await prisma.forumAd.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("广告不存在");
    const placements = req.body.placements
      ?? (req.body.placement ? [req.body.placement] : normalizeForumAdPlacements(existing.placements, existing.placement));
    const merged = {
      title: req.body.title ?? existing.title,
      description: req.body.description === undefined ? existing.description : req.body.description,
      imageUrl: req.body.imageUrl === undefined ? existing.imageUrl : req.body.imageUrl,
      linkUrl: req.body.linkUrl ?? existing.linkUrl,
      buttonText: req.body.buttonText === undefined ? existing.buttonText : req.body.buttonText,
      placement: placements[0],
      placements,
      sortOrder: req.body.sortOrder ?? existing.sortOrder,
      enabled: req.body.enabled ?? existing.enabled,
      vipExempt: req.body.vipExempt ?? existing.vipExempt,
      startsAt: req.body.startsAt === undefined ? existing.startsAt?.toISOString() : req.body.startsAt,
      endsAt: req.body.endsAt === undefined ? existing.endsAt?.toISOString() : req.body.endsAt,
    };
    if (!isForumAdPlacement(String(merged.placement))) throw Errors.badRequest("广告投放位置无效");
    const updated = await prisma.forumAd.update({ where: { id }, data: normalizePayload(merged) });
    await invalidateForumAdCaches();
    ok(res, updated);
  } catch (error) { next(error); }
});

forumAdsAdminRouter.delete("/:id", adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("广告 ID 无效");
    const existing = await prisma.forumAd.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound("广告不存在");
    await prisma.forumAd.delete({ where: { id } });
    await invalidateForumAdCaches();
    ok(res, { ok: true });
  } catch (error) { next(error); }
});
