const AUTH_PRESENCE_KEY = "cpu-authenticated";
const SAVED_CREDENTIALS_KEY = "cpu-jwxt-creds-v1";
const CACHE_PRESENCE_KEY = "cpu-jwxt-cache-presence-v1";

const DATA_CACHE_PREFIXES = [
  "cpu-jwxt-tab-cache-v3:",
  "cpu-jwxt-tab-cache-v4:",
  "cpu-jwxt-tab-cache-v5:",
  "cpu-jwxt-data-prewarm-v1:",
  "cpu-schedule-cache-v1:",
  "cpu-schedule-cache-v2:",
  "cpu-schedule-cache-v3:",
  "cpu-schedule-calendar-v1:",
  "cpu-schedule-calendar-v2:",
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

export function jwxtCacheScope() {
  try {
    return (localStorage.getItem(AUTH_PRESENCE_KEY) === "1"
      || Boolean(localStorage.getItem(SAVED_CREDENTIALS_KEY))
      || localStorage.getItem(CACHE_PRESENCE_KEY) === "1")
      ? "browser-session"
      : "";
  } catch {
    return "";
  }
}

export function jwxtScopedStorageKey(base: string, ...parts: Array<string | number | undefined | null>) {
  const scope = jwxtCacheScope();
  if (!scope) return "";
  try { localStorage.setItem(CACHE_PRESENCE_KEY, "1"); } catch { /* ignore */ }
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
    localStorage.removeItem(CACHE_PRESENCE_KEY);
  } catch {
    /* ignore */
  }
}

export function purgeLegacySensitiveJwxtCaches() {
  try {
    const sensitiveSuffixes = [":grades", ":midterm", ":progress", ":pyfa"];
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i) || "";
      if (
        (key.startsWith("cpu-jwxt-tab-cache-v3:") || key.startsWith("cpu-jwxt-tab-cache-v4:"))
        && sensitiveSuffixes.some((suffix) => key.endsWith(suffix))
      ) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
