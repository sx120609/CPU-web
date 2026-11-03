import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { buildMutedMessage, isMuteActive } from "./userModeration";
import { lockWorkshopAuthor } from "./workshopAccountDeletion";

export const CANTEEN_REVIEW_COMMENT_MAX = 200;
export const CANTEEN_REVIEW_SHOP_MAX = 120;
export const CANTEEN_REVIEW_LIMIT = 30;

type CanteenReviewer = { userId: number };
const visibleUser = { status: { notIn: ["banned", "deleting", "deleted"] } };

function normalizeShopId(value: unknown) {
  if (typeof value !== "string") throw Errors.badRequest("门店标识不正确");
  const shopId = value.trim();
  if (!shopId || shopId.length > CANTEEN_REVIEW_SHOP_MAX)
    throw Errors.badRequest("门店标识不正确");
  if (/[\u0000-\u001f\u007f]/u.test(shopId)) throw Errors.badRequest("门店标识包含无效字符");
  return shopId;
}

function normalizeRating(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 5)
    throw Errors.badRequest("评分必须是 1–5 的整数");
  return value;
}

function normalizeComment(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw Errors.badRequest("评论内容不正确");
  const comment = value.trim();
  if (comment.length > CANTEEN_REVIEW_COMMENT_MAX)
    throw Errors.badRequest(`评论最多 ${CANTEEN_REVIEW_COMMENT_MAX} 个字符`);
  return comment;
}

function stats(average: number | null, count: number) {
  return { average: average === null ? 0 : Math.round(average * 10) / 10, count };
}

function reviewWhere(shopId: string) {
  return { shopId, user: visibleUser };
}

export async function readCanteenReviews(shopIdValue: unknown, viewer?: CanteenReviewer) {
  const shopId = normalizeShopId(shopIdValue);
  const where = reviewWhere(shopId);
  const [aggregate, rows, own] = await Promise.all([
    prisma.canteenReview.aggregate({
      where,
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.canteenReview.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: CANTEEN_REVIEW_LIMIT,
      include: { user: { select: { nickname: true } } },
    }),
    viewer
      ? prisma.canteenReview.findUnique({
          where: { userId_shopId: { userId: viewer.userId, shopId } },
        })
      : null,
  ]);
  const { average, count } = stats(aggregate._avg.rating, aggregate._count._all);
  return {
    shopId,
    average,
    count,
    entries: rows.map((row) => ({
      nickname: row.user.nickname,
      rating: row.rating,
      comment: row.comment,
      updatedAt: row.updatedAt,
      me: row.userId === viewer?.userId,
    })),
    me: own
      ? { rating: own.rating, comment: own.comment, updatedAt: own.updatedAt }
      : null,
  };
}

export async function submitCanteenReview(
  shopIdValue: unknown,
  ratingValue: unknown,
  commentValue: unknown,
  viewer: CanteenReviewer,
) {
  const shopId = normalizeShopId(shopIdValue);
  const rating = normalizeRating(ratingValue);
  const comment = normalizeComment(commentValue);
  const review = await prisma.$transaction(async (tx) => {
    // Account deletion holds this same lock before changing status and erasing data.
    // Recheck after acquiring it so an in-flight submission cannot recreate erased reviews.
    await lockWorkshopAuthor(tx, viewer.userId);
    const player = await tx.user.findUnique({
      where: { id: viewer.userId },
      select: { status: true, mutedUntil: true },
    });
    if (!player || visibleUser.status.notIn.includes(player.status))
      throw Errors.forbidden("账户已停止访问，无法提交评价");
    if (isMuteActive(player)) throw Errors.forbidden(buildMutedMessage(player.mutedUntil));
    return tx.canteenReview.upsert({
      where: { userId_shopId: { userId: viewer.userId, shopId } },
      create: { userId: viewer.userId, shopId, rating, comment },
      update: { rating, comment },
    });
  });
  const aggregate = await prisma.canteenReview.aggregate({
    where: reviewWhere(shopId),
    _avg: { rating: true },
    _count: { _all: true },
  });
  const { average, count } = stats(aggregate._avg.rating, aggregate._count._all);
  return {
    recorded: true as const,
    average,
    count,
    me: { rating: review.rating, comment: review.comment, updatedAt: review.updatedAt },
  };
}
