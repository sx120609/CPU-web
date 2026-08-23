export type ForumSubmissionKind = "topic" | "reply";

export function createForumSubmissionId(kind: ForumSubmissionKind) {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${uuid}`.toLowerCase().slice(0, 80);
}

export function getForumRequestStatus(error: unknown) {
  return typeof error === "object" && error !== null
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

export function getForumRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

export function isAmbiguousForumSubmissionError(error: unknown) {
  const status = getForumRequestStatus(error);
  return status === undefined || status >= 500;
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function reconcileForumSubmission<T>(
  lookup: () => Promise<T>,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 8);
  const intervalMs = Math.max(100, options.intervalMs ?? 1_250);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(intervalMs);
    try {
      return await lookup();
    } catch (error) {
      const status = getForumRequestStatus(error);
      if (status !== 404 && status !== undefined && status < 500) throw error;
    }
  }
  return null;
}
