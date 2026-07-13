import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { ensureForumAccessEnabled } from "../services/forumAccess";
import { ensureUserCanSpeak } from "../services/userModeration";
import {
  ensureUserCanSubmitTopic,
  notifyTopicAiBlocked,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "../services/topicAiReview";
import {
  ensureForumImageAssetsForContent,
  shouldRunImageReview,
} from "../services/imageModeration";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../services/forumStats";
import { invalidateForumCaches } from "../services/cacheInvalidation";

export const lostFoundRouter = Router();
lostFoundRouter.use(authOptional);
lostFoundRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const KINDS = ["found", "lost"] as const;
const CAMPUSES = ["江宁校区", "玄武门校区"] as const;
const PUBLIC_STATUSES = ["active", "claimed"] as const;
const ITEM_STATUSES = ["reviewing", "active", "claimed", "closed", "hidden"] as const;
const CLAIM_STATUSES = ["pending", "accepted", "rejected", "withdrawn"] as const;
const BOARD_SLUG = "lost-found";

const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

const itemInputSchema = z.object({
  kind: z.enum(KINDS),
  itemName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(3000).optional().default(""),
  campus: z.enum(CAMPUSES),
  location: z.string().trim().min(2).max(100),
  happenedAt: z.coerce.date(),
  contact: z.string().trim().min(2).max(120),
  images: z.array(imageUrlSchema).max(6).optional().default([]),
});

const claimInputSchema = z.object({
  message: z.string().trim().min(5).max(1000),
  evidence: z.string().trim().max(1000).optional().default(""),
  contact: z.string().trim().min(2).max(120),
});

const claimStatusSchema = z.object({ status: z.enum(["accepted", "rejected", "withdrawn"]) });
const ownerStatusSchema = z.object({ status: z.enum(["active", "claimed", "closed"]) });
const adminItemSchema = z.object({
  status: z.enum(ITEM_STATUSES).optional(),
  pinned: z.boolean().optional(),
  note: z.string().trim().max(500).optional().default(""),
});

const publisherSelect = {
  id: true,
  nickname: true,
  avatar: true,
  role: true,
  studentSso: true,
} as const;

const itemInclude = {
  publisher: { select: publisherSelect },
  images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] },
  topic: { select: { id: true, hidden: true, pinned: true, locked: true, replyCount: true, likeCount: true, aiReviewStatus: true } },
  _count: { select: { claims: true } },
} satisfies Prisma.LostFoundItemInclude;

function isStaff(role?: string | null, lostFoundRole?: string | null) {
  return role === "admin"
    || role === "mod"
    || lostFoundRole === "admin"
    || lostFoundRole === "super_admin";
}

function itemContent(input: z.infer<typeof itemInputSchema>) {
  const kindLabel = input.kind === "found" ? "我捡到了" : "我丢了";
  const details = [
    `**${kindLabel}：${input.itemName}**`,
    "",
    `- 校区：${input.campus}`,
    `- 地点：${input.location}`,
    `- 时间：${input.happenedAt.toLocaleString("zh-CN", { hour12: false })}`,
    input.description ? `\n${input.description}` : "",
    input.images.map((url, index) => `![失物图片 ${index + 1}](${url})`).join("\n"),
    "\n> 为保护隐私，联系方式与认领凭据请通过失物招领页的站内认领表单提交。",
  ];
  return details.filter(Boolean).join("\n");
}

function imageContent(images: string[]) {
  return images.map((url, index) => `![失物图片 ${index + 1}](${url})`).join("\n");
}

async function ensureBoard() {
  return prisma.board.upsert({
    where: { slug: BOARD_SLUG },
    update: {
      name: "失物招领",
      description: "校园失物信息与认领互助",
      icon: "🧭",
      color: "#0f8f7b",
    },
    create: {
      slug: BOARD_SLUG,
      name: "失物招领",
      description: "校园失物信息与认领互助",
      icon: "🧭",
      color: "#0f8f7b",
      type: "normal",
      order: 35,
    },
  });
}

