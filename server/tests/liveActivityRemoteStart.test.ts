import test, { before } from 'node:test';
import assert from 'node:assert/strict';
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }, { id: 2, name: '2', start: '08:55', end: '09:40' }];
const devices: any[] = [], plans: any[] = [], versions: any[] = [];
let seq = 0;
function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => matches(row, w));
    if (k === 'NOT') return !matches(row, v);
    if (k === 'userId_installationId' || k === 'deviceId_itemID') return matches(row, v);
    if (k === 'device') return matches(devices.find(d => d.id === row.deviceId), v);
    const a = row?.[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) return Object.entries(v).every(([op, b]: [string, any]) => {
      if (op === 'in') return b.includes(a);
      if (op === 'not') return a !== b;
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      throw Error(op);
    });
    return a === v;
  });
}
function assign(row: any, data: any) {
  for (const [k, v] of Object.entries(data) as [string, any][]) row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] || 0) + v.increment : v;
  row.updatedAt = new Date(); return row;
}
function model(rows: any[]) {
  return {
    async findUnique({ where, include }: any) { const r = rows.find(r => matches(r, where)); return r && include?.device ? { ...r, device: devices.find(d => d.id === r.deviceId) } : r; },
    async findMany({ where, take, include }: any) { return rows.filter(r => matches(r, where)).slice(0, take).map(r => include?.device ? { ...r, device: devices.find(d => d.id === r.deviceId) } : r); },
    async upsert({ where, create, update }: any) {
      let row = rows.find(r => matches(r, where));
      if (!row) { row = { id: String(++seq), enabled: true, launchMode: 'remote', modeRevision: 0, planRevision: 0, state: 'pending', attempts: 0, broadcastUntil: new Date(0), ...create }; rows.push(row); return assign(row, {}); }
      return assign(row, update);
    },
    async update({ where, data }: any) { const row = rows.find(r => matches(r, where)); assert.ok(row); return assign(row, data); },
    async updateMany({ where, data }: any) { const found = rows.filter(r => matches(r, where)); found.forEach(r => assign(r, data)); return { count: found.length }; },
  };
}
const db: any = {
  $queryRaw: async () => [], $transaction: async (fn: any) => fn(db),
  siteSetting: { findMany: async () => Object.entries({ keyPath: '/test.p8', keyID: 'KEY', teamID: 'TEAM', bundleID: 'cn.cputime.mobile', channels: JSON.stringify({ [`production:main-campus:${version}:end-period-2`]: 'test-end-2' }) }).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })) },
  schedulePeriodConfig: { findUnique: async () => ({ periods: JSON.stringify(periods) }) },
  liveActivityDevice: model(devices), liveActivityPlan: model(plans), liveActivityScheduleVersion: model(versions),
};
process.env.DATABASE_URL ||= 'postgres://live-activity-test';
(globalThis as any).prisma = db;
let service: typeof import('../src/services/liveActivityRemoteStart');
let version: string;
before(async () => {
  service = await import('../src/services/liveActivityRemoteStart');
  version = (await import('../src/services/liveActivitySchedule')).timingVersion(periods);
});
const now = Date.parse('2026-09-22T07:45:00+08:00');
function input(planRevision = 1, installationId = 'installation-0001') {
  return { installationId, accountScope: 'account-scope-0001', token: 'ab'.repeat(32), environment: 'production', bundleID: 'cn.cputime.mobile',
    protocolVersion: 2, scheduleId: 'main-campus', scheduleVersion: version, planRevision, leadMinutes: 15,
    coverageStart: '2026-09-22', coverageEndExclusive: '2026-12-01', busyIntervals: [],
    items: [{ occurrenceId: 'course-a', supersedes: [] as string[], dateKey: '2026-09-22', startPeriod: 1, endPeriod: 2 }] };
}
test('monotonic full replacement, token rotation, revoke and re-enable retain submitted identities', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const first = await service.syncRemoteStarts(1, input());
  assert.equal(plans.length, 1); assert.equal(plans[0].fireAt.getTime(), now);
  await service.syncRemoteStarts(1, input()); assert.equal(plans.length, 1);
  await assert.rejects(service.syncRemoteStarts(1, { ...input(), leadMinutes: 30 }), /版本冲突/);
  plans[0].state = 'submitted';
  await service.syncRemoteStarts(1, { ...input(2), token: 'cd'.repeat(32), items: [] });
  assert.equal(plans[0].state, 'submitted');
  await service.revokeRemoteStarts(first.revoke);
  assert.equal(devices[0].enabled, false); assert.equal(plans[0].state, 'submitted');
  await service.syncRemoteStarts(1, input(3)); assert.equal(plans[0].state, 'submitted');
});
test('handoff is idempotent, retains ambiguous history and rejects stale remote requests', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const body = input(1, 'installation-0002'); body.token = 'ef'.repeat(32);
  const registered = await service.syncRemoteStarts(2, body);
  const row = plans.find(p => p.deviceId === registered.deviceID); row.state = 'submissionUnknown';
  const handoff = await service.switchToLocal(2, { ...body, handoffId: 'handoff-1' });
  assert.equal(handoff.records[0].state, 'submissionUnknown');
  assert.deepEqual(await service.switchToLocal(2, { ...body, handoffId: 'handoff-1' }), handoff);
  await assert.rejects(service.syncRemoteStarts(2, { ...body, planRevision: 2 }), /已切换/);
  assert.equal(row.state, 'submissionUnknown');
});
test('splits retain submission protection and empty snapshots cancel all pending jobs', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const body = input(4); body.items[0] = { ...body.items[0], occurrenceId: 'split-a', supersedes: ['course-a'] };
  await service.syncRemoteStarts(1, body);
  assert.equal(plans.find(p => p.itemID === 'split-a').state, 'terminal');
  const fresh = input(1, 'installation-0004'); fresh.token = '34'.repeat(32);
  const result = await service.syncRemoteStarts(4, fresh);
  await service.syncRemoteStarts(4, { ...fresh, planRevision: 2, items: [] });
  assert.equal(plans.find(p => p.deviceId === result.deviceID).state, 'cancelled');
});
test('v2 payload binds identity, account, timing version, final channel and stale date', () => {
  const c = service.parseCoursePlan(input(), periods, now / 1000)[0];
  const aps = service.remoteStartPayload(c, 'end-2', now / 1000, 'account-scope-0001', version).aps;
  assert.equal(aps.attributes.occurrenceId, 'course-a'); assert.equal(aps.attributes.broadcastWindow, '2');
  assert.equal(aps['stale-date'], c.end); assert.equal(aps['content-state'].protocolVersion, 2); assert.equal(aps['content-state'].courseName, '');
});

