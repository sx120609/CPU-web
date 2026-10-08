import test from "node:test";
import assert from "node:assert/strict";
import { coupleColorsFor, coupleMemberColor, generateCoupleInviteCode, normalizeAnniversary, normalizeCoupleInviteCode } from "../src/services/coupleSchedule";

test("invite codes are six unambiguous characters", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateCoupleInviteCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/u);
    assert.equal(normalizeCoupleInviteCode(code), code);
  }
});

test("invite code input tolerates case, spaces and dashes", () => {
  assert.equal(normalizeCoupleInviteCode(" ab-c 23d "), "ABC23D");
  assert.equal(normalizeCoupleInviteCode("ABC10D"), null);
  assert.equal(normalizeCoupleInviteCode("ABCD"), null);
  assert.equal(normalizeCoupleInviteCode(undefined), null);
});

test("anniversary must be a real date no later than today in China", () => {
  const now = new Date("2026-09-30T17:00:00Z"); // 北京时间 10 月 1 日凌晨
  assert.equal(normalizeAnniversary("2026-10-01", now), "2026-10-01");
  assert.equal(normalizeAnniversary("", now), null);
  assert.equal(normalizeAnniversary(null, now), null);
  assert.throws(() => normalizeAnniversary("2026-10-02", now), /晚于今天/u);
  assert.throws(() => normalizeAnniversary("2026-02-30", now), /有效日期/u);
  assert.throws(() => normalizeAnniversary("2026/01/01", now), /格式/u);
});

test("the invitee always gets the other colour", () => {
  assert.equal(coupleMemberColor("inviter", "blue"), "blue");
  assert.equal(coupleMemberColor("invitee", "blue"), "pink");
  assert.equal(coupleMemberColor("inviter", "pink"), "pink");
  assert.equal(coupleMemberColor("invitee", "pink"), "blue");
  assert.equal(coupleMemberColor("inviter", "unexpected"), "blue");
  // 自己选过颜色就用自己选的；不认识的颜色当作没选。
  assert.equal(coupleMemberColor("invitee", "blue", "teal"), "teal");
  assert.equal(coupleMemberColor("invitee", "blue", "rainbow"), "pink");
  const pair = (first: string | null, second: string | null) => {
    const colors = coupleColorsFor([{ userId: 1, role: "inviter", color: first }, { userId: 2, role: "invitee", color: second }], "blue");
    return [colors.get(1), colors.get(2)];
  };
  assert.deepEqual(pair(null, null), ["blue", "pink"]);
  assert.deepEqual(pair("green", "amber"), ["green", "amber"]);
  // 一方选的颜色撞上另一方按旧方式推出的颜色：没选过的那一方让开。
  assert.deepEqual(pair("pink", null), ["pink", "blue"]);
  assert.deepEqual(pair(null, "blue"), ["pink", "blue"]);
});
