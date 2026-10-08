import assert from "node:assert/strict";
import test from "node:test";
import { clockTime, dayKey, dayLabel, messageTime, messageTimestamp, shortTime } from "../src/utils/directMessageTime";

for (const zone of ["UTC", "Asia/Shanghai"]) {
  test(`message clocks, calendar labels and sorting agree in ${zone}`, () => {
    const previousZone = process.env.TZ;
    process.env.TZ = zone;
    try {
      const instant = "2026-10-07T07:38:00.000Z";
      const now = new Date("2026-10-07T08:00:00Z");
      const expected = zone === "UTC" ? "07:38" : "15:38";
      for (const value of [instant, "2026-10-07T15:38:00+08:00", "2026-10-07T03:38:00-04:00"]) {
        assert.equal(shortTime(value, now), expected);
        assert.equal(clockTime(value), expected);
        assert.equal(messageTime(value), `10-07 ${expected}`);
        assert.equal(messageTimestamp(value), Date.parse(instant));
        assert.equal(dayLabel(value, now), "今天");
      }
      // No endpoint emits offset-free timestamps. Retain the existing local
      // interpretation for legacy values instead of silently inventing UTC.
      for (const value of ["2026-10-07T15:38:00", "2026-10-07 15:38:00"]) {
        assert.equal(shortTime(value, now), "15:38");
        assert.equal(clockTime(value), "15:38");
        assert.equal(messageTimestamp(value), new Date(2026, 9, 7, 15, 38).getTime());
      }
      const midnight = new Date(2027, 0, 1, 0, 1);
      const before = new Date(2026, 11, 31, 23, 59).toISOString();
      const after = midnight.toISOString();
      assert.equal(dayKey(before), "2026-12-31");
      assert.equal(dayKey(after), "2027-01-01");
      assert.equal(dayLabel(before, midnight), "昨天");
      assert.equal(dayLabel(after, midnight), "今天");
      assert.equal(shortTime(before, midnight), "12-31");
      assert.equal(shortTime(after, midnight), "00:01");
      assert.equal(dayLabel("2025-12-30T12:00:00Z", midnight), "2025年12月30日");
      const rows = [before, after, "2026-12-31T00:00:00+08:00"];
      assert.deepEqual(rows.sort((a, b) => messageTimestamp(b) - messageTimestamp(a)), [after, before, "2026-12-31T00:00:00+08:00"]);
    } finally {
      if (previousZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousZone;
    }
  });
}