async function visibleImageUrls(
  items: any[],
  viewerId?: number,
  viewerRole?: string,
  viewerLostFoundRole?: string | null,
) {
  const protectedItems = items.filter(
    (item) => !isStaff(viewerRole, viewerLostFoundRole) && item.publisherId !== viewerId,
  );
  const urls = Array.from(new Set(protectedItems.flatMap((item) => item.images.map((image: any) => image.url))));
  if (!urls.length) return new Map<string, boolean>();
  const rows = await prisma.forumImageAsset.findMany({
    where: { url: { in: urls } },
    select: { url: true, status: true },
  });
  const statusMap = new Map(rows.map((row) => [row.url, row.status]));
  const reviewEnabled = shouldRunImageReview();
  return new Map(urls.map((url) => [url, reviewEnabled ? statusMap.get(url) === "approved" : statusMap.get(url) !== "rejected"]));
}

function serializeItem(
  item: any,
  viewerId?: number,
  viewerRole?: string,
  visibility?: Map<string, boolean>,
  viewerLostFoundRole?: string | null,
) {
  const mine = Boolean(viewerId && item.publisherId === viewerId);
  const staff = isStaff(viewerRole, viewerLostFoundRole);
  const images = mine || staff
    ? item.images
    : item.images.filter((image: any) => visibility?.get(image.url) !== false);
  return {
    id: item.id,
    topicId: item.topicId,
    publisherId: item.publisherId,
    kind: item.kind,
    itemName: item.itemName,
    description: item.description,
    campus: item.campus,
    location: item.location,
    happenedAt: item.happenedAt,
    status: item.status,
    pinned: item.pinned,
    claimedAt: item.claimedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    images: images.map((image: any) => ({ id: image.id, url: image.url, sort: image.sort })),
    cover: images[0]?.url || "",
    publisher: item.publisher,
    topic: item.topic,
    claimCount: item._count?.claims ?? 0,
    mine,
    contact: mine || staff ? item.contact : undefined,
  };
}

function serializeClaim(
  claim: any,
  viewerId?: number,
  viewerRole?: string,
  publisherId?: number,
  viewerLostFoundRole?: string | null,
) {
  const canInspect = isStaff(viewerRole, viewerLostFoundRole)
    || viewerId === claim.claimantId
    || viewerId === publisherId;
  return {
    id: claim.id,
    itemId: claim.itemId,
    claimantId: claim.claimantId,
    message: claim.message,
    evidence: canInspect ? claim.evidence : "",
    contact: canInspect ? claim.contact : "",
    status: claim.status,
    claimant: claim.claimant,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

async function notify(userId: number, title: string, content: string, link: string, payload: Record<string, unknown>) {
  await prisma.notification.create({
    data: {
      userId,
      category: "lost-found",
      level: "normal",
      title,
      content,
      link,
      source: "失物招领",
      payload: JSON.stringify(payload),
    },
  }).catch(() => null);
}

lostFoundRouter.get("/meta", async (_req, res, next) => {
  try {
    const campuses = await prisma.lostFoundItem.findMany({
      where: { status: { in: [...PUBLIC_STATUSES] } },
      distinct: ["campus"],
      select: { campus: true },
      orderBy: { campus: "asc" },
    });
    const campusOptions = Array.from(new Set([...CAMPUSES, ...campuses.map((item) => item.campus).filter(Boolean)]));
    ok(res, { campuses: campusOptions, kinds: KINDS, statuses: PUBLIC_STATUSES });
  } catch (error) { next(error); }
});

lostFoundRouter.get("/items", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(50, Math.max(6, Number(req.query.size || 18)));
    const q = String(req.query.q || "").trim().slice(0, 100);
    const kind = KINDS.includes(req.query.kind as any) ? String(req.query.kind) : "";
    const campus = String(req.query.campus || "").trim().slice(0, 40);
    const location = String(req.query.location || "").trim().slice(0, 100);
    const status = PUBLIC_STATUSES.includes(req.query.status as any) ? String(req.query.status) : "";
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where: any = {
      status: status || { in: [...PUBLIC_STATUSES] },
      topic: { hidden: false },
    };
    if (kind) where.kind = kind;
    if (campus) where.campus = campus;
    if (location) where.location = { contains: location, mode: "insensitive" };
    if (q) where.OR = [
      { itemName: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ];
    if (from || to) where.happenedAt = { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) };
    const [list, total] = await Promise.all([
      prisma.lostFoundItem.findMany({ where, include: itemInclude, orderBy: [{ pinned: "desc" }, { status: "asc" }, { happenedAt: "desc" }], skip: (page - 1) * size, take: size }),
      prisma.lostFoundItem.count({ where }),
    ]);
    const visibility = await visibleImageUrls(
      list,
      req.user?.userId,
      req.user?.role,
      req.user?.lostFoundRole,
    );
    ok(res, {
      page,
      size,
      total,
      list: list.map((item) => serializeItem(
        item,
        req.user?.userId,
        req.user?.role,
        visibility,
        req.user?.lostFoundRole,
      )),
    });
  } catch (error) { next(error); }
});

