/**
 * School passwords are deliberately never persisted in browser storage.
 * These compatibility exports keep older UI flows safe while deployments roll forward.
 */
const LEGACY_KEY_STORAGE = "cpu-jwxt-key-v1";
const LEGACY_CRED_STORAGE = "cpu-jwxt-creds-v1";

export function clearCreds(): void {
  try {
    localStorage.removeItem(LEGACY_CRED_STORAGE);
    localStorage.removeItem(LEGACY_KEY_STORAGE);
  } catch { /* storage may be unavailable */ }
}

// Purge credentials written by versions that encrypted the password beside its key.
clearCreds();

export async function saveCreds(_username: string, _password: string): Promise<void> {
  clearCreds();
}

export async function loadCreds(): Promise<{ username: string; password: string } | null> {
  clearCreds();
  return null;
}

export function hasCreds(): boolean {
  clearCreds();
  return false;
}

export async function savedUsername(): Promise<string | null> {
  return null;
}
