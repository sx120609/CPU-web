import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { scheduleShareRouter } from "../src/routes/scheduleShares";
import { jwxtRouter } from "../src/routes/jwxt";
import { signToken } from "../src/utils/jwt";

// 需要一个隔离的 PostgreSQL：
// SCHEDULE_SHARE_INTEGRATION_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1/... node tools/run-node-tests.mjs server/tests/scheduleSharing.integration.test.ts
test("share codes and display priority on isolated PostgreSQL", { skip: process.env.SCHEDULE_SHARE_INTEGRATION_TEST !== "1" }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL || "http://invalid").hostname, "127.0.0.1");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/schedule-shares", scheduleShareRouter);
  app.use("/jwxt", jwxtRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const suffix = randomUUID().slice(0, 8);
  const [alice, bob] = await Promise.all(["a", "b"].map((name) => prisma.user.create({
    data: { username: `share-${name}-${suffix}`, passwordHash: "test", nickname: `用户${name.toUpperCase()}` },
  })));
  const call = async (user: { id: number; username: string } | null, method: string, path: string, body?: unknown, client = "ios") => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json", "X-CPU-Client": client,
        ...(user ? { Authorization: `Bearer ${signToken({ userId: user.id, studentId: user.username, role: "user", campus: "" })}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const body = JSON.parse(readFileSync(new URL("../../ios_next/tests/fixtures/schedule-share-body.json", import.meta.url), "utf8"));
  const withCourse = (name: string) => ({
    ...body,
    schedule: { ...body.schedule, cells: [...body.schedule.cells, { day: 2, bigSlot: 1, courses: [{ name, weeks: "1周", weekList: [1] }] }] },
  });

  try {
    const first = (await call(alice, "POST", "/schedule-shares", body)).body.data;
    assert.match(first.code, /^[A-Z2-9]{8}$/u);
    assert.equal(first.created, true);

    const same = (await call(alice, "POST", "/schedule-shares", body)).body.data;
    assert.deepEqual([same.code, same.created, same.changed, same.updatedAt], [first.code, false, false, first.updatedAt]);

    const changed = (await call(alice, "POST", "/schedule-shares", withCourse("高等数学"))).body.data;
    assert.deepEqual([changed.code, changed.changed, changed.courseCount], [first.code, true, 2]);
    assert.notEqual(changed.updatedAt, first.updatedAt);
    assert.equal(await prisma.scheduleShare.count({ where: { ownerId: alice.id } }), 1);

    const read = (await call(null, "GET", `/schedule-shares/${first.code}`)).body.data;
    assert.equal(read.schedule.cells.length, 2);
    assert.deepEqual(read.calendar, body.calendar);
    assert.equal((await call(null, "GET", `/schedule-shares/${first.code}/meta`)).body.data.updatedAt, changed.updatedAt);
    assert.deepEqual((await call(alice, "GET", "/schedule-shares/mine")).body.data.shares.map((item: any) => item.code), [first.code]);
    assert.deepEqual((await call(bob, "GET", "/schedule-shares/mine")).body.data.shares, []);

    assert.equal((await call(bob, "DELETE", `/schedule-shares/${first.code}`)).status, 403);
    assert.equal((await call(alice, "DELETE", `/schedule-shares/${first.code}`)).status, 200);
    assert.equal((await call(null, "GET", `/schedule-shares/${first.code}`)).status, 404);
    assert.equal((await prisma.scheduleShare.findUnique({ where: { code: first.code } }))?.payload, "{}");
    const again = (await call(alice, "POST", "/schedule-shares", body)).body.data;
    assert.equal(again.created, true);
    assert.notEqual(again.code, first.code);

    // 显示优先级：不带字段的保存不会抹掉已存的。
    const save = (edits: unknown, client?: string) => call(alice, "PUT", "/jwxt/schedule-edits", { semester: "2026-2027-1", edits }, client);
    assert.deepEqual((await save({ hidden: [], custom: [], priority: { 药理学: 2 } })).body.data.edits.priority, { 药理学: 2 });
    assert.deepEqual((await save({ hidden: ["jwxt|1|1|||x|||"], custom: [] }, "android")).body.data.edits.priority, { 药理学: 2 });
    assert.deepEqual((await call(alice, "GET", "/jwxt/schedule-edits?semester=2026-2027-1")).body.data.edits, {
      hidden: ["jwxt|1|1|||x|||"], custom: [], priority: { 药理学: 2 },
    });
    assert.equal("priority" in (await save({ hidden: [], custom: [], priority: {} })).body.data.edits, false);
    assert.equal((await call(bob, "GET", "/jwxt/schedule-edits?semester=2026-2027-1")).body.data.edits.priority, undefined);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
});
