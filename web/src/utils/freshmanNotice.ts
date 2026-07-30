const FRESHMAN_NOTICE_SEEN_KEY = "cpu-freshman-account-notice-seen-v1";

export function shouldShowFreshmanNotice() {
  try {
    return sessionStorage.getItem(FRESHMAN_NOTICE_SEEN_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markFreshmanNoticeSeen() {
  try {
    sessionStorage.setItem(FRESHMAN_NOTICE_SEEN_KEY, "1");
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}
