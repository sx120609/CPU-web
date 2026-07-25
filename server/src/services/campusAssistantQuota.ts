import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { getSiteConfig } from "./siteSettings";
import { buildUserTrustSnapshot } from "./userTrust";

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

export type CampusAssistantQuotaStatus = {
  level: number;
  levelName: string;
  dailyQuota: number;
  used: number;
  remaining: number;
  dateKey: string;
  nextResetAt: string;
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
    },
  });
  if (!user) throw Errors.unauthorized("账号不存在或已失效，请重新登录");
  const trust = buildUserTrustSnapshot(user);
  const level = resolveCampusAssistantQuotaLevel(trust.reputation, trust.reputationLevel.level);
  return {
    level,
    levelName: level === 0 ? "新账号" : trust.reputationLevel.name,
    dailyQuota: resolveCampusAssistantDailyQuota(level),
  };
}

function buildQuotaStatus(
  quota: Awaited<ReturnType<typeof resolveUserQuota>>,
  used: number,
  date = new Date(),
): CampusAssistantQuotaStatus {
  const normalizedUsed = Math.max(0, used);
  return {
    ...quota,
    used: normalizedUsed,
    remaining: Math.max(0, quota.dailyQuota - normalizedUsed),
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

export async function consumeCampusAssistantQuota(userId: number, date = new Date()) {
  const quota = await resolveUserQuota(userId);
  if (quota.dailyQuota <= 0) {
    throw Errors.forbidden("你当前等级暂时没有拾间 AI 额度，请联系管理员");
  }
  const dateKey = campusAssistantDateKey(date);
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
  if (consumed.count !== 1) {
    throw Errors.forbidden("今天的拾间 AI 额度已用完，明天 00:00 自动恢复");
  }
  const usage = await prisma.campusAssistantDailyUsage.findUnique({
    where: { userId_dateKey: { userId, dateKey } },
    select: { used: true },
  });
  return buildQuotaStatus(quota, usage?.used ?? quota.dailyQuota, date);
}

export async function refundCampusAssistantQuota(userId: number, dateKey: string) {
  await prisma.campusAssistantDailyUsage.updateMany({
    where: {
      userId,
      dateKey,
      used: { gt: 0 },
    },
    data: { used: { decrement: 1 } },
  });
}
