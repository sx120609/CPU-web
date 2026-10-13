import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const currentTerm = { termcode: "2026-1", termname: "2026-2027学年一学期" };
const previousTerm = { termcode: "2025-2", termname: "2025-2026学年二学期" };

type Upstream = "courses" | "empty" | "down" | "expired";

async function fixture() {
  const { createGraduateScheduleDataService } = await import("../src/services/graduateScheduleData");
  const { HttpError } = await import("../src/utils/response");
  let upstream: Upstream = "courses";
  let courseName = "药物分析进展";
  const calls: Array<{ semester?: string; termcode?: string }> = [];
  const lastGood = new Map<string, { value: unknown; expiresAt: number }>();
  let now = Date.parse("2026-10-13T10:00:00Z");
  const service = createGraduateScheduleDataService({
    getGraduateSchedule: async (_token, query = {}) => {
      calls.push(query);
      if (upstream === "down") throw new HttpError(400, 4000, "研究生入口返回了网页而不是课表数据。");
      if (upstream === "expired") throw new HttpError(401, 4001, "教务会话已失效");
      const term = query.termcode === previousTerm.termcode || query.semester === previousTerm.termname
        ? previousTerm
        : currentTerm;
      return {
        parsed: {
          title: "研究生课表",
          semesters: [currentTerm, previousTerm].map((item) => ({
            value: item.termname, label: item.termname, current: item === term,
          })),
          currentSemester: term.termname,
          weeks: [{ value: "1", label: "第 1 周", current: true }],
          currentWeek: "1",
          cells: upstream === "empty" ? [] : [{
            day: 1, bigSlot: 1,
            courses: [{ name: courseName, weeks: "1-8周", weekList: [1, 2, 3, 4, 5, 6, 7, 8], startSlot: 1, endSlot: 2 }],
          }],
        },
        source: { mode: "live" as const, semester: term.termname, termcode: term.termcode, fetchedAt: new Date(now).toISOString() },
      };
    },
    readLastGood: async (key) => {
      const entry = lastGood.get(key);
      return entry && entry.expiresAt > now ? structuredClone(entry.value) as never : null;
    },
    writeLastGood: async (key, value, ttlMs) => {
      lastGood.set(key, { value: structuredClone(value), expiresAt: now + ttlMs });
    },
  });
  return {
    service, calls, token: randomUUID(),
    set(value: Upstream) { upstream = value; },
    rename(value: string) { courseName = value; },
    advanceDays(value: number) { now += value * 24 * 60 * 60_000; },
  };
}

const names = (result: { parsed: { cells: Array<{ courses: Array<{ name: string }> }> } }) =>
  result.parsed.cells.flatMap((cell) => cell.courses.map((course) => course.name));

test("研究生系统返回空课表时继续提供上一次带课程的结果", async () => {
  const f = await fixture();
  const first = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(first), ["药物分析进展"]);
  assert.equal(first.stale, undefined);

  f.set("empty");
  const during = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(during), ["药物分析进展"]);
  assert.equal(during.stale, true);
  assert.equal(during.source.fetchedAt, first.source.fetchedAt);

  f.set("courses");
  f.rename("药物化学专论");
  const recovered = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(recovered), ["药物化学专论"]);
  assert.equal(recovered.stale, undefined);
});

test("研究生系统请求失败时回退到上一次结果，会话失效仍然原样抛出", async () => {
  const f = await fixture();
  await f.service.read(f.token, { refresh: true });

  f.set("down");
  const during = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(during), ["药物分析进展"]);
  assert.equal(during.stale, true);

  f.set("expired");
  await assert.rejects(f.service.read(f.token, { refresh: true }), { status: 401 });
});

test("没有可回退的结果时保持原有行为", async () => {
  const f = await fixture();
  f.set("empty");
  const empty = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(empty), []);
  assert.equal(empty.stale, undefined);

  f.set("down");
  await assert.rejects(f.service.read(f.token, { refresh: true }), { status: 400 });
});

