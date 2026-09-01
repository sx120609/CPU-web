const RATE_LIMIT_RETRY_FALLBACK_MS = 60 * 60_000;
const MIN_RATE_LIMIT_RETRY_MS = 60_000;
const MAX_RATE_LIMIT_RETRY_MS = 6 * 60 * 60_000;

export function smartPostRateLimitRetryMs(error: unknown) {
  const response = (error as { response?: { headers?: unknown } })?.response;
  const headers = response?.headers as { get?: (name: string) => unknown; [key: string]: unknown } | undefined;
  const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return RATE_LIMIT_RETRY_FALLBACK_MS;
  return Math.min(MAX_RATE_LIMIT_RETRY_MS, Math.max(MIN_RATE_LIMIT_RETRY_MS, Math.ceil(seconds * 1000)));
}
