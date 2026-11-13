import changelog from "../releases/changelog.json";
import { publishedAndroidRelease } from "./androidRelease";
import { getAppGalleryRelease } from "./harmonyAppUpdate";
import { compareAppVersions, getAppStoreRelease } from "./iosAppUpdate";
import type { StoreRelease } from "./storeReleaseCache";

export type ChangelogPlatform = "android" | "harmony" | "ios";

/**
 * One released version as users read it on /changelog. Written by hand in
 * releases/changelog.json, newest first, when a version is published (Android)
 * or submitted to its store (HarmonyOS, iOS).
 */
export type ChangelogEntry = {
  version: string;
  /** Android versionCode, HarmonyOS versionCode or the iOS build number. */
  build: number;
  /** "2026-11-13", or "2026-11" when only the month is known; left out when not known. */
  date?: string;
  notes: string[];
  /**
   * Written when the version was sent to its store. Such an entry is listed
   * only once the store itself serves that version, so a build in review or a
   * rejected one never reads as released.
   */
  pending?: boolean;
};

export const changelogEntries = changelog as Record<ChangelogPlatform, ChangelogEntry[]>;

type Stores = { harmony: StoreRelease | null; ios: StoreRelease | null };

function released(platform: ChangelogPlatform, entry: ChangelogEntry, stores: Stores) {
  if (platform === "android") return entry.build <= publishedAndroidRelease.versionCode;
  const store = stores[platform];
  if (!store) return !entry.pending;
  if (platform === "harmony" && store.versionCode) return entry.build <= store.versionCode;
  return compareAppVersions(entry.version, store.version) <= 0;
}

export function listChangelog(stores: Stores, entries = changelogEntries) {
  const platforms = {} as Record<ChangelogPlatform, Array<Omit<ChangelogEntry, "pending">>>;
  for (const platform of ["android", "harmony", "ios"] as const) {
    platforms[platform] = entries[platform]
      .filter(entry => released(platform, entry, stores))
      .map(({ pending: _pending, ...entry }) => entry);
  }
  return platforms;
}

/** What each released version of the apps brought, newest first. */
export async function getChangelog() {
  const [harmony, ios] = await Promise.all([
    getAppGalleryRelease().catch(() => null),
    getAppStoreRelease().catch(() => null),
  ]);
  return listChangelog({ harmony, ios });
}
