import { readFileSync } from "node:fs";

export function createQqBotDeploymentDrain(options: {
  requested: () => boolean;
  pending: () => number;
  connected: () => boolean;
  close: () => void;
  now?: () => number;
  quietMs?: number;
}) {
  const now = options.now || Date.now;
  let lastActivity = now();
  let closing = false;
  return {
    activity() { lastActivity = now(); },
    closing: () => closing,
    tick() {
      if (closing || !options.requested()) { lastActivity = now(); return; }
      if (options.pending() > 0) { lastActivity = now(); return; }
      if (now() - lastActivity < (options.quietMs ?? 5000)) return;
      closing = true;
      if (options.connected()) options.close();
    },
  };
}

export function qqBotDrainRequested(file = process.env.CPU_WEB_QQBOT_DRAIN_FILE, release = process.env.CPU_WEB_RELEASE_ID) {
  if (!file || !release) return false;
  try {
    const request = JSON.parse(readFileSync(file, "utf8"));
    return request.release === release && typeof request.successor === "string" && request.successor.length > 0 && request.successor !== release;
  } catch { return false; }
}
