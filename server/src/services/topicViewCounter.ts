import { prisma } from "../prisma";

// 帖子浏览数先在进程内累加，每隔几秒合并成少量 UPDATE。原来每次浏览一条 UPDATE，
// 洪泛同一帖子时所有请求都在争同一行的行锁；现在无论多少次访问，每个周期每个帖子最多写一次。
const FLUSH_INTERVAL_MS = 2_000;
const MAX_PENDING_TOPICS = 5_000;

const pending = new Map<number, number>();
let flushingBatch: Map<number, number> | null = null;
let flushing: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushTopicViews();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

export function recordTopicView(topicId: number, count = 1) {
  pending.set(topicId, (pending.get(topicId) ?? 0) + count);
  if (pending.size >= MAX_PENDING_TOPICS) void flushTopicViews();
  else scheduleFlush();
}

/** 已记录但尚未写入数据库的浏览数，用于在数据库读数上补齐展示值。 */
export function unflushedTopicViews(topicId: number) {
  return (pending.get(topicId) ?? 0) + (flushingBatch?.get(topicId) ?? 0);
}

export function flushTopicViews(): Promise<boolean> {
  if (flushing) return flushing;
  if (!pending.size) return Promise.resolve(true);
  const batch = new Map(pending);
  pending.clear();
  flushingBatch = batch;
  // 同样增量的帖子合并成一条 updateMany。
  const byCount = new Map<number, number[]>();
  for (const [topicId, count] of batch) {
    const ids = byCount.get(count) ?? [];
    ids.push(topicId);
    byCount.set(count, ids);
  }
  flushing = (async () => {
    let succeeded = true;
    for (const [count, ids] of byCount) {
      try {
        await prisma.topic.updateMany({
          where: { id: { in: ids }, hidden: false },
          data: { viewCount: { increment: count } },
        });
      } catch {
        succeeded = false;
        // 数据库暂时不可用时放回队列下次再写；队列已满就放弃这部分计数，浏览数不值得占满内存。
        for (const topicId of ids) {
          if (pending.size >= MAX_PENDING_TOPICS && !pending.has(topicId)) continue;
          pending.set(topicId, (pending.get(topicId) ?? 0) + count);
        }
      } finally {
        for (const topicId of ids) batch.delete(topicId);
      }
    }
    return succeeded;
  })().finally(() => {
    flushing = null;
    flushingBatch = null;
    if (pending.size) scheduleFlush();
  });
  return flushing;
}

/** Call after the HTTP server has stopped accepting and drained requests. */
export async function drainTopicViews(maxFailures = 3): Promise<void> {
  if (!Number.isInteger(maxFailures) || maxFailures < 1) throw new Error("Invalid topic view drain retry limit");
  if (timer) clearTimeout(timer);
  timer = null;
  let failures = 0;
  try {
    while (flushing || pending.size) {
      if (!await flushTopicViews() && ++failures >= maxFailures) {
        throw new Error(`Topic view drain failed with ${pending.size} pending topics`);
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    timer = null;
  }
}
