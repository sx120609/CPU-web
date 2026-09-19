import test from "node:test";
import assert from "node:assert/strict";
import { appleReferenceSeconds, unixSecondsFromActivityDate } from "../src/services/apnsClient";

test("APNs activity dates accept Swift Date reference seconds", () => {
  const unix = 1_800_000_000;
  assert.equal(unixSecondsFromActivityDate(appleReferenceSeconds(unix)), unix);
  assert.equal(unixSecondsFromActivityDate(unix), unix);
  assert.equal(unixSecondsFromActivityDate(new Date(unix * 1000).toISOString()), unix);
});

test("invalid APNs activity dates are ignored", () => {
  assert.equal(unixSecondsFromActivityDate(null), null);
  assert.equal(unixSecondsFromActivityDate("not-a-date"), null);
});
