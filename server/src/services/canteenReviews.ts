import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { canteenShopIds } from "../shared/canteenCatalog";
import { getCanteenCatalog, resolveCanteenShop } from "./canteenCorrections";
import { reviewContentKeywords } from "./contentKeywordReview";
import { buildMutedMessage, isMuteActive } from "./userModeration";
import { lockWorkshopAuthor } from "./workshopAccountDeletion";

export const CANTEEN_REVIEW_COMMENT_MAX = 200;
export const CANTEEN_REVIEW_PAGE = 20;

type CanteenReviewer = { userId: number };
const hiddenStatuses = ["banned", "deleting", "deleted"];
const visibleUser = { status: { notIn: hiddenStatuses } };

function normalizeRating(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 5)
    throw Errors.badRequest("评分必须是 1–5 的整数");
  return value;
}

function normalizeComment(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw Errors.badRequest("评论内容不正确");
  const comment = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").replace(/\n{3,}/g, "\n\n").trim();
  if ([...comment].length > CANTEEN_REVIEW_COMMENT_MAX)
    throw Errors.badRequest(`短评最多 ${CANTEEN_REVIEW_COMMENT_MAX} 个字`);
  if (comment && reviewContentKeywords({ content: comment }))
    throw Errors.badRequest("短评里有不适合公开的内容，请修改后再提交");
  return comment;
}

function roundAverage(average: number | null) {
  return average === null ? 0 : Math.round(average * 10) / 10;
}

function normalizeOffset(value: unknown) {
  const offset = Number(value ?? 0);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000 ? offset : 0;
}

async function shopStats(ids: string[]) {
  const aggregate = await prisma.canteenReview.aggregate({
    where: { shopId: { in: ids }, user: visibleUser },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return { average: roundAverage(aggregate._avg.rating), count: aggregate._count._all };
}

/** 全部门店的评分汇总；改过名的门店把旧 id 的评分并进来。 */
export async function readCanteenSummary(viewer?: CanteenReviewer) {
  const [{ index, version }, groups, own] = await Promise.all([
    getCanteenCatalog(),
    prisma.canteenReview.groupBy({
      by: ["shopId", "rating"],
      where: { user: visibleUser },
      _count: { _all: true },
    }),
    viewer
      ? prisma.canteenReview.findMany({ where: { userId: viewer.userId }, select: { shopId: true, rating: true } })
      : [],
  ]);
  const totals = new Map<string, { sum: number; count: number }>();
  for (const group of groups) {
    const shop = index.find(group.shopId);
    if (!shop) continue;
    const entry = totals.get(shop.id) || { sum: 0, count: 0 };
    entry.sum += group.rating * group._count._all;
    entry.count += group._count._all;
    totals.set(shop.id, entry);
  }
  const shops: Record<string, { average: number; count: number }> = {};
  for (const [shopId, { sum, count }] of totals) shops[shopId] = { average: roundAverage(sum / count), count };
  const mine: Record<string, number> = {};
  for (const row of own) {
    const shop = index.find(row.shopId);
    if (shop) mine[shop.id] = row.rating;
  }
  return { version, shops, mine };
}

export async function readCanteenReviews(
  shopIdValue: unknown,
  viewer?: CanteenReviewer,
  options: { offset?: unknown; canModerate?: boolean } = {},
) {
  const shop = await resolveCanteenShop(shopIdValue);
  const ids = canteenShopIds(shop);
  const offset = normalizeOffset(options.offset);
  const where = { shopId: { in: ids }, user: visibleUser };
  const [stats, distribution, rows, own] = await Promise.all([
    shopStats(ids),
    prisma.canteenReview.groupBy({ by: ["rating"], where, _count: { _all: true } }),
    prisma.canteenReview.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: CANTEEN_REVIEW_PAGE + 1,
      include: { user: { select: { nickname: true } } },
    }),
    viewer
      ? prisma.canteenReview.findFirst({
          where: { userId: viewer.userId, shopId: { in: ids } },
          orderBy: { updatedAt: "desc" },
        })
      : null,
  ]);
  const page = rows.slice(0, CANTEEN_REVIEW_PAGE);
  const histogram = [0, 0, 0, 0, 0];
  for (const group of distribution) histogram[group.rating - 1] = group._count._all;
  return {
    shopId: shop.id,
    ...stats,
    histogram,
    offset,
    hasMore: rows.length > CANTEEN_REVIEW_PAGE,
    canModerate: Boolean(options.canModerate),
    entries: page.map((row) => ({
      id: row.id,
      nickname: row.user.nickname,
      rating: row.rating,
      comment: row.comment,
      updatedAt: row.updatedAt,
      me: row.userId === viewer?.userId,
    })),
    me: own ? { rating: own.rating, comment: own.comment, updatedAt: own.updatedAt } : null,
  };
}

async function assertCanPublish(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], userId: number) {
  // Account deletion holds this same lock before changing status and erasing data.
  // Recheck after acquiring it so an in-flight submission cannot recreate erased reviews.
  await lockWorkshopAuthor(tx, userId);
  const player = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, mutedUntil: true },
  });
  if (!player || hiddenStatuses.includes(player.status))
    throw Errors.forbidden("账户已停止访问，无法提交评价");
  if (isMuteActive(player)) throw Errors.forbidden(buildMutedMessage(player.mutedUntil));
}

export async function submitCanteenReview(
  shopIdValue: unknown,
  ratingValue: unknown,
  commentValue: unknown,
  viewer: CanteenReviewer,
) {
  const shop = await resolveCanteenShop(shopIdValue);
  const rating = normalizeRating(ratingValue);
  const comment = normalizeComment(commentValue);
  const formerIds = shop.formerIds;
  const review = await prisma.$transaction(async (tx) => {
    await assertCanPublish(tx, viewer.userId);
    // 门店改名后，把这个人在旧 id 下的评价并到新 id。
    if (formerIds.length)
      await tx.canteenReview.deleteMany({ where: { userId: viewer.userId, shopId: { in: formerIds } } });
    return tx.canteenReview.upsert({
      where: { userId_shopId: { userId: viewer.userId, shopId: shop.id } },
      create: { userId: viewer.userId, shopId: shop.id, rating, comment },
      update: { rating, comment },
    });
  });
  const stats = await shopStats(canteenShopIds(shop));
  return {
    recorded: true as const,
    ...stats,
    me: { rating: review.rating, comment: review.comment, updatedAt: review.updatedAt },
  };
}

export async function deleteOwnCanteenReview(shopIdValue: unknown, viewer: CanteenReviewer) {
  const shop = await resolveCanteenShop(shopIdValue);
  const ids = canteenShopIds(shop);
  const removed = await prisma.canteenReview.deleteMany({ where: { userId: viewer.userId, shopId: { in: ids } } });
  return { removed: removed.count, ...(await shopStats(ids)) };
}

/** 工具管理员删除任意一条评价。 */
export async function deleteCanteenReviewById(idValue: unknown) {
  if (typeof idValue !== "string" || !/^[0-9a-f-]{36}$/i.test(idValue)) throw Errors.badRequest("评价标识不正确");
  const removed = await prisma.canteenReview.deleteMany({ where: { id: idValue } });
  if (!removed.count) throw Errors.notFound("这条评价已经不存在");
  return { removed: removed.count };
}
