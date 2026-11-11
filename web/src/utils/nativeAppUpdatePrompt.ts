/**
 * The Web prompt that tells iOS and HarmonyOS app users a newer version is in
 * the store. Builds that prompt on their own (over the native timetable, where
 * a Web dialog is hidden) say so, and the page then stays quiet.
 */
export type NativeUpdatePlatform = "ios" | "harmony";

export type NativeUpdateSnooze = { version: string; at: number };

export const NATIVE_UPDATE_SNOOZE_KEY = "cpu-native-update-snoozed";
/** "稍后" waits this long before the same version is announced again. */
export const NATIVE_UPDATE_REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** iOS builds that prompt natively carry their version in the user agent. */
export function iosNativeAppVersion(ua: string) {
  return /\bCPUWebIOSAppVersion\/(\d+(?:\.\d+){0,3})\b/i.exec(ua || "")?.[1] ?? null;
}

export function harmonyPromptsNatively(bridge: unknown) {
  const shell = bridge as { supportsNativeUpdatePrompt?: () => boolean } | null | undefined;
  try {
    return typeof shell?.supportsNativeUpdatePrompt === "function" && shell.supportsNativeUpdatePrompt() === true;
  } catch {
    return false;
  }
}

/** Which store the page should announce updates for, or null when the app does it itself. */
export function nativeUpdatePlatform(isIos: boolean, isHarmony: boolean, ua: string, harmonyBridge: unknown): NativeUpdatePlatform | null {
  if (isIos) return iosNativeAppVersion(ua) ? null : "ios";
  if (isHarmony) return harmonyPromptsNatively(harmonyBridge) ? null : "harmony";
  return null;
}

export function parseNativeUpdateSnooze(raw: string | null): NativeUpdateSnooze | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NativeUpdateSnooze>;
    return typeof value.version === "string" && Number.isFinite(value.at) ? { version: value.version, at: Number(value.at) } : null;
  } catch {
    return null;
  }
}

/** A version is announced until the user answers, then again every few days while it is still missing. */
export function shouldAnnounceNativeUpdate(version: string, snooze: NativeUpdateSnooze | null, now: number) {
  if (!snooze || snooze.version !== version) return true;
  return now - snooze.at >= NATIVE_UPDATE_REMIND_AFTER_MS || now < snooze.at;
}
