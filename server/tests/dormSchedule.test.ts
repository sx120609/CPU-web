import test from "node:test";
import assert from "node:assert/strict";
import {
  DORM_COLORS,
  DORM_MEMBER_LIMIT,
  DORM_MEMBER_MAX,
  dormMemberColors,
  dormSwapColors,
  generateDormInviteCode,
  normalizeDormInviteCode,
  normalizeDormName,
} from "../src/services/dormSchedule";

test("dorm invite codes are six unambiguous characters", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateDormInviteCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/u);
    assert.equal(normalizeDormInviteCode(code), code);
  }
});

test("dorm code input tolerates case, spaces and dashes", () => {
  assert.equal(normalizeDormInviteCode(" ab-c 23d "), "ABC23D");
  assert.equal(normalizeDormInviteCode("ABC10D"), null);
  assert.equal(normalizeDormInviteCode("ABCD"), null);
  assert.equal(normalizeDormInviteCode(undefined), null);
});

test("dorm names are trimmed, squashed and capped", () => {
  assert.equal(normalizeDormName("  江宁   3-402 "), "江宁 3-402");
  assert.equal(normalizeDormName(""), null);
  assert.equal(normalizeDormName(null), null);
  assert.equal(normalizeDormName("一二三四五六七八九十一二三四五六"), "一二三四五六七八九十一二三四五六");
  assert.throws(() => normalizeDormName("一".repeat(25)), /最多 24 个字/u);
});

test("colour capacity covers the member limit", () => {
  assert.ok(DORM_COLORS.length >= DORM_MEMBER_MAX);
  assert.ok(DORM_MEMBER_MAX >= DORM_MEMBER_LIMIT);
  assert.equal(new Set(DORM_COLORS).size, DORM_COLORS.length);
});

test("members without a chosen colour are coloured in join order", () => {
  const colors = dormMemberColors([
    { userId: 2, joinedAt: "2026-09-08T10:00:00Z" },
    { userId: 1, joinedAt: "2026-09-08T09:00:00Z" },
  ]);
  assert.equal(colors.get(1), "blue");
  assert.equal(colors.get(2), "pink");
});

test("a chosen colour wins unless someone already holds it", () => {
  const colors = dormMemberColors([
    { userId: 1, color: "teal", joinedAt: "2026-09-08T09:00:00Z" },
    { userId: 2, color: null, joinedAt: "2026-09-08T10:00:00Z" },
  ]);
  assert.equal(colors.get(1), "teal");
  // 第二个人按顺序拿到蓝，不会和第二个人自己没选颜色这件事冲突。
  assert.equal(colors.get(2), "blue");
  assert.notEqual(colors.get(1), colors.get(2));
});

test("two members can never end up sharing a colour", () => {
  const colors = dormMemberColors([
    { userId: 1, color: "green", joinedAt: "2026-09-08T09:00:00Z" },
    { userId: 2, color: "green", joinedAt: "2026-09-08T10:00:00Z" },
    { userId: 3, color: "rainbow", joinedAt: "2026-09-08T11:00:00Z" },
  ]);
  assert.equal(colors.get(1), "green");
  assert.notEqual(colors.get(2), "green");
  assert.ok(DORM_COLORS.includes(colors.get(2)!));
  assert.equal(new Set([...colors.values()]).size, 3);
});

test("a full house still gets one colour per member", () => {
  const members = Array.from({ length: DORM_MEMBER_MAX }, (_item, index) => ({
    userId: index + 1,
    joinedAt: new Date(Date.UTC(2026, 8, 8, index)).toISOString(),
  }));
  const colors = dormMemberColors(members);
  assert.equal(colors.size, DORM_MEMBER_MAX);
  for (const member of members) assert.ok(colors.get(member.userId));
});

test("picking a colour someone else holds swaps the two", () => {
  const members = [
    { userId: 1, color: "blue", joinedAt: "2026-09-08T09:00:00Z" },
    { userId: 2, color: "pink", joinedAt: "2026-09-08T10:00:00Z" },
  ];
  const swapped = dormSwapColors(members, 2, "blue");
  assert.equal(swapped.get(2), "blue");
  assert.equal(swapped.get(1), "pink");

  const free = dormSwapColors(members, 2, "teal");
  assert.equal(free.get(2), "teal");
  assert.equal(free.get(1), "blue");
});
