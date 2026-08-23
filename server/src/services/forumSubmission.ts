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

export function scheduleForumBackgroundTask(label: string, task: () => Promise<unknown>) {
  setTimeout(() => {
    void task().catch((error) => {
      console.warn(`[forum] ${label} failed`, error instanceof Error ? error.message : error);
    });
  }, 0).unref?.();
}
