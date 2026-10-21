export function shouldRetryJwxtRead(input: { method?: string; status: number; code: number; message: string; attempts: number; aborted?: boolean }) {
  return input.method?.toLowerCase() === "get" && !input.aborted && input.attempts < 2
    && ([5302, 5305, 5306].includes(input.code) || (input.status === 503 && /教务会话正在迁移/.test(input.message)));
}

export function jwxtRetryDelay(attempt: number, retryAfter: unknown, now = Date.now(), random = Math.random()) {
  const value = typeof retryAfter === "string" || typeof retryAfter === "number" ? String(retryAfter).trim() : "";
  const seconds = value ? Number(value) : NaN;
  const requested = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
    : value ? Math.max(0, Date.parse(value) - now) : 0;
  // Do not retry earlier than a long server-directed cooldown; let the caller
  // surface the error instead of keeping a browser request alive indefinitely.
  if (Number.isFinite(requested) && requested > 10000) return null;
  return Math.max(500 * 2 ** Math.min(Math.max(0, attempt), 2), Number.isFinite(requested) ? requested : 0)
    + Math.floor(Math.min(1, Math.max(0, random)) * 500);
}

export function waitForJwxtRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
