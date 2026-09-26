import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_QQBOT_LOG_RETENTION_DAYS = 30;
// 投递去重依赖 notification 日志，永久保留。
const RETAINED_QQBOT_EVENT_TYPE = "notification";
export const LOG_RETENTION_BATCH_SIZE = 5_000;
export const LOG_RETENTION_MAX_BATCHES_PER_RUN = 20;
let sweeperStarted = false;

type PruneOptions = { batchSize?: number; maxBatches?: number };

export function qqBotLogRetentionDays(value = process.env.QQBOT_LOG_RETENTION_DAYS) {
  const days = Number(value);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : DEFAULT_QQBOT_LOG_RETENTION_DAYS;
}

/**
 * 分批删除超过保留期的 QQBot 消息日志。逐个事件类型走 (eventType, createdAt) 索引，
 * 每批只删一小段并限制单次运行总量，积压较多时由后续运行继续，避免长时间锁表。
 */
export async function pruneQqBotMessageLogs(
  now = new Date(),
  retentionDays = qqBotLogRetentionDays(),
  { batchSize = LOG_RETENTION_BATCH_SIZE, maxBatches = LOG_RETENTION_MAX_BATCHES_PER_RUN }: PruneOptions = {},
) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let deleted = 0;
  let batches = 0;
  let previousEventType: string | null = null;
  while (batches < maxBatches) {
    // 按索引顺序跳到下一个事件类型，避免对整表做 DISTINCT。
    const next: { eventType: string } | null = await prisma.qqBotMessageLog.findFirst({
      where: previousEventType === null ? {} : { eventType: { gt: previousEventType } },
      orderBy: { eventType: "asc" },
      select: { eventType: true },
    });
    if (!next) break;
    const eventType: string = next.eventType;
    previousEventType = eventType;
    if (eventType === RETAINED_QQBOT_EVENT_TYPE) continue;
    while (batches < maxBatches) {
      const rows = await prisma.qqBotMessageLog.findMany({
        where: { eventType, createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
        select: { id: true },
      });
      if (!rows.length) break;
      batches += 1;
      const result = await prisma.qqBotMessageLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
      deleted += result.count;
      if (rows.length < batchSize) break;
    }
  }
  return { deleted, batches };
}

/** 分批删除已过期的持久化运行时会话（读取时本就视为不存在）。 */
export async function pruneExpiredRuntimeSessions(
  now = new Date(),
  { batchSize = LOG_RETENTION_BATCH_SIZE, maxBatches = LOG_RETENTION_MAX_BATCHES_PER_RUN }: PruneOptions = {},
) {
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const rows = await prisma.runtimeSession.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: batchSize,
      select: { key: true },
    });
    if (!rows.length) break;
    batches += 1;
    // 删除时再次校验过期时间，不误删刚被续期的会话。
    const result = await prisma.runtimeSession.deleteMany({
      where: { key: { in: rows.map((row) => row.key) }, expiresAt: { lte: now } },
    });
    deleted += result.count;
    if (rows.length < batchSize) break;
  }
  return { deleted, batches };
}

export async function runLogRetentionSweep(now = new Date()) {
  const qqBotLogs = await pruneQqBotMessageLogs(now).catch((error) => {
    console.warn("[log-retention] QQBot message log prune failed", error);
    return null;
  });
  const runtimeSessions = await pruneExpiredRuntimeSessions(now).catch((error) => {
    console.warn("[log-retention] runtime session prune failed", error);
    return null;
  });
  return { qqBotLogs, runtimeSessions };
}

export function startLogRetentionSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const tick = () => {
    runWithDistributedLock("log-retention:sweep", SWEEP_LOCK_TTL_MS, () => runLogRetentionSweep()).catch((error) => {
      console.warn("[log-retention] sweep failed", error);
    });
  };
  // 避开发布切换时的启动高峰。
  setTimeout(tick, 5 * 60_000).unref?.();
  setInterval(tick, SWEEP_INTERVAL_MS).unref?.();
}
