import type { NextFunction, Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { verifySessionTokenSignature, verifyToken } from "../utils/jwt";

// 全站 CC 兜底：按服务器负载准入，不按 IP 区分访问者（校园网成千上万人共用一个出口）。
// 平时一律放行；只有事件循环明显卡顿或大量请求迟迟拿不到响应时才进入"过载"：
// - 已登录请求按账号限并发与速率，额度远高于正常使用，一个账号占不满整台服务器；
// - 匿名请求按接口分组，每组最多放行到自己平时流量的数倍。洪泛打哪个接口只削那一组的匿名流量，
//   登录、教务和其他接口不受牵连。

export type AdmissionOptions = {
  tickMs: number;
  lagThresholdMs: number;
  pendingThreshold: number;
  enterTicks: number;
  exitTicks: number;
  laneFloorPerSecond: number;
  maxHeadroom: number;
  minHeadroom: number;
  baselineRiseHalfLifeMs: number;
  baselineFallHalfLifeMs: number;
  userPerSecond: number;
  userBurst: number;
  userMaxPending: number;
  maxLanes: number;
  maxUsers: number;
};

export const DEFAULT_ADMISSION_OPTIONS: AdmissionOptions = {
  tickMs: 500,
  lagThresholdMs: 100,
  pendingThreshold: 200,
  enterTicks: 2,
  exitTicks: 10,
  laneFloorPerSecond: 10,
  maxHeadroom: 3,
  minHeadroom: 1,
  // 基线涨得快、落得慢，近似"最近的正常高峰"；只在未过载时更新，攻击流量不会抬高它。
  baselineRiseHalfLifeMs: 2 * 60_000,
  baselineFallHalfLifeMs: 60 * 60_000,
  userPerSecond: 30,
  userBurst: 90,
  userMaxPending: 16,
  maxLanes: 128,
  maxUsers: 50_000,
};

// 服务端回调与探活：来源是支付/消息平台或部署脚本，不能因为过载被拒。
const EXEMPT_PATHS = [
  /^\/api\/(?:health|ready)(?:[/?]|$)/,
];

type Bucket = { tokens: number; updatedAt: number };
type Lane = { arrivals: number; baseline: number; samples: number; bucket: Bucket | null; rejected: number };
type UserState = { pending: number; bucket: Bucket | null };

function take(bucket: Bucket, ratePerSecond: number, burst: number, now: number) {
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.updatedAt) / 1000) * ratePerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export type AdmissionDecision =
  | { admitted: true; release: (status?: number) => void }
  | { admitted: false; status: 429 | 503; retryAfterSeconds: number };

export class AdmissionController {
  readonly options: AdmissionOptions;
  private readonly lanes = new Map<string, Lane>();
  private readonly unrouted: Lane = { arrivals: 0, baseline: 0, samples: 0, bucket: null, rejected: 0 };
  private readonly users = new Map<string, UserState>();
  private pending = 0;
  private overloadedTicks = 0;
  private healthyTicks = 0;
  private headroom: number;
  private userRejected = 0;
  pressure = false;

  constructor(options: Partial<AdmissionOptions> = {}, private readonly log: (message: string) => void = () => undefined) {
    this.options = { ...DEFAULT_ADMISSION_OPTIONS, ...options };
    this.headroom = this.options.maxHeadroom;
  }

  /** 请求所属的匿名分组：/api/<第一段>，其他入口为 /<第一段>；统一小写（Express 路由不区分大小写）。 */
  laneKey(path: string) {
    const api = /^\/api\/([A-Za-z0-9-]{1,40})(?:[/?]|$)/.exec(path);
    if (api) return api[1].toLowerCase();
    const other = /^\/([A-Za-z0-9-]{1,40})(?:[/?]|$)/.exec(path);
    return other ? `/${other[1].toLowerCase()}` : "";
  }

  admit(path: string, identity: string | null, now = Date.now()): AdmissionDecision {
    if (EXEMPT_PATHS.some((pattern) => pattern.test(path))) return { admitted: true, release: () => undefined };
    const options = this.options;

    if (identity) {
      let user = this.users.get(identity);
      if (user) {
        this.users.delete(identity);
      } else {
        user = { pending: 0, bucket: null };
        for (const [key, state] of this.users) {
          if (this.users.size < options.maxUsers) break;
          if (state.pending === 0) this.users.delete(key);
        }
      }
      this.users.set(identity, user);
      if (this.pressure) {
        user.bucket ??= { tokens: options.userBurst, updatedAt: now };
        if (user.pending >= options.userMaxPending || !take(user.bucket, options.userPerSecond, options.userBurst, now)) {
          this.userRejected += 1;
          return { admitted: false, status: 429, retryAfterSeconds: 2 };
        }
      } else {
        user.bucket = null;
      }
      const state = user;
      return this.track(() => {
        state.pending -= 1;
      }, () => {
        state.pending += 1;
      });
    }

    const key = this.laneKey(path);
    const lane = this.lanes.get(key) ?? this.unrouted;
    lane.arrivals += 1;
    if (this.pressure) {
      const limit = Math.max(options.laneFloorPerSecond, lane.baseline) * this.headroom;
      lane.bucket ??= { tokens: limit, updatedAt: now };
      if (!take(lane.bucket, limit, limit, now)) {
        lane.rejected += 1;
        return { admitted: false, status: 503, retryAfterSeconds: 5 };
      }
    } else {
      lane.bucket = null;
    }
    return this.track(() => undefined, () => undefined, key);
  }

