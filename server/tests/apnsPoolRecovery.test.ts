import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://unit-test-only/apns';
let settings = new Map<string, any>();
let versions = new Map<string, any>();
let active = 0;
let transactions = 0;
let lockBusy = false;
let tail: Promise<unknown> = Promise.resolve();
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }];
const models: any = {
  siteSetting: {
    findUnique: async ({ where }: any) => settings.get(where.key) ?? null,
    findMany: async ({ where }: any) => [...settings.values()].filter(r => where.key.in.includes(r.key)),
    upsert: async ({ where, create, update }: any) => {
      const row = { ...(settings.get(where.key) ?? create), ...(settings.has(where.key) ? update : {}), updatedAt: new Date() };
      settings.set(where.key, row); return row;
    },
  },
  schedulePeriodConfig: { findUnique: async () => ({ periods: JSON.stringify(periods) }) },
  liveActivityScheduleVersion: {
    upsert: async ({ where, create }: any) => {
      if (!versions.has(where.id)) versions.set(where.id, { broadcastUntil: new Date(0), ...create });
      return versions.get(where.id);
    },
    updateMany: async ({ where, data }: any) => {
      const row = versions.get(where.id);
      if (row && row.broadcastUntil < where.broadcastUntil.lt) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
    findMany: async ({ where }: any) => [...versions.values()].filter(v => v.id !== where.id.not && v.broadcastUntil < where.broadcastUntil.lt),
  },
};
const tx = { ...models, $queryRaw: async () => [{ acquired: !lockBusy }] };
const root: any = {};
for (const [name, model] of Object.entries(models)) {
  root[name] = Object.fromEntries(Object.entries(model as any).map(([method, fn]) => [method, async (...args: any[]) => {
    assert.equal(active, 0, 'a transaction attempted to acquire a second pool connection');
    return (fn as any)(...args);
  }]));
}
root.$transaction = async (fn: any) => {
  transactions++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  active++;
  const savedSettings = structuredClone(settings), savedVersions = structuredClone(versions);
  try { return await fn(tx); }
  catch (error) { settings = savedSettings; versions = savedVersions; throw error; }
  finally { active--; release(); }
};
(globalThis as any).prisma = root;
let provisionApnsChannels: typeof import('../src/services/apnsChannels').provisionApnsChannels;
let liveActivityBroadcastConfig: typeof import('../src/services/liveActivityPush').liveActivityBroadcastConfig;
let withApnsConfigLock: typeof import('../src/services/apnsConfig').withApnsConfigLock;
let endChannelKey: typeof import('../src/services/liveActivitySchedule').endChannelKey;
let version: string;
before(async () => {
  ({ provisionApnsChannels } = await import('../src/services/apnsChannels'));
  ({ liveActivityBroadcastConfig } = await import('../src/services/liveActivityPush'));
  ({ withApnsConfigLock } = await import('../src/services/apnsConfig'));
  const schedule = await import('../src/services/liveActivitySchedule');
  endChannelKey = schedule.endChannelKey; version = schedule.timingVersion(periods);
});
const key = (env: string) => endChannelKey(env, version, 1);
function put(name: string, value: unknown) {
  settings.set(name, { key: name, value: typeof value === 'string' ? value : JSON.stringify(value), updatedAt: new Date() });
}
function channels() { return JSON.parse(settings.get('apns.channels').value); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  settings.clear(); versions.clear(); lockBusy = false;
  for (const [k, v] of Object.entries({ keyPath: '/test-only.p8', keyID: 'TEST', teamID: 'TEAM', bundleID: 'test.app', channels: '{}' })) put('apns.' + k, v);
});

test('one-connection pool handles concurrent local configuration reads without nested acquisition', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => liveActivityBroadcastConfig('production', 'test.app', true)));
  assert.ok(results.every(r => r.scheduleVersion === version));
  assert.ok(versions.get(version).broadcastUntil > new Date());
  assert.equal(active, 0);
});

test('slow Apple request holds zero database connections; another worker reuses the lease and IDs', async () => {
  const entered = deferred(), finish = deferred();
  let created = 0;
  const transport = {
    create: async () => { assert.equal(active, 0); created++; if (created === 1) { entered.resolve(); await finish.promise; } return 'channel-' + created; },
    delete: async () => { assert.equal(active, 0); },
  };
  const first = provisionApnsChannels(Date.now(), false, transport);
  await entered.promise;
  const second = await provisionApnsChannels(Date.now(), false, transport);
  assert.match(second.channelErrors[0].message, /in progress/);
  await liveActivityBroadcastConfig('production', 'test.app', true);
  assert.equal(created, 1);
  finish.resolve();
  await first;
  const saved = channels();
  await provisionApnsChannels(Date.now(), false, transport);
  assert.equal(created, 2, 'one channel per environment, no recreation on another tick');
  assert.deepEqual(channels(), saved);
});