test('committed send intent survives unknown results and configuration changes never resend it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const body = input(1, 'installation-0005'); body.token = '56'.repeat(32);
  const registered = await service.syncRemoteStarts(5, body);
  const row = plans.find(p => p.deviceId === registered.deviceID);
  let sends = 0;
  const send = async () => {
    sends++;
    assert.equal(row.state, 'submitting', 'intent must be durable before external I/O');
    throw new Error('connection lost after request');
  };
  await service.tickRemoteStarts(send);
  assert.equal(row.state, 'submissionUnknown'); assert.equal(sends, 1);
  await service.syncRemoteStarts(5, { ...body, planRevision: 2, leadMinutes: 30 });
  await service.tickRemoteStarts(send);
  assert.equal(sends, 1); assert.equal(row.state, 'submissionUnknown');
});

test('explicit transient rejection retries within expiry; accepted results retain identity', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const body = input(1, 'installation-0006'); body.token = '78'.repeat(32);
  const registered = await service.syncRemoteStarts(6, body);
  const row = plans.find(p => p.deviceId === registered.deviceID);
  let sends = 0;
  await service.tickRemoteStarts(async () => { sends++; throw Object.assign(new Error('busy'), { status: 503 }); });
  assert.equal(row.state, 'pending'); assert.equal(row.attempts, 1);
  assert.ok(row.nextAttemptAt.getTime() > now);
  t.mock.timers.tick(5000);
  await service.tickRemoteStarts(async () => { sends++; return { status: 200, body: '' }; });
  assert.equal(row.state, 'submitted'); assert.equal(sends, 2);
  await service.syncRemoteStarts(6, { ...body, planRevision: 2, leadMinutes: 30 });
  assert.equal(row.state, 'submitted');
});
