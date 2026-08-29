import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import { Errors, ok } from "../../utils/response";
import { FORUM_AD_PLACEMENTS, isForumAdPlacement, summarizeForumAdMetrics } from "../../services/forumAds";
import { invalidateForumAdCaches } from "../../services/cacheInvalidation";

export const forumAdsAdminRouter = Router();

const placementSchema = z.enum(FORUM_AD_PLACEMENTS);
const adInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  linkUrl: z.string().trim().min(1).max(500),
  buttonText: z.string().trim().max(24).nullable().optional(),
  placement: placementSchema,
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  enabled: z.boolean().optional(),
  vipExempt: z.boolean().optional(),
  startsAt: z.string().trim().max(64).nullable().optional(),
  endsAt: z.string().trim().max(64).nullable().optional(),
});

const adPatchSchema = adInputSchema.partial();

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

function normalizePayload(input: z.infer<typeof adInputSchema>) {
  const startsAt = normalizeDate(input.startsAt, "开始");
  const endsAt = normalizeDate(input.endsAt, "结束");
  if (startsAt && endsAt && startsAt >= endsAt) throw Errors.badRequest("结束时间必须晚于开始时间");
  return {
    title: input.title,
    description: input.description?.trim() || null,
    imageUrl: normalizeUrl(input.imageUrl, "图片地址"),
    linkUrl: normalizeUrl(input.linkUrl, "跳转链接", true)!,
    buttonText: input.buttonText?.trim() || null,
    placement: input.placement,
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
      metrics: summarizeForumAdMetrics(metrics),
    })));
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
    const merged = {
      title: req.body.title ?? existing.title,
      description: req.body.description === undefined ? existing.description : req.body.description,
      imageUrl: req.body.imageUrl === undefined ? existing.imageUrl : req.body.imageUrl,
      linkUrl: req.body.linkUrl ?? existing.linkUrl,
      buttonText: req.body.buttonText === undefined ? existing.buttonText : req.body.buttonText,
      placement: req.body.placement ?? existing.placement,
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
