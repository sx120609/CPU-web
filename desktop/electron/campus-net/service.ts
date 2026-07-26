import { Notification } from "electron";
import {
  CampusMode,
  Carrier,
  FAILURES_BEFORE_PAUSE,
  MAX_BACKOFF_MS,
  MIN_INTERVAL_SEC,
  MAX_INTERVAL_SEC,
  REQUEST_TIMEOUT_MS
} from "./constants";
import { clearCampusCredential, readCampusCredential, writeCampusCredential } from "./credential-store";
import { campusLog } from "./log";
import { httpGetText } from "./net";
import { performLogin } from "./login";
import { isValidStudentId, ResolvedMode } from "./protocol";

export type CampusNetSettings = {
  enabled: boolean;
  autoReconnect: boolean;
  mode: CampusMode;
  carrier: Carrier;
  intervalSec: number;
  testUrl: string;
  testCode: string;
};

export type CampusStatus = "unknown" | "online" | "offline" | "authenticating" | "paused" | "disabled";

export type CampusState = {
  status: CampusStatus;
  message: string;
  mode?: ResolvedMode;
  localIp?: string;
  hasCredential: boolean;
  studentId: string;
  lastCheckedAt?: number;
  consecutiveFailures: number;
};

const STATUS_LABEL: Record<CampusStatus, string> = {
  unknown: "尚未检测",
  online: "已连接",
  offline: "未认证",
  authenticating: "正在认证",
  paused: "已暂停自动重连",
  disabled: "未启用"
};

export class CampusNetService {
  private settings: CampusNetSettings;
  private state: CampusState = { status: "disabled", message: STATUS_LABEL.disabled, hasCredential: false, studentId: "", consecutiveFailures: 0 };
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private stopped = true;
  private listener: ((state: CampusState) => void) | undefined;

  constructor(settings: CampusNetSettings) {
    this.settings = settings;
  }

  onChange(listener: (state: CampusState) => void): void {
    this.listener = listener;
  }

  getState(): CampusState {
    return { ...this.state };
  }

