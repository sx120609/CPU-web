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

export type CacheDomain =
  | "site"
  | "boards"
  | "services"
  | "home"
  | "forum-list"
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
  | "jwxt-iapps";

const VERSION_PREFIX = "cache-version";
const VALUE_PREFIX = "cache-value";
const LOCK_PREFIX = "lock";
const JWXT_PENDING_PREFIX = buildRedisKey("jwxt", "pending");
const JWXT_SESSION_PREFIX = buildRedisKey("jwxt", "session");
const localCacheValues = new Map<string, { value: string; expiresAt: number }>();
const localCacheVersions = new Map<string, number>();
const localLocks = new Map<string, { token: string; expiresAt: number }>();
const inflightLoads = new Map<string, Promise<string>>();

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

function bumpLocalVersion(domain: string) {
  const next = getLocalVersion(domain) + 1;
  localCacheVersions.set(domain, next);
  return next;
}

export async function getCacheVersion(domain: CacheDomain | string) {
  const result = await readRedisString(cacheVersionKey(domain));
  if (!result.available) return getLocalVersion(domain);
  const parsed = Number(result.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function bumpCacheVersion(...domains: Array<CacheDomain | string>) {
  const uniqueDomains = Array.from(new Set(domains.filter(Boolean)));
  for (const domain of uniqueDomains) {
    const next = await incrementRedisKey(cacheVersionKey(domain));
    if (next === null) bumpLocalVersion(domain);
  }
}

export async function withCache<T>(
  domain: CacheDomain | string,
  parts: Array<string | number | boolean | null | undefined>,
  ttlMs: number,
  loader: () => Promise<T>,
) {
  const version = await getCacheVersion(domain);
  const key = cacheEntryKey(domain, version, parts);
  const shared = await readRedisString(key);
  if (shared.available) {
    if (shared.value !== null) return JSON.parse(shared.value) as T;
  } else {
    const fallback = readLocalValue(key);
    if (fallback !== null) return JSON.parse(fallback) as T;
  }

  const existingLoad = inflightLoads.get(key);
  if (existingLoad) {
    return JSON.parse(await existingLoad) as T;
  }

  const loadPromise = (async () => {
    const value = await loader();
    const payload = JSON.stringify(value);
    const stored = await writeRedisString(key, payload, ttlMs);
    if (!stored) writeLocalValue(key, payload, ttlMs);
    return payload;
  })();

  inflightLoads.set(key, loadPromise);
  try {
    return JSON.parse(await loadPromise) as T;
  } finally {
    inflightLoads.delete(key);
  }
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
  if (!stored) writeLocalValue(key, value, ttlMs);
}

export async function getEphemeralValue(key: string) {
  const shared = await readRedisString(key);
  if (shared.available) return shared.value;
  return readLocalValue(key);
}

export async function deleteEphemeralValue(key: string) {
  const deleted = await deleteRedisKeys(key);
  if (!deleted) localCacheValues.delete(key);
}

export async function touchEphemeralValue(key: string, ttlMs: number) {
  const extended = await expireRedisKey(key, ttlMs);
  if (!extended) {
    const cached = localCacheValues.get(key);
    if (cached) cached.expiresAt = Date.now() + ttlMs;
  }
}

export async function countEphemeralKeys(prefix: string) {
  const count = await countRedisKeysByPrefix(prefix);
  if (count !== null) return count;
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
