import { prisma } from "../prisma";
import { getSiteConfig, type AnonymousTierConfig, type ReputationLevelConfig } from "./siteSettings";
import { Errors } from "../utils/response";

type TrustUserSnapshot = {
  id?: number;
  createdAt: Date | string;
  postCount: number;
  replyCount: number;
  forumEnabled?: boolean | null;
  forumEnabledAt?: Date | string | null;
  anonymousCredits?: number | null;
  anonymousWeekKey?: string | null;
  anonymousCreditsFrozen?: boolean | null;
};

type TrustClient = Pick<typeof prisma, "user">;

type TrustConfig = {
  anonymousMinReputation: number;
  accountAgeDaysPerStep: number;
  accountAgePointsPerStep: number;
  accountAgePointsCap: number;
  postPointsPerTopic: number;
  postPointsCap: number;
  replyPointsPerReply: number;
  replyPointsCap: number;
  forumEnabledBonus: number;
  anonymousTiers: AnonymousTierConfig[];
  reputationLevels: ReputationLevelConfig[];
};

function readTrustConfig(): TrustConfig {
  const config = getSiteConfig();
  return {
    anonymousMinReputation: config.anonymousMinReputation,
    accountAgeDaysPerStep: config.accountAgeDaysPerStep,
    accountAgePointsPerStep: config.accountAgePointsPerStep,
    accountAgePointsCap: config.accountAgePointsCap,
    postPointsPerTopic: config.postPointsPerTopic,
    postPointsCap: config.postPointsCap,
    replyPointsPerReply: config.replyPointsPerReply,
    replyPointsCap: config.replyPointsCap,
    forumEnabledBonus: config.forumEnabledBonus,
    anonymousTiers: config.anonymousTiers,
    reputationLevels: config.reputationLevels,
  };
}

function safeDateValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function accountAgeDays(createdAt: Date | string) {
  const created = safeDateValue(createdAt);
  const diff = Date.now() - created.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function currentIsoWeekParts(date = new Date()) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    year: value.getUTCFullYear(),
    week: weekNo,
  };
}

