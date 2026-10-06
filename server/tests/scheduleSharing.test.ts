import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { scheduleShareRouter } from "../src/routes/scheduleShares";
import { normalizeSchedulePayload } from "../src/services/scheduleSharing";
import { signToken } from "../src/utils/jwt";

// 这里不连数据库：用内存里的表顶替 prisma.scheduleShare 和 prisma.user，
// 走的仍是真实的路由、鉴权中间件和 services/scheduleSharing.ts。
type Row = {
  code: string; writeTokenHash: string; ownerId: number; ownerName: string; semester: string;
  payload: string; termSnapshot: string; createdAt: Date; updatedAt: Date; revokedAt: Date | null;
};

function installFakeTables() {
  const rows: Row[] = [];
  let clock = Date.parse("2026-10-07T00:00:00Z");
  const tick = () => new Date(clock += 1000);
  const matches = (row: Row, where: Partial<Row>) => Object.entries(where).every(([key, value]) => (row as any)[key] === value);
  const table = prisma.scheduleShare as any;
  table.findFirst = async ({ where, orderBy }: any) => {
    const found = rows.filter((row) => matches(row, where));
    if (orderBy?.updatedAt === "desc") found.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return found[0] ?? null;
  };
  table.findUnique = async ({ where }: any) => rows.find((row) => row.code === where.code) ?? null;
  table.findMany = async ({ where }: any) => rows.filter((row) => matches(row, where))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  table.create = async ({ data }: any) => {
    const now = tick();
    const row = { ...data, createdAt: now, updatedAt: now, revokedAt: null } as Row;
    rows.push(row);
    return row;
  };
  table.update = async ({ where, data }: any) => {
    const row = rows.find((item) => item.code === where.code)!;
    Object.assign(row, data, { updatedAt: tick() });
    return row;
  };
  (prisma.user as any).findUnique = async ({ where }: any) => ({
    id: where.id, username: `student-${where.id}`, role: "user", voiceHubRole: null, lostFoundRole: null,
    status: "active", blocksOwned: [],
  });
  return rows;
}

