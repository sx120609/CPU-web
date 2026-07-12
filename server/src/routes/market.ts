import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { config } from "../config";
import { isFeatureOn } from "../services/siteSettings";
import { ensureUserCanSpeak } from "../services/userModeration";
import {
  ensureUserCanSubmitTopic,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "../services/topicAiReview";
import {
  amountCentsToMoney,
  buildEpaySubmitPayload,
  getEnabledEpayTypes,
  getEpayMerchantKey,
  moneyToAmountCents,
  resolvePaymentOrigin,
  verifyEpayParams,
  type EpayPayType,
} from "../services/epay";
import { calculateMarketOrderAmounts } from "../services/marketFinance";
import { ensureForumImageAssetsForContent, shouldRunImageReview } from "../services/imageModeration";
import { ensureCanReadBoardType, ensureForumAccessEnabled } from "../services/forumAccess";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../services/forumStats";

export const marketRouter = Router();
marketRouter.use(authOptional);
marketRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
marketRouter.use(async (req, _res, next) => {
  try {
    if (req.path === "/payments/notify" || req.path === "/payments/return") return next();
    if (!isFeatureOn("market") && !isMarketStaff(req.user?.role)) {
      throw Errors.forbidden("商城当前已关闭");
    }
    await ensureCanReadBoardType("market", req.user?.userId ?? null, req.user?.role ?? null);
    next();
  } catch (error) {
    next(error);
  }
});

const CONDITIONS = ["new", "like_new", "good", "fair", "wanted"] as const;
const TRADE_MODES = ["meetup", "shipping", "both", "online"] as const;
const LISTING_TYPES = ["sell", "wanted"] as const;
const ITEM_STATUSES = ["draft", "reviewing", "active", "reserved", "sold", "withdrawn", "hidden"] as const;
const PAY_TYPES = ["alipay", "wxpay", "qqpay", "bank", "jdpay"] as const;
const ORDER_TTL_MS = 15 * 60 * 1000;
const MARKET_CONFIG_ID = 1;
const DEFAULT_COMMISSION_BPS = 500;
const DEFAULT_CATEGORIES = [
  { slug: "digital", name: "数码 3C", icon: "💻", description: "手机、电脑、数码配件", fulfillmentType: "physical", imageRequired: true, sort: 10 },
  { slug: "books", name: "教材书籍", icon: "📚", description: "教材、课外书与纸质资料", fulfillmentType: "physical", imageRequired: true, sort: 20 },
  { slug: "digital_goods", name: "电子资料", icon: "📁", description: "电子书、原创笔记与数字文件", fulfillmentType: "digital", imageRequired: false, sort: 30 },
  { slug: "dorm", name: "宿舍用品", icon: "🛏️", description: "宿舍与日常生活用品", fulfillmentType: "physical", imageRequired: true, sort: 40 },
  { slug: "appliance", name: "小家电", icon: "🔌", description: "小型电器与配件", fulfillmentType: "physical", imageRequired: true, sort: 50 },
  { slug: "fashion", name: "服饰鞋包", icon: "👕", description: "服饰、鞋履与箱包", fulfillmentType: "physical", imageRequired: true, sort: 60 },
  { slug: "sports", name: "运动户外", icon: "🏸", description: "运动器材与户外用品", fulfillmentType: "physical", imageRequired: true, sort: 70 },
  { slug: "tickets", name: "票务卡券", icon: "🎫", description: "合规票券与校园卡券", fulfillmentType: "physical", imageRequired: true, sort: 80 },
  { slug: "other", name: "其他商品", icon: "📦", description: "未归入其他分类的商品", fulfillmentType: "physical", imageRequired: true, sort: 90 },
] as const;

function isMarketStaff(role?: string | null) {
  return role === "admin" || role === "mod";
}

const publicUserSelect = {
  id: true,
  nickname: true,
  avatar: true,
  role: true,
  studentSso: true,
  createdAt: true,
} as const;

const itemInclude: any = {
  seller: { select: publicUserSelect },
  images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] },
  topic: { select: { id: true, replyCount: true, likeCount: true, hidden: true, aiReviewStatus: true } },
  _count: { select: { favorites: true, offers: true } },
} as const;

const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

const itemInputSchema = z.object({
  listingType: z.enum(LISTING_TYPES).default("sell"),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(20000),
  category: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).default("other"),
  price: z.union([z.string(), z.number()]),
  originalPrice: z.union([z.string(), z.number()]).optional().nullable(),
  negotiable: z.boolean().optional().default(false),
  condition: z.enum(CONDITIONS).default("good"),
  tradeMode: z.enum(TRADE_MODES).default("meetup"),
  campus: z.string().trim().max(40).optional().default(""),
  location: z.string().trim().max(100).optional().default(""),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
  digitalDelivery: z.string().trim().max(10000).optional().default(""),
  draft: z.boolean().optional().default(false),
});

const itemPatchSchema = itemInputSchema.partial().extend({
  status: z.enum(ITEM_STATUSES).optional(),
});

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function cents(value: string | number | null | undefined, allowZero = true) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) throw Errors.badRequest("价格格式不正确");
  return Math.round(amount * 100);
}

function parseJson(value: string | null | undefined) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function extractImagesFromContent(content: string) {
  const urls: string[] = [];
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }
  for (const match of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }
  return urls.slice(0, 9);
}

function marketImagesAsContent(images: string[]) {
  return images.map((url, index) => `![商品图片 ${index + 1}](${url})`).join("\n");
}

async function registerMarketImages(images: string[], userId: number) {
  if (!images.length) return;
  await ensureForumImageAssetsForContent(marketImagesAsContent(images), userId).catch((error) => {
    console.warn("[market] 注册商品图片审核任务失败", error);
  });
}

