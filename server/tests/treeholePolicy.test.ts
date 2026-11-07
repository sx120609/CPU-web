import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingDisplayStatus,
  bookingSlots,
  claimStatusOf,
  currentShift,
  isBookableSlot,
  normalizeTopics,
  roomMemberAlias,
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

test("unclaimed messages are only visible to the visitor and core admins", () => {
  const session = { visitorId: 10, hostId: null };
  assert.equal(treeholeSessionRole(session, { userId: 10, staffId: null, isHost: false, isAdmin: false }), "visitor");
  assert.equal(treeholeSessionRole(session, { userId: 20, staffId: 3, isHost: true, isAdmin: false }), null);
  assert.equal(treeholeSessionRole(session, { userId: 22, staffId: 5, isHost: false, isAdmin: true }), "admin");
});

test("message status goes from unclaimed to claimed to replied", () => {
  assert.equal(claimStatusOf({ hostId: null, firstReplyAt: null }), "unclaimed");
  assert.equal(claimStatusOf({ hostId: 3, firstReplyAt: null }), "claimed");
  assert.equal(claimStatusOf({ hostId: 3, firstReplyAt: new Date() }), "replied");
});

test("message topics keep only known tags, at most three", () => {
  assert.deepEqual(normalizeTopics(["情感", "情感", "随便写的", "学业压力", "家庭", "其他"]), ["情感", "学业压力", "家庭"]);
  assert.deepEqual(normalizeTopics(undefined), []);
});

test("booking slots split each shift into 30-minute pieces in Beijing time", () => {
  // 周一北京时间 08:00，排班周一 19:00–21:00 和周三 12:00–13:15。
  const now = new Date("2026-10-26T00:00:00Z");
  const slots = bookingSlots([eveningShift, { weekday: 3, startMinute: 12 * 60, endMinute: 13 * 60 + 15 }], now, { days: 7 });
  assert.deepEqual(slots.map((slot) => slot.startAt.toISOString()), [
    "2026-10-26T11:00:00.000Z",
    "2026-10-26T11:30:00.000Z",
    "2026-10-26T12:00:00.000Z",
    "2026-10-26T12:30:00.000Z",
    "2026-10-28T04:00:00.000Z",
    "2026-10-28T04:30:00.000Z",
  ]);
  assert.equal(slots[0].endAt.getTime() - slots[0].startAt.getTime(), 30 * 60_000);
});

test("slots starting within the next hour cannot be booked", () => {
  const now = new Date("2026-10-26T10:40:00Z"); // 北京时间 18:40
  const slots = bookingSlots([eveningShift], now, { days: 1 });
  assert.deepEqual(slots.map((slot) => slot.startAt.toISOString()), ["2026-10-26T12:00:00.000Z", "2026-10-26T12:30:00.000Z"]);
  assert.equal(isBookableSlot([eveningShift], new Date("2026-10-26T11:30:00Z"), now), false);
  assert.equal(isBookableSlot([eveningShift], new Date("2026-10-26T12:00:00Z"), now), true);
  assert.equal(isBookableSlot([eveningShift], new Date("2026-10-26T12:10:00Z"), now), false);
});

test("booking status turns into expired or done once its time passes", () => {
  const booking = { startAt: new Date("2026-10-26T11:00:00Z"), endAt: new Date("2026-10-26T11:30:00Z") };
  const before = new Date("2026-10-26T10:00:00Z");
  const during = new Date("2026-10-26T11:10:00Z");
  const after = new Date("2026-10-26T12:00:00Z");
  assert.equal(bookingDisplayStatus({ ...booking, status: "pending" }, before), "pending");
  assert.equal(bookingDisplayStatus({ ...booking, status: "pending" }, during), "expired");
  assert.equal(bookingDisplayStatus({ ...booking, status: "confirmed" }, during), "confirmed");
  assert.equal(bookingDisplayStatus({ ...booking, status: "confirmed" }, after), "done");
  assert.equal(bookingDisplayStatus({ ...booking, status: "cancelled" }, after), "cancelled");
});

test("room members are shown as numbered classmates", () => {
  assert.equal(roomMemberAlias(7), "同学 07");
  assert.equal(roomMemberAlias(120), "同学 120");
});
