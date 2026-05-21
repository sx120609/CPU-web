import { prisma } from "../prisma";
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

export const ANONYMOUS_MIN_REPUTATION = 30;
const ACCOUNT_AGE_DAYS_PER_STEP = 14;
const ACCOUNT_AGE_POINTS_PER_STEP = 2;
const ACCOUNT_AGE_POINTS_CAP = 36;
const POST_POINTS_PER_TOPIC = 4;
const POST_POINTS_CAP = 48;
const REPLY_POINTS_PER_REPLY = 2;
const REPLY_POINTS_CAP = 48;
const FORUM_ENABLED_BONUS = 6;
const ANONYMOUS_TIERS = [
  { reputation: 120, quota: 4 },
  { reputation: 90, quota: 3 },
  { reputation: 60, quota: 2 },
  { reputation: 30, quota: 1 },
] as const;

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

export function computeUserReputationBreakdown(user: Pick<TrustUserSnapshot, "createdAt" | "postCount" | "replyCount" | "forumEnabled" | "forumEnabledAt">) {
  const days = accountAgeDays(user.createdAt);
  const agePoints = Math.min(
    ACCOUNT_AGE_POINTS_CAP,
    Math.floor(days / ACCOUNT_AGE_DAYS_PER_STEP) * ACCOUNT_AGE_POINTS_PER_STEP
  );
  const postPoints = Math.min(POST_POINTS_CAP, Math.max(0, user.postCount || 0) * POST_POINTS_PER_TOPIC);
  const replyPoints = Math.min(REPLY_POINTS_CAP, Math.max(0, user.replyCount || 0) * REPLY_POINTS_PER_REPLY);
  const forumPoints = user.forumEnabled || user.forumEnabledAt ? FORUM_ENABLED_BONUS : 0;
  const total = agePoints + postPoints + replyPoints + forumPoints;
  return {
    total,
    accountAgeDays: days,
    agePoints,
    postPoints,
    replyPoints,
    forumPoints,
    caps: {
      agePoints: ACCOUNT_AGE_POINTS_CAP,
      postPoints: POST_POINTS_CAP,
      replyPoints: REPLY_POINTS_CAP,
    },
  };
}

export function computeAnonymousWeeklyQuota(reputation: number) {
  for (const tier of ANONYMOUS_TIERS) {
    if (reputation >= tier.reputation) return tier.quota;
  }
  return 0;
}

export function buildUserTrustSnapshot(user: TrustUserSnapshot) {
  const reputationBreakdown = computeUserReputationBreakdown(user);
  const reputation = reputationBreakdown.total;
  const weeklyQuota = computeAnonymousWeeklyQuota(reputation);
  const currentWeekKey = currentAnonymousWeekKey();
  const staleWeek = (user.anonymousWeekKey || "") !== currentWeekKey;
  const frozen = Boolean(user.anonymousCreditsFrozen);
  const storedCredits = Math.max(0, Number(user.anonymousCredits ?? 0));
  const availableCredits = frozen ? 0 : staleWeek ? weeklyQuota : storedCredits;
  const nextTier = ANONYMOUS_TIERS
    .slice()
    .reverse()
    .find((tier) => tier.reputation > reputation) ?? null;

  return {
    reputation,
    reputationBreakdown,
    anonymousState: {
      eligible: reputation >= ANONYMOUS_MIN_REPUTATION,
      minReputation: ANONYMOUS_MIN_REPUTATION,
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
    throw Errors.forbidden(`当前信誉值未达到匿名门槛（需至少 ${ANONYMOUS_MIN_REPUTATION}）`);
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