lostFoundRouter.get("/items/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.lostFoundItem.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw Errors.notFound("失物信息不存在");
    const canInspect = item.publisherId === req.user?.userId
      || isStaff(req.user?.role, req.user?.lostFoundRole);
    if ((!PUBLIC_STATUSES.includes(item.status as any) || item.topic.hidden) && !canInspect) throw Errors.notFound("失物信息不存在");
    const visibility = await visibleImageUrls(
      [item],
      req.user?.userId,
      req.user?.role,
      req.user?.lostFoundRole,
    );
    const data: any = serializeItem(
      item,
      req.user?.userId,
      req.user?.role,
      visibility,
      req.user?.lostFoundRole,
    );
    if (canInspect) {
      const claims = await prisma.lostFoundClaim.findMany({
        where: { itemId: id },
        include: { claimant: { select: publisherSelect } },
        orderBy: { createdAt: "desc" },
      });
      data.claims = claims.map((claim) => serializeClaim(
        claim,
        req.user?.userId,
        req.user?.role,
        item.publisherId,
        req.user?.lostFoundRole,
      ));
    } else if (req.user?.userId) {
      const claim = await prisma.lostFoundClaim.findUnique({
        where: { itemId_claimantId: { itemId: id, claimantId: req.user.userId } },
        include: { claimant: { select: publisherSelect } },
      });
      data.myClaim = claim
        ? serializeClaim(
            claim,
            req.user.userId,
            req.user.role,
            item.publisherId,
            req.user.lostFoundRole,
          )
        : null;
    }
    ok(res, data);
  } catch (error) { next(error); }
});

lostFoundRouter.post("/items", authRequired, validate(itemInputSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    await ensureForumAccessEnabled(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    await ensureUserCanSubmitTopic(userId);
    const input = req.body as z.infer<typeof itemInputSchema>;
    const board = await ensureBoard();
    const content = itemContent(input);
    const metadata = { lostFoundItem: true, kind: input.kind, campus: input.campus, location: input.location, happenedAt: input.happenedAt.toISOString(), images: input.images };
    const bypass = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const review = shouldRunAiReview() && !bypass
      ? await reviewTopicContent({ title: `${input.kind === "found" ? "捡到" : "寻找"}｜${input.itemName}`, content, boardName: board.name, boardType: board.type, metadata })
      : null;
    const hiddenByReview = review?.status === "blocked_ai";
    const item = await prisma.$transaction(async (tx) => {
      const topic = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: userId,
          title: `${input.kind === "found" ? "捡到" : "寻找"}｜${input.itemName}`,
          content,
          metadata: JSON.stringify(metadata),
          aiReviewStatus: review?.status || "auto_passed",
          aiRiskLevel: review?.riskLevel || "low",
          aiRiskScore: review?.riskScore || 0,
          aiReviewReason: review?.reason || "",
          aiReviewDetail: review?.detail || "",
          aiModel: review?.model || null,
          aiReviewedAt: review ? new Date() : null,
          hidden: hiddenByReview,
          lastReplyAt: new Date(),
          lastReplyById: userId,
        },
      });
      const created = await tx.lostFoundItem.create({
        data: {
          topicId: topic.id,
          publisherId: userId,
          kind: input.kind,
          itemName: input.itemName,
          description: input.description,
          campus: input.campus,
          location: input.location,
          happenedAt: input.happenedAt,
          contact: input.contact,
          status: hiddenByReview ? "reviewing" : "active",
          images: { create: input.images.map((url, sort) => ({ url, sort })) },
        },
        include: itemInclude,
      });
      if (!hiddenByReview) {
        await tx.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
        await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
      }
      return created;
    });
    await ensureForumImageAssetsForContent(imageContent(input.images), userId).catch(() => null);
    if (hiddenByReview && review) {
      await notifyTopicAiBlocked({ topicId: item.topicId, userId, title: item.itemName, reason: review.reason, riskScore: review.riskScore });
    }
    await invalidateForumCaches();
    ok(res, {
      ...serializeItem(item, userId, req.user!.role, undefined, req.user!.lostFoundRole),
      review: review ? { status: review.status, reason: review.reason } : null,
    });
  } catch (error) { next(error); }
});

