import { powerSaveBlocker } from "electron";

// Owned by the main process and driven by worker state, never by renderer polls
// or window visibility. The screen may sleep while a course is running.
export class ZhihuishuBackgroundPower {
  private blocker: number | undefined;
  get active() { return this.blocker !== undefined && powerSaveBlocker.isStarted(this.blocker); }
  setRunning = (running: boolean) => {
    if (running && !this.active) this.blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!running && this.blocker !== undefined) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = undefined;
    }
  };
}
