import { randomUUID } from "node:crypto";
import {
  buildRedisKey,
  capRedisKeyTtls,
  compareAndDeleteRedisKey,
  compareAndExpireRedisKey,
  countRedisKeysByPrefix,
  deleteRedisKeys,
  deleteRedisSubjectCacheEntries,
  expireRedisKey,
  incrementRedisKey,
  readRedisString,
  readRedisStringsWithTtl,
  scanRedisKeysByPrefix,
  trySetRedisLock,
  writeRedisString,
} from "./redis";
import { prisma } from "../prisma";
import { config } from "../config";

export type CacheDomain =
  | "site"
  | "boards"
  | "services"
  | "home"
  | "forum-list"
  | "forum-ads"
  | "search"
  | "courses"
  | "dorm-electric"
  | "jwxt-widget"
  | "jwxt-status"
  | "jwxt-schedule"
  | "jwxt-grades"
  | "jwxt-midterm-grades"
  | "jwxt-exams"
  | "jwxt-calendar"
  | "jwxt-progress"
  | "jwxt-pyfa"
  | "jwxt-records"
  | "jwxt-iapps"
  | "user-avatar"
  | "jwxt-iapp-icon";

const VERSION_PREFIX = "cache-version";
const VALUE_PREFIX = "cache-value";
const LOCK_PREFIX = "lock";
const JWXT_PENDING_PREFIX = buildRedisKey("jwxt", "pending");
const JWXT_SESSION_PREFIX = buildRedisKey("jwxt", "session");
const CACHE_ENTRY_KEY_PREFIX = `${buildRedisKey(VALUE_PREFIX)}:`;
type LocalCacheValue = { value: string; expiresAt: number };
// 会话、待确认登录、日志标记等临时值（Redis 不可用时才落到进程内），只按过期时间清理，不参与淘汰。
const localCacheValues = new Map<string, LocalCacheValue>();
// withCache 的 L1 热缓存：Map 迭代顺序即最近使用顺序，超出条数或近似字节上限时淘汰最久未用的条目。
const localCacheEntries = new Map<string, LocalCacheValue>();
const localCacheLimits = { maxEntries: 2_000, maxBytes: 64 * 1024 * 1024 };
let localCacheEntryBytes = 0;
const LOCAL_CACHE_SWEEP_INTERVAL_MS = 60_000;
const localCacheVersions = new Map<string, number>();
const localCacheVersionCheckedAt = new Map<string, number>();
const localLocks = new Map<string, { token: string; expiresAt: number }>();
const inflightLoads = new Map<string, Promise<string>>();
const CACHE_ENVELOPE_VERSION = 1;
const LOCAL_VERSION_TTL_MS = 1_000;
const DURABLE_EPHEMERAL_PREFIXES = [
  buildRedisKey("auth", "browser-session") + ":",
  buildRedisKey("auth", "browser-session-revoked") + ":",
  buildRedisKey("jwxt", "session") + ":",
  buildRedisKey("jwxt", "agent-session-replica") + ":",
  buildRedisKey("jwxt", "user-session") + ":",
];
const SESSION_REVOCATION_KEY_PREFIX = buildRedisKey("auth", "browser-session-revoked") + ":";
// 会话在数据库里保存完整有效期；Redis 只留最近活跃的热副本，冷会话下次访问时从数据库恢复。
// 全部放在 Redis 时教务会话一年累积到 60 多万个键、近 4 GB 内存（2026-10-27）。
export const DURABLE_REDIS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let durableStoreUnavailableLogged = false;

function isDurableEphemeralKey(key: string) {
  return DURABLE_EPHEMERAL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 数据库里有副本时才缩短 Redis 的过期时间；否则 Redis 是唯一存储，保留完整有效期。 */
function redisTtlFor(ttlMs: number, durableStored: boolean) {
  return durableStored ? Math.min(ttlMs, DURABLE_REDIS_TTL_MS) : ttlMs;
}

function hasDatabaseStore() {
  return Boolean(String(process.env.DATABASE_URL ?? "").trim());
}

function logDurableStoreIssue(error: unknown) {
  if (durableStoreUnavailableLogged) return;
  durableStoreUnavailableLogged = true;
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  console.warn(`[session-store] database fallback unavailable: ${message}`);
}

async function readDurableEphemeralValue(key: string) {
  if (!hasDatabaseStore()) return null;
  try {
    const record = await prisma.runtimeSession.findUnique({ where: { key } });
    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) {
      await prisma.runtimeSession.delete({ where: { key } }).catch(() => undefined);
      return null;
    }
    return record;
  } catch (error) {
    logDurableStoreIssue(error);
    return null;
  }
}

