import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const DAY_MS = 24 * 60 * 60 * 1000;
const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

function replace(t: TestContext, target: any, key: string, value: any) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

async function qqLogFixture(t: TestContext, rows: Array<{ id: number; eventType: string; createdAt: Date }>) {
  const { prisma } = await import("../src/prisma");
  const service = await import("../src/services/logRetention");
  const selects: any[] = [];
  replace(t, prisma.qqBotMessageLog, "findFirst", async ({ where }: any) => {
    const types = [...new Set(rows.map((row) => row.eventType))].sort();
    const eventType = types.find((type) => where.eventType?.gt === undefined || type > where.eventType.gt);
    return eventType === undefined ? null : { eventType };
  });
  replace(t, prisma.qqBotMessageLog, "findMany", async ({ where, take }: any) => {
    selects.push(where);
    return rows
      .filter((row) => row.eventType === where.eventType && row.createdAt < where.createdAt.lt)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, take)
      .map((row) => ({ id: row.id }));
  });
  replace(t, prisma.qqBotMessageLog, "deleteMany", async ({ where }: any) => {
    const before = rows.length;
    rows.splice(0, rows.length, ...rows.filter((row) => !where.id.in.includes(row.id)));
    return { count: before - rows.length };
  });
  return { ...service, rows, selects };
}

test("QQBot 日志保留天数默认 30 天，非法或小于 1 天的配置回退默认值", async () => {
  const { qqBotLogRetentionDays } = await import("../src/services/logRetention");
  assert.equal(qqBotLogRetentionDays(undefined), 30);
  assert.equal(qqBotLogRetentionDays(""), 30);
  assert.equal(qqBotLogRetentionDays("0"), 30);
  assert.equal(qqBotLogRetentionDays("-3"), 30);
  assert.equal(qqBotLogRetentionDays("abc"), 30);
  assert.equal(qqBotLogRetentionDays("7"), 7);
  assert.equal(qqBotLogRetentionDays("14.9"), 14);
});

test("过期 QQBot 日志按事件类型分批删除，通知投递记录和保留期内的日志不动", async (t) => {
  const now = new Date("2026-09-26T00:00:00.000Z");
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const old = new Date(cutoff.getTime() - 1);
  const f = await qqLogFixture(t, [
    { id: 1, eventType: "message", createdAt: old },
    { id: 2, eventType: "notification", createdAt: old },
    { id: 3, eventType: "webhook", createdAt: old },
    { id: 4, eventType: "message", createdAt: cutoff },
    { id: 5, eventType: "group-message", createdAt: new Date(old.getTime() - DAY_MS) },
    { id: 6, eventType: "notification", createdAt: new Date(old.getTime() - 400 * DAY_MS) },
    { id: 7, eventType: "private-message", createdAt: now },
  ]);

  const result = await f.pruneQqBotMessageLogs(now, 30);

  assert.deepEqual(result, { deleted: 3, batches: 3 });
  assert.deepEqual(f.rows.map((row) => row.id).sort((a, b) => a - b), [2, 4, 6, 7]);
  // 每次删除都用事件类型等值 + 创建时间范围命中 (eventType, createdAt) 索引，且从不扫描 notification。
  for (const where of f.selects) {
    assert.equal(typeof where.eventType, "string");
    assert.notEqual(where.eventType, "notification");
    assert.equal(where.createdAt.lt.getTime(), cutoff.getTime());
  }
});

test("单次清理受批次上限约束，剩余积压留给下一次运行", async (t) => {
  const now = new Date("2026-09-26T00:00:00.000Z");
  const old = new Date(now.getTime() - 60 * DAY_MS);
  const f = await qqLogFixture(t, Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    eventType: "message",
    createdAt: new Date(old.getTime() + index),
  })));

  assert.deepEqual(await f.pruneQqBotMessageLogs(now, 30, { batchSize: 2, maxBatches: 3 }), { deleted: 6, batches: 3 });
  // 从最旧的记录开始删除。
  assert.deepEqual(f.rows.map((row) => row.id), [7]);
  assert.deepEqual(await f.pruneQqBotMessageLogs(now, 30, { batchSize: 2, maxBatches: 3 }), { deleted: 1, batches: 1 });
  assert.equal(f.rows.length, 0);
});

test("过期运行时会话分批删除，删除时再次校验过期时间以保留刚续期的会话", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { pruneExpiredRuntimeSessions } = await import("../src/services/logRetention");
  const now = new Date("2026-09-26T00:00:00.000Z");
  const rows = [
    { key: "a", expiresAt: new Date(now.getTime() - 1000) },
    { key: "b", expiresAt: now },
    { key: "c", expiresAt: new Date(now.getTime() - 2000) },
    { key: "d", expiresAt: new Date(now.getTime() + 60_000) },
  ];
  replace(t, prisma.runtimeSession, "findMany", async ({ where, take }: any) => {
    const found = rows
      .filter((row) => row.expiresAt <= where.expiresAt.lte)
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .slice(0, take);
    // 模拟查询之后、删除之前会话 a 被其他请求续期。
    const renewed = rows.find((row) => row.key === "a");
    if (renewed) renewed.expiresAt = new Date(now.getTime() + 60_000);
    return found.map((row) => ({ key: row.key }));
  });
  replace(t, prisma.runtimeSession, "deleteMany", async ({ where }: any) => {
    const before = rows.length;
    rows.splice(0, rows.length, ...rows.filter((row) => !(where.key.in.includes(row.key) && row.expiresAt <= where.expiresAt.lte)));
    return { count: before - rows.length };
  });

  const result = await pruneExpiredRuntimeSessions(now);

  assert.deepEqual(result, { deleted: 2, batches: 1 });
  assert.deepEqual(rows.map((row) => row.key).sort(), ["a", "d"]);
});

test("QQBot 日志清理失败不影响运行时会话清理，清理任务注册在后台 worker 中", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { runLogRetentionSweep } = await import("../src/services/logRetention");
  t.mock.method(console, "warn", () => {});
  replace(t, prisma.qqBotMessageLog, "findFirst", async () => { throw new Error("database timeout"); });
  replace(t, prisma.runtimeSession, "findMany", async () => []);

  const result = await runLogRetentionSweep(new Date("2026-09-26T00:00:00.000Z"));

  assert.equal(result.qqBotLogs, null);
  assert.deepEqual(result.runtimeSessions, { deleted: 0, batches: 0 });
  assert.match(appSource, /export function startAppWorkers\(\) \{[^}]*startLogRetentionSweeper\(\);[^}]*\}/);
});
