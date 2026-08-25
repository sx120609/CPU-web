import { topicApi } from "@/api/topic";

const STORAGE_KEY = "cpu-topic-impression-views-v1";
const MAX_STORED_TOPICS = 600;
const BATCH_SIZE = 40;
const FLUSH_DELAY_MS = 220;

const knownViews = new Map<number, number>();
const pending = new Map<number, Array<(viewCount: number | null) => void>>();
let hydrated = false;
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed.slice(-MAX_STORED_TOPICS)) {
      const id = Number(entry?.[0]);
      const viewCount = Number(entry?.[1]);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(viewCount) && viewCount >= 0) {
        knownViews.set(id, Math.floor(viewCount));
      }
    }
  } catch {
    // sessionStorage 不可用时只在当前模块生命周期内去重。
  }
}

function persist() {
  try {
    const entries = Array.from(knownViews.entries()).slice(-MAX_STORED_TOPICS);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 浏览量上报不应影响正常浏览。
  }
}

export function knownTopicViewCount(topicId: number, fallback = 0) {
  hydrate();
  return Math.max(0, Number(fallback) || 0, knownViews.get(topicId) || 0);
}

export function hasTrackedTopicImpression(topicId: number) {
  hydrate();
  return knownViews.has(topicId);
}

export function rememberTopicViewCount(topicId: number, viewCount: number) {
  hydrate();
  if (!Number.isInteger(topicId) || topicId <= 0 || !Number.isFinite(viewCount) || viewCount < 0) return;
  const normalized = Math.floor(viewCount);
  const previous = knownViews.get(topicId) || 0;
  knownViews.delete(topicId);
  knownViews.set(topicId, Math.max(previous, normalized));
  persist();
}

function scheduleFlush() {
  if (flushTimer !== null || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush() {
  if (flushing) return;
  const ids = Array.from(pending.keys()).slice(0, BATCH_SIZE);
  if (!ids.length) return;
  flushing = true;
  try {
    const result = await topicApi.recordImpressions(ids);
    const views = new Map(result.views.map((item) => [item.id, item.viewCount]));
    for (const id of ids) {
      const callbacks = pending.get(id) || [];
      pending.delete(id);
      const viewCount = views.get(id);
      if (typeof viewCount === "number") rememberTopicViewCount(id, viewCount);
      callbacks.forEach((resolve) => resolve(typeof viewCount === "number" ? viewCount : null));
    }
  } catch {
    for (const id of ids) {
      const callbacks = pending.get(id) || [];
      pending.delete(id);
      callbacks.forEach((resolve) => resolve(null));
    }
  } finally {
    flushing = false;
    if (pending.size) scheduleFlush();
  }
}

export function queueTopicImpression(topicId: number) {
  hydrate();
  if (!Number.isInteger(topicId) || topicId <= 0 || knownViews.has(topicId)) {
    return Promise.resolve<number | null>(null);
  }
  return new Promise<number | null>((resolve) => {
    const callbacks = pending.get(topicId) || [];
    callbacks.push(resolve);
    pending.set(topicId, callbacks);
    scheduleFlush();
  });
}
