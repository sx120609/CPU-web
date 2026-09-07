import { randomUUID } from "node:crypto";
import {
  buildRedisKey,
  compareAndDeleteRedisKey,
  compareAndExpireRedisKey,
  countRedisKeysByPrefix,
  deleteRedisKeys,
  expireRedisKey,
  incrementRedisKey,
  readRedisString,
  trySetRedisLock,
  writeRedisString,
} from "./redis";
import { prisma } from "../prisma";

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
  | "jwxt-iapps"
  | "user-avatar"
  | "jwxt-iapp-icon";

const VERSION_PREFIX = "cache-version";
const VALUE_PREFIX = "cache-value";
const LOCK_PREFIX = "lock";
const JWXT_PENDING_PREFIX = buildRedisKey("jwxt", "pending");
const JWXT_SESSION_PREFIX = buildRedisKey("jwxt", "session");
const localCacheValues = new Map<string, { value: string; expiresAt: number }>();
const localCacheVersions = new Map<string, number>();
const localCacheVersionCheckedAt = new Map<string, number>();
const localLocks = new Map<string, { token: string; expiresAt: number }>();
const inflightLoads = new Map<string, Promise<string>>();
const CACHE_ENVELOPE_VERSION = 1;
const LOCAL_VERSION_TTL_MS = 1_000;
const DURABLE_EPHEMERAL_PREFIXES = [
  buildRedisKey("auth", "browser-session") + ":",
  buildRedisKey("jwxt", "session") + ":",
  buildRedisKey("jwxt", "agent-session-replica") + ":",
  buildRedisKey("jwxt", "user-session") + ":",
];
let durableStoreUnavailableLogged = false;

function isDurableEphemeralKey(key: string) {
  return DURABLE_EPHEMERAL_PREFIXES.some((prefix) => key.startsWith(prefix));
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
    await prisma.runtimeSession.updateMany({
      where: { key },
      data: { expiresAt: new Date(Date.now() + Math.max(1, ttlMs)) },
    });
    durableStoreUnavailableLogged = false;
    return true;
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

function readLocalValue(key: string) {
  const cached = localCacheValues.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    localCacheValues.delete(key);
    return null;
  }
  return cached.value;
}

function writeLocalValue(key: string, value: string, ttlMs: number) {
  localCacheValues.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
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
    keys.forEach((key) => localCacheValues.delete(key));
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

export async function setEphemeralValue(key: string, value: string, ttlMs: number) {
  const stored = await writeRedisString(key, value, ttlMs);
  const durableStored = isDurableEphemeralKey(key)
    ? await writeDurableEphemeralValue(key, value, ttlMs)
    : false;
  if (!stored && !durableStored) writeLocalValue(key, value, ttlMs);
}

export async function getEphemeralValue(key: string) {
  const shared = await readRedisString(key);
  if (shared.available && shared.value !== null) return shared.value;
  if (isDurableEphemeralKey(key)) {
    const durable = await readDurableEphemeralValue(key);
    if (durable) {
      // Redis 被清空或短暂不可用时，用数据库中的加密副本恢复热缓存。
      if (shared.available) {
        void writeRedisString(key, durable.value, Math.max(1, durable.expiresAt.getTime() - Date.now()));
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
  localCacheValues.delete(key);
}

export async function touchEphemeralValue(key: string, ttlMs: number) {
  const extended = await expireRedisKey(key, ttlMs);
  const durableExtended = isDurableEphemeralKey(key)
    ? await touchDurableEphemeralValue(key, ttlMs)
    : false;
  if (!extended && !durableExtended) {
    const cached = localCacheValues.get(key);
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
  for (const [key, value] of localCacheValues.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (value.expiresAt <= Date.now()) {
      localCacheValues.delete(key);
      continue;
    }
    total += 1;
  }
  return total;
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
