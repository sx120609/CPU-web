import { randomUUID } from 'node:crypto';

export const WRITER_KEY = 'control/writer.json';
const RECOVERY_KEY = 'control/recovery.json';
// The deployment's hard maxDuration is 120 seconds. Never steal a live writer.
const ABANDONED_AFTER_MS = 5 * 60 * 1000;
export const isConflict = (error) => error?.code === 'PRECONDITION_FAILED';

export async function readJSON(store, key) {
  return store.get(key, { type: 'json', consistency: 'strong' });
}

export async function writeJSON(store, key, value, options) {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('STATUS_OBJECT_TOO_LARGE');
  return store.setJSON(key, value, options);
}

export async function acquireWriter(store, now = Date.now) {
  const owner = randomUUID();
  const lock = { owner, acquiredAt: now() };
  try {
    await writeJSON(store, WRITER_KEY, lock, { onlyIfNew: true });
    return { owner };
  } catch (error) {
    if (!isConflict(error)) throw error;
  }
  const prior = await readJSON(store, WRITER_KEY);
  if (!prior || !Number.isFinite(prior.acquiredAt) || now() - prior.acquiredAt < ABANDONED_AFTER_MS) return null;

  // One recovery actor only. If THIS actor is forcibly killed during recovery,
  // fail closed; an operator must inspect/remove the orphan recovery marker.
  // A KV get/put or a time-expiring in-memory lock cannot provide this exclusion.
  try {
    await writeJSON(store, RECOVERY_KEY, { owner, writer: prior.owner, acquiredAt: now() }, { onlyIfNew: true });
  } catch (error) {
    if (isConflict(error)) return null;
    throw error;
  }
  try {
    const current = await readJSON(store, WRITER_KEY);
    if (current?.owner === prior.owner && now() - current.acquiredAt >= ABANDONED_AFTER_MS) {
      await store.delete(WRITER_KEY);
    }
    try {
      await writeJSON(store, WRITER_KEY, lock, { onlyIfNew: true });
      return { owner };
    } catch (error) {
      if (isConflict(error)) return null;
      throw error;
    }
  } finally {
    await store.delete(RECOVERY_KEY);
  }
}

export async function releaseWriter(store, lock) {
  if ((await readJSON(store, WRITER_KEY))?.owner === lock.owner) await store.delete(WRITER_KEY);
}
