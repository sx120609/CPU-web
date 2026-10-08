// Pure form-factor classifier shared by the browser binding (formFactor.ts), clientInfo and tests.
// It must stay free of imports and globals so tests and native-shell checks can run it in a sandbox.

/** The phone switch every page already uses; it is unchanged for every device. */
export const PHONE_MAX_QUERY = "(max-width: 768px)";
/** Touch tablets narrower than this get the phone design, because the desktop pages need 1024 px. */
export const TABLET_COMPACT_QUERY = "(max-width: 1023px)";
/** Screens whose short side reaches this are tablets; every current phone stays below 500. */
export const TABLET_MIN_SHORT_SIDE = 600;
export const COARSE_POINTER_QUERY = "(pointer: coarse)";
export const FINE_HOVER_QUERY = "(hover: hover) and (pointer: fine)";
export const PORTRAIT_QUERY = "(orientation: portrait)";

export type FormFactorDevice = "phone" | "tablet" | "desktop";
export type FormFactorLayout = "compact" | "expanded";
export type FormFactorOrientation = "portrait" | "landscape";
export type FormFactorShell =
  | "desktop-native"
  | "flutter"
  | "ios-native"
  | "android-native"
  | "harmony-native"
  | "ios-legacy"
  | "android-legacy"
  | "harmony-legacy"
  | "standalone"
  | "browser";

export type FormFactorEnv = {
  userAgent: string;
  maxTouchPoints: number;
  /** Device size from `screen`; Split View, Stage Manager and rotation on iOS do not change its short side. */
  screenWidth: number;
  screenHeight: number;
  /** Fallback for the media results below when matchMedia is unavailable. */
  viewportWidth: number;
  viewportHeight?: number;
  coarsePointer: boolean;
  fineHover: boolean;
  /** `PHONE_MAX_QUERY` result; measured like CSS so JS and stylesheets switch at the same pixel. */
  phoneWidth?: boolean;
  /** `TABLET_COMPACT_QUERY` result. */
  tabletCompactWidth?: boolean;
  portrait?: boolean;
  /** Electron injects `window.CPUDesktop`; the UA token is checked here as well. */
  electron?: boolean;
  /** isFlutterNativeShell(): the UA token, `?shell=flutter` or the remembered session flag. */
  flutterShell?: boolean;
  standalone?: boolean;
};

export type FormFactor = {
  appleTouch: boolean;
  isIpad: boolean;
  touchPrimary: boolean;
  canHover: boolean;
  device: FormFactorDevice;
  compact: boolean;
  layout: FormFactorLayout;
  orientation: FormFactorOrientation;
  shell: FormFactorShell;
  /** The native shell draws the header and tab bar (exactly MainLayout's former `useNativeShell`). */
  nativeChrome: boolean;
};

/** iPhone, iPod and iPad, including desktop-class iPad Safari that reports a Mac UA with touch points. */
export function isAppleTouchUserAgent(userAgent: string, maxTouchPoints: number) {
  const ua = userAgent || "";
  return /\b(iPhone|iPad|iPod)\b/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
}

/** An iPhone in desktop-site mode also reports a Mac UA with touch points; its short side stays below 600. */
export function isIpadUserAgent(userAgent: string, maxTouchPoints: number, shortSide: number) {
  const ua = userAgent || "";
  if (/\biPad\b/i.test(ua)) return true;
  return isAppleTouchUserAgent(ua, maxTouchPoints)
    && !/iPhone|iPod/i.test(ua)
    && shortSide >= TABLET_MIN_SHORT_SIDE;
}

/** Shell names come from UA tokens only, so `?client=` overrides never change the layout. */
export function detectFormFactorShell(userAgent: string, options: { electron?: boolean; flutterShell?: boolean; standalone?: boolean } = {}): FormFactorShell {
  const ua = (userAgent || "").toLowerCase();
  if (options.electron || ua.includes("cpuwebdesktopapp")) return "desktop-native";
  if (options.flutterShell || ua.includes("cpuwebflutterapp")) return "flutter";
  const harmony = ua.includes("cpuwebharmonyapp");
  const android = ua.includes("cpuwebscheduleapp");
  if (ua.includes("cputimenative/")) {
    if (harmony) return "harmony-native";
    if (android) return "android-native";
    return "ios-native";
  }
  if (ua.includes("cpuwebiosapp")) return "ios-legacy";
  if (android) return "android-legacy";
  if (harmony) return "harmony-legacy";
  if (options.standalone) return "standalone";
  return "browser";
}

export function classifyFormFactor(env: FormFactorEnv): FormFactor {
  const ua = env.userAgent || "";
  const touchPoints = Number(env.maxTouchPoints) || 0;
  const electron = Boolean(env.electron) || /CPUWebDesktopApp/i.test(ua);
  const flutterShell = Boolean(env.flutterShell) || /CPUWebFlutterApp/i.test(ua);
  const screenShortSide = Math.min(Number(env.screenWidth) || 0, Number(env.screenHeight) || 0);
  const shortSide = screenShortSide > 0 ? screenShortSide : Number(env.viewportWidth) || 0;

  const appleTouch = isAppleTouchUserAgent(ua, touchPoints);
  // A bare maxTouchPoints or (hover: none) would also catch touchscreen laptops driven by a mouse.
  const touchPrimary = !electron && (env.coarsePointer || appleTouch);
  const canHover = env.fineHover && !touchPrimary;
  const device: FormFactorDevice = electron || !touchPrimary
    ? "desktop"
    : shortSide >= TABLET_MIN_SHORT_SIDE ? "tablet" : "phone";
  const nativeChrome = /CPUTimeNative\//i.test(ua) || flutterShell;
  const viewportWidth = Number(env.viewportWidth) || 0;
  const phoneWidth = env.phoneWidth ?? (viewportWidth > 0 && viewportWidth <= 768);
  const tabletCompactWidth = env.tabletCompactWidth ?? (viewportWidth > 0 && viewportWidth <= 1023);
  const compact = phoneWidth || nativeChrome || (device === "tablet" && tabletCompactWidth);
  const viewportHeight = Number(env.viewportHeight) || 0;
  const portrait = env.portrait ?? viewportHeight >= viewportWidth;

  return {
    appleTouch,
    isIpad: isIpadUserAgent(ua, touchPoints, shortSide),
    touchPrimary,
    canHover,
    device,
    compact,
    layout: compact ? "compact" : "expanded",
    orientation: portrait ? "portrait" : "landscape",
    shell: detectFormFactorShell(ua, { electron, flutterShell, standalone: env.standalone }),
    nativeChrome,
  };
}

export function sameFormFactor(a: FormFactor, b: FormFactor) {
  return a.appleTouch === b.appleTouch
    && a.isIpad === b.isIpad
    && a.touchPrimary === b.touchPrimary
    && a.canHover === b.canHover
    && a.device === b.device
    && a.compact === b.compact
    && a.orientation === b.orientation
    && a.shell === b.shell
    && a.nativeChrome === b.nativeChrome;
}
