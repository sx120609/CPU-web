import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { refundAssistantPoint, spendAssistantPoint } from "./campusAssistantPoints";
import { getSiteConfig } from "./siteSettings";
import { buildUserTrustSnapshot } from "./userTrust";

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

export type CampusAssistantQuotaStatus = {
  level: number;
  levelName: string;
  dailyQuota: number;
  used: number;
  remaining: number;
  points: number;
  totalRemaining: number;
  dateKey: string;
  nextResetAt: string;
};

export type CampusAssistantQuotaReservation = {
  source: "daily" | "points";
  dateKey: string;
  transactionId?: number;
  pointCost?: number;
};

export function campusAssistantDateKey(date = new Date()) {
  return new Date(date.getTime() + CHINA_TIME_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextCampusAssistantResetAt(date = new Date()) {
  const [year, month, day] = campusAssistantDateKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0, 0));
}

export function resolveCampusAssistantDailyQuota(level: number) {
  const tiers = getSiteConfig().assistantDailyQuotas;
  return Math.max(0, tiers.find((item) => item.level === level)?.quota ?? tiers[0]?.quota ?? 0);
}

export function resolveCampusAssistantQuotaLevel(reputation: number, reputationLevel: number) {
  return reputation <= 0 ? 0 : reputationLevel;
}

async function resolveUserQuota(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      assistantPoints: true,
    },
  });
  if (!user) throw Errors.unauthorized("账号不存在或已失效，请重新登录");
  const trust = buildUserTrustSnapshot(user);
  const level = resolveCampusAssistantQuotaLevel(trust.reputation, trust.reputationLevel.level);
  return {
    level,
    levelName: level === 0 ? "新账号" : trust.reputationLevel.name,
    dailyQuota: resolveCampusAssistantDailyQuota(level),
    points: user.assistantPoints,
  };
}

function buildQuotaStatus(
  quota: Awaited<ReturnType<typeof resolveUserQuota>>,
  used: number,
  date = new Date(),
): CampusAssistantQuotaStatus {
  const normalizedUsed = Math.max(0, used);
  return {
    level: quota.level,
    levelName: quota.levelName,
    dailyQuota: quota.dailyQuota,
    used: normalizedUsed,
    remaining: Math.max(0, quota.dailyQuota - normalizedUsed),
    points: Math.max(0, quota.points),
    totalRemaining: Math.max(0, quota.dailyQuota - normalizedUsed) + Math.max(0, quota.points),
    dateKey: campusAssistantDateKey(date),
    nextResetAt: nextCampusAssistantResetAt(date).toISOString(),
  };
}

export async function getCampusAssistantQuotaStatus(userId: number, date = new Date()) {
  const quota = await resolveUserQuota(userId);
  const dateKey = campusAssistantDateKey(date);
  const usage = await prisma.campusAssistantDailyUsage.findUnique({
    where: { userId_dateKey: { userId, dateKey } },
    select: { used: true },
  });
  return buildQuotaStatus(quota, usage?.used ?? 0, date);
}

export async function consumeCampusAssistantQuota(userId: number, date = new Date(), pointCost = 1) {
  const quota = await resolveUserQuota(userId);
  const dateKey = campusAssistantDateKey(date);
  if (quota.dailyQuota > 0) {
    await prisma.campusAssistantDailyUsage.upsert({
      where: { userId_dateKey: { userId, dateKey } },
      update: {},
      create: { userId, dateKey, used: 0 },
    });
    const consumed = await prisma.campusAssistantDailyUsage.updateMany({
      where: {
        userId,
        dateKey,
        used: { lt: quota.dailyQuota },
      },
      data: { used: { increment: 1 } },
    });
    if (consumed.count === 1) {
      const usage = await prisma.campusAssistantDailyUsage.findUnique({
        where: { userId_dateKey: { userId, dateKey } },
        select: { used: true },
      });
      return {
        ...buildQuotaStatus(quota, usage?.used ?? quota.dailyQuota, date),
        reservation: { source: "daily", dateKey } satisfies CampusAssistantQuotaReservation,
      };
    }
  }

  const normalizedPointCost = Math.max(1, Math.round((Number(pointCost) || 1) * 2) / 2);
  const pointSpend = await spendAssistantPoint(userId, normalizedPointCost);
  if (!pointSpend) {
    throw Errors.forbidden("今天的拾间 AI 额度和点数都已用完，日额度会在明天 00:00 自动恢复");
  }
  const usage = quota.dailyQuota > 0
    ? await prisma.campusAssistantDailyUsage.findUnique({
        where: { userId_dateKey: { userId, dateKey } },
        select: { used: true },
      })
    : null;
  return {
    ...buildQuotaStatus({ ...quota, points: pointSpend.balance }, usage?.used ?? 0, date),
    reservation: {
      source: "points",
      dateKey,
      transactionId: pointSpend.transactionId,
      pointCost: pointSpend.points,
    } satisfies CampusAssistantQuotaReservation,
  };
}

export async function refundCampusAssistantQuota(
  userId: number,
  reservation: CampusAssistantQuotaReservation,
) {
  if (reservation.source === "points" && reservation.transactionId) {
    await refundAssistantPoint(userId, reservation.transactionId);
    return;
  }
  await prisma.campusAssistantDailyUsage.updateMany({
    where: {
      userId,
      dateKey: reservation.dateKey,
      used: { gt: 0 },
    },
    data: { used: { decrement: 1 } },
  });
}

export async function resetCampusAssistantDailyUsage(date = new Date()) {
  const dateKey = campusAssistantDateKey(date);
  const result = await prisma.campusAssistantDailyUsage.updateMany({
    where: {
      dateKey,
      used: { gt: 0 },
    },
    data: { used: 0 },
  });
  return {
    dateKey,
    resetUsers: result.count,
  };
}
