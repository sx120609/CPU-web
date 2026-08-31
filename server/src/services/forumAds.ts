import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const FORUM_AD_PLACEMENTS = [
  "home-mobile-top",
  "compose-mobile-campaign",
  "forum-index-top",
  "forum-home-pinned",
  "forum-home-hot",
  "forum-feed-inline",
  "forum-board-top",
] as const;

export type ForumAdPlacement = (typeof FORUM_AD_PLACEMENTS)[number];
export type ForumAdDevice = "mobile" | "desktop";
export type ForumAdEventType = "impression" | "click";

export type ForumAdMetricRow = {
  day: string;
  device: string;
  impressions: number;
  clicks: number;
};

export type ForumAdMetricCounter = {
  impressions: number;
  clicks: number;
  ctr: number;
};

export type ForumAdMetricSummary = {
  all: ForumAdMetricCounter;
  last7Days: ForumAdMetricCounter;
  last30Days: ForumAdMetricCounter;
  mobile: ForumAdMetricCounter;
  desktop: ForumAdMetricCounter;
  daily: Array<{ day: string; impressions: number; clicks: number; ctr: number }>;
};

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

export function normalizeForumAdPlacements(values: readonly string[] | null | undefined, legacy?: string | null) {
  const normalized = [...new Set((values || []).filter(isForumAdPlacement))];
  if (normalized.length) return normalized;
  return legacy && isForumAdPlacement(legacy) ? [legacy] : [];
}

export function normalizeForumAdVipExempt(placements: readonly ForumAdPlacement[], vipExempt: boolean) {
  return placements.includes("compose-mobile-campaign") ? false : vipExempt;
}

export function isCampusLifeCampaignMetadata(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return metadata.campaignId === "campus-life-2026"
    && ["canteen", "nearby", "today", "fun"].includes(String(metadata.campaignTheme || ""));
}

export async function allowsCampusLifeCampaignAnonymousPost(boardSlug: string, metadata: unknown) {
  if (boardSlug !== "life" || !isCampusLifeCampaignMetadata(metadata)) return false;
  return (await listActiveForumAds("compose-mobile-campaign", false)).length > 0;
}

export function forumAdMetricDay(value = new Date()) {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayOffset(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function counter(impressions = 0, clicks = 0): ForumAdMetricCounter {
  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
  };
}

export function summarizeForumAdMetrics(rows: ForumAdMetricRow[], now = new Date()): ForumAdMetricSummary {
  const today = forumAdMetricDay(now);
  const sevenDayStart = dayOffset(today, -6);
  const thirtyDayStart = dayOffset(today, -29);
  const totals = {
    all: { impressions: 0, clicks: 0 },
    last7Days: { impressions: 0, clicks: 0 },
    last30Days: { impressions: 0, clicks: 0 },
    mobile: { impressions: 0, clicks: 0 },
    desktop: { impressions: 0, clicks: 0 },
  };
  const daily = new Map<string, { impressions: number; clicks: number }>();

  for (const row of rows) {
    totals.all.impressions += row.impressions;
    totals.all.clicks += row.clicks;
    if (row.day >= sevenDayStart) {
      totals.last7Days.impressions += row.impressions;
      totals.last7Days.clicks += row.clicks;
    }
    if (row.day >= thirtyDayStart) {
      totals.last30Days.impressions += row.impressions;
      totals.last30Days.clicks += row.clicks;
    }
    const device = row.device === "mobile" ? totals.mobile : totals.desktop;
    device.impressions += row.impressions;
    device.clicks += row.clicks;
    if (row.day >= thirtyDayStart) {
      const current = daily.get(row.day) || { impressions: 0, clicks: 0 };
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      daily.set(row.day, current);
    }
  }

  return {
    all: counter(totals.all.impressions, totals.all.clicks),
    last7Days: counter(totals.last7Days.impressions, totals.last7Days.clicks),
    last30Days: counter(totals.last30Days.impressions, totals.last30Days.clicks),
    mobile: counter(totals.mobile.impressions, totals.mobile.clicks),
    desktop: counter(totals.desktop.impressions, totals.desktop.clicks),
    daily: [...daily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, value]) => ({ day, ...counter(value.impressions, value.clicks) })),
  };
}

export async function recordForumAdEvent(input: {
  adId: number;
  placement: ForumAdPlacement;
  device: ForumAdDevice;
  type: ForumAdEventType;
}) {
  const now = new Date();
  const ad = await prisma.forumAd.findFirst({
    where: {
      id: input.adId,
      enabled: true,
      OR: [
        { placements: { has: input.placement } },
        { placements: { isEmpty: true }, placement: input.placement },
      ],
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    select: { id: true },
  });
  if (!ad) return false;

  const increment = input.type === "impression"
    ? { impressions: 1, clicks: 0 }
    : { impressions: 0, clicks: 1 };
  await prisma.forumAdMetric.upsert({
    where: {
      adId_day_device_placement: {
        adId: ad.id,
        day: forumAdMetricDay(now),
        device: input.device,
        placement: input.placement,
      },
    },
    create: {
      adId: ad.id,
      day: forumAdMetricDay(now),
      device: input.device,
      placement: input.placement,
      ...increment,
    },
    update: input.type === "impression"
      ? { impressions: { increment: 1 } }
      : { clicks: { increment: 1 } },
  });
  return true;
}

export async function listActiveForumAds(placement: ForumAdPlacement, vip: boolean) {
  const now = new Date();
  const where: Prisma.ForumAdWhereInput = {
    enabled: true,
    OR: [
      { placements: { has: placement } },
      { placements: { isEmpty: true }, placement },
    ],
    ...(vip ? { vipExempt: false } : {}),
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
  const ads = await prisma.forumAd.findMany({
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
      placements: true,
      sortOrder: true,
      startsAt: true,
      endsAt: true,
    },
  });
  return ads.map(({ placements: _placements, ...ad }) => ({ ...ad, placement })) satisfies ForumAdPublic[];
}
