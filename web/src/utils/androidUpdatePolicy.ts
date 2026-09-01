export const ANDROID_APP_UPDATE_CHECK_ENABLED = false;

export function isAndroidUpdateAvailable(
  nativeClient: boolean,
  currentVersionCode: number,
  latestVersionCode: number,
) {
  return ANDROID_APP_UPDATE_CHECK_ENABLED
    && nativeClient
    && currentVersionCode < latestVersionCode;
}

export function canOpenAndroidUpdatePrompt(kind: "app" | "widget" | "install") {
  return kind === "install" || ANDROID_APP_UPDATE_CHECK_ENABLED;
}
