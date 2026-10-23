import assert from "node:assert/strict";
import test from "node:test";
import { compareSemesters, createNativeDormSync, readNativeDormSnapshot } from "../src/utils/nativeDormSync";
import { handleNativeDormRequest, offerNativeDormSnapshot } from "../src/utils/nativeDormOffer";
import { dormScheduleLocation, normalizeDormInviteCode, scheduleDormLocation } from "../src/utils/dormScheduleRoute";
import { readCachedDormStatus, rememberDormStatus } from "../src/views/schedule/dormSync";
import type { DormStatus } from "../src/api/dorm";

const store = new Map<string, string>();
const memory = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });

const SEMESTER = "2026-2027-1";

/** 原生交来的整学期课表，格式同情侣课表上传（SharedSchedule.publishBody / sharePublishBody）。 */
function nativeBody(name = "药理学", semester = SEMESTER) {
  return {
    semester,
    schedule: {
      scope: "semester",
      semesters: [],
      weeks: [{ value: "1", label: "第 1 周", current: false }],
      currentSemester: semester,
      currentWeek: "1",
      cells: [{ day: 1, bigSlot: 1, courses: [
        { name, weeks: "1-16周", weekList: [1], startSlot: 1, endSlot: 2 },
        // 本机加的课，带自己的上下课时间。
        { name: "早读", weeks: "1周", weekList: [1], startSlot: 1, endSlot: 1, customStartTime: "07:40", customEndTime: "08:20" },
      ] }],
    },
    calendar: {
      currentSemester: semester,
      currentWeek: 1,
      semesterStart: "2026-09-07",
      semesterEnd: "2027-01-10",
      weeks: [{ week: 1, days: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"] }],
      periods: [{ id: 1, name: "第1节", start: "08:00", end: "08:45" }],
      adjustments: [],
    },
  };
}

function active(dormId: number, snapshotSemester: string | null): DormStatus {
  const me = {
    id: 7,
    color: "blue" as const,
    nickname: "我",
    avatar: null,
    isOwner: true,
    snapshot: snapshotSemester ? { semester: snapshotSemester, syncedAt: "2026-09-07T00:00:00.000Z", changedAt: "2026-09-07T00:00:00.000Z" } : null,
  };
  return { status: "active", id: dormId, name: null, memberLimit: 6, isOwner: true, since: "2026-09-07T00:00:00.000Z", invite: null, me, members: [me] };
}

/** 假的服务端：上传成功后自己的快照就是这学期的，和真实接口一致。 */
function fakeServer(initial: DormStatus) {
  const calls = { status: 0, sync: [] as any[] };
  let current = initial;
  return {
    calls,
    set(next: DormStatus) { current = next; },
    api: {
      status: async () => { calls.status += 1; return current; },
      syncSchedule: async (payload: any) => {
        calls.sync.push(payload);
        if (current.status === "active") current = active(current.id, payload.semester);
        return {} as any;
      },
    },
  };
}

function sessionStore() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test.beforeEach(() => store.clear());

test("the native term is uploaded as the Web uploads it, own clock times included", async () => {
  const server = fakeServer(active(1, null));
  const sync = createNativeDormSync({ userId: () => 7, api: server.api, storage: sessionStore() });
  assert.equal(await sync.offer(nativeBody()), "synced");
  assert.equal(server.calls.sync.length, 1);
  const sent = server.calls.sync[0];
  assert.equal(sent.semester, SEMESTER);
  assert.equal(sent.schedule.scope, "semester");
  assert.equal(sent.schedule.currentSemester, SEMESTER);
  assert.equal(sent.schedule.cells[0].courses[1].customStartTime, "07:40");
  assert.deepEqual(sent.calendar.periods[0], { id: 1, name: "第1节", start: "08:00", end: "08:45" });
  // 同样的内容不再上传；改了课再交来就上传。
  assert.equal(await sync.offer(nativeBody()), "unchanged");
  assert.equal(await sync.offer(nativeBody("生物化学")), "synced");
  assert.equal(server.calls.sync.length, 2);
});

test("outside a dorm the server is asked once and then left alone for ten minutes", async () => {
  const server = fakeServer({ status: "none" });
  const sync = createNativeDormSync({ userId: () => 7, api: server.api, storage: sessionStore() });
  assert.equal(await sync.offer(nativeBody()), "skipped");
  assert.equal(await sync.offer(nativeBody()), "skipped");
  assert.equal(server.calls.status, 1);
  assert.equal(server.calls.sync.length, 0);
  assert.equal(readCachedDormStatus(7), "none");
  // 在宿舍页里刚加入：弹窗把新状态交给立即同步，不用等缓存过期。
  server.set(active(3, null));
  rememberDormStatus(7, active(3, null));
  assert.equal(await sync.syncNow({ status: active(3, null) }), "synced");
  assert.equal(server.calls.sync.length, 1);
});

test("an older term never replaces a newer one already on the server", async () => {
  const server = fakeServer(active(1, "2026-2027-2"));
  const sync = createNativeDormSync({ userId: () => 7, api: server.api, storage: sessionStore() });
  // 原生还停在上学期的本地副本，网页已经传了新学期。
  assert.equal(await sync.offer(nativeBody("药理学", SEMESTER)), "skipped");
  assert.equal(await sync.syncNow({ force: true }), "skipped");
  assert.equal(server.calls.sync.length, 0);
  // 同一学期照常上传。
  server.set(active(1, SEMESTER));
  assert.equal(await sync.offer(nativeBody()), "synced");
});

test("a timetable that is not a whole term is not taken", async () => {
  const server = fakeServer(active(1, null));
  const sync = createNativeDormSync({ userId: () => 7, api: server.api, storage: sessionStore() });
  const body = nativeBody();
  assert.equal(await sync.offer({ ...body, calendar: { ...body.calendar, weeks: [] } }), "unavailable");
  assert.equal(await sync.offer({ ...body, schedule: { ...body.schedule, currentSemester: "2025-2026-2" } }), "unavailable");
  assert.equal(await sync.offer({ ...body, schedule: { ...body.schedule, cells: undefined } }), "unavailable");
  assert.equal(await sync.offer(null), "unavailable");
  assert.equal(server.calls.status + server.calls.sync.length, 0);
  // 没有可用快照时，立即同步如实说“还不能同步”，不会当成没课。
  assert.equal(await sync.syncNow({}, 0), "unavailable");
});

test("the page waits for the native term, and the snapshot belongs to one account", async () => {
  const server = fakeServer(active(1, null));
  const session = sessionStore();
  let userId: number | null = 7;
  const sync = createNativeDormSync({ userId: () => userId, api: server.api, storage: session });
  // 页面先打开，原生的课表稍后才到：页面等它，原生交来的那次上传就是页面要的，只传一次。
  const pending = sync.syncNow({ status: active(1, null) }, 2000);
  setTimeout(() => { void sync.offer(nativeBody()); }, 20);
  assert.equal(await pending, "synced");
  assert.equal(server.calls.sync.length, 1);
  // 手动同步一定再传一次。
  assert.equal(await sync.syncNow({ force: true }, 0), "synced");
  assert.equal(server.calls.sync.length, 2);
  // 页面重新加载后，从会话存储里还能读到同一份。
  const reloaded = createNativeDormSync({ userId: () => userId, api: server.api, storage: session });
  assert.equal(reloaded.latest()?.snapshot.semester, SEMESTER);
  // 换了账号，旧账号的课表不能传到新账号的宿舍里。
  userId = 8;
  assert.equal(reloaded.latest(), null);
  assert.equal(await reloaded.syncNow({}, 0), "unavailable");
  userId = null;
  assert.equal(await reloaded.offer(nativeBody()), "unavailable");
  assert.equal(session.values.size, 0);
});

test("signing in as someone else while the status is on its way stops the upload", async () => {
  const server = fakeServer(active(1, null));
  let userId = 7;
  const status = server.api.status;
  server.api.status = async () => {
    const reply = await status();
    userId = 8;
    return reply;
  };
  const sync = createNativeDormSync({ userId: () => userId, api: server.api, storage: null });
  assert.equal(await sync.offer(nativeBody()), "skipped");
  assert.equal(server.calls.sync.length, 0);
});

test("a snapshot handed over while the sync module loads stays with the account that received it", async () => {
  const server = fakeServer(active(1, null));
  let userId: number | null = 7;
  let key = "acct-7";
  const sync = createNativeDormSync({ userId: () => userId, api: server.api, storage: null });
  const switchingDeps = (switchTo: () => void) => ({
    userId: () => userId,
    accountKey: () => key,
    sync: async () => { switchTo(); return sync; },
  });
  // 带 account：加载期间换了账号（站内账号和原生账号键都变了）。
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody(), account: "acct-7" },
    switchingDeps(() => { userId = 8; key = "acct-8"; })), "skipped");
  // 不带 account：至少绑定收到请求时的站内账号。
  userId = 7; key = "acct-7";
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody() },
    switchingDeps(() => { userId = 8; key = "acct-8"; })), "skipped");
  // 同一站内账号换了教务身份（原生账号键变了）也不收。
  userId = 7; key = "acct-7";
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody(), account: "acct-7" },
    switchingDeps(() => { key = "acct-7b"; })), "skipped");
  // 加载期间退出登录。
  userId = 7; key = "acct-7";
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody() },
    switchingDeps(() => { userId = null; key = ""; })), "skipped");
  assert.equal(server.calls.status + server.calls.sync.length, 0);
  assert.equal(sync.latest(), null);
  // 原生课表属于别的账号；没登录时不收。
  userId = 7; key = "acct-7";
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody(), account: "acct-8" }, switchingDeps(() => {})), "skipped");
  userId = null;
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody() }, switchingDeps(() => {})), "unavailable");
  // 账号没变就照常上传，记在收到时的账号名下。
  userId = 7; key = "acct-7";
  assert.equal(await offerNativeDormSnapshot({ snapshot: nativeBody(), account: "acct-7" }, switchingDeps(() => {})), "synced");
  assert.equal(sync.latest()?.userId, 7);
  // 直接调用 offer 时带上收到时的账号也一样拦。
  assert.equal(await sync.offer(nativeBody("生物化学"), { userId: 8 }), "skipped");
  assert.equal(server.calls.sync.length, 1);
});