async function writeDurableEphemeralValue(key: string, value: string, ttlMs: number) {
  if (!hasDatabaseStore()) return false;
  try {
    await prisma.runtimeSession.upsert({
      where: { key },
      create: { key, value, expiresAt: new Date(Date.now() + Math.max(1, ttlMs)) },
      update: { value, expiresAt: new Date(Date.now() + Math.max(1, ttlMs)) },
    });
    durableStoreUnavailableLogged = false;
    return true;
  } catch (error) {
    logDurableStoreIssue(error);
    return false;
  }
}

async function deleteDurableEphemeralValue(key: string) {
  if (!hasDatabaseStore()) return false;
  try {
    await prisma.runtimeSession.deleteMany({ where: { key } });
    durableStoreUnavailableLogged = false;
    return true;
  } catch (error) {
    logDurableStoreIssue(error);
    return false;
  }
}

async function touchDurableEphemeralValue(key: string, ttlMs: number) {
  if (!hasDatabaseStore()) return false;
  try {
    const result = await prisma.runtimeSession.updateMany({
      where: { key },
      data: { expiresAt: new Date(Date.now() + Math.max(1, ttlMs)) },
    });
    durableStoreUnavailableLogged = false;
    return result.count > 0;
  } catch (error) {
    logDurableStoreIssue(error);
    return false;
  }
}

function cacheVersionKey(domain: string) {
  return buildRedisKey(VERSION_PREFIX, domain);
}

function cacheEntryKey(domain: string, version: number, parts: Array<string | number | boolean | null | undefined>) {
  return buildRedisKey(VALUE_PREFIX, domain, `v${version}`, ...parts.map(normalizeCachePart));
}

function lockKey(name: string) {
  return buildRedisKey(LOCK_PREFIX, name);
}

function normalizeCachePart(input: string | number | boolean | null | undefined) {
  const value = String(input ?? "").trim();
  if (!value) return "_";
  return encodeURIComponent(value);
}

function localStoreFor(key: string) {
  return key.startsWith(CACHE_ENTRY_KEY_PREFIX) ? localCacheEntries : localCacheValues;
}

function localEntryBytes(key: string, value: string) {
  // 按 UTF-16 粗略估算字符串占用的内存。
  return (key.length + value.length) * 2;
}

function deleteLocalValue(key: string) {
  const store = localStoreFor(key);
  const cached = store.get(key);
  if (!cached) return;
  store.delete(key);
  if (store === localCacheEntries) localCacheEntryBytes -= localEntryBytes(key, cached.value);
}

function evictLocalCacheEntries() {
  for (const [key, cached] of localCacheEntries) {
    if (localCacheEntries.size <= localCacheLimits.maxEntries && localCacheEntryBytes <= localCacheLimits.maxBytes) break;
    localCacheEntries.delete(key);
    localCacheEntryBytes -= localEntryBytes(key, cached.value);
  }
}

function readLocalValue(key: string) {
  const store = localStoreFor(key);
  const cached = store.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    deleteLocalValue(key);
    return null;
  }
  if (store === localCacheEntries) {
    // 命中后移到队尾，维持 LRU 顺序。
    store.delete(key);
    store.set(key, cached);
  }
  return cached.value;
}

function writeLocalValue(key: string, value: string, ttlMs: number) {
  const entry = {
    value,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  };
  if (localStoreFor(key) !== localCacheEntries) {
    localCacheValues.set(key, entry);
    return;
  }
  deleteLocalValue(key);
  localCacheEntries.set(key, entry);
  localCacheEntryBytes += localEntryBytes(key, value);
  evictLocalCacheEntries();
}

// 版本号切换后旧 key 不会再被读取，定期清理所有已过期的进程内条目，避免它们一直占用内存。
export function sweepExpiredLocalCacheValues(now = Date.now()) {
  let removed = 0;
  for (const store of [localCacheValues, localCacheEntries]) {
    for (const [key, cached] of store) {
      if (cached.expiresAt > now) continue;
      deleteLocalValue(key);
      removed += 1;
    }
  }
  return removed;
}

