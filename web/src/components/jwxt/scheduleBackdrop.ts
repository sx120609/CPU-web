const BACKDROP_KEY = "cpu-schedule-backdrop-v1";

export function readScheduleBackdrop() {
  try {
    return localStorage.getItem(BACKDROP_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeScheduleBackdrop(value?: string | null) {
  try {
    const next = (value ?? "").trim();
    if (next) localStorage.setItem(BACKDROP_KEY, next);
    else localStorage.removeItem(BACKDROP_KEY);
    return true;
  } catch {
    return false;
  }
}

export function scheduleBackdropCssVars(value?: string | null): Record<string, string> {
  const next = (value ?? "").trim();
  return {
    "--schedule-custom-bg-image": next ? `url("${next}")` : "none",
  };
}
