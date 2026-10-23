import assert from "node:assert/strict";
import test from "node:test";
import { emptyScheduleEdits } from "../src/utils/scheduleEdits";
import { readCachedDormStatus, rememberDormStatus, syncDormScheduleIfJoined } from "../src/views/schedule/dormSync";
import type { DormStatus } from "../src/api/dorm";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
  },
});

const SEMESTER = "2026-2027-1";
const calendar: CalendarResult = { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2027-01-10", weeks: [] };
function schedule(scope: ScheduleResult["scope"], name = "药理学"): ScheduleResult {
  return {
    scope,
    semesters: [],
    weeks: [],
    currentSemester: SEMESTER,
    currentWeek: "1",
    cells: [{ day: 1, bigSlot: 1, courses: [{ name, weeks: "1-16周", weekList: [1] }] }],
  };
}

const NONE: DormStatus = { status: "none" };
/** 服务端的宿舍状态；hasSnapshot 表示服务端是否已有我这学期的快照。 */
function active(dormId: number, hasSnapshot: boolean): DormStatus {
  const me = {
    id: 7,
    color: "blue" as const,
    nickname: "我",
    avatar: null,
    isOwner: true,
    snapshot: hasSnapshot ? { semester: SEMESTER, syncedAt: "2026-09-07T00:00:00.000Z", changedAt: "2026-09-07T00:00:00.000Z" } : null,
  };
  return { status: "active", id: dormId, name: null, memberLimit: 6, isOwner: true, since: "2026-09-07T00:00:00.000Z", invite: null, me, members: [me] };
}

/** 假的服务端：上传成功后自己的快照就存在了，和真实接口一致。 */
function fakeServer(initial: DormStatus) {
  const calls = { status: 0, sync: [] as Array<{ schedule: ScheduleResult }> };
  let current = initial;
  let failNextSync = false;
  return {
    calls,
    set(next: DormStatus) { current = next; },
    failNextSync() { failNextSync = true; },
    api: {
      status: async () => { calls.status += 1; return current; },
      syncSchedule: async (payload: any) => {
        if (failNextSync) {
          failNextSync = false;
          throw new Error("network");
        }
        calls.sync.push(payload);
        if (current.status === "active") current = active(current.id, true);
        return {} as any;
      },
    },
  };
}

function input(api: ReturnType<typeof fakeServer>["api"], extra: Record<string, unknown> = {}) {
  return { userId: 7, semester: SEMESTER, parsed: schedule("semester"), calendar, edits: emptyScheduleEdits(), api, ...extra };
}

test.beforeEach(() => store.clear());

test("users outside a dorm are checked once and then cached as none", async () => {
  const server = fakeServer(NONE);
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "skipped");
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "skipped");
  assert.equal(server.calls.status, 1);
  assert.equal(server.calls.sync.length, 0);
  assert.equal(readCachedDormStatus(7), "none");
});

test("creating or joining in the dialog overrides the cached none at once", async () => {
  const server = fakeServer(NONE);
  await syncDormScheduleIfJoined(input(server.api));
  server.set(active(1, false));
  // 弹窗创建/加入后调用 rememberDormStatus，不必等 10 分钟缓存过期。
  rememberDormStatus(7, active(1, false));
  assert.equal(readCachedDormStatus(7), null);
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(server.calls.sync.length, 1);
});

test("a status handed over by the dialog is used without asking the server again", async () => {
  const server = fakeServer(NONE);
  await syncDormScheduleIfJoined(input(server.api));
  server.set(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { status: active(1, false) })), "synced");
  assert.equal(server.calls.status, 1);
});

test("unchanged content is not uploaded twice to the same dorm", async () => {
  const server = fakeServer(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "unchanged");
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { parsed: schedule("semester", "生物化学") })), "synced");
  assert.equal(server.calls.sync.length, 2);
  // 内容不变超过 12 小时后刷新“同步于”。
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { parsed: schedule("semester", "生物化学"), now: Date.now() + 13 * 3_600_000 })), "synced");
});

test("moving to another dorm uploads again even though the content is the same", async () => {
  const server = fakeServer(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  // 在别的设备上被移出并加入了 2 号宿舍；新宿舍里还没有我的快照。
  server.set(active(2, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(server.calls.sync.length, 2);
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "unchanged");
});

test("rejoining the same dorm uploads again because the server snapshot was deleted", async () => {
  const server = fakeServer(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  // 被移出后又用宿舍码加回同一个宿舍：宿舍 id 不变，但服务端快照已经删除。
  server.set(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(server.calls.sync.length, 2);
});

test("leaving clears the upload record so a later rejoin starts fresh", async () => {
  const server = fakeServer(active(1, false));
  await syncDormScheduleIfJoined(input(server.api));
  rememberDormStatus(7, NONE);
  // 即使服务端仍报告有快照（例如状态请求比删除先返回），也不会凭旧记录跳过上传。
  server.set(active(1, true));
  rememberDormStatus(7, active(1, true));
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(server.calls.sync.length, 2);
});

test("a manual sync uploads even when nothing changed", async () => {
  const server = fakeServer(active(1, false));
  await syncDormScheduleIfJoined(input(server.api));
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { force: true })), "synced");
  assert.equal(server.calls.sync.length, 2);
});

test("a failed upload is reported and retried next time", async () => {
  const server = fakeServer(active(1, false));
  server.failNextSync();
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "failed");
  assert.equal(await syncDormScheduleIfJoined(input(server.api)), "synced");
  assert.equal(server.calls.sync.length, 1);
});

test("nothing is uploaded once the page is gone or another account has signed in", async () => {
  const server = fakeServer(active(1, false));
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { isCurrent: () => false })), "skipped");
  assert.equal(server.calls.status, 0);

  // 拉整学期课表要等教务，等的过程中换了账号：旧账号的课表不能用新登录上传。
  let signedIn = 7;
  const switched = await syncDormScheduleIfJoined(input(server.api, {
    parsed: schedule("week"),
    isCurrent: () => signedIn === 7,
    loadSemesterSchedule: async () => { signedIn = 8; return schedule("semester"); },
  }));
  assert.equal(switched, "skipped");
  assert.equal(server.calls.sync.length, 0);
  // 原账号回来后照常上传。
  signedIn = 7;
  assert.equal(await syncDormScheduleIfJoined(input(server.api, { isCurrent: () => signedIn === 7 })), "synced");
});

test("weekly pages fetch the full semester at most every six hours", async () => {
  const server = fakeServer(active(1, false));
  let loads = 0;
  const weekly = input(server.api, {
    parsed: schedule("week"),
    loadSemesterSchedule: async () => { loads += 1; return schedule("semester"); },
  });
  assert.equal(await syncDormScheduleIfJoined(weekly), "synced");
  assert.equal(await syncDormScheduleIfJoined(weekly), "unchanged");
  assert.equal(loads, 1);
  assert.equal(server.calls.sync[0].schedule.scope, "semester");
  // 换宿舍后不受 6 小时限制，马上补传。
  server.set(active(3, false));
  assert.equal(await syncDormScheduleIfJoined(weekly), "synced");
  assert.equal(loads, 2);
});
