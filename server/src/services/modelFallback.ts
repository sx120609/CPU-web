export function normalizeFallbackModelList(input: string | null | undefined, primaryModel?: string | null) {
  const primary = String(primaryModel || "").trim();
  const items = String(input || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!key || key === primary.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized.join(", ");
}

export function resolveModelCandidates(primaryModel: string | null | undefined, fallbackList: string | null | undefined) {
  const primary = String(primaryModel || "").trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [primary, ...String(fallbackList || "").split(/[\n,，]+/)]) {
    const normalized = String(item || "").trim();
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function shouldFallbackToNextModel(status: number, responseText: string) {
  if (status === 429 || status >= 500) return true;
  const text = String(responseText || "").toLowerCase();
  if (!text) return status === 404;
  return [
    /model[^.\n]{0,80}(not found|does not exist|unavailable|unsupported|disabled|decommissioned)/i,
    /(unknown|invalid)[^.\n]{0,40}model/i,
    /no such model/i,
    /rate limit/i,
    /quota exceeded/i,
    /service unavailable/i,
    /server is overloaded/i,
    /capacity/i,
    /temporarily unavailable/i,
  ].some((pattern) => pattern.test(text));
}

/**
 * Cross-provider fallback is reserved for transient upstream failures. A 400
 * such as Ollama's `invalid image input` describes this request, not a dead
 * provider; sending the same malformed payload to another service only hides
 * the real cause and produces another failure.
 */
export function shouldFallbackToNextProvider(status: number, responseText: string) {
  if (status === 408 || status === 409 || status === 425 || status === 429 || status === 529 || status >= 500) return true;
  const text = String(responseText || "").toLowerCase();
  return /(?:temporarily unavailable|server is overloaded|capacity|rate limit|quota exceeded|try again later)/i.test(text);
}