function nextMarketTradeNo(userId: number) {
  return `MK${Date.now()}U${userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function serializeItem(item: any, viewerId?: number) {
  return {
    id: item.id,
    topicId: item.topicId,
    sellerId: item.sellerId,
    listingType: item.listingType,
    title: item.title,
    description: item.description,
    category: item.category,
    deliveryType: item.deliveryType || "physical",
    hasDigitalDelivery: Boolean(item.digitalDeliveryEncrypted),
    price: amountCentsToMoney(item.priceCents),
    priceCents: item.priceCents,
    originalPrice: item.originalPriceCents === null ? null : amountCentsToMoney(item.originalPriceCents),
    originalPriceCents: item.originalPriceCents,
    negotiable: item.negotiable,
    condition: item.condition,
    tradeMode: item.tradeMode,
    campus: item.campus,
    location: item.location,
    status: item.status,
    viewCount: item.viewCount,
    favoriteCount: item._count?.favorites ?? item.favoriteCount ?? 0,
    offerCount: item._count?.offers ?? item.offerCount ?? 0,
    images: (item.images || []).map((image: any) => ({ id: image.id, url: image.url, sort: image.sort })),
    cover: item.images?.[0]?.url || extractImagesFromContent(item.description || "")[0] || "",
    seller: item.seller,
    topic: item.topic,
    favorited: Array.isArray(item.favorites) ? item.favorites.some((favorite: any) => favorite.userId === viewerId) : false,
    mine: Boolean(viewerId && viewerId === item.sellerId),
    soldAt: item.soldAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function removeHiddenImagesFromContent(content: string, visibleUrls: Set<string>) {
  return content
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (raw, alt, url) => (
      visibleUrls.has(url) ? raw : `> [${alt || "商品图片"}正在审核]`
    ))
    .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (raw, url) => (
      visibleUrls.has(url) ? raw : "<p>商品图片正在审核</p>"
    ));
}

async function prepareMarketItemsForViewer(items: any[], viewerId?: number, viewerRole?: string) {
  const reviewEnabled = shouldRunImageReview();
  const protectedItems = items.filter((item) => !isMarketStaff(viewerRole) && item.sellerId !== viewerId);
  const urls = Array.from(new Set(protectedItems.flatMap((item) => [
    ...(item.images || []).map((image: any) => image.url),
    ...extractImagesFromContent(item.description || ""),
  ]).filter(Boolean)));
  const rows = urls.length
    ? await prisma.forumImageAsset.findMany({ where: { url: { in: urls } }, select: { url: true, status: true } })
    : [];
  const statusByUrl = new Map(rows.map((row) => [row.url, row.status]));
  const isVisible = (url: string) => reviewEnabled
    ? statusByUrl.get(url) === "approved"
    : statusByUrl.get(url) !== "rejected";
  return items.map((item) => {
    if (isMarketStaff(viewerRole) || item.sellerId === viewerId) return item;
    const visibleUrls = new Set<string>([
      ...(item.images || []).map((image: any) => image.url),
      ...extractImagesFromContent(item.description || ""),
    ].filter(isVisible));
    return {
      ...item,
      images: (item.images || []).filter((image: any) => visibleUrls.has(image.url)),
      description: removeHiddenImagesFromContent(item.description || "", visibleUrls),
    };
  });
}

function serializeOrder(order: any, viewerId?: number, viewerRole?: string) {
  const { digitalDeliveryEncrypted, item, ...safeOrder } = order;
  const canSeeDigitalDelivery = Boolean(
    digitalDeliveryEncrypted
    && ["paid", "delivering", "completed", "refund_pending", "disputed"].includes(order.status)
    && (viewerId === order.buyerId || viewerId === order.sellerId || ["admin", "mod"].includes(viewerRole || "")),
  );
  let digitalDelivery: string | null = null;
  if (canSeeDigitalDelivery) {
    try { digitalDelivery = openSensitive(digitalDeliveryEncrypted); } catch { digitalDelivery = null; }
  }
  return {
    ...safeOrder,
    item: item ? serializeItem(item, viewerId) : undefined,
    amount: amountCentsToMoney(order.amountCents),
    platformFee: amountCentsToMoney(order.platformFeeCents),
    sellerAmount: amountCentsToMoney(order.sellerAmountCents),
    digitalDelivery,
  };
}

function serializeOffer(offer: any, viewerId?: number, viewerRole?: string) {
  const { item, order, ...safeOffer } = offer;
  return {
    ...safeOffer,
    price: amountCentsToMoney(offer.priceCents),
    item: item ? serializeItem(item, viewerId) : undefined,
    order: order ? serializeOrder(order, viewerId, viewerRole) : null,
  };
}

async function ensureMarketCategories() {
  await Promise.all(DEFAULT_CATEGORIES.map((category) => prisma.marketCategory.upsert({
    where: { slug: category.slug },
    update: {},
    create: category,
  })));
}

async function getMarketCategory(slug: string, includeDisabled = false) {
  await ensureMarketCategories();
  const category = await prisma.marketCategory.findUnique({ where: { slug } });
  if (!category || (!includeDisabled && !category.enabled)) throw Errors.badRequest("请选择有效的商品品类");
  return category;
}

async function getMarketConfig() {
  return prisma.marketConfig.upsert({
    where: { id: MARKET_CONFIG_ID },
    update: {},
    create: { id: MARKET_CONFIG_ID, commissionBps: DEFAULT_COMMISSION_BPS },
  });
}

function serializeMarketConfig(config: { commissionBps: number; updatedAt: Date }) {
  return {
    commissionBps: config.commissionBps,
    commissionRate: config.commissionBps / 100,
    updatedAt: config.updatedAt,
  };
}

async function requireVerifiedMarketUser(userId: number, role: string) {
  if (!isFeatureOn("market") && !isMarketStaff(role)) throw Errors.forbidden("商城当前已关闭");
  await ensureForumAccessEnabled(userId, role);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, studentSso: true, forumEnabled: true, status: true, topicSubmissionLocked: true },
  });
  if (!user) throw Errors.unauthorized();
  if (!isMarketStaff(role) && !user.studentSso) throw Errors.forbidden("仅限通过学校统一认证的用户使用商城");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  return user;
}

async function notify(userId: number, title: string, content: string, link: string, payload: Record<string, unknown>) {
  await prisma.notification.create({
    data: {
      userId,
      category: "market",
      level: "normal",
      title,
      content,
      link,
      source: "校园商城",
      payload: JSON.stringify(payload),
    },
  }).catch(() => null);
}

async function closeExpiredMarketOrders() {
  const expired = await prisma.marketOrder.findMany({
    where: { status: "pending_payment", expiresAt: { lte: new Date() } },
    select: { id: true, itemId: true, offerId: true },
    take: 100,
  });
  for (const order of expired) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.marketOrder.updateMany({
        where: { id: order.id, status: "pending_payment", expiresAt: { lte: new Date() } },
        data: { status: "cancelled", closedAt: new Date() },
      });
      if (claimed.count !== 1) return;
      await tx.marketOffer.updateMany({ where: { id: order.offerId, status: "accepted" }, data: { status: "expired" } });
      await tx.marketItem.updateMany({ where: { id: order.itemId, status: "reserved" }, data: { status: "active" } });
    }).catch(() => null);
  }
}

marketRouter.get("/meta", async (_req, res, next) => {
  try {
    await ensureMarketCategories();
    const marketConfig = await getMarketConfig();
    const categories = await prisma.marketCategory.findMany({ where: { enabled: true }, orderBy: [{ sort: "asc" }, { id: "asc" }] });
    ok(res, {
      categories,
      conditions: CONDITIONS,
      tradeModes: TRADE_MODES,
      listingTypes: LISTING_TYPES,
      payTypes: await getEnabledEpayTypes(),
      paymentEnabled: (await getEnabledEpayTypes()).length > 0,
      ...serializeMarketConfig(marketConfig),
    });
  } catch (error) { next(error); }
});

marketRouter.get("/items", async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(60, Math.max(1, Number(req.query.size || 24)));
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const listingType = String(req.query.listingType || "").trim();
    const condition = String(req.query.condition || "").trim();
    const tradeMode = String(req.query.tradeMode || "").trim();
    const campus = String(req.query.campus || "").trim();
    const minPrice = req.query.minPrice === undefined ? null : cents(String(req.query.minPrice));
    const maxPrice = req.query.maxPrice === undefined ? null : cents(String(req.query.maxPrice));
    const where: any = { status: "active" };
    if (q) where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ];
    if (category) where.category = category;
    if (LISTING_TYPES.includes(listingType as any)) where.listingType = listingType;
    if (CONDITIONS.includes(condition as any)) where.condition = condition;
    if (TRADE_MODES.includes(tradeMode as any)) where.tradeMode = tradeMode;
    if (campus) where.campus = campus;
    if (minPrice !== null || maxPrice !== null) where.priceCents = {
      ...(minPrice !== null ? { gte: minPrice } : {}),
      ...(maxPrice !== null ? { lte: maxPrice } : {}),
    };
    const sort = String(req.query.sort || "new");
    const orderBy: any = sort === "price_asc" ? { priceCents: "asc" }
      : sort === "price_desc" ? { priceCents: "desc" }
        : sort === "popular" ? [{ favoriteCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }]
          : { createdAt: "desc" };
    const [list, total] = await Promise.all([
      prisma.marketItem.findMany({
        where,
        include: {
          ...itemInclude,
          favorites: req.user ? { where: { userId: req.user.userId }, select: { userId: true } } : false,
        },
        orderBy,
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.marketItem.count({ where }),
    ]);
    const visibleList = await prepareMarketItemsForViewer(list, req.user?.userId, req.user?.role);
    ok(res, { page, size, total, list: visibleList.map((item) => serializeItem(item, req.user?.userId)) });
  } catch (error) { next(error); }
});

marketRouter.get("/items/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({
      where: { id },
      include: {
        ...itemInclude,
        favorites: req.user ? { where: { userId: req.user.userId }, select: { userId: true } } : false,
      },
    });
    let canInspectInactive = Boolean(req.user && (req.user.userId === item?.sellerId || isMarketStaff(req.user.role)));
    if (item && req.user && !canInspectInactive && item.status !== "hidden") {
      const participation = await prisma.marketOffer.findFirst({
        where: { itemId: id, buyerId: req.user.userId },
        select: { id: true },
      }) || await prisma.marketConversation.findFirst({
        where: { itemId: id, OR: [{ buyerId: req.user.userId }, { sellerId: req.user.userId }] },
        select: { id: true },
      });
      canInspectInactive = Boolean(participation);
    }
    if (!item || (item.status !== "active" && !canInspectInactive)) {
      throw Errors.notFound("商品不存在");
    }
    if (item.status === "active") prisma.marketItem.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    const rating = await prisma.marketReview.aggregate({ where: { targetUserId: item.sellerId }, _avg: { rating: true }, _count: true });
    const [visibleItem] = await prepareMarketItemsForViewer([item], req.user?.userId, req.user?.role);
    ok(res, { ...serializeItem(visibleItem, req.user?.userId), sellerRating: rating._avg.rating || 0, sellerReviewCount: rating._count });
  } catch (error) { next(error); }
});

marketRouter.post("/items", authRequired, validate(itemInputSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    await requireVerifiedMarketUser(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    await ensureUserCanSubmitTopic(userId);
    const input = req.body as z.infer<typeof itemInputSchema>;
    const category = await getMarketCategory(input.category);
    const deliveryType = category.fulfillmentType === "digital" ? "digital" : "physical";
    if (deliveryType === "digital" && input.listingType === "sell" && !input.draft && !input.digitalDelivery) {
      throw Errors.badRequest("电子资料上架前必须填写线上交付内容");
    }
    if (category.imageRequired && input.listingType === "sell" && !input.draft && !input.images.length) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }
    const priceCents = cents(input.price) ?? 0;
    const originalPriceCents = cents(input.originalPrice);
    const board = await prisma.board.findUnique({ where: { slug: "market" } });
    if (!board) throw Errors.notFound("商城板块不存在");
    const metadata = {
      marketItem: true,
      price: Number(amountCentsToMoney(priceCents)),
      condition: input.condition,
      tradeMode: deliveryType === "digital" ? "online" : input.tradeMode,
      deliveryType,
      listingType: input.listingType,
      category: input.category,
      campus: input.campus,
      location: input.location,
      images: input.images,
    };
    const bypass = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const review = shouldRunAiReview() && !bypass
      ? await reviewTopicContent({ title: input.title, content: input.description, boardName: board.name, boardType: "market", metadata })
      : null;
    const hiddenByReview = review?.status === "blocked_ai";
    const item = await prisma.$transaction(async (tx) => {
      const topic = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: userId,
          title: input.title,
          content: input.description,
          metadata: JSON.stringify(metadata),
          aiReviewStatus: review?.status || "auto_passed",
          aiRiskLevel: review?.riskLevel || "low",
          aiRiskScore: review?.riskScore || 0,
          aiReviewReason: review?.reason || "",
          aiReviewDetail: review?.detail || "",
          aiModel: review?.model || null,
          aiReviewedAt: review ? new Date() : null,
          hidden: input.draft || hiddenByReview,
          lastReplyAt: new Date(),
          lastReplyById: userId,
        },
      });
      const created = await tx.marketItem.create({
        data: {
          topicId: topic.id,
          sellerId: userId,
          listingType: input.listingType,
          title: input.title,
          description: input.description,
          category: input.category,
          deliveryType,
          digitalDeliveryEncrypted: deliveryType === "digital" && input.digitalDelivery ? sealSensitive(input.digitalDelivery) : null,
          priceCents,
          originalPriceCents,
          negotiable: input.negotiable,
          condition: input.condition,
          tradeMode: deliveryType === "digital" ? "online" : input.tradeMode,
          campus: input.campus,
          location: input.location,
          status: input.draft ? "draft" : hiddenByReview ? "reviewing" : "active",
          images: { create: input.images.map((url, sort) => ({ url, sort })) },
        },
        include: itemInclude,
      });
      if (!hiddenByReview && !input.draft) {
        await tx.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
        await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
      }
      return created;
    });
    await registerMarketImages(input.images, userId);
    ok(res, { ...serializeItem(item, userId), review: review ? { status: review.status, reason: review.reason } : null });
  } catch (error) { next(error); }
});

marketRouter.patch("/items/:id", authRequired, validate(itemPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.marketItem.findUnique({ where: { id }, include: { images: true, topic: true } });
    if (!current) throw Errors.notFound("商品不存在");
    const staff = isMarketStaff(req.user!.role);
    const canManage = current.sellerId === req.user!.userId || staff;
    if (!canManage) throw Errors.forbidden("无权修改该商品");
    if (!staff) {
      await requireVerifiedMarketUser(req.user!.userId, req.user!.role);
      await ensureUserCanSpeak(req.user!.userId);
    }
    const input = req.body as z.infer<typeof itemPatchSchema>;
    if (input.status && !staff && !["active", "withdrawn", "sold", "draft"].includes(input.status)) {
      throw Errors.forbidden("不能切换到该商品状态");
    }
    const data: any = { ...input };
    delete data.images;
    delete data.price;
    delete data.originalPrice;
    delete data.draft;
    delete data.digitalDelivery;
    const category = input.category ? await getMarketCategory(input.category) : await getMarketCategory(current.category, true);
    const deliveryType = category.fulfillmentType === "digital" ? "digital" : "physical";
    const finalListingType = input.listingType ?? current.listingType;
    const contentChanged = [
      "listingType", "title", "description", "category", "price", "originalPrice", "negotiable",
      "condition", "tradeMode", "campus", "location", "images", "digitalDelivery",
    ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    let desiredStatus = input.status || (input.draft === true ? "draft" : input.draft === false ? "active" : current.status);
    if (!staff && current.status === "reviewing" && contentChanged && input.status === undefined && input.draft === undefined) {
      desiredStatus = "active";
    }
    if (!staff && desiredStatus === "active" && current.status === "reviewing" && !contentChanged) {
      throw Errors.conflict("商品正在等待人工审核，不能直接上架");
    }
    const finalImageCount = input.images ? input.images.length : current.images.length;
    if (category.imageRequired && finalListingType === "sell" && desiredStatus === "active" && finalImageCount === 0) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }
    data.deliveryType = deliveryType;
    if (deliveryType === "digital") {
      data.tradeMode = "online";
      if (input.digitalDelivery) data.digitalDeliveryEncrypted = sealSensitive(input.digitalDelivery);
      const willBePublished = desiredStatus === "active";
      if (finalListingType !== "wanted" && willBePublished && !input.digitalDelivery && !current.digitalDeliveryEncrypted) {
        throw Errors.badRequest("电子资料上架前必须填写线上交付内容");
      }
    } else {
      data.digitalDeliveryEncrypted = null;
    }
    if (input.price !== undefined) data.priceCents = cents(input.price) ?? 0;
    if (input.originalPrice !== undefined) data.originalPriceCents = cents(input.originalPrice);
    const finalTitle = input.title ?? current.title;
    const finalDescription = input.description ?? current.description;
    const finalImages = input.images ?? current.images.map((image) => image.url);
    const metadata = {
      ...parseJson(current.topic?.metadata),
      marketItem: true,
      price: input.price === undefined ? Number(amountCentsToMoney(current.priceCents)) : Number(input.price),
      condition: input.condition ?? current.condition,
      tradeMode: deliveryType === "digital" ? "online" : input.tradeMode ?? current.tradeMode,
      deliveryType,
      listingType: finalListingType,
      category: input.category ?? current.category,
      campus: input.campus ?? current.campus,
      location: input.location ?? current.location,
      images: finalImages,
    };
    let review: any = null;
    const publicationAttempt = !staff && desiredStatus === "active" && (contentChanged || current.status === "draft");
    if (publicationAttempt) {
      const bypass = await shouldBypassAiReviewForUser(req.user!.userId, req.user!.role);
      review = shouldRunAiReview() && !bypass
        ? await reviewTopicContent({
          title: finalTitle,
          content: finalDescription,
          boardName: "商城",
          boardType: "market",
          metadata,
        })
        : null;
      desiredStatus = review?.status === "blocked_ai" ? "reviewing" : "active";
    }
    data.status = desiredStatus;
    if (desiredStatus === "sold") data.soldAt = current.soldAt || new Date();
    else if (desiredStatus === "active") data.soldAt = null;
    const finalTopicHidden = ["draft", "reviewing", "hidden"].includes(desiredStatus)
      ? true
      : desiredStatus === "active"
        ? false
        : current.topic?.hidden ?? false;
    const updated = await prisma.$transaction(async (tx) => {
      if (input.images) {
        await tx.marketImage.deleteMany({ where: { itemId: id } });
        if (input.images.length) await tx.marketImage.createMany({ data: input.images.map((url, sort) => ({ itemId: id, url, sort })) });
      }
      if (current.topicId && current.topic) {
        await tx.topic.update({
          where: { id: current.topicId },
          data: {
            title: finalTitle,
            content: finalDescription,
            locked: ["sold", "withdrawn", "hidden"].includes(desiredStatus),
            hidden: finalTopicHidden,
            metadata: JSON.stringify(metadata),
            ...(publicationAttempt ? {
              aiReviewStatus: review?.status || "auto_passed",
              aiRiskLevel: review?.riskLevel || "low",
              aiRiskScore: review?.riskScore || 0,
              aiReviewReason: review?.reason || "",
              aiReviewDetail: review?.detail || "",
              aiModel: review?.model || null,
              aiReviewedAt: review ? new Date() : null,
            } : {}),
          },
        });
        if (finalTopicHidden !== current.topic.hidden) {
          await Promise.all([
            refreshBoardTopicCounts([current.topic.boardId], tx),
            refreshUserPostCount(current.sellerId, tx),
          ]);
        }
      }
      return tx.marketItem.update({ where: { id }, data, include: itemInclude });
    });
    if (input.images) await registerMarketImages(input.images, current.sellerId);
    ok(res, {
      ...serializeItem(updated, req.user!.userId),
      review: review ? { status: review.status, reason: review.reason } : null,
    });
  } catch (error) { next(error); }
});

marketRouter.delete("/items/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id } });
    if (!item) throw Errors.notFound("商品不存在");
    if (item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    await prisma.marketItem.update({ where: { id }, data: { status: "withdrawn" } });
    if (item.topicId) await prisma.topic.update({ where: { id: item.topicId }, data: { locked: true } }).catch(() => null);
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

marketRouter.post("/items/:id/favorite", authRequired, async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const userId = req.user!.userId;
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    if (!item || item.status !== "active") throw Errors.notFound("商品不存在");
    const existing = await prisma.marketFavorite.findUnique({ where: { itemId_userId: { itemId, userId } } });
    if (existing) {
      await prisma.$transaction([
        prisma.marketFavorite.delete({ where: { id: existing.id } }),
        prisma.marketItem.update({ where: { id: itemId }, data: { favoriteCount: { decrement: 1 } } }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.marketFavorite.create({ data: { itemId, userId } }),
        prisma.marketItem.update({ where: { id: itemId }, data: { favoriteCount: { increment: 1 } } }),
      ]);
    }
    ok(res, { favorited: !existing, favoriteCount: Math.max(0, item.favoriteCount + (existing ? -1 : 1)) });
  } catch (error) { next(error); }
});

const offerSchema = z.object({
  price: z.union([z.string(), z.number()]),
  message: z.string().trim().max(500).optional().default(""),
});

marketRouter.post("/items/:id/offers", authRequired, validate(offerSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const buyerId = req.user!.userId;
    await requireVerifiedMarketUser(buyerId, req.user!.role);
    await ensureUserCanSpeak(buyerId);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId }, include: { seller: { select: publicUserSelect } } });
    if (!item || item.status !== "active") throw Errors.badRequest("商品当前不可提交购买意向");
    if (item.listingType !== "sell") throw Errors.badRequest("求购信息请先通过站内沟通联系发布者");
    if (item.sellerId === buyerId) throw Errors.badRequest("不能购买自己发布的商品");
    const priceCents = cents(req.body.price, false)!;
    if (!item.negotiable && priceCents !== item.priceCents) throw Errors.badRequest("该商品不接受议价");
    const duplicate = await prisma.marketOffer.findFirst({ where: { itemId, buyerId, status: "pending" } });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的购买意向");
    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.marketOffer.create({ data: { itemId, buyerId, priceCents, message: req.body.message } });
      const conversation = await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId, buyerId, sellerId: item.sellerId } },
        create: { itemId, buyerId, sellerId: item.sellerId, lastMessageAt: req.body.message ? new Date() : null },
        update: {},
      });
      if (req.body.message) {
        await tx.marketMessage.create({ data: { conversationId: conversation.id, senderId: buyerId, content: req.body.message } });
      }
      await tx.marketItem.update({ where: { id: itemId }, data: { offerCount: { increment: 1 } } });
      return { offer, conversation };
    });
    await notify(item.sellerId, "收到新的购买意向", `有人想以 ¥${amountCentsToMoney(priceCents)} 购买「${item.title}」`, `/market/mine?tab=selling`, { type: "market-offer", itemId, offerId: result.offer.id });
    ok(res, { ...result.offer, price: amountCentsToMoney(result.offer.priceCents), conversationId: result.conversation.id });
  } catch (error) { next(error); }
});

const offerActionSchema = z.object({ action: z.enum(["accept", "reject", "cancel"]) });

marketRouter.patch("/offers/:id", authRequired, validate(offerActionSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const offer = await prisma.marketOffer.findUnique({ where: { id }, include: { item: true } });
    if (!offer) throw Errors.notFound("购买意向不存在");
    if (offer.status !== "pending") throw Errors.badRequest("该购买意向已经处理");
    const action = req.body.action as "accept" | "reject" | "cancel";
    if (action === "cancel") {
      if (offer.buyerId !== req.user!.userId) throw Errors.forbidden();
      const claimed = await prisma.marketOffer.updateMany({ where: { id, status: "pending" }, data: { status: "cancelled" } });
      if (claimed.count !== 1) throw Errors.conflict("该购买意向已经处理");
      const updated = await prisma.marketOffer.findUnique({ where: { id } });
      return ok(res, updated);
    }
    if (offer.item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (action === "reject") {
      const claimed = await prisma.marketOffer.updateMany({ where: { id, status: "pending" }, data: { status: "rejected" } });
      if (claimed.count !== 1) throw Errors.conflict("该购买意向已经处理");
      const updated = await prisma.marketOffer.findUnique({ where: { id } });
      await notify(offer.buyerId, "购买意向未被接受", `卖家暂未接受你对「${offer.item.title}」的购买意向`, `/market/item/${offer.itemId}`, { type: "market-offer-rejected", itemId: offer.itemId, offerId: id });
      return ok(res, updated);
    }
    if (offer.item.status !== "active") throw Errors.badRequest("商品当前不可预订");
    if (offer.item.deliveryType === "digital" && !offer.item.digitalDeliveryEncrypted) throw Errors.badRequest("该电子资料尚未配置线上交付内容");
    const marketConfig = await getMarketConfig();
    const orderAmounts = calculateMarketOrderAmounts(offer.priceCents, marketConfig.commissionBps);
    const order = await prisma.$transaction(async (tx) => {
      const itemClaim = await tx.marketItem.updateMany({
        where: { id: offer.itemId, status: "active" },
        data: { status: "reserved" },
      });
      if (itemClaim.count !== 1) throw Errors.conflict("商品已被其他购买意向锁定");
      const offerClaim = await tx.marketOffer.updateMany({
        where: { id, status: "pending" },
        data: { status: "accepted" },
      });
      if (offerClaim.count !== 1) throw Errors.conflict("该购买意向已经处理");
      await tx.marketOffer.updateMany({ where: { itemId: offer.itemId, id: { not: id }, status: "pending" }, data: { status: "rejected" } });
      const created = await tx.marketOrder.create({
        data: {
          itemId: offer.itemId,
          offerId: id,
          buyerId: offer.buyerId,
          sellerId: offer.item.sellerId,
          outTradeNo: nextMarketTradeNo(offer.buyerId),
          amountCents: offer.priceCents,
          platformFeeCents: orderAmounts.platformFeeCents,
          sellerAmountCents: orderAmounts.sellerAmountCents,
          deliveryType: offer.item.deliveryType || "physical",
          digitalDeliveryEncrypted: offer.item.deliveryType === "digital" ? offer.item.digitalDeliveryEncrypted : null,
          expiresAt: new Date(Date.now() + ORDER_TTL_MS),
        },
      });
      await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId: offer.itemId, buyerId: offer.buyerId, sellerId: offer.item.sellerId } },
        create: { itemId: offer.itemId, orderId: created.id, buyerId: offer.buyerId, sellerId: offer.item.sellerId },
        update: { orderId: created.id },
      });
      return created;
    });
    await notify(offer.buyerId, "卖家已接受购买意向", `请在 15 分钟内完成「${offer.item.title}」的支付`, `/market/mine?tab=orders`, { type: "market-offer-accepted", itemId: offer.itemId, orderId: order.id });
    ok(res, serializeOrder(order, req.user!.userId, req.user!.role));
  } catch (error) { next(error); }
});

const paySchema = z.object({ payType: z.enum(PAY_TYPES) });

marketRouter.post("/orders/:id/pay", authRequired, validate(paySchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id }, include: { item: true } });
    if (!order || order.buyerId !== req.user!.userId) throw Errors.notFound("订单不存在");
    if (order.status !== "pending_payment") throw Errors.badRequest("该订单当前不可支付");
    if (order.expiresAt && order.expiresAt <= new Date()) throw Errors.badRequest("订单已超时关闭");
    const enabled = await getEnabledEpayTypes();
    if (!enabled.includes(req.body.payType as EpayPayType)) throw Errors.badRequest("该支付方式暂不可用");
    const origin = resolvePaymentOrigin(requestOrigin(req));
    if (!origin) throw Errors.badRequest("请先在后台配置站点域名");
    const updated = await prisma.marketOrder.update({ where: { id }, data: { payType: req.body.payType } });
    const epay = await buildEpaySubmitPayload({
      outTradeNo: updated.outTradeNo,
      name: `校园商城 - ${order.item.title}`.slice(0, 120),
      money: amountCentsToMoney(updated.amountCents),
      type: req.body.payType,
      notifyUrl: `${origin}/api/market/payments/notify`,
      returnUrl: `${origin}/api/market/payments/return`,
      clientIp: req.ip,
      device: "pc",
      param: `market:${updated.id}`,
    });
    ok(res, { order: serializeOrder(updated, req.user!.userId, req.user!.role), epay });
  } catch (error: any) {
    if (/易支付|支付方式|商户|网关|回调|订单号|商品名称/.test(String(error?.message || ""))) return next(Errors.badRequest(error.message));
    next(error);
  }
});

function normalizePaymentParams(input: Record<string, unknown>) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) params[key] = String(value[0] ?? "");
    else if (value !== undefined && value !== null) params[key] = String(value);
  }
  return params;
}

marketRouter.all("/payments/notify", async (req, res, next) => {
  let logId: number | null = null;
  try {
    const params = normalizePaymentParams({ ...req.query, ...req.body });
    const outTradeNo = params.out_trade_no || "";
    const existing = outTradeNo ? await prisma.marketOrder.findUnique({ where: { outTradeNo } }) : null;
    const key = await getEpayMerchantKey();
    const signOk = Boolean(key && verifyEpayParams(params, key));
    const log = await prisma.marketPaymentLog.create({
      data: { orderId: existing?.id || null, outTradeNo: outTradeNo || null, rawPayload: JSON.stringify(params), signOk, result: signOk ? "received" : "bad-sign" },
    });
    logId = log.id;
    if (!signOk) return res.type("text/plain").status(400).send("fail");
    if (params.trade_status !== "TRADE_SUCCESS") {
      await prisma.marketPaymentLog.update({ where: { id: log.id }, data: { handled: true, result: "ignored-status" } });
      return res.type("text/plain").send("success");
    }
    const paidCents = moneyToAmountCents(params.money || "0");
    let paidOrder: any = existing;
    let newlyPaid = false;
    await prisma.$transaction(async (tx) => {
      const order = await tx.marketOrder.findUnique({ where: { outTradeNo } });
      if (!order) throw new Error("订单不存在");
      if (["paid", "delivering", "completed", "refund_pending", "refunded"].includes(order.status)) {
        paidOrder = order;
        return;
      }
      if (order.status !== "pending_payment") throw new Error("订单状态不可支付");
      if (order.amountCents !== paidCents) throw new Error("支付金额与订单不一致");
      const isDigital = order.deliveryType === "digital";
      const claimed = await tx.marketOrder.updateMany({
        where: { id: order.id, status: "pending_payment", amountCents: paidCents },
        data: {
          status: isDigital ? "delivering" : "paid",
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
          digitalDeliveredAt: isDigital ? new Date() : null,
          sellerConfirmedAt: isDigital ? new Date() : null,
        },
      });
      if (claimed.count !== 1) throw new Error("订单状态已变化，无法完成支付");
      paidOrder = await tx.marketOrder.findUnique({ where: { id: order.id } });
      await tx.marketItem.update({ where: { id: order.itemId }, data: { status: "reserved" } });
      await tx.marketOffer.updateMany({ where: { id: order.offerId }, data: { status: "accepted" } });
      newlyPaid = true;
    });
    if (newlyPaid && paidOrder) {
      const item = await prisma.marketItem.findUnique({ where: { id: paidOrder.itemId } });
      await Promise.all([
        notify(paidOrder.buyerId, "商城订单支付成功", paidOrder.deliveryType === "digital" ? `「${item?.title || "商品"}」的电子资料已发放，请进入订单查看` : `「${item?.title || "商品"}」已支付，请与卖家确认交付安排`, `/market/mine?tab=orders`, { type: "market-paid", orderId: paidOrder.id }),
        notify(paidOrder.sellerId, "买家已完成支付", paidOrder.deliveryType === "digital" ? `「${item?.title || "商品"}」已自动完成线上发货，等待买家确认` : `「${item?.title || "商品"}」已收到平台支付，请安排交付`, `/market/seller?tab=orders`, { type: "market-paid-seller", orderId: paidOrder.id }),
      ]);
    }
    if (logId) await prisma.marketPaymentLog.update({ where: { id: logId }, data: { handled: true, result: "success", orderId: paidOrder?.id || existing?.id || null } });
    res.type("text/plain").send("success");
  } catch (error: any) {
    if (logId) await prisma.marketPaymentLog.update({ where: { id: logId }, data: { handled: false, result: String(error?.message || "error") } }).catch(() => null);
    if (/订单|金额|支付/.test(String(error?.message || ""))) return res.type("text/plain").status(400).send("fail");
    next(error);
  }
});

marketRouter.get("/payments/return", async (req, res) => {
  const origin = resolvePaymentOrigin(requestOrigin(req));
  const status = String(req.query.trade_status || "") === "TRADE_SUCCESS" ? "success" : "pending";
  const outTradeNo = encodeURIComponent(String(req.query.out_trade_no || ""));
  const target = `${origin || ""}/market/mine?tab=orders&payment=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`;
  res.redirect(302, target || "/market/mine?tab=orders");
});

const orderActionSchema = z.object({
  action: z.enum(["set_meetup", "buyer_confirm", "seller_confirm", "cancel", "request_refund", "dispute"]),
  meetupTime: z.string().datetime().optional(),
  meetupLocation: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
});

marketRouter.patch("/orders/:id", authRequired, validate(orderActionSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id }, include: { item: true, refunds: true } });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role))) {
      throw Errors.notFound("订单不存在");
    }
    const action = req.body.action as z.infer<typeof orderActionSchema>["action"];
    const isBuyer = order.buyerId === req.user!.userId;
    const isSeller = order.sellerId === req.user!.userId;
    if (action === "set_meetup") {
      if (order.deliveryType === "digital") throw Errors.badRequest("电子资料订单使用线上交付，无需设置面交安排");
      if (!["paid", "delivering"].includes(order.status)) throw Errors.badRequest("当前订单不能修改交付安排");
      const updated = await prisma.marketOrder.update({
        where: { id },
        data: {
          status: "delivering",
          meetupTime: req.body.meetupTime ? new Date(req.body.meetupTime) : order.meetupTime,
          meetupLocation: req.body.meetupLocation ?? order.meetupLocation,
          note: req.body.note ?? order.note,
        },
      });
      await notify(isBuyer ? order.sellerId : order.buyerId, "交易交付安排已更新", `「${order.item.title}」的面交/交付信息发生了更新`, `/market/mine?tab=orders`, { type: "market-meetup", orderId: id });
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }
    if (action === "buyer_confirm" || action === "seller_confirm") {
      if (action === "buyer_confirm" && !isBuyer) throw Errors.forbidden();
      if (action === "seller_confirm" && !isSeller) throw Errors.forbidden();
      if (!["paid", "delivering"].includes(order.status)) throw Errors.badRequest("当前订单不能确认完成");
      const data = action === "buyer_confirm" ? { buyerConfirmedAt: new Date() } : { sellerConfirmedAt: new Date() };
      let updated = await prisma.marketOrder.update({ where: { id }, data });
      if (updated.buyerConfirmedAt && updated.sellerConfirmedAt) {
        updated = await prisma.$transaction(async (tx) => {
          const completed = await tx.marketOrder.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
          await tx.marketItem.update({ where: { id: order.itemId }, data: { status: "sold", soldAt: new Date() } });
          await tx.marketSettlement.upsert({
            where: { orderId: id },
            create: { orderId: id, sellerId: order.sellerId, amountCents: order.sellerAmountCents, status: "available", availableAt: new Date() },
            update: { status: "available", availableAt: new Date() },
          });
          return completed;
        });
        await Promise.all([
          notify(order.buyerId, "交易已完成", `「${order.item.title}」已完成，可为卖家留下评价`, `/market/mine?tab=orders`, { type: "market-completed", orderId: id }),
          notify(order.sellerId, "交易已完成", `「${order.item.title}」已进入平台结算`, `/market/mine?tab=selling`, { type: "market-completed-seller", orderId: id }),
        ]);
      }
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }
    if (action === "cancel") {
      if (order.status === "pending_payment") {
        const updated = await prisma.$transaction(async (tx) => {
          const claimed = await tx.marketOrder.updateMany({ where: { id, status: "pending_payment" }, data: { status: "cancelled", closedAt: new Date(), note: req.body.reason || order.note } });
          if (claimed.count !== 1) throw Errors.conflict("订单状态已变化，不能取消");
          await tx.marketOffer.updateMany({ where: { id: order.offerId, status: "accepted" }, data: { status: "cancelled" } });
          await tx.marketItem.updateMany({ where: { id: order.itemId, status: "reserved" }, data: { status: "active" } });
          return tx.marketOrder.findUniqueOrThrow({ where: { id } });
        });
        return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
      }
      if (["paid", "delivering"].includes(order.status)) {
        const refund = await prisma.$transaction(async (tx) => {
          const created = await tx.marketRefund.create({ data: { orderId: id, requestedById: req.user!.userId, amountCents: order.amountCents, reason: req.body.reason || "交易取消" } });
          await tx.marketOrder.update({ where: { id }, data: { status: "refund_pending" } });
          return created;
        });
        return ok(res, { refund, order: serializeOrder({ ...order, status: "refund_pending" }, req.user!.userId, req.user!.role) });
      }
      throw Errors.badRequest("当前订单不能取消");
    }
    if (action === "request_refund") {
      if (!isBuyer) throw Errors.forbidden();
      if (!["paid", "delivering", "disputed"].includes(order.status)) throw Errors.badRequest("当前订单不能申请退款");
      if (order.refunds.some((refund) => ["pending", "approved"].includes(refund.status))) throw Errors.conflict("已有退款申请正在处理");
      const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.marketRefund.create({ data: { orderId: id, requestedById: req.user!.userId, amountCents: order.amountCents, reason: req.body.reason || "买家申请退款" } });
        await tx.marketOrder.update({ where: { id }, data: { status: "refund_pending" } });
        return created;
      });
      await notify(order.sellerId, "买家提交了退款申请", `「${order.item.title}」订单正在等待平台处理退款`, `/market/mine?tab=selling`, { type: "market-refund", orderId: id, refundId: refund.id });
      return ok(res, refund);
    }
    if (action === "dispute") {
      if (!["paid", "delivering", "refund_pending"].includes(order.status)) throw Errors.badRequest("当前订单不能发起纠纷");
      const updated = await prisma.marketOrder.update({ where: { id }, data: { status: "disputed", note: req.body.reason || order.note } });
      const admins = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
      if (admins.length) await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, category: "market", level: "strong", title: "商城交易纠纷", content: `订单 ${order.outTradeNo} 已发起纠纷`, link: "/admin?tab=market", source: "校园商城", payload: JSON.stringify({ type: "market-dispute", orderId: id }) })) });
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }
    throw Errors.badRequest();
  } catch (error) { next(error); }
});

const conversationCreateSchema = z.object({ message: z.string().trim().max(1000).optional().default("") });

marketRouter.post("/items/:id/conversations", authRequired, validate(conversationCreateSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const buyerId = req.user!.userId;
    await requireVerifiedMarketUser(buyerId, req.user!.role);
    await ensureUserCanSpeak(buyerId);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    const existingConversation = item
      ? await prisma.marketConversation.findUnique({ where: { itemId_buyerId_sellerId: { itemId, buyerId, sellerId: item.sellerId } } })
      : null;
    const canInspectInactive = Boolean(item && (item.sellerId === buyerId || isMarketStaff(req.user!.role) || existingConversation));
    if (!item || (item.status !== "active" && !canInspectInactive)) throw Errors.notFound("商品不存在");
    if (item.sellerId === buyerId) throw Errors.badRequest("不能与自己发起会话");
    const conversation = await prisma.marketConversation.upsert({
      where: { itemId_buyerId_sellerId: { itemId, buyerId, sellerId: item.sellerId } },
      create: { itemId, buyerId, sellerId: item.sellerId, lastMessageAt: req.body.message ? new Date() : null },
      update: {},
    });
    if (req.body.message) {
      await prisma.$transaction([
        prisma.marketMessage.create({ data: { conversationId: conversation.id, senderId: buyerId, content: req.body.message } }),
        prisma.marketConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } }),
      ]);
      await notify(item.sellerId, "收到商品咨询", `有人咨询「${item.title}」`, `/market/messages?conversation=${conversation.id}`, { type: "market-message", itemId, conversationId: conversation.id });
    }
    ok(res, conversation);
  } catch (error) { next(error); }
});

marketRouter.get("/conversations", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const list = await prisma.marketConversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
        buyer: { select: publicUserSelect },
        seller: { select: publicUserSelect },
        order: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    });
    const visibleItems = await prepareMarketItemsForViewer(list.map((conversation) => conversation.item), userId, req.user!.role);
    ok(res, list.map((conversation, index) => ({
      ...conversation,
      item: serializeItem(visibleItems[index], userId),
      order: conversation.order ? serializeOrder(conversation.order, userId, req.user!.role) : null,
      counterpart: conversation.buyerId === userId ? conversation.seller : conversation.buyer,
      lastMessage: conversation.messages[0] || null,
    })));
  } catch (error) { next(error); }
});

marketRouter.get("/conversations/:id/messages", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const conversation = await prisma.marketConversation.findUnique({ where: { id } });
    if (!conversation || (conversation.buyerId !== req.user!.userId && conversation.sellerId !== req.user!.userId)) throw Errors.notFound("会话不存在");
    const messages = await prisma.marketMessage.findMany({ where: { conversationId: id }, include: { sender: { select: publicUserSelect } }, orderBy: { createdAt: "asc" }, take: 300 });
    await prisma.marketMessage.updateMany({ where: { conversationId: id, senderId: { not: req.user!.userId }, readAt: null }, data: { readAt: new Date() } });
    ok(res, messages);
  } catch (error) { next(error); }
});

const messageSchema = z.object({ content: z.string().trim().min(1).max(2000) });

marketRouter.post("/conversations/:id/messages", authRequired, validate(messageSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await ensureUserCanSpeak(req.user!.userId);
    const conversation = await prisma.marketConversation.findUnique({ where: { id }, include: { item: true } });
    if (!conversation || (conversation.buyerId !== req.user!.userId && conversation.sellerId !== req.user!.userId)) throw Errors.notFound("会话不存在");
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.marketMessage.create({ data: { conversationId: id, senderId: req.user!.userId, content: req.body.content } });
      await tx.marketConversation.update({ where: { id }, data: { lastMessageAt: created.createdAt } });
      return created;
    });
    const recipientId = conversation.buyerId === req.user!.userId ? conversation.sellerId : conversation.buyerId;
    await notify(recipientId, "收到交易消息", `「${conversation.item.title}」有一条新消息`, `/market/messages?conversation=${id}`, { type: "market-message", conversationId: id, itemId: conversation.itemId });
    ok(res, message);
  } catch (error) { next(error); }
});

marketRouter.get("/mine", authRequired, async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const userId = req.user!.userId;
    const [selling, favoriteRows, offers, sellerOffers, orders, conversations, participantConversations, payout] = await Promise.all([
      prisma.marketItem.findMany({ where: { sellerId: userId }, include: itemInclude, orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.marketFavorite.findMany({ where: { userId }, include: { item: { include: itemInclude } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOffer.findMany({ where: { buyerId: userId }, include: { item: { include: { images: { orderBy: { sort: "asc" }, take: 1 }, seller: { select: publicUserSelect } } }, order: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOffer.findMany({
        where: { item: { sellerId: userId }, status: "pending" },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: publicUserSelect },
          order: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.marketOrder.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: publicUserSelect },
          seller: { select: publicUserSelect },
          offer: true,
          settlement: true,
          refunds: { orderBy: { createdAt: "desc" } },
          reviews: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.marketConversation.count({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      prisma.marketConversation.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        select: { id: true, itemId: true, buyerId: true, sellerId: true },
      }),
      prisma.marketPayoutProfile.findUnique({ where: { userId }, select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true } }),
    ]);
    const conversationByItemAndBuyer = new Map(
      participantConversations.map((conversation) => [`${conversation.itemId}:${conversation.buyerId}`, conversation.id]),
    );
    const visibleItems = await prepareMarketItemsForViewer([
      ...selling,
      ...favoriteRows.map((row: any) => row.item),
      ...offers.map((offer) => offer.item),
      ...sellerOffers.map((offer) => offer.item),
      ...orders.map((order) => order.item),
    ], userId, req.user!.role);
    const visibleItemById = new Map(visibleItems.map((item) => [item.id, item]));
    const withVisibleItem = (record: any) => ({ ...record, item: visibleItemById.get(record.itemId) || record.item });
    ok(res, {
      selling: selling.map((item) => serializeItem(visibleItemById.get(item.id) || item, userId)),
      favorites: favoriteRows.map((row: any) => serializeItem(visibleItemById.get(row.item.id) || row.item, userId)),
      offers: offers.map((offer) => serializeOffer(withVisibleItem(offer), userId, req.user!.role)),
      sellerOffers: sellerOffers.map((offer) => ({
        ...serializeOffer(withVisibleItem(offer), userId, req.user!.role),
        conversationId: conversationByItemAndBuyer.get(`${offer.itemId}:${offer.buyerId}`) || null,
      })),
      orders: orders.map((order) => serializeOrder(withVisibleItem(order), userId, req.user!.role)),
      conversationCount: conversations,
      payoutProfile: payout,
    });
  } catch (error) { next(error); }
});

marketRouter.get("/seller/dashboard", authRequired, async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const sellerId = req.user!.userId;
    await requireVerifiedMarketUser(sellerId, req.user!.role);
    const [items, orders, settlements, payoutProfile, config] = await Promise.all([
      prisma.marketItem.findMany({
        where: { sellerId },
        include: itemInclude,
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
      prisma.marketOrder.findMany({
        where: { sellerId },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: publicUserSelect },
          offer: true,
          settlement: true,
          refunds: { orderBy: { createdAt: "desc" } },
          conversation: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.marketSettlement.findMany({
        where: { sellerId },
        include: { order: { include: { item: { select: { id: true, title: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.marketPayoutProfile.findUnique({
        where: { userId: sellerId },
        select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true },
      }),
      getMarketConfig(),
    ]);

    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const pendingOrders = orders.filter((order) => ["paid", "delivering"].includes(order.status));
    const frozenOrders = orders.filter((order) => ["refund_pending", "disputed"].includes(order.status));
    const availableSettlements = settlements.filter((settlement) => settlement.status === "available");
    const heldSettlements = settlements.filter((settlement) => settlement.status === "held");
    const settledSettlements = settlements.filter((settlement) => settlement.status === "settled");
    const paidOrders = orders.filter((order) => Boolean(order.paidAt) && !["cancelled", "refunded"].includes(order.status));
    const timeline = [
      ...orders.filter((order) => Boolean(order.paidAt)).map((order) => ({
        key: `paid-${order.id}`,
        orderId: order.id,
        type: order.status === "refunded" ? "refunded" : "payment",
        title: order.item.title,
        amountCents: order.status === "refunded" ? -order.sellerAmountCents : order.sellerAmountCents,
        platformFeeCents: order.platformFeeCents,
        status: order.status,
        occurredAt: order.refundedAt || order.paidAt,
      })),
      ...settlements.map((settlement) => ({
        key: `settlement-${settlement.id}`,
        orderId: settlement.orderId,
        type: "settlement",
        title: settlement.order.item.title,
        amountCents: settlement.amountCents,
        platformFeeCents: settlement.order.platformFeeCents,
        status: settlement.status,
        occurredAt: settlement.settledAt || settlement.availableAt || settlement.createdAt,
        reference: settlement.reference,
      })),
    ].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime()).slice(0, 200);

    ok(res, {
      config: serializeMarketConfig(config),
      stats: {
        activeListings: items.filter((item) => item.status === "active").length,
        reservedListings: items.filter((item) => item.status === "reserved").length,
        soldListings: items.filter((item) => item.status === "sold").length,
        pendingDeliveryOrders: pendingOrders.length,
        pendingSettlementOrders: availableSettlements.length + heldSettlements.length,
      },
      balance: {
        grossCents: sum(paidOrders.map((order) => order.amountCents)),
        commissionCents: sum(paidOrders.map((order) => order.platformFeeCents)),
        pendingCents: sum(pendingOrders.map((order) => order.sellerAmountCents)),
        frozenCents: sum(frozenOrders.map((order) => order.sellerAmountCents)) + sum(heldSettlements.map((settlement) => settlement.amountCents)),
        availableCents: sum(availableSettlements.map((settlement) => settlement.amountCents)),
        settledCents: sum(settledSettlements.map((settlement) => settlement.amountCents)),
      },
      items: items.map((item) => serializeItem(item, sellerId)),
      orders: orders.map((order) => serializeOrder(order, sellerId, req.user!.role)),
      settlements: settlements.map((settlement) => ({ ...settlement, amount: amountCentsToMoney(settlement.amountCents), order: serializeOrder(settlement.order, sellerId, req.user!.role) })),
      timeline: timeline.map((entry) => ({
        ...entry,
        amount: amountCentsToMoney(Math.abs(entry.amountCents)),
        platformFee: amountCentsToMoney(entry.platformFeeCents),
      })),
      payoutProfile,
    });
  } catch (error) { next(error); }
});

const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), content: z.string().trim().max(500).optional().default("") });

marketRouter.post("/orders/:id/reviews", authRequired, validate(reviewSchema), async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id: orderId }, include: { item: true } });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId)) throw Errors.notFound("订单不存在");
    if (order.status !== "completed") throw Errors.badRequest("交易完成后才能评价");
    const targetUserId = order.buyerId === req.user!.userId ? order.sellerId : order.buyerId;
    const review = await prisma.marketReview.create({ data: { orderId, authorId: req.user!.userId, targetUserId, rating: req.body.rating, content: req.body.content } }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("你已经评价过该交易");
      throw error;
    });
    await notify(targetUserId, "收到新的交易评价", `「${order.item.title}」的交易对方给出了 ${review.rating} 星评价`, `/market/mine?tab=orders`, { type: "market-review", orderId, reviewId: review.id });
    ok(res, review);
  } catch (error) { next(error); }
});

marketRouter.get("/users/:id/reviews", async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.id);
    const [list, summary] = await Promise.all([
      prisma.marketReview.findMany({ where: { targetUserId }, include: { author: { select: publicUserSelect }, order: { include: { item: { select: { id: true, title: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.marketReview.aggregate({ where: { targetUserId }, _avg: { rating: true }, _count: true }),
    ]);
    ok(res, { list, average: summary._avg.rating || 0, total: summary._count });
  } catch (error) { next(error); }
});

const reportSchema = z.object({ reason: z.string().trim().min(2).max(80), detail: z.string().trim().max(1000).optional().default("") });

marketRouter.post("/items/:id/reports", authRequired, validate(reportSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    if (!item) throw Errors.notFound("商品不存在");
    const report = await prisma.marketReport.create({ data: { itemId, reporterId: req.user!.userId, reason: req.body.reason, detail: req.body.detail } }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("你已经举报过该商品");
      throw error;
    });
    const staff = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
    if (staff.length) await prisma.notification.createMany({ data: staff.map((user) => ({ userId: user.id, category: "market", level: "strong", title: "收到商品举报", content: `「${item.title}」被举报：${req.body.reason}`, link: "/admin?tab=market", source: "校园商城", payload: JSON.stringify({ type: "market-report", itemId, reportId: report.id }) })) });
    ok(res, report);
  } catch (error) { next(error); }
});

function sensitiveKey() {
  const encryptionSecret = process.env.MARKET_ENCRYPTION_SECRET?.trim() || config.jwtSecret;
  return crypto.createHash("sha256").update(`campus-market-payout:${encryptionSecret}`).digest();
}

function sealSensitive(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sensitiveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openSensitive(value: string) {
  const payload = Buffer.from(value, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", sensitiveKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

function maskAccount(value: string) {
  if (value.includes("@")) {
    const [name, host] = value.split("@", 2);
    return `${name.slice(0, 2)}***@${host}`;
  }
  return value.length <= 6 ? `${value.slice(0, 1)}***${value.slice(-1)}` : `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function maskName(value: string) {
  return value.length <= 1 ? "*" : `${value.slice(0, 1)}${"*".repeat(Math.min(3, value.length - 1))}`;
}

const payoutSchema = z.object({ method: z.enum(["alipay", "wxpay", "bank"]), account: z.string().trim().min(3).max(120), realName: z.string().trim().min(1).max(80) });

marketRouter.patch("/payout-profile", authRequired, validate(payoutSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.marketPayoutProfile.upsert({
      where: { userId },
      create: { userId, method: req.body.method, accountEncrypted: sealSensitive(req.body.account), accountMasked: maskAccount(req.body.account), realNameEncrypted: sealSensitive(req.body.realName), realNameMasked: maskName(req.body.realName), verified: false },
      update: { method: req.body.method, accountEncrypted: sealSensitive(req.body.account), accountMasked: maskAccount(req.body.account), realNameEncrypted: sealSensitive(req.body.realName), realNameMasked: maskName(req.body.realName), verified: false },
      select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true },
    });
    ok(res, profile);
  } catch (error) { next(error); }
});

