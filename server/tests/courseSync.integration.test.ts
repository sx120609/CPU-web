import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import test from "node:test";
import express from "express";

// No external database, Redis, or academic service is used by this suite.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "course-sync-integration-secret-0123456789abcdef";
process.env.JWXT_SESSION_SYNC_KEY = "course-sync-integration-sync-0123456789abcdef";

type Row = Record<string, any>;
const tokens = { cpu: "legacy-cpu-test-token", njmu: "njmu_test-token", njucm: "njucm_test-token" };
type School = keyof typeof tokens;
type Source = "header" | "browser";

test("course sync enforces school ownership at the HTTP boundary", async (t) => {
  // Storage SDKs loaded by the router need not inspect host interfaces in a test.
  t.mock.method(os, "networkInterfaces", () => ({}));
  // Keep the real router, authentication, browser sessions, school resolver,
  // error handler, course merging and applyCourseSync. Replace only I/O boundaries.
  function replaceExports(modulePath: string, overrides: Row) {
    const original = require(modulePath);
    const cached = require.cache[require.resolve(modulePath)]!;
    cached.exports = { ...original, ...overrides };
    t.after(() => { cached.exports = original; });
  }

  let account: Row;
  let tables: Record<string, Row[]>;
  let databaseCalls: string[];
  let upstreamCalls: Array<{ method: string; token: string; semester?: string }>;
  let invalidations: number;
  let failures: Record<string, Error>;
  let nextUserId = 100;
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) : row[key] === value);
  const uniqueKeys: Record<string, string[]> = {
    course: ["schoolId", "code"], teacher: ["schoolId", "name"],
    courseTeacher: ["courseId", "teacherId"], userCourse: ["userId", "courseId"],
  };
  const models = Object.fromEntries(Object.entries(uniqueKeys).map(([name, keys]) => [name, {
    async findMany({ where }: Row) {
      databaseCalls.push(`${name}.findMany`);
      return structuredClone(tables[name].filter((row) => matches(row, where)));
    },
    async createMany({ data }: Row) {
      databaseCalls.push(`${name}.createMany`);
      let count = 0;
      for (const row of data) {
        if (tables[name].some((existing) => keys.every((key) => existing[key] === row[key]))) continue;
        tables[name].push({ id: tables[name].length + 1, ...row });
        count++;
      }
      return { count };
    },
    async update({ where, data }: Row) {
      databaseCalls.push(`${name}.update`);
      const row = tables[name].find((item) => matches(item, where));
      assert.ok(row, `missing ${name} row`);
      Object.assign(row, data);
      return structuredClone(row);
    },
  }]));
  const database = new Proxy({
    ...models,
    user: { async findUnique({ where }: Row) { return where.id === account.id ? structuredClone(account) : null; } },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }, {
    get(target, key) {
      assert.ok(key in target, `unexpected database access: ${String(key)}`);
      return Reflect.get(target, key);
    },
  });
  replaceExports("../src/prisma", { prisma: database });

  const { Errors } = require("../src/utils/response");
  function queried(method: string, token: string, semester?: string) {
    upstreamCalls.push({ method, token, ...(semester === undefined ? {} : { semester }) });
    if (failures[semester ? `${method}:${semester}` : method]) {
      throw failures[semester ? `${method}:${semester}` : method];
    }
  }
  replaceExports("../src/services/jwxtTransport", {
    // schoolIdForJwxtToken is deliberately NOT mocked: use registered drivers.
    async getGrades(token: string, options: Row) {
      queried("grades", token, options.semester);
      return { list: [
        { courseCode: "G1", courseName: "已修课程一", semester: "2025-2026-2", score: "91", credits: 2 },
        { courseCode: "G2", courseName: "已修课程二", semester: "2025-2026-1", score: "85", credits: 3 },
      ] };
    },
    async getPyfa(token: string) {
      queried("pyfa", token);
      return { list: [
        { courseCode: "C1", courseName: "本学期课程", credits: 2, attr: "必修", unit: "测试学院" },
        { courseCode: "P1", courseName: "计划课程", credits: 1 },
      ] };
    },
    async getSchedule(token: string, options?: Row) {
      queried("schedule", token, options?.semester);
      const semester = options?.semester ?? "2026-2027-1";
      const name = semester === "2025-2026-2" ? "已修课程一"
        : semester === "2025-2026-1" ? "已修课程二" : "本学期课程";
      return { currentSemester: semester, cells: [{ courses: [{ name, teacher: `教师-${semester}` }] }] };
    },
  });
  replaceExports("../src/services/cacheInvalidation", {
    async invalidateCourseCaches() { invalidations++; },
  });

  const { courseRouter } = require("../src/routes/course");
  const { errorHandler } = require("../src/middleware/error");
  const { browserSessionMiddleware } = require("../src/middleware/browserSession");
  const { issueBrowserSession } = require("../src/services/browserSession");
  const { signToken } = require("../src/utils/jwt");
  const app = express();
  app.use(express.json(), browserSessionMiddleware);
  // Test-only cookie issuance; the request under test uses the real session middleware.
  app.post("/test-session", async (req, res, next) => {
    try { await issueBrowserSession(res, req.body); res.json({ ok: true }); } catch (error) { next(error); }
  });
  app.use("/courses", courseRouter);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const httpFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", ((input: any, init: any) => {
    assert.ok(String(input).startsWith(`${origin}/`), `unexpected external request: ${input}`);
    return httpFetch(input, init);
  }) as typeof fetch);

  function reset(schoolId: School) {
    account = { id: ++nextUserId, schoolId, username: "test-student", role: "user", status: "active", blocksOwned: [] };
    tables = { course: [], teacher: [], courseTeacher: [], userCourse: [] };
    // Existing data from every school must survive rejected requests untouched.
    for (const school of Object.keys(tokens)) {
      tables.course.push({ id: tables.course.length + 1, schoolId: school, code: "G1", name: "已修课程一", credits: null });
      tables.teacher.push({ id: tables.teacher.length + 1, schoolId: school, name: "历史教师" });
    }
    tables.userCourse.push({ id: 1, userId: account.id, courseId: tables.course.find((c) => c.schoolId === schoolId)!.id,
      source: "grade", score: "80", semester: "2024-2025-1", teacherNames: "历史教师", syncedAt: new Date("2025-01-01") });
    databaseCalls = [];
    upstreamCalls = [];
    invalidations = 0;
    failures = {};
  }

  async function sync(source: Source, token?: string, extraHeaders: Record<string, string> = {}) {
    // Intentionally stale JWT school: authRequired must hydrate the actual account school.
    const siteToken = signToken({ userId: account.id, studentId: account.username, role: account.role, schoolId: "cpu", campus: "" });
    const headers: Record<string, string> = { ...extraHeaders };
    if (source === "browser") {
      const login = await fetch(`${origin}/test-session`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteToken, jwxtToken: token }) });
      assert.equal(login.status, 200);
      headers.Cookie = login.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
    } else {
      headers.Authorization = `Bearer ${siteToken}`;
      if (token) headers["X-Jwxt-Token"] = token;
    }
    const response = await fetch(`${origin}/courses/sync`, { method: "POST", headers });
    return { status: response.status, body: await response.json() as Row };
  }

  function assertNoEffects(before: Record<string, Row[]>) {
    assert.deepEqual(tables, before, "course, teacher and user-course data must be unchanged");
    assert.deepEqual(databaseCalls, [], "no course database reads or writes");
    assert.deepEqual(upstreamCalls, [], "must reject before querying academic services");
    assert.equal(invalidations, 0);
  }

  for (const source of ["header", "browser"] as const) {
    for (const school of Object.keys(tokens) as School[]) {
      for (const tokenSchool of Object.keys(tokens) as School[]) {
        if (school === tokenSchool) continue;
        await t.test(`${source}: ${school} rejects ${tokenSchool} token without side effects`, async () => {
          reset(school);
          const before = structuredClone(tables);
          const result = await sync(source, tokens[tokenSchool], { "X-CPU-School": tokenSchool, "X-Admin-School": tokenSchool });
          assert.equal(result.status, 403,
            `cross-school request: HTTP ${result.status}, upstream=${upstreamCalls.length}, database=${databaseCalls.join(",")}`);
          assert.equal(result.body.code, 4003);
          assert.match(result.body.message, /学校.*不一致/u);
          assertNoEffects(before);
        });
      }
      await t.test(`${source}: ${school} imports all sources and historical semesters`, async () => {
        reset(school);
        const otherSchools = structuredClone(tables.course.filter((c) => c.schoolId !== school));
        const result = await sync(source, tokens[school]);
        assert.equal(result.status, 200);
        assert.equal(result.body.code, 0);
        assert.equal(result.body.data.examined, 4);
        assert.equal(result.body.data.taken, 2);
        assert.equal(result.body.data.current, 1);
        assert.equal(result.body.data.planned, 1);
        assert.equal(result.body.data.partial, false);
        assert.equal(result.body.data.coursesCreated, 3);
        assert.equal(result.body.data.teachersLinked, 3);
        assert.deepEqual(upstreamCalls.map((call) => [call.method, call.semester]), [
          ["grades", ""], ["pyfa", undefined], ["schedule", undefined],
          ["schedule", "2025-2026-2"], ["schedule", "2025-2026-1"],
        ]);
        assert.ok(upstreamCalls.every((call) => call.token === tokens[school]));
        assert.deepEqual(tables.course.filter((c) => c.schoolId !== school), otherSchools);
        assert.equal(tables.course.filter((c) => c.schoolId === school).length, 4);
        assert.ok(tables.teacher.filter((teacher) => teacher.name !== "历史教师").every((teacher) => teacher.schoolId === school));
        assert.ok(tables.userCourse.every((link) => link.userId === account.id
          && tables.course.some((course) => course.id === link.courseId && course.schoolId === school)));
        assert.equal(tables.userCourse[0].score, "91");
        assert.equal(tables.userCourse[0].teacherNames, "教师-2025-2026-2");
        assert.equal(invalidations, 1);
      });
    }

    await t.test(`${source}: missing authorization retains 409 / 4011`, async () => {
      reset("cpu");
      const before = structuredClone(tables);
      const result = await sync(source);
      assert.equal(result.status, 409);
      assert.equal(result.body.code, 4011);
      assertNoEffects(before);
    });
    for (const stage of ["grades", "pyfa", "schedule"]) {
      await t.test(`${source}: expired ${stage} retains 409 / 4011 and writes nothing`, async () => {
        reset("njucm");
        const before = structuredClone(tables);
        failures[stage] = Errors.unauthorized("教务会话已失效，请重新登录");
        const result = await sync(source, tokens.njucm);
        assert.equal(result.status, 409);
        assert.equal(result.body.code, 4011);
        assert.deepEqual(tables, before);
        assert.deepEqual(databaseCalls, []);
        assert.equal(invalidations, 0);
      });
    }
  }

  await t.test("browser token wins over a conflicting header and is itself checked", async () => {
    reset("njucm");
    const before = structuredClone(tables);
    const rejected = await sync("browser", tokens.njmu, { "X-Jwxt-Token": tokens.njucm });
    assert.equal(rejected.status, 403);
    assertNoEffects(before);
    reset("njucm");
    const accepted = await sync("browser", tokens.njucm, { "X-Jwxt-Token": tokens.njmu });
    assert.equal(accepted.status, 200);
    assert.ok(upstreamCalls.every((call) => call.token === tokens.njucm));
  });

  await t.test("a browser session without JWXT authorization falls back to the checked header", async () => {
    reset("njmu");
    const before = structuredClone(tables);
    assert.equal((await sync("browser", undefined, { "X-Jwxt-Token": tokens.njucm })).status, 403);
    assertNoEffects(before);
    reset("njmu");
    assert.equal((await sync("browser", undefined, { "X-Jwxt-Token": tokens.njmu })).status, 200);
  });

  await t.test("an expired historical timetable retains the existing best-effort import behavior", async () => {
    reset("cpu");
    failures["schedule:2025-2026-2"] = Errors.unauthorized("教务会话已失效，请重新登录");
    const result = await sync("header", tokens.cpu);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.examined, 4);
    assert.equal(result.body.data.teachersLinked, 1);
  });

  await t.test("an admin school override cannot import another school's token into their own user courses", async () => {
    reset("cpu");
    account.role = "admin";
    const before = structuredClone(tables);
    assert.equal((await sync("header", tokens.njmu, { "X-Admin-School": "njmu" })).status, 403);
    assertNoEffects(before);
  });

  await t.test("an admin school override cannot redirect same-school data into another catalog", async () => {
    reset("cpu");
    account.role = "admin";
    const before = structuredClone(tables);
    assert.equal((await sync("header", tokens.cpu, { "X-Admin-School": "njmu" })).status, 403);
    assertNoEffects(before);
  });
});
