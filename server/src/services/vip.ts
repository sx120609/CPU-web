import { prisma } from "../prisma";

export const VIP_PROFILE_THEMES = ["mint", "sunset", "ocean", "lavender"] as const;
export const VIP_PROFILE_FRAMES = ["gold", "neon", "campus"] as const;

export const VIP_REACTION_CATALOG = [
  { key: "vip-crown", emoji: "👑", label: "王者" },
  { key: "sparkles", emoji: "✨", label: "闪耀" },
  { key: "fire", emoji: "🔥", label: "太燃了" },
  { key: "hug", emoji: "🫶", label: "抱抱" },
  { key: "rocket", emoji: "🚀", label: "起飞" },
] as const;

export type VipReactionKey = (typeof VIP_REACTION_CATALOG)[number]["key"];

export function isVipActive(user: { isVip?: boolean | null } | null | undefined) {
  return Boolean(user?.isVip);
}

export async function isUserVip(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isVip: true },
  });
  return isVipActive(user);
}

export function getVipReaction(key: string) {
  return VIP_REACTION_CATALOG.find((item) => item.key === key);
}

export async function getReactionSummary(
  target: { topicId?: number; replyId?: number },
  viewerId?: number | null,
) {
  const where = target.topicId
    ? { topicId: target.topicId }
    : { replyId: target.replyId };
  const [groups, mine] = await Promise.all([
    prisma.forumReaction.groupBy({
      by: ["kind"],
      where,
      _count: { _all: true },
    }),
    viewerId
      ? prisma.forumReaction.findMany({ where: { ...where, userId: viewerId }, select: { kind: true } })
      : [],
  ]);
  const active = new Set(mine.map((item) => item.kind));
  return groups
    .map((group) => ({ key: group.kind, count: group._count._all, active: active.has(group.kind) }))
    .sort((a, b) => b.count - a.count);
}
