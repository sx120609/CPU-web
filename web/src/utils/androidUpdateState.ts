export type AndroidUpdatePhase = "idle" | "downloading" | "paused" | "validating" | "ready" | "permission" | "installing" | "failed";
export type AndroidUpdateState = { phase: AndroidUpdatePhase; message: string; fileName: string; progress: number; totalBytes: number; errorCode: string };
export function parseAndroidUpdateState(raw: string): AndroidUpdateState {
  const idle: AndroidUpdateState = { phase: "idle", message: "", fileName: "", progress: 0, totalBytes: 0, errorCode: "" };
  try {
    const value = JSON.parse(raw);
    if (!value || !["idle", "downloading", "paused", "validating", "ready", "permission", "installing", "failed"].includes(value.phase)) return idle;
    const progress = Number(value.progress);
    return {
      phase: value.phase,
      message: typeof value.message === "string" ? value.message : "",
      fileName: typeof value.fileName === "string" ? value.fileName : "",
      progress: ["ready", "permission", "installing"].includes(value.phase) ? 100 : Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
      totalBytes: Math.max(0, Number(value.totalBytes) || 0),
      errorCode: typeof value.errorCode === "string" ? value.errorCode : "",
    };
  } catch { return idle; }
}