const localCacheSweepTimer = setInterval(() => {
  sweepExpiredLocalCacheValues();
}, LOCAL_CACHE_SWEEP_INTERVAL_MS);
localCacheSweepTimer.unref?.();

export function setLocalCacheLimitsForTests(limits: Partial<typeof localCacheLimits>) {
  const previous = { ...localCacheLimits };
  Object.assign(localCacheLimits, limits);
  evictLocalCacheEntries();
  return previous;
}

function getLocalVersion(domain: string) {
  return localCacheVersions.get(domain) ?? 0;
}

function rememberLocalVersion(domain: string, version: number) {
  localCacheVersions.set(domain, version);
  localCacheVersionCheckedAt.set(domain, Date.now());
  return version;
}

function bumpLocalVersion(domain: string) {
  const next = getLocalVersion(domain) + 1;
  return rememberLocalVersion(domain, next);
}

type CacheEnvelope<T> = {
  __cpuCache: typeof CACHE_ENVELOPE_VERSION;
  cachedAt: number;
  data: T;
};

function decodeCachePayload<T>(raw: string) {
  const parsed = JSON.parse(raw) as CacheEnvelope<T> | T;
  if (
    parsed
    && typeof parsed === "object"
    && "__cpuCache" in parsed
    && (parsed as CacheEnvelope<T>).__cpuCache === CACHE_ENVELOPE_VERSION
    && Number.isFinite((parsed as CacheEnvelope<T>).cachedAt)
  ) {
    const envelope = parsed as CacheEnvelope<T>;
    return { data: envelope.data, cachedAt: envelope.cachedAt };
  }
  return { data: parsed as T, cachedAt: Date.now() };
}

function staleWindowMs(ttlMs: number) {
  return Math.min(24 * 60 * 60 * 1000, Math.max(60_000, ttlMs * 4));
}

function startCacheLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
  const existing = inflightLoads.get(key);
  if (existing) return existing;
  const retentionMs = ttlMs + staleWindowMs(ttlMs);
  const loadPromise = (async () => {
    const value = await loader();
    const payload = JSON.stringify({
      __cpuCache: CACHE_ENVELOPE_VERSION,
      cachedAt: Date.now(),
      data: value,
    } satisfies CacheEnvelope<T>);
    // L1 进程内热缓存必须始终写入。Redis 是跨进程共享层，不应让每个命中请求
    // 都承担 Redis 往返和大 JSON 解析开销。
    writeLocalValue(key, payload, retentionMs);
    const stored = await writeRedisString(key, payload, retentionMs);
    if (!stored) writeLocalValue(key, payload, retentionMs);
    return payload;
  })();
  inflightLoads.set(key, loadPromise);
  const cleanup = () => {
    if (inflightLoads.get(key) === loadPromise) inflightLoads.delete(key);
  };
  void loadPromise.then(cleanup, cleanup);
  return loadPromise;
}

