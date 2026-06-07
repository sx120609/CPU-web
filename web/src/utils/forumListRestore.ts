type RestorePayload = {
  scrollY: number;
  page?: number;
  sort?: "new" | "hot";
  latestPage?: number;
  savedAt: number;
};

const STORAGE_PREFIX = "forum-list-restore:";
const MAX_AGE_MS = 30 * 60 * 1000;

function storageKey(routePath: string) {
  return `${STORAGE_PREFIX}${String(routePath || "").trim()}`;
}

export function readForumListRestoreState<T extends RestorePayload>(routePath: string) {
  if (typeof window === "undefined") return null as T | null;
  const raw = window.sessionStorage.getItem(storageKey(routePath));
  if (!raw) return null as T | null;
  try {
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== "object") return null as T | null;
    if (Date.now() - Number(parsed.savedAt || 0) > MAX_AGE_MS) {
      window.sessionStorage.removeItem(storageKey(routePath));
      return null as T | null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(storageKey(routePath));
    return null as T | null;
  }
}

export function clearForumListRestoreState(routePath: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(storageKey(routePath));
}

export function writeForumListRestoreState(routePath: string, payload: Omit<RestorePayload, "savedAt">) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(storageKey(routePath), JSON.stringify({
    ...payload,
    savedAt: Date.now(),
  }));
}
