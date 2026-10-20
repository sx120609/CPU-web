import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { jwxtRouter } from "../src/routes/jwxt";
import { signToken } from "../src/utils/jwt";

// 内存里的表顶替 prisma.userScheduleEdit 和 prisma.user，路由和校验是真实的。
function installFakeTables() {
  const rows = new Map<string, { payload: string }>();
  const key = (where: any) => `${where.userId_semester.userId}:${where.userId_semester.semester}`;
  const table = prisma.userScheduleEdit as any;
  table.findUnique = async ({ where }: any) => rows.get(key(where)) ?? null;
  table.upsert = async ({ where, create }: any) => {
    rows.set(key(where), { payload: create.payload });
    return rows.get(key(where));
  };
  (prisma.user as any).findUnique = async ({ where }: any) => ({
    id: where.id, username: `student-${where.id}`, role: "user", voiceHubRole: null, lostFoundRole: null,
    status: "active", blocksOwned: [],
  });
}

const custom = [{
  id: "custom-1", day: 1, bigSlot: 1,
  course: { name: "药理学", weeks: "全部周", weekList: [], startSlot: 1, endSlot: 2 },
}];

test("display priority survives a save from a client that does not send it", async () => {
  installFakeTables();
  const app = express();
  app.use(express.json());
  app.use("/jwxt", jwxtRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, body?: unknown, client = "ios") => {
    const response = await fetch(`${origin}/jwxt/schedule-edits${method === "GET" ? "?semester=2026-2027-1" : ""}`, {
      method,
      headers: {
        "Content-Type": "application/json", "X-CPU-Client": client,
        Authorization: `Bearer ${signToken({ userId: 7, studentId: "student-7", role: "user", campus: "" })}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const save = (edits: unknown, client?: string) => call("PUT", { semester: "2026-2027-1", edits }, client);
  try {
    assert.deepEqual((await call("GET")).body.data.edits, { hidden: [], custom: [] });

    const saved = await save({ hidden: [], custom, priority: { " 药理学 ": 2, 高等数学: 1 } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data.edits.priority, { 药理学: 2, 高等数学: 1 });

    // An Android or HarmonyOS build that predates the field rewrites the whole document.
    const older = await save({ hidden: ["jwxt|1|1|||x|||"], custom: [] }, "android");
    assert.equal(older.status, 200);
    assert.deepEqual(older.body.data.edits.priority, { 药理学: 2, 高等数学: 1 });
    assert.deepEqual((await call("GET")).body.data.edits.priority, { 药理学: 2, 高等数学: 1 });

    assert.deepEqual((await save({ hidden: [], custom, priority: { 高等数学: 3 } })).body.data.edits.priority, { 高等数学: 3 });

    const cleared = await save({ hidden: [], custom, priority: {} });
    assert.equal("priority" in cleared.body.data.edits, false);
    assert.equal("priority" in (await call("GET")).body.data.edits, false);

    assert.equal((await save({ hidden: [], custom, priority: { 药理学: 0 } })).status, 400);
    assert.equal((await save({ hidden: [], custom, priority: { 药理学: 1.5 } })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a course's own start and end survive a save, and a broken pair is refused", async () => {
  installFakeTables();
  const app = express();
  app.use(express.json());
  app.use("/jwxt", jwxtRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const save = async (course: Record<string, unknown>) => {
    const response = await fetch(`${origin}/jwxt/schedule-edits`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json", "X-CPU-Client": "android",
        Authorization: `Bearer ${signToken({ userId: 8, studentId: "student-8", role: "user", campus: "" })}`,
      },
      body: JSON.stringify({ semester: "2026-2027-1", edits: { hidden: [], custom: [{ id: "custom-talk", day: 2, bigSlot: 3, course }] } }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const talk = { name: "学术讲座", weeks: "第 3 周", weekList: [3], startSlot: 5, endSlot: 7 };
  try {
    const saved = await save({ ...talk, customStartTime: "14:00", customEndTime: "16:00" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.edits.custom[0].course.customStartTime, "14:00");
    assert.equal(saved.body.data.edits.custom[0].course.customEndTime, "16:00");
    assert.equal((await save({ ...talk, customStartTime: "14:00" })).status, 400);
    assert.equal((await save({ ...talk, customStartTime: "16:00", customEndTime: "14:00" })).status, 400);
    assert.equal((await save({ ...talk, customStartTime: "下午", customEndTime: "16:00" })).status, 400);
    assert.equal("customStartTime" in (await save(talk)).body.data.edits.custom[0].course, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
