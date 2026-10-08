import { recentDayKeys } from '../src/time.mjs';
import { readJSON } from './storage.mjs';

const HOUR = 3600000;
const MAX_BACKFILL = 64;
const MINUTE = 60000;
const counts = value => Array.isArray(value) ? value : [value?.up ?? 0, value?.slow ?? 0, value?.down ?? 0];

// Presentation-only cache. Daily state and immutable raw samples remain intact.
export function appendHistory(state, batch) {
  const history = state.timeline ??= { version: 2, hours: {}, minutes: {} };
  history.minutes ??= {};
  for (const { id, at, sample } of batch.samples) {
    if (!Number.isFinite(at) || !['up', 'slow', 'down'].includes(sample.outcome)) continue;
    const hour = Math.floor(at / HOUR) * HOUR;
    for (const [map,key] of [[history.hours,hour],[history.minutes,Math.floor(at/MINUTE)*MINUTE]]) {
      const group=map[key] ??= {};
      const bucket=group[id]=counts(group[id]);
      bucket[['up','slow','down'].indexOf(sample.outcome)]++;
    }
  }
  const cutoff = Math.floor(batch.completedAt / HOUR) * HOUR - (90*24-1) * HOUR;
  for (const hour of Object.keys(history.hours)) if (Number(hour) < cutoff) delete history.hours[hour];
  const minuteCutoff=Math.floor(batch.completedAt/MINUTE)*MINUTE-1439*MINUTE;
  for(const minute of Object.keys(history.minutes))if(Number(minute)<minuteCutoff)delete history.minutes[minute];
}

// One bounded upgrade pass under the existing writer lock. Never read raw
// history on page requests; if data is incomplete, the view stays daily.
export async function seedHistory(store, checkpoint, config, now) {
  if (checkpoint.state.timeline?.version === 2) return;
  checkpoint.state.timeline = { version: 2, hours: checkpoint.state.timeline?.hours ?? {}, minutes: {} };
  const dates = Object.values(checkpoint.state.checks).flatMap(entry => Object.keys(entry.days ?? {})).sort();
  const recent = recentDayKeys(now, config.timezone, 2);
  if (!dates.length || dates[0] < recent[0]) return;
  try {
    const keys = [];
    for (const date of recent) {
      const prefix = `samples/${date}/`;
      const listing = await store.list({ prefix, limit: MAX_BACKFILL + 1, consistency: 'strong' });
      if (listing.blobs.length > MAX_BACKFILL || listing.cursor) return;
      for (const { key } of listing.blobs) {
        if (!key.startsWith(prefix) || !/^\d+\.json$/.test(key.slice(prefix.length))) throw new Error('INVALID_HISTORY_KEY');
        if (Number(key.slice(prefix.length, -5)) <= checkpoint.lastSlot) keys.push(key);
      }
      if (keys.length > MAX_BACKFILL) return;
    }
    const candidate = { timeline: { version: 2, hours: {}, minutes: {} } };
    for (let offset = 0; offset < keys.length; offset += 8) {
      const batches = await Promise.all(keys.slice(offset, offset + 8).map(key => readJSON(store, key)));
      for (const batch of batches) {
        if (!batch || !Array.isArray(batch.samples) || !Number.isFinite(batch.completedAt)) throw new Error('INVALID_HISTORY_BATCH');
        appendHistory(candidate, batch);
      }
    }
    checkpoint.state.timeline = candidate.timeline;
  } catch {
    // A display-cache failure must not interrupt monitoring or invent data.
  }
}
