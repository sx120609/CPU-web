import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { currentTiming, endChannelKey } from "./liveActivitySchedule";
import { createLiveActivityChannel, deleteLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock, type ApnsConfig } from "./apnsConfig";

const MAX_CHANNELS_PER_ENVIRONMENT = 9000;
const LEASE_KEY = "apns.channels.lease";
const GC_KEY = "apns.channels.pending-deletions";
// Apple requests time out after 15s. Renew before each request and fence writes.
const LEASE_MS = 60_000;
const DATED_CHANNEL = /^(production|sandbox):cpu-(?:day|block):(\d{4}-\d{2}-\d{2})(?::\d{4})?$/;
const LEGACY_CHANNEL = /^(production|sandbox):cpu(?:-morning|-afternoon|-evening)?$/;
type ChannelError = { environment: string; message: string };
type Lease = { owner: string; expiresAt: number };
type RetiredChannel = { key: string; channel: string; environment: "production" | "sandbox"; provider: ApnsConfig };
const providerIdentity = (c: ApnsConfig) => JSON.stringify([c.keyPath, c.keyID, c.teamID, c.bundleID]);
const providerOnly = (c: ApnsConfig): ApnsConfig => ({ ...c, channels: {} });

export function schoolDate(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}
export async function requiredChannelSuffixes(_now = Date.now(), db?: Prisma.TransactionClient) {
  const timing = await currentTiming(db);
  return timing.periods.map(p => endChannelKey("production", timing.id, p.id).slice("production:".length));
}
async function readSetting<T>(db: Prisma.TransactionClient, key: string, fallback: T): Promise<T> {
  const row = await db.siteSetting.findUnique({ where: { key } });
  return row ? JSON.parse(row.value) as T : fallback;
}
async function writeSetting(db: Prisma.TransactionClient, key: string, value: unknown) {
  const encoded = JSON.stringify(value);
  await db.siteSetting.upsert({ where: { key }, create: { key, value: encoded }, update: { value: encoded } });
}

