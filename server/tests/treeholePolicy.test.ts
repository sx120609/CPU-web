import test from "node:test";
import assert from "node:assert/strict";
import {
  currentShift,
  generateVisitorAlias,
  looksLikeContactExchange,
  nextRoomSeq,
  nextShiftStart,
  normalizeHostCode,
  normalizeShifts,
  presenceOverrideFor,
  resolveHostPresence,
  revealApprovalState,
  roomVisitorAlias,
  shanghaiClock,
  shouldNotifyCounterpart,
  treeholeSessionRole,
} from "../src/services/treeholePolicy";

// 2026-10-26 是周一。北京时间 19:30 = UTC 11:30。
const mondayEvening = new Date("2026-10-26T11:30:00Z");
const eveningShift = { weekday: 1, startMinute: 19 * 60, endMinute: 21 * 60 };

test("clock uses Beijing time regardless of the server time zone", () => {
  assert.deepEqual(
    { weekday: shanghaiClock(mondayEvening).weekday, minute: shanghaiClock(mondayEvening).minute },
    { weekday: 1, minute: 19 * 60 + 30 },
  );
  // UTC 周日 17:00 已经是北京时间周一凌晨 1 点。
  assert.equal(shanghaiClock(new Date("2026-10-25T17:00:00Z")).weekday, 1);
});

test("shifts are validated, sorted and must not overlap", () => {
  assert.deepEqual(normalizeShifts([{ weekday: 3, startMinute: 600, endMinute: 660 }, { weekday: 1, startMinute: 60, endMinute: 120 }]).map((shift) => shift.weekday), [1, 3]);
  assert.throws(() => normalizeShifts([{ weekday: 1, startMinute: 600, endMinute: 600 }]), /早于结束时间/);
  assert.throws(() => normalizeShifts([{ weekday: 8, startMinute: 0, endMinute: 60 }]), /星期/);
  assert.throws(() => normalizeShifts([
    { weekday: 2, startMinute: 600, endMinute: 700 },
    { weekday: 2, startMinute: 650, endMinute: 720 },
  ]), /重叠/);
});

