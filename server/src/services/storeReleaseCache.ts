/** The version an app store currently serves, with its "what's new" text split into lines. */
export type StoreRelease = {
  version: string;
  versionCode?: number;
  notes: string[];
};

const FRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_NOTES = 8;
const MAX_NOTE_LENGTH = 200;

/** Splits store release notes into lines without their bullets or numbering. */
export function releaseNoteLines(text: unknown) {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[·•\-*●▪]|\d{1,2}[.、．)]|[（(]\d{1,2}[)）])\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, MAX_NOTES)
    .map(line => (line.length > MAX_NOTE_LENGTH ? `${line.slice(0, MAX_NOTE_LENGTH - 1)}…` : line));
}

/**
 * Caches one store lookup for half an hour. A failed lookup keeps the last
 * known release and is retried after five minutes, so a store outage neither
 * hides a known update nor sends a request per page view.
 */
export function cachedStoreLookup(load: (fetcher: typeof fetch) => Promise<StoreRelease>) {
  let cached: { release: StoreRelease | null; checkedAt: number } = { release: null, checkedAt: -Infinity };
  let pending: Promise<StoreRelease | null> | null = null;

  return {
    get(fetcher: typeof fetch = fetch, now = Date.now()) {
      const age = now - cached.checkedAt;
      if (age < (cached.release ? FRESH_MS : RETRY_MS)) return Promise.resolve(cached.release);
      pending ??= load(fetcher)
        .then(release => {
          cached = { release, checkedAt: now };
          return release;
        })
        .catch(() => {
          cached = { release: cached.release, checkedAt: now - (cached.release ? FRESH_MS - RETRY_MS : 0) };
          return cached.release;
        })
        .finally(() => { pending = null; });
      return pending;
    },
    reset() {
      cached = { release: null, checkedAt: -Infinity };
      pending = null;
    },
  };
}
