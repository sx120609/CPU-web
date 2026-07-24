import type { HomeSummary } from "@/api/home";
import type { MarketItem } from "@/api/market";

const HOME_CACHE_VERSION = 1;
const HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HOME_SUMMARY_CACHE_PREFIX = "cpu-home-summary-v1:";
const HOME_MARKET_CACHE_PREFIX = "cpu-home-market-v1:";

interface CacheEnvelope<T> {
  version: number;
  savedAt: number;
  data: T;
}

function readEnvelope<T>(key: string, validate: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw) as Partial<CacheEnvelope<unknown>>;
    if (
      envelope.version !== HOME_CACHE_VERSION
      || typeof envelope.savedAt !== "number"
      || Date.now() - envelope.savedAt > HOME_CACHE_MAX_AGE_MS
      || !validate(envelope.data)
    ) {
      localStorage.removeItem(key);
      return null;
    }

    return envelope.data;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: HOME_CACHE_VERSION,
      savedAt: Date.now(),
      data,
    } satisfies CacheEnvelope<T>));
  } catch {
    /* localStorage may be unavailable or full; network loading still works. */
  }
}

function isHomeSummary(value: unknown): value is HomeSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HomeSummary>;
  return Array.isArray(candidate.pinnedTopics)
    && Array.isArray(candidate.hotTopics)
    && Array.isArray(candidate.latestTopics)
    && Array.isArray(candidate.announce)
    && Array.isArray(candidate.services);
}

function isMarketItems(value: unknown): value is MarketItem[] {
  return Array.isArray(value);
}

export function readHomeSummaryCache(scope: string) {
  return readEnvelope(`${HOME_SUMMARY_CACHE_PREFIX}${scope}`, isHomeSummary);
}

export function writeHomeSummaryCache(scope: string, summary: HomeSummary) {
  writeEnvelope(`${HOME_SUMMARY_CACHE_PREFIX}${scope}`, summary);
}

export function readHomeMarketCache(scope: string) {
  return readEnvelope(`${HOME_MARKET_CACHE_PREFIX}${scope}`, isMarketItems);
}

export function writeHomeMarketCache(scope: string, items: MarketItem[]) {
  writeEnvelope(`${HOME_MARKET_CACHE_PREFIX}${scope}`, items);
}