function requireStaff(role: string) {
  if (!["admin", "mod"].includes(role)) throw Errors.forbidden("需要商城管理权限");
}

marketRouter.get("/admin/config", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    ok(res, serializeMarketConfig(await getMarketConfig()));
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/config", authRequired, validate(z.object({
  commissionRate: z.number().min(0).max(50),
})), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const commissionBps = Math.round(req.body.commissionRate * 100);
    const config = await prisma.marketConfig.upsert({
      where: { id: MARKET_CONFIG_ID },
      update: { commissionBps },
      create: { id: MARKET_CONFIG_ID, commissionBps },
    });
    ok(res, serializeMarketConfig(config));
  } catch (error) { next(error); }
});

const categoryCreateSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(30),
  icon: z.string().trim().min(1).max(12).default("📦"),
  description: z.string().trim().max(120).default(""),
  fulfillmentType: z.enum(["physical", "digital"]).default("physical"),
  imageRequired: z.boolean().default(true),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).max(9999).default(0),
});
const categoryPatchSchema = categoryCreateSchema.omit({ slug: true }).partial();

marketRouter.get("/admin/categories", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    await ensureMarketCategories();
    const list = await prisma.marketCategory.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] });
    const counts = await prisma.marketItem.groupBy({ by: ["category"], _count: { _all: true } });
    const countMap = new Map(counts.map((row) => [row.category, row._count._all]));
    ok(res, list.map((category) => ({ ...category, itemCount: countMap.get(category.slug) || 0 })));
  } catch (error) { next(error); }
});

