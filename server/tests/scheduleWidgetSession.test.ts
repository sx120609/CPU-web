import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";
process.env.JWT_SECRET = "widget-session-test-secret-0123456789abcdef";
process.env.JWXT_SESSION_SYNC_KEY = "widget-session-sync-test-0123456789abcdef";

test("successful login syncs only active widgets of that account and preserves their saved timetable", async () => {
  const { scheduleWidgetSessions } = await import("../src/services/scheduleWidgetSession");
  const { prisma } = await import("../src/prisma");
  const { getEphemeralValue, setEphemeralValue } = await import("../src/services/cache");
  const { buildRedisKey } = await import("../src/services/redis");
  const originalUpdate = prisma.scheduleWidgetToken.updateMany;
  const rows = [
    { userId: 71, jwxtToken: "old-school-token", revokedAt: null, cachedPayload: "saved-course-dates", cachedAt: 123 },
    { userId: 72, jwxtToken: "other-school-token", revokedAt: null, cachedPayload: "another-account", cachedAt: 123 },
    { userId: 71, jwxtToken: "revoked-school-token", revokedAt: new Date(), cachedPayload: "revoked", cachedAt: 123 },
  ];
  prisma.scheduleWidgetToken.updateMany = (async ({ where, data }: any) => {
    const matched = rows.filter(row => row.userId === where.userId && !row.revokedAt && row.jwxtToken !== where.jwxtToken.not);
    matched.forEach(row => Object.assign(row, data));
    return { count: matched.length };
  }) as any;
  try {
    assert.equal((await scheduleWidgetSessions.recordLogin(71, "student-a", "fresh-school-token")).count, 1);
    assert.equal(rows[0].jwxtToken, "fresh-school-token");
    assert.equal(rows[0].cachedPayload, "saved-course-dates");
    assert.equal(rows[0].cachedAt, 123);
    assert.equal(rows[1].jwxtToken, "other-school-token");
    assert.equal(rows[2].jwxtToken, "revoked-school-token");
    assert.equal((await scheduleWidgetSessions.latest(71))?.token, "fresh-school-token");
    const raw = await getEphemeralValue(buildRedisKey("jwxt", "user-session", "71"));
    assert.ok(raw && !raw.includes("fresh-school-token") && !raw.includes("student-a"));
    await setEphemeralValue(buildRedisKey("jwxt", "user-session", "72"), raw, 60_000);
    assert.equal(await scheduleWidgetSessions.latest(72), null);
  } finally { prisma.scheduleWidgetToken.updateMany = originalUpdate; }
});

test("an authenticated school account cannot attach another student's session", async () => {
  const { createScheduleWidgetSessionService } = await import("../src/services/scheduleWidgetSession");
  const { prisma } = await import("../src/prisma");
  const originalFind = prisma.user.findUnique;
  prisma.user.findUnique = (async () => ({ username: "student-a", studentSso: true })) as any;
  const service = createScheduleWidgetSessionService(async () => ({ active: true, username: "student-b", since: Date.now() }));
  try {
    await assert.rejects(service.rememberAuthorizedSession(71, "wrong-student-token"), /与当前账号不一致/);
    assert.equal((await service.latest(71))?.token, "fresh-school-token");
  } finally { prisma.user.findUnique = originalFind; }
});

test("the last authorized session has an encrypted durable copy when Redis is unavailable", async () => {
  const { scheduleWidgetSessions } = await import("../src/services/scheduleWidgetSession");
  const { prisma } = await import("../src/prisma");
  const original = { upsert: prisma.runtimeSession.upsert, find: prisma.runtimeSession.findUnique, update: prisma.scheduleWidgetToken.updateMany };
  const databaseUrl = process.env.DATABASE_URL;
  const records = new Map<string, any>();
  process.env.DATABASE_URL = "postgresql://stub-only";
  prisma.runtimeSession.upsert = (async ({ create }: any) => { records.set(create.key, create); return create; }) as any;
  prisma.runtimeSession.findUnique = (async ({ where }: any) => records.get(where.key) || null) as any;
  prisma.scheduleWidgetToken.updateMany = (async () => ({ count: 0 })) as any;
  try {
    await scheduleWidgetSessions.recordLogin(79, "persisted-student", "persisted-school-token");
    assert.equal(records.size, 1);
    const raw = [...records.values()][0].value;
    assert.equal(raw.includes("persisted-school-token"), false);
    assert.equal((await scheduleWidgetSessions.latest(79))?.token, "persisted-school-token");
  } finally {
    process.env.DATABASE_URL = databaseUrl;
    prisma.runtimeSession.upsert = original.upsert;
    prisma.runtimeSession.findUnique = original.find;
    prisma.scheduleWidgetToken.updateMany = original.update;
  }
});
