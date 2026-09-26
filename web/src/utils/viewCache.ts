interface ViewCacheEnvelope<T> {
  version: number;
  savedAt: number;
  data: T;
}

const VIEW_CACHE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readViewCache<T>(
  key: string,
  validate: (value: unknown) => value is T,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw) as Partial<ViewCacheEnvelope<unknown>>;
    if (
      envelope.version !== VIEW_CACHE_VERSION
      || typeof envelope.savedAt !== "number"
      || Date.now() - envelope.savedAt > maxAgeMs
      || !validate(envelope.data)
    ) {
      localStorage.removeItem(key);
      return null;
    }

    return envelope.data;
  } catch {
    return null;
  }
}

export function writeViewCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: VIEW_CACHE_VERSION,
      savedAt: Date.now(),
      data,
    } satisfies ViewCacheEnvelope<T>));
  } catch {
    /* localStorage may be unavailable or full; network loading still works. */
  }
}

/** 页面级视图缓存的键前缀（论坛缓存由 forumCache 单独限量清理）。 */
const PAGE_VIEW_CACHE_PREFIXES = ["cpu-profile-view-v1:", "cpu-services-tools-v1:"];

function readSavedAt(raw: string | null) {
  if (!raw) return null;
  // writeViewCache 固定按 version、savedAt、data 的顺序序列化，先只解析头部，避免清理时解析整份数据。
  const header = /^\{"version":(\d+),"savedAt":(\d+)[,}]/.exec(raw.slice(0, 64));
  if (header) return Number(header[1]) === VIEW_CACHE_VERSION ? Number(header[2]) : null;
  try {
    const envelope = JSON.parse(raw) as Partial<ViewCacheEnvelope<unknown>>;
    return envelope.version === VIEW_CACHE_VERSION && typeof envelope.savedAt === "number" ? envelope.savedAt : null;
  } catch {
    return null;
  }
}

export type ViewCachePruneOptions = {
  maxAgeMs?: number;
  /** 返回键所属的分组；每组按保存时间只保留最近的 limits[分组] 条。 */
  groupOf?: (key: string) => string;
  limits?: Record<string, number>;
};

/**
 * 清理指定前缀下的视图缓存：删除过期或无法识别的条目，并按分组限制条数。
 * 只会触碰带该前缀的键，课表离线缓存等其他本地数据不受影响。
 */
export function pruneViewCache(prefix: string, options: ViewCachePruneOptions = {}) {
  try {
    const now = Date.now();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    const groups = new Map<string, Array<{ key: string; savedAt: number }>>();
    for (const key of keys) {
      const savedAt = readSavedAt(localStorage.getItem(key));
      if (savedAt === null || now - savedAt > maxAgeMs) {
        localStorage.removeItem(key);
        continue;
      }
      const group = options.groupOf?.(key);
      if (group === undefined || options.limits?.[group] === undefined) continue;
      const entries = groups.get(group) ?? [];
      entries.push({ key, savedAt });
      groups.set(group, entries);
    }
    for (const [group, entries] of groups) {
      entries
        .sort((left, right) => right.savedAt - left.savedAt)
        .slice(options.limits![group])
        .forEach(({ key }) => localStorage.removeItem(key));
    }
  } catch {
    /* Storage can be unavailable; stale entries are also dropped when read. */
  }
}

/** 清理各页面视图缓存中已过期的条目。 */
export function sweepPageViewCaches() {
  PAGE_VIEW_CACHE_PREFIXES.forEach((prefix) => pruneViewCache(prefix));
}
