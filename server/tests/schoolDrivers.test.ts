import assert from "node:assert/strict";
import test from "node:test";
import { completeSchoolPeriods } from "../src/schools/periods";
import { schoolDriverFor, schoolDriverForToken, schoolMfaGuideForToken } from "../src/schools/drivers";
import { BUILTIN_SCHOOLS, DEFAULT_SCHOOL_ID } from "../src/schools/registry";
import { schoolIdForJwxtToken } from "../src/services/jwxtTransport";

const defaults = (count: number) => Array.from({ length: count }, (_, index) => ({
  no: index + 1, name: `第${index + 1}节`, start: "08:00", end: "08:45",
}));
const supplied = (ids: number[]) => ids.map((id) => ({ id, name: "", start: "10:00", end: `10:${String(id).padStart(2, "0")}` }));

test("a school's period table is its own defaults with the supplied times on top", () => {
  // Partial upstream table: the missing periods come from this school's defaults, nobody else's.
  const partial = completeSchoolPeriods(supplied([1, 2]), defaults(10));
  assert.equal(partial.length, 10);
  assert.equal(partial[0].end, "10:01");
  assert.equal(partial[9].end, "08:45");
  // Periods running on past the defaults are appended; a gap ends the table.
  assert.equal(completeSchoolPeriods(supplied([...Array(15).keys()].map((n) => n + 1)), defaults(12)).length, 15);
  assert.equal(completeSchoolPeriods(supplied([1, 2, 3, 14]), defaults(12)).length, 12);
  // A school without defaults uses what upstream gave, from period 1 on.
  assert.equal(completeSchoolPeriods(supplied([1, 2, 3, 4, 5, 6, 7, 8, 9]), []).length, 9);
  assert.deepEqual(completeSchoolPeriods(supplied([2, 3]), []), []);
  // Invalid rows are ignored.
  assert.equal(completeSchoolPeriods([{ id: 1, start: "bad", end: "08:45" }], defaults(2))[0].start, "08:00");
});

test("every registered school driver belongs to a known school and owns its own tokens", () => {
  for (const school of BUILTIN_SCHOOLS.values()) {
    const driver = schoolDriverFor(school.id);
    if (school.id === DEFAULT_SCHOOL_ID) {
      assert.equal(driver, undefined, "the default school runs on services/jwxtFacade");
      continue;
    }
    assert.ok(driver, `${school.id} has a profile but no driver in schools/drivers.ts`);
    assert.equal(driver.schoolId, school.id);
    if (driver.mfa) assert.equal(driver.mfa.guide.kind, "qr");
  }
  assert.equal(schoolDriverForToken("plain-default-token"), undefined);
  assert.equal(schoolIdForJwxtToken("plain-default-token"), DEFAULT_SCHOOL_ID);
  assert.equal(schoolMfaGuideForToken(""), undefined);
});
