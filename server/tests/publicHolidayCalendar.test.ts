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

import { previewPublicHolidays } from "../src/services/publicHolidayCalendar";
const responseFor = (data: unknown) => (async () => ({ ok: true, json: async () => data }) as Response) as typeof fetch;

test("preview imports holidays and makeup candidates but not observances", async () => {
  const result = await previewPublicHolidays("2026-02-09", 3, responseFor({
    "2026-02-10": { date: "2026-02-10", name: "北小年", isOffDay: false },
    "2026-02-14": { date: "2026-02-14", name: "春节", isOffDay: false },
    "2026-02-15": { date: "2026-02-15", name: "春节", isOffDay: true },
    "2026-01-01": { date: "2026-01-01", name: "元旦", isOffDay: true },
  }));
  assert.equal(result.endDate, "2026-03-01");
  assert.deepEqual(result.adjustments, [
    { date: "2026-02-14", kind: "swap", note: "春节（公开节假日）" },
    { date: "2026-02-15", kind: "off", note: "春节（公开节假日）" },
  ]);
});

test("preview rejects invalid dates, missing data and malformed records", async () => {
  await assert.rejects(previewPublicHolidays("2026-02-30", 2, responseFor({})), /有效/);
  await assert.rejects(previewPublicHolidays("2026-02-10", 2, responseFor({})), /有效/);
  await assert.rejects(previewPublicHolidays("2026-02-09", 65, responseFor({})), /有效/);
  for (const raw of [{}, [], null, { error: "not published" }, { "2026-02-30": { date: "2026-02-30", name: "春节", isOffDay: true } }]) {
    await assert.rejects(previewPublicHolidays("2026-02-09", 3, responseFor(raw)), /尚未发布|格式异常/);
  }
});

test("cross-year preview never returns a partial import on failure", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    calls.push(String(url));
    if (String(url).endsWith("2027")) return { ok: false } as Response;
    return { ok: true, json: async () => ({ "2026-12-31": { date: "2026-12-31", name: "元旦", isOffDay: true } }) } as Response;
  }) as typeof fetch;
  await assert.rejects(previewPublicHolidays("2026-12-28", 2, fetchImpl), /2027.*获取失败/);
  assert.equal(calls.length, 2);
});