test("the bridge entry binds an offer to the account of the moment it is called", async () => {
  const server = fakeServer(active(1, null));
  let userId: number | null = 7;
  let key = "acct-7";
  let ready = true;
  let settle: (value: boolean) => void = () => {};
  const settledCalls: number[] = [];
  const opened: (string | undefined)[] = [];
  const sync = createNativeDormSync({ userId: () => userId, api: server.api, storage: null });
  const deps = {
    userId: () => userId,
    accountKey: () => key,
    sync: async () => sync,
    ready: () => ready,
    settled: () => { settledCalls.push(1); return ready ? Promise.resolve(true) : new Promise<boolean>((resolve) => { settle = resolve; }); },
    open: async (code?: string) => { opened.push(code); },
  };
  // 登录已恢复：调用之后、任何微任务之前换号，旧快照不能记到新账号名下。
  const reply = handleNativeDormRequest({ action: "offer", snapshot: nativeBody() }, deps);
  userId = 8; key = "acct-8";
  assert.deepEqual(await reply, { result: "skipped" });
  assert.equal(settledCalls.length, 0);
  assert.equal(sync.latest(), null);

  // 登录还没恢复：不带 account 的认不出是谁的，不收，也不等。
  ready = false; userId = null; key = "";
  assert.deepEqual(await handleNativeDormRequest({ action: "offer", snapshot: nativeBody() }, deps), { result: "unavailable" });
  assert.equal(settledCalls.length, 0);
  // 带 account 的等登录恢复后按它核对：恢复成别的账号不收，恢复成它就上传。
  let pending = handleNativeDormRequest({ action: "offer", snapshot: nativeBody(), account: "acct-7" }, deps);
  userId = 8; key = "acct-8"; ready = true; settle(true);
  assert.deepEqual(await pending, { result: "skipped" });
  ready = false;
  pending = handleNativeDormRequest({ action: "offer", snapshot: nativeBody(), account: "acct-7" }, deps);
  userId = 7; key = "acct-7"; ready = true; settle(true);
  assert.deepEqual(await pending, { result: "synced" });
  assert.equal(sync.latest()?.userId, 7);
  // 等不到登录状态时和没有这个桥的旧网页一样。
  ready = false;
  pending = handleNativeDormRequest({ action: "offer", snapshot: nativeBody(), account: "acct-7" }, deps);
  settle(false);
  assert.deepEqual(await pending, { missing: true });
  assert.equal(server.calls.sync.length, 1);

  ready = true;
  assert.deepEqual(await handleNativeDormRequest({ action: "open", code: "ABC234" }, deps), { result: "opened" });
  assert.deepEqual(opened, ["ABC234"]);
  assert.deepEqual(await handleNativeDormRequest({ action: "nope" }, deps), { error: "不支持的宿舍课表操作" });
  assert.deepEqual(await handleNativeDormRequest(null, deps), { error: "不支持的宿舍课表操作" });
});

