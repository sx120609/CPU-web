import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.APNS_TEST_DATABASE_URL;
test('real PostgreSQL: one-connection pool survives concurrent config reads, lock contention and slow Apple I/O', { skip: !databaseUrl, timeout: 30000 }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/cpu_apns_regression', 'only the isolated CI database is allowed');
  const schema = 'apns_pool_regression';
  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
  await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '1');
  url.searchParams.set('application_name', 'apns-pool-regression');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let releaseApple: (() => void) | undefined;
  let releaseLock: (() => void) | undefined;
  try {
    await db.$executeRawUnsafe('CREATE TABLE "SiteSetting" ("id" SERIAL PRIMARY KEY, "key" TEXT UNIQUE NOT NULL, "value" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL)');
    await db.$executeRawUnsafe('CREATE TABLE "SchedulePeriodConfig" ("id" INTEGER PRIMARY KEY DEFAULT 1, "periods" TEXT NOT NULL DEFAULT \'[]\', "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)');
    await db.$executeRawUnsafe('CREATE TABLE "LiveActivityScheduleVersion" ("id" TEXT PRIMARY KEY, "scheduleId" TEXT NOT NULL, "timezone" TEXT NOT NULL, "periods" TEXT NOT NULL, "broadcastUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    process.env.DATABASE_URL = url.toString();
    (globalThis as any).prisma = db;
    const { liveActivityBroadcastConfig } = await import('../src/services/liveActivityPush');
    const { withApnsConfigLock } = await import('../src/services/apnsConfig');
    const { provisionApnsChannels } = await import('../src/services/apnsChannels');
    const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }];
    await db.schedulePeriodConfig.create({ data: { periods: JSON.stringify(periods) } });
    for (const [key, value] of Object.entries({ keyPath: '/test-only.p8', keyID: 'TEST', teamID: 'TEAM', bundleID: 'test.app', channels: '{}' })) {
      await db.siteSetting.create({ data: { key: 'apns.' + key, value } });
    }
    const configs = await Promise.all(Array.from({ length: 20 }, () => liveActivityBroadcastConfig('production', 'test.app', true)));
    assert.ok(configs.every(c => c.windows.length === 1));

    let enteredLock!: () => void;
    const lockEntered = new Promise<void>(r => { enteredLock = r; });
    const lockWait = new Promise<void>(r => { releaseLock = r; });
    const holder = admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(742091, 1)');
      enteredLock(); await lockWait;
    }, { timeout: 10000 });
    await lockEntered;
    const started = Date.now();
    await assert.rejects(withApnsConfigLock(async () => assert.fail('must not acquire busy lock')), /busy/);
    assert.ok(Date.now() - started < 1500);
    await db.$queryRaw`SELECT 1`;
    releaseLock!(); await holder;

    let enteredApple!: () => void;
    const appleEntered = new Promise<void>(r => { enteredApple = r; });
    const appleWait = new Promise<void>(r => { releaseApple = r; });
    let created = 0;
    const transport = { create: async () => {
      if (++created === 1) { enteredApple(); await appleWait; }
      return 'test-channel-' + created;
    }, delete: async () => assert.fail('nothing retired') };
    const provision = provisionApnsChannels(Date.now(), false, transport);
    await appleEntered;
    const [activity] = await admin.$queryRawUnsafe<Array<{ count: bigint }>>("SELECT count(*) FROM pg_stat_activity WHERE application_name='apns-pool-regression' AND state='idle in transaction'");
    assert.equal(Number(activity.count), 0);
    await db.$queryRaw`SELECT 1`;
    await liveActivityBroadcastConfig('production', 'test.app', true);
    const competing = await provisionApnsChannels(Date.now(), false, transport);
    assert.match(competing.channelErrors[0].message, /in progress/);
    releaseApple!(); await provision;
    await provisionApnsChannels(Date.now(), false, transport);
    assert.equal(created, 2, 'existing channel IDs remain stable');
  } finally {
    releaseApple?.(); releaseLock?.();
    await db.$disconnect();
    await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.$disconnect();
  }
});
