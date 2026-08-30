type StorageLike = Pick<Storage, "getItem" | "setItem">;

const SESSION_REPAIR_KEY_PREFIX = "cpu-jwxt-session-repair-modern-v1";
const attemptedInMemory = new Set<string>();

function repairKey(username: string) {
  const normalized = username.trim().toLowerCase();
  return normalized ? `${SESSION_REPAIR_KEY_PREFIX}:${encodeURIComponent(normalized)}` : "";
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function hasAttemptedModernJwxtSessionRepair(
  username: string,
  storage: StorageLike | null = browserStorage(),
) {
  const key = repairKey(username);
  if (!key) return true;
  if (attemptedInMemory.has(key)) return true;
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markModernJwxtSessionRepairAttempted(
  username: string,
  storage: StorageLike | null = browserStorage(),
) {
  const key = repairKey(username);
  if (!key) return;
  attemptedInMemory.add(key);
  try { storage?.setItem(key, "1"); } catch { /* ignore */ }
}

export async function repairUnavailableJwxtSession(input: {
  username: string;
  storage?: StorageLike | null;
  disconnect: () => Promise<unknown>;
  resetLocalState: () => void;
  hasSavedCredentials: () => boolean;
  autoLogin: () => Promise<boolean>;
}) {
  const storage = input.storage === undefined ? browserStorage() : input.storage;
  if (hasAttemptedModernJwxtSessionRepair(input.username, storage)) return false;
  markModernJwxtSessionRepairAttempted(input.username, storage);
  await input.disconnect().catch(() => undefined);
  input.resetLocalState();
  if (!input.hasSavedCredentials()) return false;
  return input.autoLogin();
}
