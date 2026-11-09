import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCHOOL_ID, activeCelebration, getSchool, type SchoolProfile } from "../src/schools/registry";

const school: SchoolProfile = {
  ...getSchool(DEFAULT_SCHOOL_ID),
  id: "example",
  celebration: { founded: 1936, date: "2026-11-16", motto: "九秩华章 铸梦健康", until: "2027-01-01" },
};

test("a school's celebration is offered until its end date in Beijing time", () => {
  assert.equal(activeCelebration(school, new Date("2026-11-09T04:00:00Z"))?.date, "2026-11-16");
  // 2027-01-01 00:00 北京时间 = 2026-12-31 16:00 UTC
  assert.ok(activeCelebration(school, new Date("2026-12-31T15:59:00Z")));
  assert.equal(activeCelebration(school, new Date("2026-12-31T16:00:00Z")), null);
});

test("schools without a celebration never get one", () => {
  const { celebration: _celebration, ...plain } = school;
  assert.equal(activeCelebration(plain as SchoolProfile, new Date("2026-11-09T04:00:00Z")), null);
});