test("an explicit non-semester scope is refused; the native body without scope is a whole term", () => {
  const body = nativeBody();
  assert.equal(readNativeDormSnapshot({ ...body, schedule: { ...body.schedule, scope: "week" } }), null);
  assert.equal(readNativeDormSnapshot({ ...body, schedule: { ...body.schedule, scope: "" } }), null);
  const { scope: _scope, ...unscoped } = body.schedule;
  assert.equal(readNativeDormSnapshot({ ...body, schedule: unscoped })?.schedule.scope, "semester");
  assert.equal(readNativeDormSnapshot(body)?.schedule.scope, "semester");
});

test("a background upload tells the open page to refresh", async () => {
  const server = fakeServer(active(1, null));
  const sync = createNativeDormSync({ userId: () => 7, api: server.api, storage: null });
  let refreshed = 0;
  const stop = sync.onSynced(() => { refreshed += 1; });
  await sync.offer(nativeBody());
  await sync.offer(nativeBody());
  assert.equal(refreshed, 1);
  stop();
  await sync.offer(nativeBody("生物化学"));
  assert.equal(refreshed, 1);
});

test("semesters compare by year, then term", () => {
  assert.equal(compareSemesters("2026-2027-2", "2026-2027-1"), 1);
  assert.equal(compareSemesters("2025-2026-2", "2026-2027-1"), -1);
  assert.equal(compareSemesters("2026-2027-1", " 2026-2027-1 "), 0);
  assert.equal(compareSemesters("fall", "2026-2027-1"), 0);
  assert.equal(readNativeDormSnapshot({ ...nativeBody(), semester: " " }), null);
});

test("invite links go to the right dorm entry on each client", () => {
  assert.equal(normalizeDormInviteCode(" abc 234 "), "ABC234");
  assert.equal(normalizeDormInviteCode(["k7m2qx"]), "K7M2QX");
  assert.equal(normalizeDormInviteCode("<script>"), "");
  assert.deepEqual(dormScheduleLocation("abc234"), { path: "/dorm-schedule", query: { code: "ABC234" } });
  assert.deepEqual(dormScheduleLocation(undefined), { path: "/dorm-schedule", query: {} });
  assert.deepEqual(scheduleDormLocation("abc234"), { path: "/schedule", query: { dorm: "1", code: "ABC234" } });
  assert.deepEqual(scheduleDormLocation("<x>"), { path: "/schedule", query: { dorm: "1" } });
});