marketRouter.post("/admin/categories", authRequired, validate(categoryCreateSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const category = await prisma.marketCategory.create({ data: req.body }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("品类标识已存在");
      throw error;
    });
    ok(res, { ...category, itemCount: 0 });
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/categories/:id", authRequired, validate(categoryPatchSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const category = await prisma.marketCategory.update({ where: { id }, data: req.body }).catch((error: any) => {
      if (String(error?.code) === "P2025") throw Errors.notFound("品类不存在");
      throw error;
    });
    ok(res, category);
  } catch (error) { next(error); }
});

marketRouter.delete("/admin/categories/:id", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const category = await prisma.marketCategory.findUnique({ where: { id } });
    if (!category) throw Errors.notFound("品类不存在");
    const itemCount = await prisma.marketItem.count({ where: { category: category.slug } });
    if (itemCount) throw Errors.conflict("该品类下已有商品，请先停用品类，不能直接删除");
    await prisma.marketCategory.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

marketRouter.get("/admin/overview", authRequired, async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const [counts, reports, refunds, settlements, orders] = await Promise.all([
      Promise.all(["active", "reserved", "sold", "hidden"].map(async (status) => [status, await prisma.marketItem.count({ where: { status } })])),
      prisma.marketReport.findMany({ include: { item: { select: { id: true, title: true, status: true } }, reporter: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketRefund.findMany({ include: { order: { include: { item: { select: { id: true, title: true } }, buyer: { select: publicUserSelect }, seller: { select: publicUserSelect } } }, requestedBy: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketSettlement.findMany({ include: { order: { include: { item: { select: { id: true, title: true } } } }, seller: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOrder.findMany({ include: { item: { select: { id: true, title: true } }, buyer: { select: publicUserSelect }, seller: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    ok(res, {
      counts: Object.fromEntries(counts),
      reports,
      refunds: refunds.map(({ order, ...refund }) => ({ ...refund, amount: amountCentsToMoney(refund.amountCents), order: serializeOrder(order, req.user!.userId, req.user!.role) })),
      settlements: settlements.map((settlement) => ({ ...settlement, amount: amountCentsToMoney(settlement.amountCents), order: serializeOrder(settlement.order, req.user!.userId, req.user!.role) })),
      orders: orders.map((order) => serializeOrder(order, req.user!.userId, req.user!.role)),
    });
  } catch (error) { next(error); }
});

const adminItemSchema = z.object({ status: z.enum(ITEM_STATUSES), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/items/:id", authRequired, validate(adminItemSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const current = await prisma.marketItem.findUnique({ where: { id }, include: { topic: { select: { id: true, boardId: true, authorId: true, hidden: true } } } });
    if (!current) throw Errors.notFound("商品不存在");
    const topicHidden = ["draft", "reviewing", "hidden"].includes(req.body.status);
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketItem.update({ where: { id }, data: { status: req.body.status, soldAt: req.body.status === "sold" ? new Date() : req.body.status === "active" ? null : undefined }, include: itemInclude });
      if (current.topic) {
        await tx.topic.update({ where: { id: current.topic.id }, data: { hidden: topicHidden, locked: ["hidden", "sold", "withdrawn"].includes(req.body.status), manualReviewNote: req.body.note || undefined } });
        if (current.topic.hidden !== topicHidden) {
          await Promise.all([
            refreshBoardTopicCounts([current.topic.boardId], tx),
            refreshUserPostCount(current.topic.authorId, tx),
          ]);
        }
      }
      return updated;
    });
    await notify(item.sellerId, "商品状态已更新", `「${item.title}」已被管理员调整为 ${req.body.status}${req.body.note ? `：${req.body.note}` : ""}`, `/market/item/${id}`, { type: "market-admin-item", itemId: id, status: req.body.status });
    ok(res, serializeItem(item));
  } catch (error) { next(error); }
});

const adminReportSchema = z.object({ status: z.enum(["resolved", "rejected"]), note: z.string().trim().max(500).optional().default(""), hideItem: z.boolean().optional().default(false) });
marketRouter.patch("/admin/reports/:id", authRequired, validate(adminReportSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const report = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketReport.update({ where: { id }, data: { status: req.body.status, handledById: req.user!.userId, handledNote: req.body.note, handledAt: new Date() } });
      if (req.body.hideItem) {
        const item = await tx.marketItem.update({ where: { id: updated.itemId }, data: { status: "hidden" }, select: { topic: { select: { id: true, boardId: true, authorId: true, hidden: true } } } });
        if (item.topic) {
          await tx.topic.update({ where: { id: item.topic.id }, data: { hidden: true, locked: true } });
          if (!item.topic.hidden) {
            await Promise.all([
              refreshBoardTopicCounts([item.topic.boardId], tx),
              refreshUserPostCount(item.topic.authorId, tx),
            ]);
          }
        }
      }
      return updated;
    });
    await notify(report.reporterId, "商品举报已处理", `你的举报已被标记为 ${req.body.status}${req.body.note ? `：${req.body.note}` : ""}`, `/market/item/${report.itemId}`, { type: "market-report-result", reportId: id });
    ok(res, report);
  } catch (error) { next(error); }
});

const adminRefundSchema = z.object({ status: z.enum(["approved", "completed", "rejected", "failed"]), providerRefundNo: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/refunds/:id", authRequired, validate(adminRefundSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const current = await prisma.marketRefund.findUnique({ where: { id }, include: { order: { include: { item: true } } } });
    if (!current) throw Errors.notFound("退款申请不存在");
    const refund = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketRefund.update({ where: { id }, data: { status: req.body.status, providerRefundNo: req.body.providerRefundNo || current.providerRefundNo, handledById: req.user!.userId, handledNote: req.body.note, handledAt: new Date() } });
      if (req.body.status === "completed") {
        await tx.marketOrder.update({ where: { id: current.orderId }, data: { status: "refunded", refundedAt: new Date() } });
        await tx.marketItem.update({ where: { id: current.order.itemId }, data: { status: "active" } });
      } else if (req.body.status === "rejected" || req.body.status === "failed") {
        await tx.marketOrder.update({ where: { id: current.orderId }, data: { status: current.order.paidAt ? "paid" : "cancelled" } });
      }
      return updated;
    });
    await notify(current.order.buyerId, "退款状态已更新", `「${current.order.item.title}」退款申请：${req.body.status}${req.body.note ? `，${req.body.note}` : ""}`, `/market/mine?tab=orders`, { type: "market-refund-result", orderId: current.orderId, refundId: id });
    ok(res, refund);
  } catch (error) { next(error); }
});

const settlementSchema = z.object({ status: z.enum(["available", "held", "settled"]), reference: z.string().trim().max(120).optional().default(""), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/settlements/:id", authRequired, validate(settlementSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const settlement = await prisma.marketSettlement.update({ where: { id }, data: { status: req.body.status, reference: req.body.reference, note: req.body.note, settledAt: req.body.status === "settled" ? new Date() : undefined }, include: { order: { include: { item: true } } } });
    await notify(settlement.sellerId, "商城结算状态已更新", `「${settlement.order.item.title}」结算状态：${req.body.status}`, `/market/mine?tab=selling`, { type: "market-settlement", settlementId: id, orderId: settlement.orderId });
    const { order, ...safeSettlement } = settlement;
    ok(res, { ...safeSettlement, amount: amountCentsToMoney(settlement.amountCents), order: serializeOrder(order, req.user!.userId, req.user!.role) });
  } catch (error) { next(error); }
});

marketRouter.get("/admin/settlements/:id/payout-profile", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const settlement = await prisma.marketSettlement.findUnique({ where: { id: Number(req.params.id) }, include: { seller: { include: { marketPayoutProfile: true } } } });
    if (!settlement) throw Errors.notFound("结算单不存在");
    const profile = settlement.seller.marketPayoutProfile;
    if (!profile) throw Errors.notFound("卖家尚未设置收款资料");
    ok(res, { method: profile.method, account: openSensitive(profile.accountEncrypted), realName: openSensitive(profile.realNameEncrypted), verified: profile.verified });
  } catch (error) { next(error); }
});
