const FORUM_SUBMISSION_ID_PATTERN = /^(?:topic|reply)-[a-z0-9][a-z0-9-]{7,79}$/u;

export type TopicEditReviewContext = {
  kind: "topic-edit";
  version: 1;
  originalTitle: string;
  originalContent: string;
  similarityThreshold: number;
  attempt: number;
  lastError?: string;
  retryMode?: typeof AUTO_MANUAL_RETRY_MARKER;
};

export const AUTO_MANUAL_RETRY_MARKER = "auto-manual-retry:v1";

export const FORUM_SELF_VISIBLE_REVIEW_STATUSES = [
  "checking",
  "review_failed",
  "blocked_ai",
  "manual_requested",
  "manual_reviewing",
  "rejected_manual",
] as const;

export function forumContentVisibilityWhere(viewerId?: number | null) {
  if (!viewerId) return { hidden: false };
  return {
    OR: [
      { hidden: false },
      {
        hidden: true,
        authorId: viewerId,
        aiReviewStatus: { in: [...FORUM_SELF_VISIBLE_REVIEW_STATUSES] },
      },
    ],
  };
}

export function normalizeForumSubmissionId(value: unknown, kind: "topic" | "reply") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!FORUM_SUBMISSION_ID_PATTERN.test(normalized) || !normalized.startsWith(`${kind}-`)) return null;
  return normalized;
}

export function isForumSubmissionUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export function forumReviewSnapshotWhere(id: number, updatedAt: Date) {
  return {
    id,
    aiReviewStatus: "checking",
    hidden: true,
    updatedAt,
  } as const;
}

export function encodeTopicEditReviewContext(input: {
  originalTitle: string;
  originalContent: string;
  similarityThreshold: number;
}) {
  return JSON.stringify({
    kind: "topic-edit",
    version: 1,
    originalTitle: input.originalTitle,
    originalContent: input.originalContent,
    similarityThreshold: Math.max(0, Math.min(1, Number(input.similarityThreshold) || 0)),
    attempt: 0,
  } satisfies TopicEditReviewContext);
}

export function parseTopicEditReviewContext(value: string | null | undefined): TopicEditReviewContext | null {
  try {
    const parsed = JSON.parse(value || "{}");
    if (
      parsed?.kind !== "topic-edit"
      || parsed?.version !== 1
      || typeof parsed.originalTitle !== "string"
      || typeof parsed.originalContent !== "string"
    ) return null;
    return {
      kind: "topic-edit",
      version: 1,
      originalTitle: parsed.originalTitle,
      originalContent: parsed.originalContent,
      similarityThreshold: Math.max(0, Math.min(1, Number(parsed.similarityThreshold) || 0)),
      attempt: Math.max(0, Math.floor(Number(parsed.attempt) || 0)),
      ...(typeof parsed.lastError === "string" && parsed.lastError ? { lastError: parsed.lastError.slice(0, 500) } : {}),
      ...(parsed.retryMode === AUTO_MANUAL_RETRY_MARKER ? { retryMode: AUTO_MANUAL_RETRY_MARKER } : {}),
    };
  } catch {
    return null;
  }
}

export function forumReviewAttempt(detail: string | null | undefined) {
  const editContext = parseTopicEditReviewContext(detail);
  if (editContext) return editContext.attempt;
  const match = String(detail || "").match(/^\[attempt:(\d+)\]/);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

export function isAutomaticManualReviewRetry(detail: string | null | undefined) {
  const editContext = parseTopicEditReviewContext(detail);
  return editContext?.retryMode === AUTO_MANUAL_RETRY_MARKER
    || String(detail || "").includes(`[${AUTO_MANUAL_RETRY_MARKER}]`);
}

export function resetForumReviewRetryDetail(detail: string | null | undefined) {
  const editContext = parseTopicEditReviewContext(detail);
  if (!editContext) return "";
  const { lastError: _lastError, retryMode: _retryMode, ...rest } = editContext;
  return JSON.stringify({ ...rest, attempt: 0 } satisfies TopicEditReviewContext);
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
  if (["manual_requested", "manual_reviewing"].includes(status)) {
    return {
      status: "manual_review",
      reason: input.reason || "内容已进入人工审核队列，审核完成后会通过站内通知告知结果",
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
  if (status === "deleted") {
    return {
      status: "deleted",
      reason: input.reason || "内容已删除",
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
