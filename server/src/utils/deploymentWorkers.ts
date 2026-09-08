import { readFileSync } from "node:fs";

export function ownsBackgroundWork(marker: string | undefined, release: string | undefined): boolean {
  if (!marker) return true;
  if (!release) return false;
  try { return readFileSync(marker, "utf8").trim() === release; }
  catch { return false; }
}

export function waitForBackgroundOwnership(start: () => void) {
  const marker = process.env.CPU_WEB_BACKGROUND_MARKER;
  const release = process.env.CPU_WEB_RELEASE_ID;
  const tryStart = () => {
    if (!ownsBackgroundWork(marker, release)) return false;
    start();
    return true;
  };
  if (tryStart()) return;
  const timer = setInterval(() => { if (tryStart()) clearInterval(timer); }, 500);
  timer.unref();
}
