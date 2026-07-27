import {
  HEALTHY_PROBE_INTERVAL_SEC,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC
} from "./constants";

export const configuredIntervalMs = (seconds: number): number =>
  Math.min(Math.max(seconds, MIN_INTERVAL_SEC), MAX_INTERVAL_SEC) * 1000;

// 用户设置的是掉线检测与重连的基础间隔。网络已经确认正常后至少等 30 秒再查，
// 但尊重用户主动设置的更长间隔。
export const healthyProbeDelayMs = (seconds: number): number =>
  Math.max(configuredIntervalMs(seconds), HEALTHY_PROBE_INTERVAL_SEC * 1000);
