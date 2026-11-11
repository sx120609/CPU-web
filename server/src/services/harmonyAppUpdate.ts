import { cachedStoreLookup, releaseNoteLines, type StoreRelease } from "./storeReleaseCache";

export const HARMONY_BUNDLE_NAME = "cn.lizmt.cpuweb";
export const HARMONY_APP_STORE_URL = `https://appgallery.huawei.com/app/detail?id=${HARMONY_BUNDLE_NAME}`;

// The public endpoint behind the AppGallery web detail page. It answers with
// the version on sale, so a build still in review is not announced early.
const APPINFO_URL = "https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo";

export function parseAppGalleryRelease(payload: unknown): StoreRelease | null {
  const info = payload as {
    pkgName?: unknown;
    version?: unknown;
    versionCode?: unknown;
    newFeatures?: unknown;
    isShelves?: unknown;
  } | null;
  if (info?.pkgName !== HARMONY_BUNDLE_NAME || Number(info.isShelves ?? 1) !== 1) return null;
  const versionCode = Number(info.versionCode);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) return null;
  if (typeof info.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(info.version)) return null;
  return { version: info.version, versionCode, notes: releaseNoteLines(info.newFeatures) };
}

const appGalleryRelease = cachedStoreLookup(async fetcher => {
  const response = await fetcher(APPINFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pkgName: HARMONY_BUNDLE_NAME, locale: "zh_CN" }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const release = parseAppGalleryRelease(await response.json());
  if (!release) throw new Error("AppGallery lookup has no version");
  return release;
});

export function getAppGalleryRelease(fetcher: typeof fetch = fetch, now = Date.now()) {
  return appGalleryRelease.get(fetcher, now);
}

export function resetAppGalleryReleaseCache() {
  appGalleryRelease.reset();
}

/** Whether a HarmonyOS app with this version code is behind the version on sale in AppGallery. */
export async function getHarmonyAppUpdateStatus(currentVersionCode: number | null) {
  const release = await getAppGalleryRelease();
  const latestVersionCode = release?.versionCode ?? null;
  return {
    latestVersion: release?.version ?? null,
    latestVersionCode,
    currentVersionCode,
    updateAvailable: Boolean(latestVersionCode && currentVersionCode && currentVersionCode < latestVersionCode),
    notes: release?.notes ?? [],
    storeUrl: HARMONY_APP_STORE_URL,
  };
}
