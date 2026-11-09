import assert from "node:assert/strict";
import test from "node:test";
import { beijingToday, celebrationDateLabel, celebrationYears, daysUntilCelebration } from "../src/utils/celebration";

const celebration = { founded: 1936, date: "2026-11-16", motto: "九秩华章 铸梦健康", until: "2027-01-01" };

test("the anniversary count comes from the founding year and the celebration date", () => {
  assert.equal(celebrationYears(celebration), 90);
  assert.equal(celebrationDateLabel(celebration), "11 月 16 日");
});

test("the countdown follows Beijing time, not the device's time zone", () => {
  // 北京时间 11 月 15 日 23:59 和 11 月 16 日 00:01（UTC 前一天 15:59 / 16:01）。
  assert.equal(beijingToday(new Date("2026-11-15T15:59:00Z")), "2026-11-15");
  assert.equal(daysUntilCelebration(celebration, new Date("2026-11-15T15:59:00Z")), 1);
  assert.equal(daysUntilCelebration(celebration, new Date("2026-11-15T16:01:00Z")), 0);
  assert.equal(daysUntilCelebration(celebration, new Date("2026-11-09T04:00:00Z")), 7);
  assert.equal(daysUntilCelebration(celebration, new Date("2026-11-20T04:00:00Z")), -4);
});