export function currentAnonymousWeekKey(date = new Date()) {
  const { year, week } = currentIsoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function nextAnonymousResetAt(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const distance = day === 0 ? 1 : 8 - day;
  next.setDate(next.getDate() + distance);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function computeUserReputationBreakdown(
  user: Pick<TrustUserSnapshot, "createdAt" | "postCount" | "replyCount" | "forumEnabled" | "forumEnabledAt">,
  config = readTrustConfig()
) {
  const days = accountAgeDays(user.createdAt);
  const agePoints = Math.min(
    config.accountAgePointsCap,
    Math.floor(days / config.accountAgeDaysPerStep) * config.accountAgePointsPerStep
  );
  const postPoints = Math.min(config.postPointsCap, Math.max(0, user.postCount || 0) * config.postPointsPerTopic);
  const replyPoints = Math.min(config.replyPointsCap, Math.max(0, user.replyCount || 0) * config.replyPointsPerReply);
  const forumPoints = user.forumEnabled || user.forumEnabledAt ? config.forumEnabledBonus : 0;
  const total = agePoints + postPoints + replyPoints + forumPoints;
  return {
    total,
    accountAgeDays: days,
    agePoints,
    postPoints,
    replyPoints,
    forumPoints,
    caps: {
      agePoints: config.accountAgePointsCap,
      postPoints: config.postPointsCap,
      replyPoints: config.replyPointsCap,
    },
  };
}

export function computeAnonymousWeeklyQuota(reputation: number, config = readTrustConfig()) {
  const tiers = [...config.anonymousTiers].sort((a, b) => b.reputation - a.reputation);
  for (const tier of tiers) {
    if (reputation >= tier.reputation) return tier.quota;
  }
  return 0;
}

function resolveReputationLevel(reputation: number, config = readTrustConfig()) {
  const levels = [...config.reputationLevels].sort((a, b) => a.level - b.level);
  const current = [...levels].reverse().find((item) => reputation >= item.minReputation) ?? levels[0];
  const next = levels.find((item) => item.minReputation > reputation) ?? null;
  return {
    level: current.level,
    name: current.name,
    minReputation: current.minReputation,
    nextLevel: next ? {
      level: next.level,
      name: next.name,
      minReputation: next.minReputation,
      need: Math.max(0, next.minReputation - reputation),
    } : null,
  };
}

export function buildUserTrustSnapshot(user: TrustUserSnapshot) {
  const config = readTrustConfig();
  const reputationBreakdown = computeUserReputationBreakdown(user, config);
  const reputation = reputationBreakdown.total;
  const weeklyQuota = computeAnonymousWeeklyQuota(reputation, config);
  const reputationLevel = resolveReputationLevel(reputation, config);
  const currentWeekKey = currentAnonymousWeekKey();
  const staleWeek = (user.anonymousWeekKey || "") !== currentWeekKey;
  const frozen = Boolean(user.anonymousCreditsFrozen);
  const storedCredits = Math.max(0, Number(user.anonymousCredits ?? 0));
  const availableCredits = frozen ? 0 : staleWeek ? weeklyQuota : storedCredits;
  const nextTier = [...config.anonymousTiers]
    .sort((a, b) => a.reputation - b.reputation)
    .find((tier) => tier.reputation > reputation) ?? null;

  return {
    reputation,
    reputationBreakdown,
    reputationLevel,
    anonymousState: {
      eligible: reputation >= config.anonymousMinReputation,
      minReputation: config.anonymousMinReputation,
      weeklyQuota,
      availableCredits,
      storedCredits,
      frozen,
      weekKey: currentWeekKey,
      staleWeek,
      nextResetAt: nextAnonymousResetAt().toISOString(),
      nextTier: nextTier ? {
        reputation: nextTier.reputation,
        weeklyQuota: nextTier.quota,
        need: Math.max(0, nextTier.reputation - reputation),
      } : null,
    },
  };
}

export async function refreshAnonymousCreditsIfNeeded(userId: number, client: TrustClient = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  if (!user) throw Errors.notFound("用户不存在");
  const trust = buildUserTrustSnapshot(user);
  if (!trust.anonymousState.staleWeek) {
    return { user, trust };
  }
  const updated = await client.user.update({
    where: { id: userId },
    data: {
      anonymousWeekKey: trust.anonymousState.weekKey,
      anonymousCredits: trust.anonymousState.frozen ? 0 : trust.anonymousState.weeklyQuota,
    },
    select: {
      id: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  return {
    user: updated,
    trust: buildUserTrustSnapshot(updated),
  };
}

export async function consumeAnonymousCredit(userId: number, client: TrustClient = prisma) {
  const { trust } = await refreshAnonymousCreditsIfNeeded(userId, client);
  if (!trust.anonymousState.eligible) {
    throw Errors.forbidden(`当前信誉值未达到匿名门槛（需至少 ${trust.anonymousState.minReputation}）`);
  }
  if (trust.anonymousState.frozen) {
    throw Errors.forbidden("你的匿名积分当前已被冻结，请联系管理员");
  }
  if (trust.anonymousState.availableCredits <= 0) {
    throw Errors.forbidden("本周匿名积分已用完");
  }
  const updated = await client.user.update({
    where: { id: userId },
    data: { anonymousCredits: { decrement: 1 } },
    select: {
      id: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  return {
    user: updated,
    trust: buildUserTrustSnapshot(updated),
  };
}

export async function freezeAnonymousCredits(userId: number, client: TrustClient = prisma, zeroOut = true) {
  const updated = await client.user.update({
    where: { id: userId },
    data: {
      anonymousCreditsFrozen: true,
      ...(zeroOut ? { anonymousCredits: 0 } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  return {
    user: updated,
    trust: buildUserTrustSnapshot(updated),
  };
}

export function createAnonymousAlias() {
  const seed = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `匿名同学 ${seed}`;
}