export async function getCacheVersion(domain: CacheDomain | string) {
  const checkedAt = localCacheVersionCheckedAt.get(domain) ?? 0;
  if (checkedAt > 0 && Date.now() - checkedAt <= LOCAL_VERSION_TTL_MS) {
    return getLocalVersion(domain);
  }
  const result = await readRedisString(cacheVersionKey(domain));
  if (!result.available) {
    localCacheVersionCheckedAt.set(domain, Date.now());
    return getLocalVersion(domain);
  }
  const parsed = Number(result.value);
  return rememberLocalVersion(domain, Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
}

export async function bumpCacheVersion(...domains: Array<CacheDomain | string>) {
  const uniqueDomains = Array.from(new Set(domains.filter(Boolean)));
  await Promise.all(uniqueDomains.map(async (domain) => {
    const next = await incrementRedisKey(cacheVersionKey(domain));
    if (next === null) bumpLocalVersion(domain);
    else rememberLocalVersion(domain, next);
  }));
}

export async function withCache<T>(
  domain: CacheDomain | string,
  parts: Array<string | number | boolean | null | undefined>,
  ttlMs: number,
  loader: () => Promise<T>,
  options: { refresh?: boolean } = {},
) {
  const version = await getCacheVersion(domain);
  const key = cacheEntryKey(domain, version, parts);
  if (options.refresh) {
    return decodeCachePayload<T>(await startCacheLoad(key, ttlMs, loader)).data;
  }
  const local = readLocalValue(key);
  if (local !== null) {
    const cached = decodeCachePayload<T>(local);
    const age = Math.max(0, Date.now() - cached.cachedAt);
    if (age <= ttlMs) return cached.data;
    if (age <= ttlMs + staleWindowMs(ttlMs)) {
      void startCacheLoad(key, ttlMs, loader).catch(() => undefined);
      return cached.data;
    }
  }
  const shared = await readRedisString(key);
  let cachedRaw: string | null = null;
  if (shared.available) {
    cachedRaw = shared.value;
  } else {
    cachedRaw = readLocalValue(key);
  }
  if (cachedRaw !== null) {
    const cached = decodeCachePayload<T>(cachedRaw);
    const age = Math.max(0, Date.now() - cached.cachedAt);
    const remainingMs = ttlMs + staleWindowMs(ttlMs) - age;
    if (remainingMs > 0) writeLocalValue(key, cachedRaw, remainingMs);
    if (age <= ttlMs) return cached.data;
    if (age <= ttlMs + staleWindowMs(ttlMs)) {
      // 先返回旧值让页面秒开，再在后台更新。主动失效会切换版本 key，不会命中旧数据。
      void startCacheLoad(key, ttlMs, loader).catch(() => undefined);
      return cached.data;
    }
  }

  return decodeCachePayload<T>(await startCacheLoad(key, ttlMs, loader)).data;
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const shared = await readRedisString(key);
  if (shared.available) {
    return shared.value ? JSON.parse(shared.value) as T : null;
  }
  const fallback = readLocalValue(key);
  return fallback ? JSON.parse(fallback) as T : null;
}

export async function setCachedJson(key: string, value: unknown, ttlMs: number) {
  const payload = JSON.stringify(value);
  const stored = await writeRedisString(key, payload, ttlMs);
  if (!stored) writeLocalValue(key, payload, ttlMs);
}

export async function deleteCachedKeys(...keys: string[]) {
  const deleted = await deleteRedisKeys(...keys);
  if (!deleted) {
    keys.forEach((key) => deleteLocalValue(key));
  }
}

export async function runWithDistributedLock<T>(name: string, ttlMs: number, task: () => Promise<T>) {
  const key = lockKey(name);
  const token = randomUUID();
  const shared = await trySetRedisLock(key, ttlMs, token);
  if (!shared.available) {
    const existing = localLocks.get(key);
    if (existing && existing.expiresAt > Date.now()) return { acquired: false as const, result: null as T | null };
    localLocks.set(key, { token, expiresAt: Date.now() + ttlMs });
    try {
      const result = await task();
      return { acquired: true as const, result };
    } finally {
      const current = localLocks.get(key);
      if (current?.token === token) localLocks.delete(key);
    }
  }
  if (!shared.acquired) return { acquired: false as const, result: null as T | null };

  const heartbeat = setInterval(() => {
    compareAndExpireRedisKey(key, token, ttlMs).catch(() => undefined);
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  heartbeat.unref?.();

  try {
    const result = await task();
    return { acquired: true as const, result };
  } finally {
    clearInterval(heartbeat);
    await compareAndDeleteRedisKey(key, token).catch(() => undefined);
  }
}

/**
 * Claims `name` for `ttlMs` and never releases it early, so of several
 * processes seeing the same event only the first one handles it. Falls back
 * to this process when Redis is unavailable.
 */
export async function claimOnce(name: string, ttlMs: number) {
  const key = lockKey(name);
  const shared = await trySetRedisLock(key, ttlMs);
  if (shared.available) return shared.acquired;
  const now = Date.now();
  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > now) return false;
  if (localLocks.size >= 5_000) {
    for (const [entryKey, entry] of localLocks) {
      if (entry.expiresAt <= now) localLocks.delete(entryKey);
    }
  }
  localLocks.set(key, { token: shared.token, expiresAt: now + ttlMs });
  return true;
}

export async function setEphemeralValue(key: string, value: string, ttlMs: number) {
  const durableStored = isDurableEphemeralKey(key)
    ? await writeDurableEphemeralValue(key, value, ttlMs)
    : false;
  const stored = await writeRedisString(key, value, redisTtlFor(ttlMs, durableStored));
  if (!stored && !durableStored) writeLocalValue(key, value, ttlMs);
}

export async function deleteSubjectCacheEntries(subjectHash: string) {
  await deleteRedisSubjectCacheEntries(subjectHash);
  for (const key of localCacheEntries.keys()) {
    if (key.split(":").includes(subjectHash)) deleteLocalValue(key);
  }
}

// Redis 正常但没查到时才回退数据库，用于 Redis 被清空后恢复会话。伪造的随机会话 Cookie 每次都会走到这里，
// 所以这条路径有全局速率预算；Redis 不可用时数据库是唯一存储，不受此限制。
const durableMissBudget = { tokens: 50, updatedAt: Date.now() };
const DURABLE_MISS_PER_SECOND = 20;
const DURABLE_MISS_BURST = 50;

export function takeDurableMissBudget(now = Date.now()) {
  durableMissBudget.tokens = Math.min(
    DURABLE_MISS_BURST,
    durableMissBudget.tokens + ((now - durableMissBudget.updatedAt) / 1000) * DURABLE_MISS_PER_SECOND,
  );
  durableMissBudget.updatedAt = now;
  if (durableMissBudget.tokens < 1) return false;
  durableMissBudget.tokens -= 1;
  return true;
}

export async function getEphemeralValue(key: string) {
  const shared = await readRedisString(key);
  if (shared.available && shared.value !== null) return shared.value;
  // 撤销标记必须查到底：漏查会让已退出的会话继续有效。其余键查不到只会被当作未登录。
  if (isDurableEphemeralKey(key) && (!shared.available || key.startsWith(SESSION_REVOCATION_KEY_PREFIX) || takeDurableMissBudget())) {
    const durable = await readDurableEphemeralValue(key);
    if (durable) {
      // Redis 被清空或短暂不可用时，用数据库中的加密副本恢复热缓存。
      if (shared.available) {
        void writeRedisString(key, durable.value, redisTtlFor(Math.max(1, durable.expiresAt.getTime() - Date.now()), true));
      }
      return durable.value;
    }
  }
  if (shared.available) return null;
  return readLocalValue(key);
}

export async function deleteEphemeralValue(key: string) {
  await deleteRedisKeys(key);
  if (isDurableEphemeralKey(key)) await deleteDurableEphemeralValue(key);
  deleteLocalValue(key);
}

export async function touchEphemeralValue(key: string, ttlMs: number) {
  let durableExtended = false;
  if (isDurableEphemeralKey(key)) {
    durableExtended = await touchDurableEphemeralValue(key, ttlMs);
    if (!durableExtended) {
      // 数据库加入会话存储（2026-08-14）之前写入的会话只在 Redis 里，续期时补一份。
      const shared = await readRedisString(key);
      if (shared.value !== null) durableExtended = await writeDurableEphemeralValue(key, shared.value, ttlMs);
    }
  }
  const extended = await expireRedisKey(key, redisTtlFor(ttlMs, durableExtended));
  if (!extended && !durableExtended) {
    const cached = localStoreFor(key).get(key);
    if (cached) cached.expiresAt = Date.now() + ttlMs;
  }
}

export async function countEphemeralKeys(prefix: string) {
  const count = await countRedisKeysByPrefix(prefix);
  if (count !== null) return count;
  if (isDurableEphemeralKey(prefix) && hasDatabaseStore()) {
    try {
      await prisma.runtimeSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      return await prisma.runtimeSession.count({ where: { key: { startsWith: prefix } } });
    } catch (error) {
      logDurableStoreIssue(error);
    }
  }
  let total = 0;
  for (const [key, value] of localStoreFor(prefix).entries()) {
    if (!key.startsWith(prefix)) continue;
    if (value.expiresAt <= Date.now()) {
      deleteLocalValue(key);
      continue;
    }
    total += 1;
  }
  return total;
}

const DURABLE_TRIM_MARKER = buildRedisKey("durable-redis-trim", "v1");

type DurableTrimEntry = { key: string; ttlMs: number; value: string };

/** 按“完整有效期 − 剩余 TTL”推算闲置时长：会话每次续期都会把 TTL 重置成完整有效期。 */
export function planDurableTrim(entries: DurableTrimEntry[], fullTtlMs: number | null) {
  const cap: string[] = [];
  const evict: string[] = [];
  for (const entry of entries) {
    if (entry.ttlMs !== -1 && entry.ttlMs <= DURABLE_REDIS_TTL_MS) continue;
    const idle = fullTtlMs === null || entry.ttlMs === -1 ? 0 : fullTtlMs - entry.ttlMs;
    (idle > DURABLE_REDIS_TTL_MS ? evict : cap).push(entry.key);
  }
  return { cap, evict };
}

/** 确保数据库副本存在且不早于 Redis 过期；返回已确认有副本的键。 */
async function ensureDurableCopies(entries: DurableTrimEntry[]) {
  const now = Date.now();
  const rows = await prisma.runtimeSession.findMany({
    where: { key: { in: entries.map((entry) => entry.key) } },
    select: { key: true, expiresAt: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.expiresAt.getTime()]));
  const missing = entries.filter((entry) => !stored.has(entry.key) && entry.ttlMs > 0);
  const created = missing.length
    ? (await prisma.runtimeSession.createMany({
      data: missing.map((entry) => ({ key: entry.key, value: entry.value, expiresAt: new Date(now + entry.ttlMs) })),
      skipDuplicates: true,
    })).count
    : 0;
  for (const entry of entries) {
    const expiresAt = stored.get(entry.key);
    if (expiresAt !== undefined && entry.ttlMs > 0 && expiresAt < now + entry.ttlMs) {
      await prisma.runtimeSession.updateMany({ where: { key: entry.key }, data: { expiresAt: new Date(now + entry.ttlMs) } });
    }
  }
  return { durable: new Set([...stored.keys(), ...missing.map((entry) => entry.key)]), created };
}

/**
 * 一次性整理：旧版本把会话按完整有效期放在 Redis 里。补齐数据库副本后，
 * 7 天以上没活跃的从 Redis 删除，其余缩到 7 天；撤销标记不动。
 */
export async function trimDurableRedisCopies() {
  if (!hasDatabaseStore()) return null;
  const marker = await readRedisString(DURABLE_TRIM_MARKER);
  if (!marker.available || marker.value) return null;
  const targets: Array<[string, number | null]> = [
    [buildRedisKey("auth", "browser-session") + ":", config.browserSessionAbsoluteMs],
    [buildRedisKey("jwxt", "session") + ":", config.jwxtSessionIdleMs],
    [buildRedisKey("jwxt", "agent-session-replica") + ":", config.jwxtSessionIdleMs],
    // 小组件关联只在登录时写入、不续期，剩余 TTL 反映不了闲置时长，只缩短不删除。
    [buildRedisKey("jwxt", "user-session") + ":", null],
  ];
  const { acquired, result } = await runWithDistributedLock("durable-redis-trim", 60_000, async () => {
    const totals = { capped: 0, evicted: 0, backfilled: 0 };
    for (const [prefix, fullTtlMs] of targets) {
      const scanned = await scanRedisKeysByPrefix(prefix, async (keys) => {
        const entries = (await readRedisStringsWithTtl(keys)).filter((entry): entry is DurableTrimEntry => entry !== null);
        const plan = planDurableTrim(entries, fullTtlMs);
        const pending = new Set([...plan.cap, ...plan.evict]);
        if (!pending.size) return;
        const { durable, created } = await ensureDurableCopies(entries.filter((entry) => pending.has(entry.key)));
        totals.backfilled += created;
        const evict = plan.evict.filter((key) => durable.has(key));
        if (evict.length) await deleteRedisKeys(...evict);
        totals.evicted += evict.length;
        totals.capped += await capRedisKeyTtls(plan.cap.filter((key) => durable.has(key)), DURABLE_REDIS_TTL_MS);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }, 200);
      if (!scanned) throw new Error("Redis unavailable during durable session trim");
    }
    await writeRedisString(DURABLE_TRIM_MARKER, JSON.stringify({ ...totals, finishedAt: Date.now() }));
    return totals;
  });
  return acquired ? result : null;
}

export function startDurableRedisTrim() {
  const timer = setTimeout(() => {
    trimDurableRedisCopies().then((totals) => {
      if (totals) console.log(`[session-store] trimmed Redis session copies ${JSON.stringify(totals)}`);
    }, (error) => {
      console.warn("[session-store] Redis session trim failed; it will retry on the next start", error);
    });
  }, 30_000);
  timer.unref();
}

export function jwxtPendingKey(id: string) {
  return `${JWXT_PENDING_PREFIX}:${id}`;
}

export function jwxtSessionKey(id: string) {
  return `${JWXT_SESSION_PREFIX}:${id}`;
}

export function jwxtPendingPrefix() {
  return `${JWXT_PENDING_PREFIX}:`;
}

export function jwxtSessionPrefix() {
  return `${JWXT_SESSION_PREFIX}:`;
}
