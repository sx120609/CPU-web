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

export function buildSelfUser(u: any) {
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
    postCount: u.postCount,
    replyCount: u.replyCount,
    reputation: u.reputation,
    lastSeenAt: u.lastSeenAt,
    lastLoginAt: u.lastLoginAt,
    lastLoginClient: u.lastLoginClient,
    usedIosClient: u.usedIosClient,
    usedAndroidClient: u.usedAndroidClient,
    topicSubmissionLocked: u.topicSubmissionLocked,
    aiReviewWhitelisted: u.aiReviewWhitelisted,
    forumEnabled: u.forumEnabled,
    forumEnabledAt: u.forumEnabledAt,
    status: u.status,
    mutedUntil: u.mutedUntil,
    createdAt: u.createdAt,
  };
}

export function buildPublicUser(u: any, viewer?: Viewer) {
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
    reputation: u.reputation,
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

  if ("bio" in u) result.bio = u.bio;
  if (canSeeUsername(viewer, u.id)) result.username = u.username;
  if (canSeeModerationFields(viewer)) {
    result.status = u.status;
    result.mutedUntil = u.mutedUntil;
  }

  return result;
}