  private emit(patch: Partial<CampusState>): void {
    this.state = { ...this.state, ...patch };
    this.listener?.(this.getState());
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    } catch {
      // 通知失败不影响主流程
    }
  }

  async refreshCredentialState(): Promise<void> {
    const credential = await readCampusCredential();
    this.emit({ hasCredential: Boolean(credential), studentId: credential?.studentId ?? "" });
  }

  async saveCredential(studentId: unknown, password: unknown): Promise<CampusState> {
    if (typeof studentId !== "string" || typeof password !== "string") throw new Error("学号或密码无效");
    const trimmed = studentId.trim();
    if (!isValidStudentId(trimmed)) throw new Error("学号只能包含字母和数字");
    if (!password) throw new Error("密码不能为空");
    await writeCampusCredential({ studentId: trimmed, password });
    campusLog("info", `已保存校园网凭据（学号 ${trimmed}）`);
    // 换了凭据就把熔断解掉，用户显然想重试
    this.emit({ hasCredential: true, studentId: trimmed, consecutiveFailures: 0 });
    if (this.state.status === "paused") this.emit({ status: "unknown", message: STATUS_LABEL.unknown });
    this.reschedule(0);
    return this.getState();
  }

  async clearCredential(): Promise<CampusState> {
    await clearCampusCredential();
    campusLog("info", "已清除校园网凭据");
    this.emit({ hasCredential: false, studentId: "", consecutiveFailures: 0, status: "unknown", message: STATUS_LABEL.unknown });
    return this.getState();
  }

  updateSettings(patch: Partial<CampusNetSettings>): CampusNetSettings {
    this.settings = { ...this.settings, ...patch };
    if (!this.settings.enabled) {
      this.stop();
      this.emit({ status: "disabled", message: STATUS_LABEL.disabled });
    } else if (this.stopped) {
      void this.start();
    } else {
      this.reschedule(0);
    }
    return this.settings;
  }

  // 探测必须跟随重定向并比对正文：captive portal 会把请求劫持成一个 200 的门户页，
  // 只看状态码是判不出"没认证"的。
  private async probeOnline(): Promise<boolean> {
    try {
      const url = `${this.settings.testUrl}${this.settings.testUrl.includes("?") ? "&" : "?"}_=${Date.now()}`;
      const response = await httpGetText(url, REQUEST_TIMEOUT_MS);
      if (response.status < 200 || response.status >= 300) return false;
      return response.body.includes(this.settings.testCode);
    } catch {
      return false;
    }
  }

  private intervalMs(): number {
    const seconds = Math.min(Math.max(this.settings.intervalSec, MIN_INTERVAL_SEC), MAX_INTERVAL_SEC);
    return seconds * 1000;
  }

  private reschedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped || !this.settings.enabled) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private pause(reason: string): void {
    this.emit({ status: "paused", message: reason });
    campusLog("warn", `已暂停自动重连：${reason}`);
    this.notify("校园网自动重连已暂停", `${reason}。请检查学号密码后手动重试。`);
    if (this.timer) clearTimeout(this.timer);
  }

  private async tick(): Promise<void> {
    // 原版的定时器是 async void，不防重入：5 秒周期配 5 秒超时，弱网下请求会叠起来
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      const online = await this.probeOnline();
      this.emit({ lastCheckedAt: Date.now() });
      if (online) {
        if (this.state.status !== "online") campusLog("info", "网络已连通");
        this.emit({ status: "online", message: STATUS_LABEL.online, consecutiveFailures: 0 });
        this.reschedule(this.intervalMs());
        return;
      }
      this.emit({ status: "offline", message: STATUS_LABEL.offline });
      if (!this.settings.autoReconnect || !this.state.hasCredential) {
        this.reschedule(this.intervalMs());
        return;
      }
      await this.attemptLogin(true);
    } finally {
      this.inFlight = false;
    }
  }

  private async attemptLogin(scheduleNext: boolean): Promise<CampusState> {
    this.emit({ status: "authenticating", message: STATUS_LABEL.authenticating });
    const result = await performLogin({
      mode: this.settings.mode,
      carrier: this.settings.carrier
    });

    if (result.ok) {
      this.emit({
        status: "online",
        message: result.message,
        mode: result.mode,
        localIp: result.localIp,
        consecutiveFailures: 0,
        lastCheckedAt: Date.now()
      });
      if (scheduleNext) this.reschedule(this.intervalMs());
      return this.getState();
    }

    const failures = this.state.consecutiveFailures + 1;
    this.emit({ status: "offline", message: result.message, mode: result.mode, localIp: result.localIp, consecutiveFailures: failures });

    // 凭据类错误立刻停手：用错误密码每隔几秒撞一次校园网认证服务器，有被学校侧封锁的实际风险
    if (result.fatal) {
      this.pause(result.message);
      return this.getState();
    }
    if (failures >= FAILURES_BEFORE_PAUSE) {
      this.pause(`连续 ${failures} 次认证失败：${result.message}`);
      return this.getState();
    }
    if (scheduleNext) {
      // 指数退避 + 抖动，避免一栋楼的客户端同时重试
      const backoff = Math.min(this.intervalMs() * 2 ** failures, MAX_BACKOFF_MS);
      this.reschedule(backoff + Math.floor(Math.random() * 3000));
    }
    return this.getState();
  }

  // 用户手动点"立即登录"：清掉熔断计数，无论当前是不是 paused
  async loginNow(): Promise<CampusState> {
    if (this.inFlight) throw new Error("正在处理上一次请求，请稍候");
    this.inFlight = true;
    try {
      this.emit({ consecutiveFailures: 0 });
      const state = await this.attemptLogin(this.settings.enabled);
      return state;
    } finally {
      this.inFlight = false;
    }
  }

  async checkNow(): Promise<CampusState> {
    if (this.inFlight) return this.getState();
    this.reschedule(0);
    return this.getState();
  }

  async start(): Promise<void> {
    await this.refreshCredentialState();
    if (!this.settings.enabled) {
      this.stopped = true;
      this.emit({ status: "disabled", message: STATUS_LABEL.disabled });
      return;
    }
    this.stopped = false;
    campusLog("info", "校园网自动连接已启动");
    this.emit({ status: "unknown", message: STATUS_LABEL.unknown });
    this.reschedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
