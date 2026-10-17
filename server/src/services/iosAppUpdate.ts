import { prisma } from "../prisma";

export const IOS_APP_STORE_ID = "6811073406";
export const IOS_APP_STORE_URL = `https://apps.apple.com/cn/app/id${IOS_APP_STORE_ID}`;

const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${IOS_APP_STORE_ID}&country=cn`;
const FRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const RECENT_INSTALL_MS = 30 * 24 * 60 * 60 * 1000;

let cached: { version: string | null; checkedAt: number } = { version: null, checkedAt: -Infinity };
let pending: Promise<string | null> | null = null;

/** Compares dotted marketing versions such as "4.15" and "4.9"; missing parts count as 0. */
export function compareAppVersions(left: string, right: string) {
  const a = left.split(".").map(part => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export function parseAppStoreLookup(payload: unknown) {
  const result = (payload as { results?: Array<{ trackId?: unknown; version?: unknown }> } | null)?.results?.[0];
  if (String(result?.trackId ?? "") !== IOS_APP_STORE_ID) return null;
  return typeof result?.version === "string" && /^\d+(\.\d+){0,3}$/.test(result.version) ? result.version : null;
}

/** The version the China App Store currently serves. A failed lookup keeps the last known value. */
export async function getAppStoreVersion(fetcher: typeof fetch = fetch, now = Date.now()) {
  const age = now - cached.checkedAt;
  if (age < (cached.version ? FRESH_MS : RETRY_MS)) return cached.version;
  pending ??= fetcher(LOOKUP_URL, { signal: AbortSignal.timeout(5_000) })
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const version = parseAppStoreLookup(await response.json());
      if (!version) throw new Error("App Store lookup has no version");
      cached = { version, checkedAt: now };
      return version;
    })
    .catch(() => {
      // Retry sooner than a successful lookup, but do not hammer Apple on every request.
      cached = { version: cached.version, checkedAt: now - (cached.version ? FRESH_MS - RETRY_MS : 0) };
      return cached.version;
    })
    .finally(() => { pending = null; });
  return pending;
}

export function resetAppStoreVersionCache() {
  cached = { version: null, checkedAt: -Infinity };
  pending = null;
}

/**
 * The Web page inside the iOS app cannot read the app's version, so the
 * account's most recently active install (its launch heartbeat reports the
 * version) stands in for the device the user is holding.
 */
export async function getIosAppUpdateStatus(userId: number, now = new Date()) {
  const [latestVersion, install] = await Promise.all([
    getAppStoreVersion(),
    prisma.iosClientInstall.findFirst({
      where: { userId, lastSeenAt: { gte: new Date(now.getTime() - RECENT_INSTALL_MS) } },
      orderBy: { lastSeenAt: "desc" },
      select: { appVersion: true, appBuild: true },
    }),
  ]);
  const currentVersion = install?.appVersion ?? null;
  return {
    latestVersion,
    currentVersion,
    currentBuild: install?.appBuild ?? null,
    updateAvailable: Boolean(latestVersion && currentVersion && compareAppVersions(currentVersion, latestVersion) < 0),
    storeUrl: IOS_APP_STORE_URL,
  };
}