lostFoundRouter.patch("/items/:id/status", authRequired, validate(ownerStatusSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.lostFoundItem.findUnique({ where: { id }, include: { topic: true } });
    if (!item) throw Errors.notFound("失物信息不存在");
    if (
      item.publisherId !== req.user!.userId
      && !isStaff(req.user!.role, req.user!.lostFoundRole)
    ) throw Errors.forbidden("无权修改这条信息");
    const status = req.body.status as "active" | "claimed" | "closed";
    if (
      !isStaff(req.user!.role, req.user!.lostFoundRole)
      && ["reviewing", "hidden"].includes(item.status)
      && status !== "closed"
    ) {
      throw Errors.forbidden("审核中或已下架的信息不能自行重新开放");
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.topic.update({ where: { id: item.topicId }, data: { locked: status !== "active" } });
      return tx.lostFoundItem.update({ where: { id }, data: { status, claimedAt: status === "claimed" ? item.claimedAt || new Date() : null }, include: itemInclude });
    });
    ok(res, serializeItem(updated, req.user!.userId, req.user!.role, undefined, req.user!.lostFoundRole));
  } catch (error) { next(error); }
});

lostFoundRouter.post("/items/:id/claims", authRequired, validate(claimInputSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const claimantId = req.user!.userId;
    const item = await prisma.lostFoundItem.findUnique({ where: { id: itemId } });
    if (!item || item.status !== "active") throw Errors.notFound("该信息已不可认领");
    if (item.publisherId === claimantId) throw Errors.badRequest("不能认领自己发布的信息");
    const input = req.body as z.infer<typeof claimInputSchema>;
    const claim = await prisma.lostFoundClaim.upsert({
      where: { itemId_claimantId: { itemId, claimantId } },
      update: { message: input.message, evidence: input.evidence, contact: input.contact, status: "pending", resolvedAt: null },
      create: { itemId, claimantId, message: input.message, evidence: input.evidence, contact: input.contact },
      include: { claimant: { select: publisherSelect } },
    });
    await notify(item.publisherId, "收到新的认领申请", `「${item.itemName}」收到一条站内认领信息，请核对物品特征后处理。`, `/lost-found?item=${item.id}`, { type: "lost-found-claim", itemId, claimId: claim.id });
    ok(res, serializeClaim(claim, claimantId, req.user!.role, item.publisherId, req.user!.lostFoundRole));
  } catch (error) { next(error); }
});

lostFoundRouter.patch("/claims/:id", authRequired, validate(claimStatusSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const claim = await prisma.lostFoundClaim.findUnique({ where: { id }, include: { item: { include: { topic: true } }, claimant: { select: publisherSelect } } });
    if (!claim) throw Errors.notFound("认领申请不存在");
    const status = req.body.status as typeof CLAIM_STATUSES[number];
    const staff = isStaff(req.user!.role, req.user!.lostFoundRole);
    if (status === "withdrawn") {
      if (claim.claimantId !== req.user!.userId) throw Errors.forbidden("无权撤回该申请");
    } else if (claim.item.publisherId !== req.user!.userId && !staff) {
      throw Errors.forbidden("只有发布者可以处理认领申请");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const resolved = await tx.lostFoundClaim.update({ where: { id }, data: { status, resolvedAt: new Date() }, include: { claimant: { select: publisherSelect } } });
      if (status === "accepted") {
        await tx.lostFoundClaim.updateMany({ where: { itemId: claim.itemId, id: { not: id }, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
        await tx.lostFoundItem.update({ where: { id: claim.itemId }, data: { status: "claimed", claimedAt: new Date() } });
        await tx.topic.update({ where: { id: claim.item.topicId }, data: { locked: true } });
      }
      return resolved;
    });
    if (status !== "withdrawn") {
      await notify(claim.claimantId, status === "accepted" ? "认领申请已通过" : "认领申请未通过", `你对「${claim.item.itemName}」提交的认领申请已${status === "accepted" ? "通过，请按联系方式与发布者核实交接" : "被发布者拒绝"}。`, `/lost-found?item=${claim.itemId}`, { type: "lost-found-claim-result", itemId: claim.itemId, claimId: id, status });
    }
    ok(res, serializeClaim(
      updated,
      req.user!.userId,
      req.user!.role,
      claim.item.publisherId,
      req.user!.lostFoundRole,
    ));
  } catch (error) { next(error); }
});

lostFoundRouter.get("/mine", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [published, claims] = await Promise.all([
      prisma.lostFoundItem.findMany({ where: { publisherId: userId }, include: itemInclude, orderBy: { updatedAt: "desc" } }),
      prisma.lostFoundClaim.findMany({ where: { claimantId: userId }, include: { item: { include: itemInclude }, claimant: { select: publisherSelect } }, orderBy: { updatedAt: "desc" } }),
    ]);
    ok(res, {
      published: published.map((item) => serializeItem(
        item,
        userId,
        req.user!.role,
        undefined,
        req.user!.lostFoundRole,
      )),
      claims: claims.map((claim) => ({
        ...serializeClaim(
          claim,
          userId,
          req.user!.role,
          claim.item.publisherId,
          req.user!.lostFoundRole,
        ),
        item: serializeItem(
          claim.item,
          userId,
          req.user!.role,
          undefined,
          req.user!.lostFoundRole,
        ),
      })),
    });
  } catch (error) { next(error); }
});

