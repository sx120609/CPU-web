const FORUM_SUBMISSION_ID_PATTERN = /^(?:topic|reply)-[a-z0-9][a-z0-9-]{7,79}$/u;

export function normalizeForumSubmissionId(value: unknown, kind: "topic" | "reply") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!FORUM_SUBMISSION_ID_PATTERN.test(normalized) || !normalized.startsWith(`${kind}-`)) return null;
  return normalized;
}

export function isForumSubmissionUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export function forumSubmissionResultForReview(input: {
  aiReviewStatus?: string | null;
  hidden?: boolean | null;
  riskLevel?: string | null;
  riskScore?: number | null;
  reason?: string | null;
  replayed?: boolean;
}) {
  const status = String(input.aiReviewStatus || "").trim();
  if (status === "checking") {
    return {
      status: "pending",
      reason: "内容已提交审核，完成后会通过站内通知告知结果",
      replayed: input.replayed === true,
    };
  }
  if (status === "review_failed") {
    return {
      status: "failed",
      reason: input.reason || "审核服务暂时不可用，请稍后重新提交",
      replayed: input.replayed === true,
    };
  }
  if (input.hidden && status === "blocked_ai") {
    return {
      status: "blocked_ai",
      riskLevel: input.riskLevel || undefined,
      riskScore: input.riskScore ?? undefined,
      reason: input.reason || "内容暂未通过审核",
      replayed: input.replayed === true,
    };
  }
  return { status: "published", replayed: input.replayed === true };
}

export function scheduleForumBackgroundTask(label: string, task: () => Promise<unknown>) {
  setTimeout(() => {
    void task().catch((error) => {
      console.warn(`[forum] ${label} failed`, error instanceof Error ? error.message : error);
    });
  }, 0).unref?.();
}
