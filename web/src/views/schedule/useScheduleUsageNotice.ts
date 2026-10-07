import { onScopeDispose, ref, watch } from "vue";

type NoticeAccount = { id: number; username: string };
const acknowledgedThisSession = new Set<string>();
const READ_TIME_MS = 3000;

export function useScheduleUsageNotice(account: () => NoticeAccount | null) {
  const visible = ref(false);
  const secondsLeft = ref(3);
  let accountKey = "";
  let unlockAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stopTimer() {
    clearInterval(timer);
    timer = undefined;
  }

  function wasAcknowledged(key: string) {
    if (acknowledgedThisSession.has(key)) return true;
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  watch(() => {
    const user = account();
    return user?.username.trim().startsWith("202026")
      ? `cpu-schedule-usage-notice-202026-v1:${user.id}`
      : "";
  }, (key) => {
    const alreadyOpen = visible.value && unlockAt !== null;
    stopTimer();
    accountKey = key;
    unlockAt = null;
    secondsLeft.value = 3;
    visible.value = Boolean(key && !wasAcknowledged(key));
    // A visible dialog does not emit `opened` again when the account changes.
    if (visible.value && alreadyOpen) beginReading();
  }, { immediate: true, flush: "sync" });

  // Count only after the dialog has finished opening, so its entrance animation
  // does not consume any of the required reading time.
  function beginReading() {
    if (!visible.value || unlockAt !== null) return;
    unlockAt = Date.now() + READ_TIME_MS;
    timer = setInterval(() => {
      secondsLeft.value = Math.max(0, Math.ceil((unlockAt! - Date.now()) / 1000));
      if (secondsLeft.value === 0) stopTimer();
    }, 100);
  }

  function acknowledge() {
    if (!visible.value || !accountKey || unlockAt === null || Date.now() < unlockAt) return;
    acknowledgedThisSession.add(accountKey);
    try {
      localStorage.setItem(accountKey, "1");
    } catch {
      // Keep the in-memory acknowledgement when browser storage is unavailable.
    }
    stopTimer();
    visible.value = false;
  }

  onScopeDispose(stopTimer);

  return { visible, secondsLeft, beginReading, acknowledge };
}