// A database lease coordinates separate releases without holding a connection
// during Apple I/O. Exported so regressions can simulate independent workers.
export async function provisionApnsChannels(now = Date.now(), prune = false, transport = { create: createLiveActivityChannel, delete: deleteLiveActivityChannel }) {
  const owner = randomUUID();
  const initial = await withApnsConfigLock(async db => {
    const config = await getApnsConfig(db);
    if (!config.configured) return { config, acquired: false, busy: false };
    const lease = await readSetting<Lease | null>(db, LEASE_KEY, null);
    if (lease && lease.expiresAt > Date.now()) return { config, acquired: false, busy: true };
    await writeSetting(db, LEASE_KEY, { owner, expiresAt: Date.now() + LEASE_MS });
    return { config, acquired: true, busy: false };
  });
  const errors: ChannelError[] = [];
  if (!initial.acquired) {
    if (initial.busy) errors.push({ environment: "all", message: "Channel provisioning is already in progress" });
    return { ...initial.config, channelErrors: errors };
  }
  const identity = providerIdentity(initial.config);
  const step = <T>(operation: (db: Prisma.TransactionClient, config: ApnsConfig) => Promise<T>) => withApnsConfigLock(async db => {
    const lease = await readSetting<Lease | null>(db, LEASE_KEY, null);
    if (lease?.owner !== owner || lease.expiresAt <= Date.now()) throw new Error("APNs channel lease expired or changed");
    const config = await getApnsConfig(db);
    if (providerIdentity(config) !== identity || !config.configured) throw new Error("APNs provider changed during channel provisioning");
    await writeSetting(db, LEASE_KEY, { owner, expiresAt: Date.now() + LEASE_MS });
    return operation(db, config);
  });
  try {
    if (prune) await step(async (db, config) => {
      const current = await currentTiming(db);
      const expired = await db.liveActivityScheduleVersion.findMany({ where: { id: { not: current.id }, broadcastUntil: { lt: new Date(now - 60000) } } });
      const expiredIds = new Set(expired.map(v => v.id));
      const garbage = await readSetting<RetiredChannel[]>(db, GC_KEY, []);
      let changed = false;
      for (const [key, channel] of Object.entries(config.channels)) {
        const dated = DATED_CHANNEL.exec(key);
        const versioned = /^(production|sandbox):main-campus:([a-f0-9]+):end-period-\d+$/.exec(key);
        const match = LEGACY_CHANNEL.exec(key) ?? /^(production|sandbox):cpu-(?:day|block(?::\d+)?)$/.exec(key)
          ?? (dated && dated[2] < schoolDate(now - 86400_000) ? dated : null)
          ?? (versioned && expiredIds.has(versioned[2]) ? versioned : null);
        if (!match) continue;
        // Unpublish and queue atomically. A crash keeps cleanup retryable and no
        // published mapping can point at a channel already deleted by Apple.
        garbage.push({ key, channel, environment: match[1] as RetiredChannel["environment"], provider: providerOnly(config) });
        delete config.channels[key]; changed = true;
      }
      if (changed) {
        await writeSetting(db, "apns.channels", config.channels);
        await writeSetting(db, GC_KEY, garbage);
      }
    });
    const garbage = await step(db => readSetting<RetiredChannel[]>(db, GC_KEY, []));
    for (const retired of garbage) {
      await step(async (_db, config) => {
        if (providerIdentity(config) === providerIdentity(retired.provider) && Object.values(config.channels).includes(retired.channel)) {
          throw new Error("Refusing to delete a published APNs channel");
        }
      });
      try {
        await transport.delete(retired.provider, retired.environment, retired.channel);
        await step(async db => {
          const pending = await readSetting<RetiredChannel[]>(db, GC_KEY, []);
          await writeSetting(db, GC_KEY, pending.filter(item => !(item.channel === retired.channel && item.environment === retired.environment && providerIdentity(item.provider) === providerIdentity(retired.provider))));
        });
      } catch (error) {
        errors.push({ environment: retired.environment, message: retired.key + ": deletion deferred: " + (error instanceof Error ? error.message : String(error)) });
      }
    }
    const suffixes = await step(db => requiredChannelSuffixes(now, db));
    for (const environment of ["production", "sandbox"] as const) {
      for (const suffix of suffixes) {
        const key = environment + ":" + suffix;
        const config = await step(async (_db, config) => {
          if (config.channels[key]) return null;
          if (Object.keys(config.channels).filter(k => k.startsWith(environment + ":")).length >= MAX_CHANNELS_PER_ENVIRONMENT) throw new Error("APNs channel limit reached");
          return config;
        });
        if (!config) continue;
        let created: string | undefined;
        try {
          created = await transport.create(config, environment);
          const accepted = await step(async (db, latest) => {
            if (latest.channels[key]) return false;
            latest.channels[key] = created!;
            await writeSetting(db, "apns.channels", latest.channels);
            return true;
          });
          if (accepted) created = undefined;
        } catch (error) {
          errors.push({ environment, message: key + ": " + (error instanceof Error ? error.message : String(error)) });
        } finally {
          if (created) {
            // Never overwrite a successor's ID with a late result. Queue unused
            // returned IDs for cleanup using the provider that created them.
            const unused = created;
            await withApnsConfigLock(async db => {
              const pending = await readSetting<RetiredChannel[]>(db, GC_KEY, []);
              pending.push({ key, channel: unused, environment, provider: providerOnly(config) });
              await writeSetting(db, GC_KEY, pending);
            });
          }
        }
      }
    }
    return { ...await step(async (_db, config) => config), channelErrors: errors };
  } finally {
    await withApnsConfigLock(async db => {
      const lease = await readSetting<Lease | null>(db, LEASE_KEY, null);
      if (lease?.owner === owner) await writeSetting(db, LEASE_KEY, { owner, expiresAt: 0 });
    }).catch(() => undefined);
  }
}
let lastChannelCheck = 0;
let inFlight: ReturnType<typeof provisionApnsChannels> | undefined;
function runProvision(now: number, prune: boolean) {
  if (!inFlight) inFlight = provisionApnsChannels(now, prune).finally(() => { inFlight = undefined; });
  return inFlight;
}
export async function maintainApnsChannels(now = Date.now()) {
  if (now - lastChannelCheck < 60_000) return;
  const { channelErrors } = await runProvision(now, true);
  for (const error of channelErrors) console.warn("[apns] channel provisioning", error.message);
  lastChannelCheck = now;
}
/** Reuse existing IDs; publish each missing channel as soon as Apple creates it. */
export async function ensureApnsChannels(now = Date.now()) {
  return runProvision(now, false);
}
