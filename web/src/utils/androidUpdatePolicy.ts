export const ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED = false;
export const ANDROID_STAGED_INSTALL_MIN_VERSION_CODE = 37;
// A plain page avoids older shells intercepting APK and /downloads/ links.
export const ANDROID_BROWSER_DOWNLOAD_PAGE = "https://cputime.cn/download?androidUpdate=1";

export function canUseStagedAndroidUpdate(versionCode: number, stagedInstallSupported: boolean) {
  return versionCode >= ANDROID_STAGED_INSTALL_MIN_VERSION_CODE && stagedInstallSupported;
}

export function shouldPromptAndroidInstallRepair(nativeClient: boolean, versionCode: number) {
  return nativeClient && versionCode >= 21 && versionCode < ANDROID_STAGED_INSTALL_MIN_VERSION_CODE;
}

export function isAndroidUpdateAvailable(
  nativeClient: boolean,
  currentVersionCode: number,
  latestVersionCode: number,
) {
  return nativeClient && currentVersionCode < latestVersionCode;
}
