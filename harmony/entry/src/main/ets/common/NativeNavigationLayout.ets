export const NATIVE_TAB_BAR_HEIGHT: number = 56;

export function nativeNavigationBottomInset(systemInsetVp: number): number {
  // The AppGallery report requires at least 28vp of navigation clearance.
  return Math.max(28, Number.isFinite(systemInsetVp) ? systemInsetVp : 0) + 8;
}

export function nativeNavigationClearance(systemInsetVp: number): number {
  return NATIVE_TAB_BAR_HEIGHT + nativeNavigationBottomInset(systemInsetVp) + 8;
}
