import { prisma } from "../prisma";
import { cachedStoreLookup, releaseNoteLines, type StoreRelease } from "./storeReleaseCache";

export const IOS_APP_STORE_ID = "6811073406";
export const IOS_APP_STORE_URL = `https://apps.apple.com/cn/app/id${IOS_APP_STORE_ID}`;

const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${IOS_APP_STORE_ID}&country=cn`;
const RECENT_INSTALL_MS = 30 * 24 * 60 * 60 * 1000;
const MARKETING_VERSION = /^\d+(\.\d+){0,3}$/;

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

export function isMarketingVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 20 && MARKETING_VERSION.test(value);
}

export function parseAppStoreRelease(payload: unknown): StoreRelease | null {
  const result = (payload as { results?: Array<{ trackId?: unknown; version?: unknown; releaseNotes?: unknown }> } | null)?.results?.[0];
  if (String(result?.trackId ?? "") !== IOS_APP_STORE_ID) return null;
  if (!isMarketingVersion(result?.version)) return null;
  return { version: result.version, notes: releaseNoteLines(result.releaseNotes) };
}

export function parseAppStoreLookup(payload: unknown) {
  return parseAppStoreRelease(payload)?.version ?? null;
}

const appStoreRelease = cachedStoreLookup(async fetcher => {
  const response = await fetcher(LOOKUP_URL, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const release = parseAppStoreRelease(await response.json());
  if (!release) throw new Error("App Store lookup has no version");
  return release;
});

/** The release the China App Store currently serves. A failed lookup keeps the last known value. */
export function getAppStoreRelease(fetcher: typeof fetch = fetch, now = Date.now()) {
  return appStoreRelease.get(fetcher, now);
}

export async function getAppStoreVersion(fetcher: typeof fetch = fetch, now = Date.now()) {
  return (await getAppStoreRelease(fetcher, now))?.version ?? null;
}

export function resetAppStoreVersionCache() {
  appStoreRelease.reset();
}

/**
 * Whether the iOS app the user is holding is behind the App Store.
 *
 * Newer builds report their own version (the app asks itself, and its user agent
 * carries the version for the page). Older builds do not, so the account's most
 * recently active install, whose launch heartbeat reports the version, stands in.
 */
export async function getIosAppUpdateStatus(userId: number | null, reportedVersion: string | null, now = new Date()) {
  const [release, install] = await Promise.all([
    getAppStoreRelease(),
    reportedVersion || userId === null
      ? null
      : prisma.iosClientInstall.findFirst({
        where: { userId, lastSeenAt: { gte: new Date(now.getTime() - RECENT_INSTALL_MS) } },
        orderBy: { lastSeenAt: "desc" },
        select: { appVersion: true, appBuild: true },
      }),
  ]);
  const latestVersion = release?.version ?? null;
  const currentVersion = reportedVersion ?? install?.appVersion ?? null;
  return {
    latestVersion,
    currentVersion,
    currentBuild: install?.appBuild ?? null,
    updateAvailable: Boolean(latestVersion && currentVersion && compareAppVersions(currentVersion, latestVersion) < 0),
    notes: release?.notes ?? [],
    storeUrl: IOS_APP_STORE_URL,
  };
}
