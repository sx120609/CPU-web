import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { jwxtRouter } from "../src/routes/jwxt";
import { signToken } from "../src/utils/jwt";
import { courseEditKey } from "../src/shared/scheduleEdits";
import { applyOccurrenceChanges, normalizeOccurrenceChanges, weekdayOf } from "../src/shared/scheduleOccurrences";

const weeks = [
  { week: 1, monday: "2026-09-07" },
  { week: 2, monday: "2026-09-14" },
  { week: 3, monday: "2026-09-21" },
];
const math = { name: "高等数学", teacher: "王老师", location: "A101", weeks: "第1-3周", weekList: [1, 2, 3], startSlot: 1, endSlot: 2 };
const lab = { name: "药理实验", weeks: "全部周", weekList: [] as number[], startSlot: 5, endSlot: 6 };
const cells = () => [
  { day: 1, bigSlot: 1, courses: [{ ...math }] },
  { day: 3, bigSlot: 3, courses: [{ ...lab }] },
];
const mathKey = courseEditKey(1, 1, math);
const labKey = courseEditKey(3, 3, lab);

test("dates map to the term's weeks", () => {
  assert.deepEqual(weekdayOf("2026-09-16", weeks), { week: 2, day: 3 });
  assert.deepEqual(weekdayOf("2026-09-27", weeks), { week: 3, day: 7 });
  assert.equal(weekdayOf("2026-09-28", weeks), null);
  assert.equal(weekdayOf("2026-02-30", weeks), null);
});

test("normalizing keeps one change per meeting and drops what cannot apply", () => {
  const changes = normalizeOccurrenceChanges([
    { key: mathKey, date: "2026-09-14", cancelled: true },
    { key: mathKey, date: "2026-09-14", toDate: "2026-09-15", startSlot: 3, endSlot: 4 },
    { key: mathKey, date: "2026-09-21" },
    { key: "", date: "2026-09-21", cancelled: true },
    { key: labKey, date: "2026-13-01", cancelled: true },
    { key: labKey, date: "2026-09-09", startSlot: 6, endSlot: 5, location: " B202 " },
  ]);
  assert.deepEqual(changes, [
    { key: mathKey, date: "2026-09-14", toDate: "2026-09-15", startSlot: 3, endSlot: 4 },
    { key: labKey, date: "2026-09-09", location: "B202" },
  ]);
});

test("a cancelled meeting leaves its week; other weeks keep running", () => {
  const next = applyOccurrenceChanges(cells(), [{ key: mathKey, date: "2026-09-14", cancelled: true }], weeks);
  assert.deepEqual(next[0].courses[0].weekList, [1, 3]);
  // The text every client reads first changes with it; the key does not.
  assert.equal(next[0].courses[0].weeks, "第 1、3 周");
  assert.equal(courseEditKey(1, 1, next[0].courses[0]), mathKey);
  // A course of every week gets an explicit list without that week.
  const lab2 = applyOccurrenceChanges(cells(), [{ key: labKey, date: "2026-09-23", cancelled: true }], weeks);
  assert.deepEqual(lab2[1].courses[0].weekList, [1, 2]);
  // The key is unchanged, so a second meeting of the same course can change too.
  const twice = applyOccurrenceChanges(cells(), [
    { key: mathKey, date: "2026-09-07", cancelled: true }, { key: mathKey, date: "2026-09-21", cancelled: true },
  ], weeks);
  assert.deepEqual(twice[0].courses[0].weekList, [2]);
  // Its only week cancelled: the course goes instead of meaning "every week".
  const gone = applyOccurrenceChanges(
    [{ day: 1, bigSlot: 1, courses: [{ ...math, weeks: "第2周", weekList: [2] }] }],
    [{ key: courseEditKey(1, 1, { ...math, weeks: "第2周", weekList: [2] }), date: "2026-09-14", cancelled: true }], weeks,
  );
  assert.deepEqual(gone, []);
});

test("a moved meeting runs once on its new date", () => {
  const next = applyOccurrenceChanges(cells(), [
    { key: mathKey, date: "2026-09-14", toDate: "2026-09-17", startSlot: 7, endSlot: 8, location: "B202" },
  ], weeks);
  assert.deepEqual(next[0].courses[0].weekList, [1, 3]);
  const moved = next.find((cell) => cell.day === 4)!;
  assert.equal(moved.bigSlot, 4);
  assert.deepEqual(moved.courses[0], {
    ...math, weekList: [2], weeks: "第 2 周", startSlot: 7, endSlot: 8, location: "B202", slotNote: undefined,
    occurrenceKey: mathKey, occurrenceFrom: "2026-09-14", nativeId: `occ:${mathKey}@2026-09-14`,
  });
  // Another room on the same day keeps the day and the periods.
  const room = applyOccurrenceChanges(cells(), [{ key: labKey, date: "2026-09-16", location: "C303" }], weeks);
  const same = room[1].courses.find((course: any) => course.occurrenceFrom)!;
  assert.equal(same.location, "C303");
  assert.deepEqual([same.startSlot, same.endSlot, same.weekList], [5, 6, [2]]);
  // A meeting the course does not have changes nothing.
  assert.deepEqual(applyOccurrenceChanges(cells(), [{ key: mathKey, date: "2026-09-15", cancelled: true }], weeks), cells());
});

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

test("a client that does not send single-meeting changes keeps them", async () => {
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
        Authorization: `Bearer ${signToken({ userId: 9, studentId: "student-9", role: "user", campus: "" })}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const save = (edits: unknown, client?: string) => call("PUT", { semester: "2026-2027-1", edits }, client);
  const occurrences = [{ key: mathKey, date: "2026-09-14", cancelled: true }];
  try {
    assert.deepEqual((await save({ hidden: [], custom: [], occurrences })).body.data.edits.occurrences, occurrences);
    // An older build rewrites the document without the field.
    assert.deepEqual((await save({ hidden: ["jwxt|1|1|||x|||"], custom: [] }, "android")).body.data.edits.occurrences, occurrences);
    assert.deepEqual((await call("GET")).body.data.edits.occurrences, occurrences);
    // An empty list clears them.
    const cleared = await save({ hidden: [], custom: [], occurrences: [] });
    assert.equal("occurrences" in cleared.body.data.edits, false);
    assert.equal((await save({ hidden: [], custom: [], occurrences: [{ key: mathKey, date: "9/14" }] })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