test('checking sixty existing channels uses a fixed number of transactions', async () => {
  const original = [...periods];
  try {
    periods.splice(0, periods.length, ...Array.from({ length: 30 }, (_, i) => ({
      id: i + 1, name: String(i + 1), start: `00:${String(i * 2).padStart(2, '0')}`,
      end: `00:${String(i * 2 + 1).padStart(2, '0')}`,
    })));
    const { timingVersion } = await import('../src/services/liveActivitySchedule');
    const mapping = Object.fromEntries(['production', 'sandbox'].flatMap(env =>
      periods.map(p => [endChannelKey(env, timingVersion(periods), p.id), env + p.id])));
    put('apns.channels', mapping);
    const before = transactions;
    const result = await provisionApnsChannels(Date.now(), false, {
      create: async () => assert.fail('all channels already exist'),
      delete: async () => assert.fail('nothing retired'),
    });
    assert.equal(result.channelErrors.length, 0);
    assert.ok(transactions - before <= 8, 'existing channels must not each open a transaction');
    assert.deepEqual(channels(), mapping);
  } finally { periods.splice(0, periods.length, ...original); }
});

test('partial create success persists immediately and only missing channels are retried', async () => {
  let calls = 0;
  const transport = { create: async () => { if (++calls === 2) throw Error('Apple unavailable'); return 'id-' + calls; }, delete: async () => {} };
  const first = await provisionApnsChannels(Date.now(), false, transport);
  assert.equal(first.channelErrors.length, 1);
  assert.equal(channels()[key('production')], 'id-1');
  await provisionApnsChannels(Date.now(), false, transport);
  assert.equal(calls, 3);
  assert.equal(channels()[key('production')], 'id-1');
});

test('expired owner cannot replace a successor ID or release its lease', async () => {
  const entered = deferred(), finish = deferred();
  const first = provisionApnsChannels(Date.now(), false, {
    create: async () => { entered.resolve(); await finish.promise; return 'late-id'; }, delete: async () => {},
  });
  const rejected = assert.rejects(first, /lease expired or changed/);
  await entered.promise;
  put('apns.channels.lease', { owner: 'successor', expiresAt: Date.now() + 60_000 });
  put('apns.channels', { [key('production')]: 'winner' });
  finish.resolve();
  await rejected;
  assert.equal(channels()[key('production')], 'winner');
  assert.equal(JSON.parse(settings.get('apns.channels.lease').value).owner, 'successor');
  assert.equal(JSON.parse(settings.get('apns.channels.pending-deletions').value)[0].channel, 'late-id');
});

test('retired channel deletion is outside transactions and survives failure for later retry', async () => {
  put('apns.channels', { 'production:cpu-morning': 'old', [key('production')]: 'keep-prod', [key('sandbox')]: 'keep-sandbox' });
  let deletionCount = 0;
  const transport = {
    create: async () => { throw Error('existing channels must be reused'); },
    delete: async () => { assert.equal(active, 0); assert.ok(!Object.values(channels()).includes('old')); if (++deletionCount === 1) throw Error('offline'); },
  };
  const first = await provisionApnsChannels(Date.now(), true, transport);
  assert.equal(first.channelErrors.length, 1);
  assert.equal(JSON.parse(settings.get('apns.channels.pending-deletions').value).length, 1);
  await provisionApnsChannels(Date.now(), true, transport);
  assert.equal(deletionCount, 2);
  assert.deepEqual(JSON.parse(settings.get('apns.channels.pending-deletions').value), []);
  assert.deepEqual(Object.values(channels()).sort(), ['keep-prod', 'keep-sandbox']);
});

test('global advisory contention releases its connection without invoking the operation', async () => {
  lockBusy = true;
  await assert.rejects(withApnsConfigLock(async () => assert.fail('must not run')), /busy/);
  assert.equal(active, 0);
});

test('provider rotation during Apple I/O cannot publish a stale channel', async () => {
  const entered = deferred(), finish = deferred();
  const job = provisionApnsChannels(Date.now(), false, {
    create: async () => { entered.resolve(); await finish.promise; return 'old-provider-channel'; }, delete: async () => {},
  });
  const rejected = assert.rejects(job, /provider changed/);
  await entered.promise;
  put('apns.bundleID', 'replacement.app');
  finish.resolve();
  await rejected;
  assert.deepEqual(channels(), {});
  assert.equal(JSON.parse(settings.get('apns.channels.pending-deletions').value)[0].provider.bundleID, 'test.app');
});
