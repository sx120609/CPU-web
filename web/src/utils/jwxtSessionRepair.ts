type StorageLike = Pick<Storage, "getItem" | "setItem">;

const SESSION_REPAIR_KEY_PREFIX = "cpu-jwxt-session-repair-modern-v3";
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

export async function prepareManualJwxtReauthorization(input: {
  disconnect: () => Promise<unknown>;
  resetLocalState: () => void;
}) {
  await input.disconnect().catch(() => undefined);
  input.resetLocalState();
}

export type JwxtAuthorizationRetryResult = "restored" | "saved-captcha" | "manual";

export function shouldAutoRecoverJwxtSession(input: {
  allowAutoLogin: boolean;
  authorizationExpired: boolean;
  hasSavedCredentials: boolean;
}) {
  return input.hasSavedCredentials && (input.allowAutoLogin || input.authorizationExpired);
}

/**
 * 用户主动重试时也应先兑现“保持登录”的承诺。只有本机没有可用凭据，
 * 或自动登录确实失败时，才准备一份新的手动登录表单。
 */
export async function retryJwxtAuthorization(input: {
  disconnect: () => Promise<unknown>;
  resetLocalState: () => void;
  hasSavedCredentials: () => boolean;
  autoLogin: () => Promise<boolean>;
  needsCaptcha: () => boolean;
  prepareLogin: () => Promise<unknown>;
}): Promise<JwxtAuthorizationRetryResult> {
  await input.disconnect().catch(() => undefined);
  input.resetLocalState();

  if (input.hasSavedCredentials()) {
    if (await input.autoLogin()) return "restored";
    if (input.needsCaptcha()) return "saved-captcha";
  }

  await input.prepareLogin();
  return "manual";
}