test("current shift and the next shift start are found in Beijing time", () => {
  const active = currentShift([eveningShift], mondayEvening);
  assert.equal(active?.endsAt.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(currentShift([eveningShift], new Date("2026-10-26T13:00:00Z")), null);
  // 本周一的时段已经过去，下一次是下周一 19:00。
  assert.equal(nextShiftStart([eveningShift], new Date("2026-10-26T14:00:00Z"))?.toISOString(), "2026-11-02T11:00:00.000Z");
  assert.equal(nextShiftStart([{ weekday: 3, startMinute: 8 * 60, endMinute: 9 * 60 }], mondayEvening)?.toISOString(), "2026-10-28T00:00:00.000Z");
});

test("hosts are online during their shift unless they manually went offline", () => {
  const base = { isHost: true, enabled: true, shifts: [eveningShift] };
  assert.equal(resolveHostPresence(base, mondayEvening).online, true);
  assert.equal(resolveHostPresence({ ...base, enabled: false }, mondayEvening).online, false);
  const offline = presenceOverrideFor("offline", base.shifts, mondayEvening);
  assert.equal(offline.presenceOverride, "offline");
  assert.equal(resolveHostPresence({ ...base, ...offline }, mondayEvening).online, false);
  // 手动下线只到本时段结束；下周同一时段自动在岗。
  assert.equal(resolveHostPresence({ ...base, ...offline }, new Date("2026-11-02T11:30:00Z")).online, true);
  // 排班内点“上线”就是撤销手动下线。
  assert.deepEqual(presenceOverrideFor("online", base.shifts, mondayEvening), { presenceOverride: null, presenceOverrideUntil: null });
});

test("going online outside a shift lasts two hours", () => {
  const morning = new Date("2026-10-26T01:00:00Z");
  const override = presenceOverrideFor("online", [eveningShift], morning);
  assert.equal(override.presenceOverride, "online");
  const input = { isHost: true, enabled: true, shifts: [eveningShift], ...override };
  assert.equal(resolveHostPresence(input, morning).online, true);
  assert.equal(resolveHostPresence(input, new Date(morning.getTime() + 121 * 60_000)).online, false);
  assert.deepEqual(presenceOverrideFor("offline", [eveningShift], morning), { presenceOverride: null, presenceOverrideUntil: null });
});

test("session isolation: only the visitor, the receiving host and core admins", () => {
  const session = { visitorId: 10, hostId: 3 };
  const viewer = (userId: number, staffId: number | null, isHost: boolean, isAdmin: boolean) => ({ userId, staffId, isHost, isAdmin });
  assert.equal(treeholeSessionRole(session, viewer(10, null, false, false)), "visitor");
  assert.equal(treeholeSessionRole(session, viewer(20, 3, true, false)), "host");
  assert.equal(treeholeSessionRole(session, viewer(21, 4, true, false)), null);
  assert.equal(treeholeSessionRole(session, viewer(22, 5, false, true)), "admin");
  assert.equal(treeholeSessionRole(session, viewer(11, null, false, false)), null);
  // 被停用的洞主看不到原来接待过的会话。
  assert.equal(treeholeSessionRole(session, viewer(20, 3, false, false)), null);
});

test("each session gets a fresh visitor alias", () => {
  const sequence = [0, 1, 2, 3];
  assert.equal(generateVisitorAlias(() => sequence.shift() ?? 0), "来访者 ABCD");
  assert.match(generateVisitorAlias(), /^来访者 [A-Z2-9]{4}$/u);
});

test("host codes are two digits", () => {
  assert.equal(normalizeHostCode("1"), "01");
  assert.equal(normalizeHostCode("12"), "12");
  assert.throws(() => normalizeHostCode("0"), /01 到 99/);
  assert.throws(() => normalizeHostCode("123"), /01 到 99/);
});

test("room aliases join the recommending host code and the join order", () => {
  assert.equal(roomVisitorAlias("01", 67), "0167");
  assert.equal(roomVisitorAlias("03", 5), "0305");
  assert.equal(roomVisitorAlias("03", 120), "03120");
});

test("room seats reuse the smallest free number before growing", () => {
  assert.equal(nextRoomSeq([]), 1);
  assert.equal(nextRoomSeq([1, 2, 3]), 4);
  // 67 号退群后空出来，下一位进群的人拿到 67。
  const seats = Array.from({ length: 70 }, (_, index) => index + 1).filter((seq) => seq !== 67);
  assert.equal(nextRoomSeq(seats), 67);
  assert.equal(nextRoomSeq([null, undefined, 2]), 1);
});

test("contact exchange is blocked in rooms", () => {
  assert.equal(looksLikeContactExchange("我的手机 13812345678"), true);
  assert.equal(looksLikeContactExchange("加我 v x：abc_12345"), true);
  assert.equal(looksLikeContactExchange("qq 123456789"), true);
  assert.equal(looksLikeContactExchange("加个微信吧"), true);
  assert.equal(looksLikeContactExchange("今天考完试了，好累"), false);
  assert.equal(looksLikeContactExchange("我考了 135 分"), false);
});

test("reveal needs two different core admins", () => {
  assert.deepEqual(revealApprovalState([4]), { approvals: 1, required: 2, approved: false });
  assert.equal(revealApprovalState([4, 4]).approved, false);
  assert.equal(revealApprovalState([4, 7]).approved, true);
});

test("counterpart reminders skip people who are reading and repeat at most every half hour", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  assert.equal(shouldNotifyCounterpart({}, now), true);
  assert.equal(shouldNotifyCounterpart({ seenAt: ago(20_000) }, now), false);
  assert.equal(shouldNotifyCounterpart({ seenAt: ago(5 * 60_000), notifiedAt: ago(60_000) }, now), false);
  assert.equal(shouldNotifyCounterpart({ seenAt: ago(5 * 60_000), notifiedAt: ago(10 * 60_000) }, now), true);
  assert.equal(shouldNotifyCounterpart({ seenAt: ago(60 * 60_000), notifiedAt: ago(31 * 60_000) }, now), true);
});
