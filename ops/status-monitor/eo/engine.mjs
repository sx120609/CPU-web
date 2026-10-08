import { createHash } from 'node:crypto';
import { createMonitor } from '../src/monitor.mjs';
import { createConnectivityGuard } from '../src/probe.mjs';
import { createNotifier } from '../src/notify.mjs';
import { applySample, createState, reconcile, recordCertificates } from '../src/state.mjs';
import { dayKey, recentDayKeys } from '../src/time.mjs';
import { acquireWriter, releaseWriter, readJSON, writeJSON, isConflict } from './storage.mjs';
import { createSharedProbe } from './shared-probe.mjs';
import { appendHistory, seedHistory } from './history.mjs';

export const STATE_KEY = 'state/current.json';
export const PENDING_KEY = 'journal/pending.json';
const SILENT = { info() {}, warn() {}, error() {} };
const clone = (value) => structuredClone(value);

export function assertEOConfig(config) {
  // These bounds are the existing deployment's settings, not silent overrides.
  // The user approved 4s per request for this EO adapter on 2026-10-08.
  // Asset checks: 2 * (4s page + 4s concurrent assets) + 3s retry = 19s.
  if (config.checks.length > 10 || config.checks.some(c => c.intervalSeconds !== 60 || c.timeoutMs > 4000 || c.retryDelayMs > 3000)) {
    throw new Error('EO_TIMING_CONFIG_REQUIRES_REVIEW');
  }
  if (new Set(config.notify.map(c => c.name)).size !== config.notify.length) throw new Error('NOTIFICATION_NAMES_MUST_BE_UNIQUE');
}

export async function loadCheckpoint(store) {
  const value = await readJSON(store, STATE_KEY);
  if (value === null) return { schema: 1, lastSlot: -1, state: createState(), outbox: [], retentionDay: null };
  if (value?.schema !== 1 || value.state?.version !== 1 || !value.state.checks || !Array.isArray(value.state.incidents) || !Array.isArray(value.outbox) || !Number.isInteger(value.lastSlot)) {
    throw new Error('INVALID_STATUS_CHECKPOINT');
  }
  return value;
}

