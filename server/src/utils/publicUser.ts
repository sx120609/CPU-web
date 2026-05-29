import { buildUserTrustSnapshot } from "../services/userTrust";

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

function canSeeUsername(viewer: Viewer, targetUserId?: number | null) {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return targetUserId !== undefined && targetUserId !== null && viewer.userId === targetUserId;
}

function canSeeModerationFields(viewer: Viewer) {
  return viewer?.role === "admin" || viewer?.role === "mod";
}

function sponsorAmount(u: any) {
  return Number(((u.sponsorTotalCents ?? 0) / 100).toFixed(2));
}

export function buildSelfUser(u: any) {
  const trust = buildUserTrustSnapshot(u);
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    college: u.college,
    enrollYear: u.enrollYear,
    role: u.role,
    studentSso: u.studentSso,
    dataAuthAgreedAt: u.dataAuthAgreedAt,
    postCount: u.postCount,
    replyCount: u.replyCount,
    reputation: trust.reputation,
    reputationLevel: trust.reputationLevel,
    reputationBreakdown: trust.reputationBreakdown,
    lastSeenAt: u.lastSeenAt,
    lastLoginAt: u.lastLoginAt,
    lastLoginClient: u.lastLoginClient,
    usedIosClient: u.usedIosClient,
    usedAndroidClient: u.usedAndroidClient,
    usedHarmonyClient: u.usedHarmonyClient,
    topicSubmissionLocked: u.topicSubmissionLocked,
    aiReviewWhitelisted: u.aiReviewWhitelisted,
    forumEnabled: u.forumEnabled,
    forumEnabledAt: u.forumEnabledAt,
    anonymousState: trust.anonymousState,
    sponsorTotalCents: u.sponsorTotalCents ?? 0,
    sponsorAmount: sponsorAmount(u),
    status: u.status,
    mutedUntil: u.mutedUntil,
    createdAt: u.createdAt,
  };
}

export function buildPublicUser(u: any, viewer?: Viewer) {
  const trust = buildUserTrustSnapshot(u);
  const result: Record<string, unknown> = {
    id: u.id,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    college: u.college,
    enrollYear: u.enrollYear,
    role: u.role,
    postCount: u.postCount,
    replyCount: u.replyCount,
    reputation: trust.reputation,
    reputationLevel: trust.reputationLevel,
    sponsorTotalCents: u.sponsorTotalCents ?? 0,
    sponsorAmount: sponsorAmount(u),
    createdAt: u.createdAt,
  };

  if (canSeeUsername(viewer, u.id)) result.username = u.username;
  if (canSeeModerationFields(viewer)) {
    result.status = u.status;
    result.mutedUntil = u.mutedUntil;
  }

  return result;
}

export function buildUserPreview(u: any, viewer?: Viewer) {
  if (!u) return u;

  const result: Record<string, unknown> = {
    id: u.id,
    nickname: u.nickname,
    avatar: u.avatar,
    role: u.role,
  };

  if ("reputation" in u) result.reputation = u.reputation;
  if ("reputationLevel" in u) result.reputationLevel = u.reputationLevel;

  if ("bio" in u) result.bio = u.bio;
  if (canSeeUsername(viewer, u.id)) result.username = u.username;
  if (canSeeModerationFields(viewer)) {
    result.status = u.status;
    result.mutedUntil = u.mutedUntil;
  }

  return result;
}