function payload(courses: string[], semester = "2026-2027-1") {
  return {
    semester,
    schedule: {
      semesters: [], weeks: [], currentSemester: semester, currentWeek: "1",
      cells: [{ day: 1, bigSlot: 1, courses: courses.map((name) => ({ name, weeks: "1-16周", weekList: [1, 2] })) }],
    },
    calendar: { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2027-01-17", weeks: [] },
  };
}

async function withServer(run: (call: (userId: number | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; cache: string | null }>) => Promise<void>) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/schedule-shares", scheduleShareRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await run(async (userId, method, path, body, headers = {}) => {
      const response = await fetch(`${origin}/schedule-shares${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(userId === null ? {} : { Authorization: `Bearer ${signToken({ userId, studentId: `student-${userId}`, role: "user", campus: "" })}` }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as any, cache: response.headers.get("cache-control") };
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("a share payload needs named courses, a calendar and a sane size", () => {
  assert.equal(normalizeSchedulePayload(payload(["药理学", "高等数学"])).courseCount, 2);
  assert.throws(() => normalizeSchedulePayload({ ...payload(["药理学"]), calendar: null }), /校历/u);
  assert.throws(() => normalizeSchedulePayload(payload([" "])), /名称/u);
  assert.throws(() => normalizeSchedulePayload({ ...payload(["药理学"]), semester: "" }), /学期/u);
});

test("publishing the same semester again keeps the code and only rewrites what changed", async () => {
  const rows = installFakeTables();
  await withServer(async (call) => {
    assert.equal((await call(null, "POST", "/", payload(["药理学"]))).status, 401);

    const first = (await call(1, "POST", "/", { ...payload(["药理学"]), ownerName: "阿青" })).body.data;
    assert.match(first.code, /^[A-Z2-9]{8}$/u);
    assert.equal(first.created, true);
    assert.equal(first.owner, "阿青");
    assert.match(first.writeToken, /^cpu_share_/u);

    const same = (await call(1, "POST", "/", { ...payload(["药理学"]), ownerName: "阿青" })).body.data;
    assert.equal(same.code, first.code);
    assert.deepEqual([same.created, same.changed], [false, false]);
    assert.equal(same.updatedAt, first.updatedAt, "an unchanged timetable must not look updated to its readers");
    assert.equal(same.writeToken, undefined);

    const changed = (await call(1, "POST", "/", { ...payload(["药理学", "高等数学"]), ownerName: "阿青" })).body.data;
    assert.equal(changed.code, first.code);
    assert.deepEqual([changed.created, changed.changed, changed.courseCount], [false, true, 2]);
    assert.notEqual(changed.updatedAt, first.updatedAt);

    const otherTerm = (await call(1, "POST", "/", payload(["有机化学"], "2025-2026-2"))).body.data;
    assert.notEqual(otherTerm.code, first.code);
    assert.equal(rows.length, 2);

    const someoneElse = (await call(2, "POST", "/", payload(["药理学"]))).body.data;
    assert.notEqual(someoneElse.code, first.code);
  });
});

test("readers get the timetable or a light summary, and only the owner sees the list", async () => {
  installFakeTables();
  await withServer(async (call) => {
    const share = (await call(1, "POST", "/", { ...payload(["药理学", "高等数学"]), ownerName: "阿青" })).body.data;

    const full = await call(null, "GET", `/${share.code.toLowerCase()}`);
    assert.equal(full.status, 200);
    assert.equal(full.body.data.schedule.cells[0].courses.length, 2);
    assert.equal(full.body.data.writeToken, undefined);

    const meta = await call(null, "GET", `/${share.code}/meta`);
    assert.deepEqual(meta.body.data, {
      code: share.code, owner: "阿青", semester: "2026-2027-1", courseCount: 2,
      createdAt: share.createdAt, updatedAt: share.updatedAt,
    });

    assert.equal(meta.cache, "no-store", "a reader polling for changes must not be answered from a cache");
    assert.equal((await call(null, "GET", "/NOTACODE/meta")).cache, "no-store");

    assert.equal((await call(null, "GET", "/mine")).status, 401, "/mine is not read as a share code");
    assert.deepEqual((await call(1, "GET", "/mine")).body.data.shares.map((item: any) => item.code), [share.code]);
    assert.deepEqual((await call(2, "GET", "/mine")).body.data.shares, []);
    assert.equal((await call(null, "GET", "/NOTACODE")).status, 404);
    assert.equal((await call(null, "GET", "/NOTACODE/meta")).status, 404);
  });
});

test("only the owner can revoke, and a revoked share is gone for readers", async () => {
  const rows = installFakeTables();
  await withServer(async (call) => {
    const share = (await call(1, "POST", "/", payload(["药理学"]))).body.data;

    assert.equal((await call(2, "DELETE", `/${share.code}`)).status, 403);
    assert.equal((await call(1, "DELETE", `/${share.code}`, undefined, { "X-Write-Token": "cpu_share_wrong" })).status, 403);
    assert.equal((await call(null, "GET", `/${share.code}`)).status, 200);

    assert.equal((await call(1, "DELETE", `/${share.code}`)).status, 200, "the signed-in owner needs no token");
    assert.equal((await call(null, "GET", `/${share.code}`)).status, 404);
    assert.equal((await call(null, "GET", `/${share.code}/meta`)).status, 404);
    assert.deepEqual((await call(1, "GET", "/mine")).body.data.shares, []);
    assert.equal(rows[0].payload, "{}", "the timetable itself is not kept after a revoke");

    const again = (await call(1, "POST", "/", payload(["药理学"]))).body.data;
    assert.equal(again.created, true);
    assert.notEqual(again.code, share.code);

    assert.equal((await call(1, "DELETE", `/${again.code}`, undefined, { "X-Write-Token": again.writeToken })).status, 200);
  });
});

test("the body the iOS app publishes is accepted and comes back unchanged", async () => {
  installFakeTables();
  // Written by ios_next/tests/NativeSharedScheduleChecks.swift from the app's own publishing code.
  const body = JSON.parse(readFileSync(new URL("../../ios_next/tests/fixtures/schedule-share-body.json", import.meta.url), "utf8"));
  await withServer(async (call) => {
    const published = await call(1, "POST", "/", body);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual([published.body.data.owner, published.body.data.courseCount], ["阿青", 1]);
    const read = (await call(null, "GET", `/${published.body.data.code}`)).body.data;
    assert.deepEqual(read.schedule, body.schedule);
    assert.deepEqual(read.calendar, body.calendar);
  });
});