function eventId(event) {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

export function reduceBatch(checkpoint, batch, config) {
  if (batch.slot <= checkpoint.lastSlot) return checkpoint;
  const next = clone(checkpoint);
  const state = next.state;
  appendHistory(state, batch);
  reconcile(state, config.checks, batch.completedAt);
  const events = [];
  for (const result of batch.samples) {
    const check = config.checks.find(c => c.id === result.id);
    if (!check) throw new Error('UNKNOWN_SAMPLE_ID');
    events.push(...applySample(state, check, result.sample, { now: result.at, timezone: config.timezone }));
    events.push(...recordCertificates(state, result.sample.certificates ?? [], { now: result.at, warnDays: config.certificateWarnDays }));
    if (result.sample.version && state.release?.value !== result.sample.version) state.release = { value: result.sample.version, seenAt: result.at };
  }
  for (const event of events) {
    const channels = config.notify.filter(c => c.events.includes(event.type)).map(c => c.name);
    if (channels.length) next.outbox.push({ id: eventId(event), event, channels });
  }
  next.lastSlot = batch.slot;
  if (batch.region) next.lastExecution = { region: batch.region, completedAt: batch.completedAt, requests: batch.requests ?? null, shared: batch.shared ?? null };
  next.retentionDay ??= batch.day;
  return next;
}

async function persistBatch(store, checkpoint, batch, config) {
  const sampleKey = `samples/${batch.day}/${batch.slot}.json`;
  try {
    await writeJSON(store, sampleKey, batch, { onlyIfNew: true });
  } catch (error) {
    if (!isConflict(error)) throw error;
    const saved = await readJSON(store, sampleKey);
    if (JSON.stringify(saved) !== JSON.stringify(batch)) throw new Error('SAMPLE_CONFLICT');
  }
  const next = reduceBatch(checkpoint, batch, config);
  await writeJSON(store, STATE_KEY, next);
  await store.delete(PENDING_KEY);
  return next;
}

async function recoverPending(store, checkpoint, config) {
  const pending = await readJSON(store, PENDING_KEY);
  if (!pending) return checkpoint;
  // An interrupted previous deployment may contain nine checks. Replay it before
  // adding the new JWXT check; never discard its durable historical samples.
  if (!Number.isInteger(pending.slot) || !Array.isArray(pending.samples) || !pending.samples.length || new Set(pending.samples.map(s => s.id)).size !== pending.samples.length || pending.samples.some(s => !config.checks.some(c => c.id === s.id))) throw new Error('INVALID_PENDING_BATCH');
  if (pending.slot <= checkpoint.lastSlot) {
    await store.delete(PENDING_KEY);
    return checkpoint;
  }
  return persistBatch(store, checkpoint, pending, config);
}

// Per-channel acknowledgements survive cold starts. A lost acknowledgement can
// still cause redelivery: external notification APIs do not offer transactions.
async function deliverOutbox(store, checkpoint, config, send) {
  for (const channel of config.notify) {
    const entries = checkpoint.outbox.filter(e => e.channels.includes(channel.name));
    if (!entries.length) continue;
    const results = await send(channel, entries.map(e => e.event));
    if (!results.every(result => result.ok) || !results.length) continue;
    for (const entry of entries) entry.channels = entry.channels.filter(name => name !== channel.name);
    checkpoint.outbox = checkpoint.outbox.filter(entry => entry.channels.length);
    await writeJSON(store, STATE_KEY, checkpoint);
  }
}

function nextDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function cleanupHistory(store, checkpoint, config, now) {
  const oldestKept = recentDayKeys(now, config.timezone, 90)[0];
  const day = checkpoint.retentionDay;
  if (!day || day >= oldestKept) return;
  // One bounded chunk per tick; 25/minute exceeds 1,440 daily samples. No TTL
  // assumption. Never enumerate or delete outside the expired samples prefix.
  const prefix = `samples/${day}/`;
  const listing = await store.list({ prefix, limit: 25, consistency: 'strong' });
  for (const { key } of listing.blobs) {
    if (!key.startsWith(prefix)) throw new Error('UNEXPECTED_RETENTION_KEY');
    await store.delete(key);
  }
  if (listing.blobs.length < 25) checkpoint.retentionDay = nextDay(day);
  await writeJSON(store, STATE_KEY, checkpoint);
}

export async function runTick({ store, config, now = Date.now, probe, connectivity, send, cleanup = true, sleep, region = null }) {
  assertEOConfig(config);
  const startedAt = now();
  const slot = Math.floor(startedAt / 60000);
  const lock = await acquireWriter(store, now);
  if (!lock) return { code: 'busy', status: 409 };
  try {
    let checkpoint = await recoverPending(store, await loadCheckpoint(store), config);
    if (slot <= checkpoint.lastSlot) return { code: 'already_recorded', status: 200, slot };
    await seedHistory(store, checkpoint, config, startedAt);
    const guard = connectivity ?? createConnectivityGuard({ urls: config.connectivityUrls, timeoutMs: 4000 });
    let connectivityResult;
    const sharedProbe = createSharedProbe();
    const runProbe = probe ?? sharedProbe.probe;
    const sampleTimes = new Map();
    const monitor = createMonitor({ config, ...(sleep ? { sleep } : {}), run: async check => {
      const sample = await runProbe(check);
      sampleTimes.set(check.id, now());
      // Check our own connectivity as soon as any attempt fails, concurrently
      // with the original retry delay and retry. Await it before returning.
      if (sample.outcome === 'down') connectivityResult ??= guard.isOnline();
      return sample;
    } });
    // runOnce already runs all configured checks concurrently, with the original
    // timeout/retry and asset/TLS logic. There are no timers after the response.
    const results = await monitor.runOnce();
    const online = connectivityResult ? await connectivityResult : true;
    const completedAt = now();
    const batch = {
      schema: 1, slot, startedAt, completedAt, day: dayKey(completedAt, config.timezone), region,
      requests: probe ? null : sharedProbe.stats.requests, shared: probe ? null : sharedProbe.stats.shared,
      samples: results.map(({ check, sample }) => ({ id: check.id, at: sampleTimes.get(check.id), sample: { ...sample, outcome: sample.outcome === 'down' && !online ? 'unknown' : sample.outcome } })),
    };
    await writeJSON(store, PENDING_KEY, batch);
    checkpoint = await persistBatch(store, checkpoint, batch, config);
    const deliver = send ?? ((channel, events) => createNotifier({
      channels: [channel], context: { siteName: config.siteName, publicUrl: config.publicUrl, timezone: config.timezone }, logger: SILENT,
    }).send(events));
    await deliverOutbox(store, checkpoint, config, deliver);
    if (cleanup) await cleanupHistory(store, checkpoint, config, now());
    return { code: 'recorded', status: 200, slot, checks: batch.samples.length, updatedAt: completedAt, pendingNotifications: checkpoint.outbox.length, region, requests: batch.requests, shared: batch.shared };
  } finally {
    await releaseWriter(store, lock);
  }
}
