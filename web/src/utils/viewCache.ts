interface ViewCacheEnvelope<T> {
  version: number;
  savedAt: number;
  data: T;
}

const VIEW_CACHE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readViewCache<T>(
  key: string,
  validate: (value: unknown) => value is T,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw) as Partial<ViewCacheEnvelope<unknown>>;
    if (
      envelope.version !== VIEW_CACHE_VERSION
      || typeof envelope.savedAt !== "number"
      || Date.now() - envelope.savedAt > maxAgeMs
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

export function writeViewCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: VIEW_CACHE_VERSION,
      savedAt: Date.now(),
      data,
    } satisfies ViewCacheEnvelope<T>));
  } catch {
    /* localStorage may be unavailable or full; network loading still works. */
  }
}
