import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// A student at another school was told a 14:00 class starts at 14:25: the default school's sixth
// period. Every school's activities are timed by its own bells; these tests hold that.
process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES = '0';
process.env.DATABASE_URL = 'postgresql://unit-test-only/school-bells';
const cpu = [
  { id: 1, name: '1', start: '08:00', end: '08:45' }, { id: 2, name: '2', start: '08:55', end: '09:40' },
  { id: 3, name: '3', start: '09:55', end: '10:40' }, { id: 4, name: '4', start: '10:50', end: '11:35' },
  { id: 5, name: '5', start: '13:30', end: '14:15' }, { id: 6, name: '6', start: '14:25', end: '15:10' },
];
let settings = new Map<string, any>();
let versions = new Map<string, any>();
/** Tables saved in the admin, by school. */
let saved = new Map<string, unknown[]>();
const compare = (value: Date, where: any) => (where?.gte === undefined || value >= where.gte) && (where?.lt === undefined || value < where.lt);
const models: any = {
  siteSetting: {
    findUnique: async ({ where }: any) => settings.get(where.key) ?? null,
    findMany: async ({ where }: any) => [...settings.values()].filter(r => where.key.in.includes(r.key)),
    upsert: async ({ where, create, update }: any) => {
      const row = { ...(settings.get(where.key) ?? create), ...(settings.has(where.key) ? update : {}), updatedAt: new Date() };
      settings.set(where.key, row); return row;
    },
  },
  schedulePeriodConfig: {
    findUnique: async ({ where }: any) => {
      const table = saved.get(where.schoolId ?? 'cpu');
      return table ? { periods: JSON.stringify(table) } : null;
    },
  },
  liveActivityScheduleVersion: {
    upsert: async ({ where, create }: any) => {
      if (!versions.has(where.id)) versions.set(where.id, { broadcastUntil: new Date(0), ...create });
      return versions.get(where.id);
    },
    findUnique: async ({ where }: any) => versions.get(where.id) ?? null,
    count: async ({ where }: any) => [...versions.values()].filter(v => compare(v.broadcastUntil, where.broadcastUntil)).length,
    updateMany: async ({ where, data }: any) => {
      const row = versions.get(where.id);
      if (row && row.broadcastUntil < where.broadcastUntil.lt) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
    findMany: async ({ where }: any) => [...versions.values()]
      .filter(v => v.id !== where.id?.not && compare(v.broadcastUntil, where.broadcastUntil)),
  },
};
const root: any = { ...models, $queryRaw: async () => [{ acquired: true }] };
root.$transaction = async (fn: any) => fn(root);
(globalThis as any).prisma = root;

let push: typeof import('../src/services/liveActivityPush');
let schedule: typeof import('../src/services/liveActivitySchedule');
let channels: typeof import('../src/services/apnsChannels');
before(async () => {
  push = await import('../src/services/liveActivityPush');
  schedule = await import('../src/services/liveActivitySchedule');
  channels = await import('../src/services/apnsChannels');
});
beforeEach(() => {
  settings.clear(); versions.clear(); saved = new Map([['cpu', cpu]]);
  for (const [key, value] of Object.entries({ keyPath: '/test-only.p8', keyID: 'TEST', teamID: 'TEAM', bundleID: 'test.app', channels: '{}' })) {
    settings.set('apns.' + key, { key: 'apns.' + key, value, updatedAt: new Date() });
  }
});
const config = (schoolId?: string, periods?: unknown) => push.liveActivityBroadcastConfig('production', 'test.app', true, schoolId, periods);
const period = (result: { periods: Array<{ id: number; start: string; end: string }> }, id: number) => result.periods.find(p => p.id === id);

test('the default school keeps its one table, whatever an app declares', async () => {
  const plain = await config();
  assert.equal(plain.scheduleVersion, schedule.timingVersion(cpu));
  assert.equal(period(plain, 6)!.start, '14:25');
  for (const result of [await config('cpu'), await config('cpu', '0820-0900_0910-0950'), await config('no-such-school', '0820-0900')]) {
    assert.equal(result.scheduleVersion, plain.scheduleVersion);
    assert.deepEqual(result.periods, plain.periods);
  }
  assert.equal(versions.size, 1);
});

test("another school is timed by its own bells: a 14:00 class is not the default school's 14:25", async () => {
  const mine = await config('njucm');
  assert.equal(mine.scheduleId, 'main-campus', 'the protocol is the same; only the table differs');
  assert.notEqual(mine.scheduleVersion, schedule.timingVersion(cpu));
  assert.deepEqual([period(mine, 6)!.start, period(mine, 6)!.end, period(mine, 7)!.end], ['14:00', '14:40', '15:30']);
  assert.equal(mine.periods.length, 12);
  assert.deepEqual(mine.windows.map(w => w.id), mine.periods.map(p => String(p.id)));
  assert.ok(versions.get(mine.scheduleVersion).broadcastUntil > new Date(), 'a table in use is held, so it is broadcast');
  // NJMU has fifteen periods of its own.
  const njmu = await config('njmu');
  assert.equal(njmu.periods.length, 15);
  assert.notEqual(njmu.scheduleVersion, mine.scheduleVersion);
});

test("a school's saved table goes over its built-in one, as its timetable is drawn", async () => {
  saved.set('njucm', [{ id: 1, name: '第1节', start: '08:30', end: '09:10' }]);
  const mine = await config('njucm');
  assert.deepEqual([period(mine, 1)!.start, period(mine, 2)!.start, period(mine, 6)!.start], ['08:30', '09:10', '14:00']);
  assert.deepEqual(await schedule.schoolPeriods('njucm'), mine.periods);
});

test('the table an app declares times a campus that rings differently from its school', async () => {
  const declared = '0800-0840_0850-0930_1330-1410';
  const mine = await config('njucm', declared);
  assert.deepEqual(mine.periods.map(p => [p.id, p.start, p.end]), [[1, '08:00', '08:40'], [2, '08:50', '09:30'], [3, '13:30', '14:10']]);
  assert.equal(mine.scheduleVersion, schedule.timingVersion(schedule.declaredPeriods(declared)!));
  // The same table from another student is the same timing: campuses share channels.
  assert.equal((await config('njucm', declared)).scheduleVersion, mine.scheduleVersion);
  // Malformed tables are no table: the school's own stands in.
  const school = await config('njucm');
  for (const bad of ['', '0800-0840,0850-0930', '0850-0930_0800-0840', '0800-0700', '2500-2600', '800-840', ['0800-0840'], Array(21).fill('0800-0801').join('_')]) {
    assert.equal(schedule.declaredPeriods(bad), null, String(bad));
    assert.equal((await config('njucm', bad)).scheduleVersion, school.scheduleVersion, String(bad));
  }
});

test('declared tables cannot crowd out the channels: past the limit a new one falls back to the school', async () => {
  const future = new Date(Date.now() + 86400_000);
  for (let index = 0; index < 48; index++) versions.set(`held-${index}`, { id: `held-${index}`, periods: '[]', broadcastUntil: future });
  const school = schedule.timingVersion(await schedule.schoolPeriods('njucm'));
  assert.equal((await config('njucm', '0800-0840')).scheduleVersion, school);
  // One already held is still handed out.
  const known = schedule.declaredPeriods('0900-0940')!;
  versions.set(schedule.timingVersion(known), { id: schedule.timingVersion(known), scheduleId: 'main-campus', timezone: 'Asia/Shanghai', periods: JSON.stringify(known), broadcastUntil: future });
  assert.equal((await config('njucm', '0900-0940')).scheduleVersion, schedule.timingVersion(known));
});

test('a school with no table of its own is refused rather than timed by another school', async () => {
  const registry = await import('../src/schools/registry');
  registry.applySchoolRows([{ id: 'plain', name: '某校', shortName: '某校', brandName: '某校拾间', tagline: '', enabled: true } as any], []);
  try {
    await assert.rejects(config('plain'), /学校作息未配置/);
    assert.equal((await config('plain', '0800-0840')).periods.length, 1, 'its app can still say how it rings');
  } finally { registry.applySchoolRows([], []); }
});

test("held tables get channels and the day's events beside the default school's; expired ones do not", async () => {
  const mine = await config('njucm');
  const stale = schedule.declaredPeriods('0700-0740')!;
  versions.set(schedule.timingVersion(stale), { id: schedule.timingVersion(stale), periods: JSON.stringify(stale), broadcastUntil: new Date(Date.now() - 3600_000) });
  const suffixes = await channels.requiredChannelSuffixes();
  const version = schedule.timingVersion(cpu);
  assert.equal(suffixes.length, (cpu.length + 12) * 2);
  // The default school's channels come first, ends before starts.
  assert.equal(suffixes[0], `main-campus:${version}:end-period-1`);
  assert.ok(suffixes.includes(`main-campus:${mine.scheduleVersion}:end-period-7`));
  assert.ok(suffixes.includes(`main-campus:${mine.scheduleVersion}:start-period-6`));
  assert.ok(!suffixes.some(suffix => suffix.includes(schedule.timingVersion(stale))));
  // What ends that class is its own table's period, at its own time.
  const events = push.schoolBroadcastEvents({ periods: mine.periods }, '2026-11-13', false, mine.scheduleVersion);
  const end = events.find(event => event.windowID === `${mine.scheduleVersion}:7` && event.event === 'end')!;
  assert.equal(end.fireAt.toISOString(), new Date('2026-11-13T15:30:00+08:00').toISOString());
  assert.equal(push.windowChannelKey('production', end.windowID), schedule.endChannelKey('production', mine.scheduleVersion, 7));
});