  private track(onRelease: () => void, onAcquire: () => void, laneKey?: string) {
    onAcquire();
    this.pending += 1;
    let released = false;
    return {
      admitted: true as const,
      release: (status?: number) => {
        if (released) return;
        released = true;
        this.pending -= 1;
        onRelease();
        // 只为真实存在的接口建分组；乱写的路径都落在同一个"未路由"分组里，无法挤占分组表。
        if (laneKey && status !== undefined && status !== 404 && !this.lanes.has(laneKey) && this.lanes.size < this.options.maxLanes) {
          this.lanes.set(laneKey, { arrivals: 0, baseline: 0, samples: 0, bucket: null, rejected: 0 });
        }
      },
    };
  }

  /** 每个 tick 调用一次；lagMs 为该时段事件循环延迟 p99。 */
  tick(lagMs: number) {
    const options = this.options;
    const overloaded = lagMs > options.lagThresholdMs || this.pending > options.pendingThreshold;
    this.overloadedTicks = overloaded ? this.overloadedTicks + 1 : 0;
    this.healthyTicks = overloaded ? 0 : this.healthyTicks + 1;

    if (!this.pressure && this.overloadedTicks >= options.enterTicks) {
      this.pressure = true;
      this.headroom = options.maxHeadroom;
      this.log(`[admission] overload: lag=${Math.round(lagMs)}ms pending=${this.pending}; shedding excess anonymous traffic per API group`);
    } else if (this.pressure && this.healthyTicks >= options.exitTicks) {
      this.pressure = false;
      this.log(`[admission] recovered: ${this.summary()}`);
      this.resetCounters();
    }
    if (this.pressure) {
      // 仍然过载就逐步收紧，但每组至少保留平时的流量水平。
      this.headroom = overloaded
        ? Math.max(options.minHeadroom, this.headroom * 0.85)
        : Math.min(options.maxHeadroom, this.headroom + 0.1);
    }

    const seconds = options.tickMs / 1000;
    for (const lane of [...this.lanes.values(), this.unrouted]) {
      const rate = lane.arrivals / seconds;
      lane.arrivals = 0;
      if (this.pressure) continue;
      lane.samples += 1;
      const halfLife = rate > lane.baseline ? options.baselineRiseHalfLifeMs : options.baselineFallHalfLifeMs;
      // 冷启动时先用算术平均，尽快得到可用的基线。
      const alpha = Math.max(1 / lane.samples, 1 - Math.pow(0.5, options.tickMs / halfLife));
      lane.baseline += (rate - lane.baseline) * alpha;
    }
  }

  summary() {
    const shed = [...this.lanes.entries(), ["(unrouted)", this.unrouted] as const]
      .filter(([, lane]) => lane.rejected > 0)
      .map(([key, lane]) => `${key}=${lane.rejected}`);
    return `pending=${this.pending} headroom=${this.headroom.toFixed(2)} shedAnonymous{${shed.join(",")}} shedUsers=${this.userRejected}`;
  }

  private resetCounters() {
    for (const lane of [...this.lanes.values(), this.unrouted]) lane.rejected = 0;
    this.userRejected = 0;
  }

  get pendingCount() {
    return this.pending;
  }

  baselineOf(key: string) {
    return this.lanes.get(key)?.baseline ?? this.unrouted.baseline;
  }
}

function requestIdentity(req: Request) {
  try {
    if (req.browserSession?.siteToken) return `u:${verifySessionTokenSignature(req.browserSession.siteToken).userId}`;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return `u:${verifyToken(header.slice(7)).userId}`;
  } catch {
    // 无效或过期的令牌按匿名处理，不能借伪造的 Authorization 头绕过匿名分组。
  }
  return null;
}

export function createAdmissionControl(options: Partial<AdmissionOptions> = {}) {
  const controller = new AdmissionController(options, (message) => console.warn(message));
  // 用短周期定时器的迟到时间衡量事件循环延迟。不用 monitorEventLoopDelay：实测在洪泛把事件循环占满时
  // 它一个样本都采不到，"没有样本"会被误读成"没有延迟"，服务器越卡越不触发保护。
  const PROBE_MS = 20;
  let lastProbe = performance.now();
  let worstLagMs = 0;
  const probe = setInterval(() => {
    const now = performance.now();
    worstLagMs = Math.max(worstLagMs, now - lastProbe - PROBE_MS);
    lastProbe = now;
  }, PROBE_MS);
  probe.unref?.();
  let ticks = 0;
  const timer = setInterval(() => {
    // 探针迟迟没有运行时，等待本身就是延迟。
    const lagMs = Math.max(worstLagMs, performance.now() - lastProbe - PROBE_MS);
    worstLagMs = 0;
    controller.tick(lagMs);
    ticks += 1;
    if (controller.pressure && ticks % Math.max(1, Math.round(10_000 / controller.options.tickMs)) === 0) {
      console.warn(`[admission] under pressure: ${controller.summary()}`);
    }
  }, controller.options.tickMs);
  timer.unref?.();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const decision = controller.admit(req.originalUrl, requestIdentity(req));
    if (!decision.admitted) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.setHeader("Cache-Control", "no-store");
      res.status(decision.status).json(decision.status === 429
        ? { code: 4029, data: null, message: "请求过于频繁，请稍后再试" }
        : { code: 5031, data: null, message: "当前访问人数较多，请稍后重试" });
      return;
    }
    // 以开始写响应头为准释放名额：流式响应（如 AI 助手）开始输出后不再占用"等待中"的计数。
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: Response, ...args: any[]) {
      decision.release(typeof args[0] === "number" ? args[0] : res.statusCode);
      return (writeHead as any).apply(this, args);
    } as typeof res.writeHead;
    res.once("close", () => decision.release(res.headersSent ? res.statusCode : undefined));
    next();
  };
  return { middleware, controller };
}
