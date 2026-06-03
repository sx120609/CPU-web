import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import IORedis from "ioredis";
import { config } from "../config";

type RedisBroadcastType = "site-settings-reload" | "storage-config-reload";

export type RedisBroadcastMessage = {
  type: RedisBroadcastType;
  issuedAt: number;
};

type ReadResult = {
  available: boolean;
  value: string | null;
};

const REDIS_EVENT_CHANNEL = buildRedisKey("events");
const redisEvents = new EventEmitter();
let commandClient: IORedis | null = null;
let subscriberClient: IORedis | null = null;
let commandUnavailableLogged = false;
let subscriberUnavailableLogged = false;

export function isRedisConfigured() {
  return Boolean(config.redisEnabled && config.redisUrl.trim());
}

export function buildRedisKey(...parts: Array<string | number | null | undefined>) {
  const cleaned = parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s+/g, ":"));
  return [config.redisPrefix, ...cleaned].join(":");
}

async function connectClient(kind: "command" | "subscriber") {
  if (!isRedisConfigured()) return null;
  const client = new IORedis(config.redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  client.on("error", (error) => {
    logRedisIssue(kind, error);
  });
  try {
    await client.connect();
    if (kind === "command") {
      commandUnavailableLogged = false;
    } else {
      subscriberUnavailableLogged = false;
    }
    return client;
  } catch (error) {
    logRedisIssue(kind, error);
    try { client.disconnect(); } catch { /* ignore */ }
    return null;
  }
}

async function getCommandClient() {
  if (commandClient) return commandClient;
  commandClient = await connectClient("command");
  return commandClient;
}

function resetCommandClient() {
  if (!commandClient) return;
  try { commandClient.disconnect(); } catch { /* ignore */ }
  commandClient = null;
}

function resetSubscriberClient() {
  if (!subscriberClient) return;
  try { subscriberClient.disconnect(); } catch { /* ignore */ }
  subscriberClient = null;
}

function logRedisIssue(kind: "command" | "subscriber", error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  if (kind === "command") {
    if (commandUnavailableLogged) return;
    commandUnavailableLogged = true;
  } else {
    if (subscriberUnavailableLogged) return;
    subscriberUnavailableLogged = true;
  }
  console.warn(`[redis] ${kind} unavailable: ${message}`);
}

export async function readRedisString(key: string): Promise<ReadResult> {
  const client = await getCommandClient();
  if (!client) return { available: false, value: null };
  try {
    return { available: true, value: await client.get(key) };
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return { available: false, value: null };
  }
}

export async function writeRedisString(key: string, value: string, ttlMs?: number) {
  const client = await getCommandClient();
  if (!client) return false;
  try {
    if (ttlMs && ttlMs > 0) {
      await client.set(key, value, "PX", ttlMs);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export async function deleteRedisKeys(...keys: string[]) {
  const targets = keys.filter(Boolean);
  if (!targets.length) return false;
  const client = await getCommandClient();
  if (!client) return false;
  try {
    await client.del(...targets);
    return true;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export async function incrementRedisKey(key: string) {
  const client = await getCommandClient();
  if (!client) return null;
  try {
    return await client.incr(key);
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return null;
  }
}

export async function expireRedisKey(key: string, ttlMs: number) {
  const client = await getCommandClient();
  if (!client) return false;
  try {
    await client.pexpire(key, ttlMs);
    return true;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export async function countRedisKeysByPrefix(prefix: string) {
  const client = await getCommandClient();
  if (!client) return null;
  try {
    let cursor = "0";
    let total = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = nextCursor;
      total += keys.length;
    } while (cursor !== "0");
    return total;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return null;
  }
}

export async function compareAndDeleteRedisKey(key: string, token: string) {
  const client = await getCommandClient();
  if (!client) return false;
  try {
    const deleted = await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
    return Number(deleted) > 0;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export async function compareAndExpireRedisKey(key: string, token: string, ttlMs: number) {
  const client = await getCommandClient();
  if (!client) return false;
  try {
    const extended = await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      key,
      token,
      String(ttlMs),
    );
    return Number(extended) > 0;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export async function trySetRedisLock(key: string, ttlMs: number, token = randomUUID()) {
  const client = await getCommandClient();
  if (!client) return { available: false, acquired: false, token };
  try {
    const result = await client.set(key, token, "PX", ttlMs, "NX");
    return { available: true, acquired: result === "OK", token };
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return { available: false, acquired: false, token };
  }
}

export async function publishRedisBroadcast(message: RedisBroadcastMessage) {
  const client = await getCommandClient();
  if (!client) return false;
  try {
    await client.publish(REDIS_EVENT_CHANNEL, JSON.stringify(message));
    return true;
  } catch (error) {
    logRedisIssue("command", error);
    resetCommandClient();
    return false;
  }
}

export function onRedisBroadcast<T extends RedisBroadcastType>(
  type: T,
  handler: (message: Extract<RedisBroadcastMessage, { type: T }> | RedisBroadcastMessage) => void | Promise<void>,
) {
  redisEvents.on(type, handler);
  return () => {
    redisEvents.off(type, handler);
  };
}

export async function startRedisSubscriptions() {
  if (!isRedisConfigured()) return false;
  if (subscriberClient) return true;
  subscriberClient = await connectClient("subscriber");
  if (!subscriberClient) return false;
  subscriberClient.on("message", (_channel, rawMessage) => {
    try {
      const parsed = JSON.parse(String(rawMessage || "")) as RedisBroadcastMessage;
      if (!parsed?.type) return;
      redisEvents.emit(parsed.type, parsed);
    } catch {
      // ignore malformed broadcasts
    }
  });
  subscriberClient.on("end", () => {
    resetSubscriberClient();
  });
  try {
    await subscriberClient.subscribe(REDIS_EVENT_CHANNEL);
    return true;
  } catch (error) {
    logRedisIssue("subscriber", error);
    resetSubscriberClient();
    return false;
  }
}
