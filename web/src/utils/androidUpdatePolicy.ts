export const ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED = false;

export function isAndroidUpdateAvailable(
  nativeClient: boolean,
  currentVersionCode: number,
  latestVersionCode: number,
) {
  return nativeClient && currentVersionCode < latestVersionCode;
}
