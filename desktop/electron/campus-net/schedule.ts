import {
  HEALTHY_PROBE_INTERVAL_SEC,
  MAX_BACKOFF_MS,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC
} from "./constants";

export const configuredIntervalMs = (seconds: number): number =>
  Math.min(Math.max(seconds, MIN_INTERVAL_SEC), MAX_INTERVAL_SEC) * 1000;

// 用户设置的是掉线检测与重连的基础间隔。网络已经确认正常后至少等 30 秒再查，
// 但尊重用户主动设置的更长间隔。
export const healthyProbeDelayMs = (seconds: number): number =>
  Math.max(configuredIntervalMs(seconds), HEALTHY_PROBE_INTERVAL_SEC * 1000);

// 临时认证失败永不熔断：指数退避到上限后保持低频探测，学校维护、时间策略
// 或认证服务器故障解除后即可自动恢复。限制指数避免长期离线后计算溢出。
export const retryBackoffDelayMs = (seconds: number, consecutiveFailures: number): number => {
  const exponent = Math.min(Math.max(Math.trunc(consecutiveFailures), 0), 20);
  return Math.min(configuredIntervalMs(seconds) * 2 ** exponent, MAX_BACKOFF_MS);
};
