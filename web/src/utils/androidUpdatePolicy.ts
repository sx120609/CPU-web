export const ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED = true;
export const ANDROID_STAGED_INSTALL_MIN_VERSION_CODE = 37;
// A plain page avoids older shells intercepting APK and /downloads/ links.
export const ANDROID_BROWSER_DOWNLOAD_PAGE = "https://cputime.cn/download?androidUpdate=1";

export type AndroidUpdateRequirement = {
  minimumVersionCode: number;
  startsAt: string;
  deadlineAt: string;
  message: string;
};

export function androidUpdateRequirementState(
  nativeClient: boolean,
  currentVersionCode: number,
  requirement: AndroidUpdateRequirement | undefined,
  now: number,
): "none" | "grace" | "required" {
  if (!nativeClient || !requirement || currentVersionCode >= requirement.minimumVersionCode) return "none";
  if (now < Date.parse(requirement.startsAt)) return "none";
  return now >= Date.parse(requirement.deadlineAt) ? "required" : "grace";
}

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

export function isAndroidUpdateAvailable(
  nativeClient: boolean,
  currentVersionCode: number,
  latestVersionCode: number,
) {
  return nativeClient && currentVersionCode < latestVersionCode;
}
