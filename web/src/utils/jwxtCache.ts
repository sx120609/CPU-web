const JWXT_TOKEN_KEY = "cpu-jwxt-token";

const DATA_CACHE_PREFIXES = [
  "cpu-jwxt-tab-cache-v3:",
  "cpu-schedule-cache-v1:",
  "cpu-schedule-calendar-v1:",
  "cpu-schedule-last-cache-key-v1:",
  "cpu-jwxt-schedule-view-state-v1:",
  "cpu-schedule-last-state-v1:",
];

const DATA_CACHE_KEYS = [
  "cpu-schedule-calendar-v1",
  "cpu-schedule-last-cache-key-v1",
  "cpu-jwxt-schedule-view-state-v1",
  "cpu-schedule-last-state-v1",
];

function fingerprint(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function jwxtCacheScope() {
  try {
    const token = sessionStorage.getItem(JWXT_TOKEN_KEY) ?? "";
    return token ? fingerprint(token) : "";
  } catch {
    return "";
  }
}

export function jwxtScopedStorageKey(base: string, ...parts: Array<string | number | undefined | null>) {
  const scope = jwxtCacheScope();
  if (!scope) return "";
  const suffix = parts
    .filter((part) => part !== undefined && part !== null && String(part) !== "")
    .map((part) => encodeURIComponent(String(part)));
  return [base, scope, ...suffix].join(":");
}

export function clearJwxtDataCaches() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (DATA_CACHE_KEYS.includes(key) || DATA_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}
