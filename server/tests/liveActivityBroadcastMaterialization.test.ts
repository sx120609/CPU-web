import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://unit-test-only/apns';
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }];
const versions: any[] = [];
const events = new Map<string, any>();
let channels: Record<string, string> = {};
let batches = 0;
const db: any = {
  siteSetting: { findMany: async () => Object.entries({
    keyPath: '/test.p8', keyID: 'TEST', teamID: 'TEAM', bundleID: 'test.app', channels: JSON.stringify(channels),
  }).map(([key, value]) => ({ key: 'apns.' + key, value, updatedAt: new Date() })) },
  schedulePeriodConfig: { findUnique: async () => ({ periods: JSON.stringify(periods) }) },
  liveActivityScheduleVersion: {
    upsert: async ({ create }: any) => {
      if (!versions.length) versions.push({ ...create, broadcastUntil: new Date(0) });
      return versions[0];
    },
    findMany: async ({ select }: any) => versions.map(v => Object.fromEntries(
      Object.keys(select).map(key => [key, v[key]]))),
  },
  liveActivityBroadcastEvent: {
    updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
    createMany: async ({ data, skipDuplicates }: any) => {
      assert.equal(skipDuplicates, true); batches++;
      for (const row of data) {
        const key = row.channelID + ':' + row.eventID;
        if (!events.has(key)) events.set(key, { ...row, state: 'pending' });
      }
    },
  },
};
(globalThis as any).prisma = db;

test('retention renewal avoids rewriting boundaries; adding channels and changing dates preserve sent state', async () => {
  const { timingVersion, endChannelKey } = await import('../src/services/liveActivitySchedule');
  const { ensureBroadcastEvents } = await import('../src/services/liveActivityPush');
  const version = timingVersion(periods);
  channels[endChannelKey('production', version, 1)] = 'production-channel';
  const now = Date.parse('2026-09-22T07:00:00+08:00') / 1000;
  await ensureBroadcastEvents(now);
  assert.equal(batches, 1); assert.equal(events.size, 2);
  const end = [...events.values()].find(e => e.event === 'end');
  end.state = 'sent'; end.attempts = 3;
  versions[0].broadcastUntil = new Date('2026-10-01');
  await ensureBroadcastEvents(now + 61);
  assert.equal(batches, 1, 'a retention extension must not rewrite today');
  channels[endChannelKey('sandbox', version, 1)] = 'sandbox-channel';
  await ensureBroadcastEvents(now + 122);
  assert.equal(batches, 2); assert.equal(events.size, 4);
  assert.equal(end.state, 'sent'); assert.equal(end.attempts, 3);
  await ensureBroadcastEvents(now + 86400);
  assert.equal(events.size, 8);
  assert.equal([...events.values()].filter(e => e.event === 'end').length, 4);
});
