import assert from "node:assert/strict";
import test from "node:test";
import { clearPublicHolidayCache, fetchPublicHolidayAdjustments } from "../src/services/publicHolidayCalendar";

test("public holiday data becomes off-day adjustments and ignores workdays", async () => {
  clearPublicHolidayCache();
  let calls = 0;
  const adjustments = await fetchPublicHolidayAdjustments(
    "2026-09-01",
    "2026-10-31",
    async (url) => {
      calls += 1;
      assert.match(String(url), /2026$/u);
      return {
        ok: true,
        json: async () => ({
          "2026-09-20": { date: "2026-09-20", name: "国庆节", isOffDay: false },
          "2026-10-01": { date: "2026-10-01", name: "国庆节", isOffDay: true },
          "2026-10-02": { date: "2026-10-02", name: "国庆节", isOffDay: true },
        }),
      } as Response;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(adjustments, [
    { date: "2026-10-01", kind: "off", note: "国庆节（公开节假日）" },
    { date: "2026-10-02", kind: "off", note: "国庆节（公开节假日）" },
  ]);
});

test("public holiday responses are cached by year", async () => {
  clearPublicHolidayCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({}) } as Response;
  };
  await fetchPublicHolidayAdjustments("2026-01-01", "2026-12-31", fetchImpl);
  await fetchPublicHolidayAdjustments("2026-01-01", "2026-12-31", fetchImpl);
  assert.equal(calls, 1);
});
