import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const FORUM_AD_PLACEMENTS = [
  "forum-index-top",
  "forum-feed-inline",
  "forum-board-top",
] as const;

export type ForumAdPlacement = (typeof FORUM_AD_PLACEMENTS)[number];

export type ForumAdPublic = {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  linkUrl: string;
  buttonText: string | null;
  placement: string;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
};

export function isForumAdPlacement(value: string): value is ForumAdPlacement {
  return (FORUM_AD_PLACEMENTS as readonly string[]).includes(value);
}

export async function listActiveForumAds(placement: ForumAdPlacement, vip: boolean) {
  const now = new Date();
  const where: Prisma.ForumAdWhereInput = {
    enabled: true,
    placement,
    ...(vip ? { vipExempt: false } : {}),
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
  return prisma.forumAd.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    take: 3,
    select: {
      id: true,
      title: true,
      description: true,
      imageUrl: true,
      linkUrl: true,
      buttonText: true,
      placement: true,
      sortOrder: true,
      startsAt: true,
      endsAt: true,
    },
  }) as Promise<ForumAdPublic[]>;
}