lostFoundRouter.get("/admin/items", authRequired, async (req, res, next) => {
  try {
    if (!isStaff(req.user!.role, req.user!.lostFoundRole)) throw Errors.forbidden("需要失物招领管理权限");
    const q = String(req.query.q || "").trim().slice(0, 100);
    const status = ITEM_STATUSES.includes(req.query.status as any) ? String(req.query.status) : "";
    const where: any = {};
    if (status) where.status = status;
    if (q) where.OR = [
      { itemName: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
      { publisher: { nickname: { contains: q, mode: "insensitive" } } },
    ];
    const list = await prisma.lostFoundItem.findMany({ where, include: itemInclude, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 200 });
    ok(res, list.map((item) => serializeItem(
      item,
      req.user!.userId,
      req.user!.role,
      undefined,
      req.user!.lostFoundRole,
    )));
  } catch (error) { next(error); }
});

lostFoundRouter.patch("/admin/items/:id", authRequired, validate(adminItemSchema), async (req, res, next) => {
  try {
    if (!isStaff(req.user!.role, req.user!.lostFoundRole)) throw Errors.forbidden("需要失物招领管理权限");
    const id = Number(req.params.id);
    const current = await prisma.lostFoundItem.findUnique({ where: { id }, include: { topic: true } });
    if (!current) throw Errors.notFound("失物信息不存在");
    const status = (req.body.status || current.status) as typeof ITEM_STATUSES[number];
    const pinned = req.body.pinned ?? current.pinned;
    const hideTopic = ["reviewing", "hidden"].includes(status);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.topic.update({
        where: { id: current.topicId },
        data: {
          hidden: hideTopic,
          pinned,
          locked: ["claimed", "closed", "hidden"].includes(status),
          ...(current.status === "reviewing" && status === "active" ? {
            aiReviewStatus: "approved_manual",
            manualReviewedById: req.user!.userId,
            manualReviewedAt: new Date(),
            manualReviewNote: req.body.note || "失物招领后台审核通过",
          } : {}),
        },
      });
      if (hideTopic !== current.topic.hidden) {
        await Promise.all([refreshBoardTopicCounts([current.topic.boardId], tx), refreshUserPostCount(current.publisherId, tx)]);
      }
      return tx.lostFoundItem.update({ where: { id }, data: { status, pinned, claimedAt: status === "claimed" ? current.claimedAt || new Date() : status === "active" ? null : current.claimedAt }, include: itemInclude });
    });
    await notify(current.publisherId, "失物信息状态已更新", `「${current.itemName}」已由管理人员调整为 ${status}${req.body.note ? `：${req.body.note}` : ""}`, `/lost-found?item=${id}`, { type: "lost-found-admin", itemId: id, status });
    await invalidateForumCaches();
    ok(res, serializeItem(updated, req.user!.userId, req.user!.role, undefined, req.user!.lostFoundRole));
  } catch (error) { next(error); }
});
