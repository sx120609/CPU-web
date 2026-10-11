export const ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED = true;
export const ANDROID_STAGED_INSTALL_MIN_VERSION_CODE = 37;
// A plain page avoids older shells intercepting APK and /downloads/ links.
export const ANDROID_BROWSER_DOWNLOAD_PAGE = "https://cputime.cn/download?androidUpdate=1";

export function isObsoleteAndroidUpdateFailure(phase: string, fileName: string, installedVersion: number) {
  if (phase !== "failed" || !Number.isSafeInteger(installedVersion) || installedVersion < 1) return false;
  const version = /^CPU-Web-Android-V(\d+)\.apk$/i.exec(fileName)?.[1];
  return version !== undefined && Number(version) <= installedVersion;
}

export function canUseStagedAndroidUpdate(versionCode: number, stagedInstallSupported: boolean) {
  return versionCode >= ANDROID_STAGED_INSTALL_MIN_VERSION_CODE && stagedInstallSupported;
}

export function shouldPromptAndroidInstallRepair(nativeClient: boolean, versionCode: number) {
  return nativeClient && versionCode >= 21 && versionCode < ANDROID_STAGED_INSTALL_MIN_VERSION_CODE;
}

/** Below the published floor the prompt cannot be dismissed; an unknown installed version is never forced. */
export function isAndroidUpdateRequired(nativeClient: boolean, currentVersionCode: number, minSupportedVersionCode: number) {
  return nativeClient && currentVersionCode > 0 && currentVersionCode < minSupportedVersionCode;
}

export function isAndroidUpdateAvailable(
  nativeClient: boolean,
  currentVersionCode: number,
  latestVersionCode: number,
) {
  return nativeClient && currentVersionCode < latestVersionCode;
}
