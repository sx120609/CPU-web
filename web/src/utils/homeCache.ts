import type { HomeSummary } from "@/api/home";
import type { Topic } from "@/api/topic";

const HOME_CACHE_VERSION = 1;
const HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HOME_SUMMARY_CACHE_PREFIX = "cpu-home-summary-v1:";
const HOME_SECOND_HAND_CACHE_PREFIX = "cpu-home-second-hand-v1:";

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

function isTopics(value: unknown): value is Topic[] {
  return Array.isArray(value);
}

export function readHomeSummaryCache(scope: string) {
  return readEnvelope(`${HOME_SUMMARY_CACHE_PREFIX}${scope}`, isHomeSummary);
}

export function writeHomeSummaryCache(scope: string, summary: HomeSummary) {
  writeEnvelope(`${HOME_SUMMARY_CACHE_PREFIX}${scope}`, summary);
}

export function readHomeSecondHandCache(scope: string) {
  return readEnvelope(`${HOME_SECOND_HAND_CACHE_PREFIX}${scope}`, isTopics);
}

export function writeHomeSecondHandCache(scope: string, topics: Topic[]) {
  writeEnvelope(`${HOME_SECOND_HAND_CACHE_PREFIX}${scope}`, topics);
}