test("回退按会话和学期区分", async () => {
  const f = await fixture();
  await f.service.read(f.token, { refresh: true });
  f.set("empty");

  // 默认请求得到的学期被明确选中时，回退到同一份结果。
  const sameTerm = await f.service.read(f.token, { semester: "2026-2027学年第一学期", refresh: true });
  assert.deepEqual(names(sameTerm), ["药物分析进展"]);
  assert.equal(sameTerm.stale, true);
  const sameTermcode = await f.service.read(f.token, { termcode: currentTerm.termcode, refresh: true });
  assert.equal(sameTermcode.stale, true);

  const otherTerm = await f.service.read(f.token, { semester: previousTerm.termname, refresh: true });
  assert.deepEqual(names(otherTerm), []);
  assert.equal(otherTerm.parsed.currentSemester, previousTerm.termname);

  const otherSession = await f.service.read(randomUUID(), { refresh: true });
  assert.deepEqual(names(otherSession), []);
});

test("空课表持续超过保留期后以研究生系统为准", async () => {
  const f = await fixture();
  await f.service.read(f.token, { refresh: true });
  f.set("empty");

  f.advanceDays(6);
  assert.equal((await f.service.read(f.token, { refresh: true })).stale, true);

  f.advanceDays(2);
  const settled = await f.service.read(f.token, { refresh: true });
  assert.deepEqual(names(settled), []);
  assert.equal(settled.stale, undefined);
});

test("短期缓存内的重复读取不再请求研究生系统", async () => {
  const f = await fixture();
  await f.service.read(f.token);
  await f.service.read(f.token);
  assert.equal(f.calls.length, 1);

  await f.service.read(f.token, { refresh: true });
  assert.equal(f.calls.length, 2);
});

test("默认的回退存储随账号缓存清理一并删除", async () => {
  const { createGraduateScheduleDataService } = await import("../src/services/graduateScheduleData");
  const { deleteSubjectCacheEntries } = await import("../src/services/cache");
  const { createHash } = await import("node:crypto");
  const token = randomUUID();
  let upstream: "courses" | "empty" = "courses";
  const service = createGraduateScheduleDataService({
    getGraduateSchedule: async () => ({
      parsed: {
        title: "研究生课表", semesters: [], currentSemester: currentTerm.termname, weeks: [], currentWeek: "1",
        cells: upstream === "empty" ? [] : [{ day: 1, bigSlot: 1, courses: [{ name: "药物分析进展", weeks: "1-8周", weekList: [1] }] }],
      },
      source: { mode: "live" as const, semester: currentTerm.termname, termcode: currentTerm.termcode, fetchedAt: new Date().toISOString() },
    }),
  });
  await service.read(token, { refresh: true });
  upstream = "empty";
  assert.equal((await service.read(token, { refresh: true })).stale, true);

  await deleteSubjectCacheEntries(createHash("sha256").update(token).digest("hex").slice(0, 24));
  const afterDeletion = await service.read(token, { refresh: true });
  assert.deepEqual(names(afterDeletion), []);
  assert.equal(afterDeletion.stale, undefined);
});

test("真实取数链路：研究生系统只剩学期列表、课表为空时仍返回上一次的课程", async () => {
  const { graduateScheduleData } = await import("../src/services/graduateScheduleData");
  const { importSessionSnapshot, logout } = await import("../src/services/jwxtClient");
  const token = randomUUID();
  const now = Date.now();
  await importSessionSnapshot(token, {
    version: 1,
    jar: { "ygl.cpu.edu.cn": { GRAD_SESSION: "active" } },
    username: "2026240444",
    createdAt: now,
    lastSeenAt: now,
  });

  let rows: Array<Record<string, string>> = [{ mc: "第1节", z1: "药物分析进展[1-8周] 张老师[教学楼101]" }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/gmis5/student/default/bindterm") {
      return new Response(JSON.stringify([
        { termcode: currentTerm.termcode, termname: currentTerm.termname, selected: true },
        { termcode: previousTerm.termcode, termname: previousTerm.termname },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/gmis5/student/pygl/py_kbcx_ew") {
      return new Response(JSON.stringify({ rows }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected request: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const healthy = await graduateScheduleData.read(token, { refresh: true });
    assert.deepEqual(names(healthy), ["药物分析进展"]);

    rows = [{ mc: "第1节" }];
    const outage = await graduateScheduleData.read(token, { refresh: true });
    assert.deepEqual(names(outage), ["药物分析进展"]);
    assert.equal(outage.stale, true);
    assert.equal(outage.parsed.currentSemester, currentTerm.termname);
  } finally {
    globalThis.fetch = originalFetch;
    await logout(token);
  }
});
