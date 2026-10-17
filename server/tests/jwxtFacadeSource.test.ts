import assert from "node:assert/strict";
import test from "node:test";
import { parseRecognizedSchedule, scheduleQuery } from "../src/services/jwxtFacade";
import { HttpError } from "../src/utils/response";

test("schedule facade accepts a recognized empty timetable for freshmen", () => {
  const parsed = parseRecognizedSchedule(`
    <html><head><title>个人课表信息</title></head><body>
      <table class="qz-weeklyTable"><tr><td name="timeTd"></td></tr></table>
    </body></html>
  `);
  assert.equal(parsed.pageRecognized, true);
  assert.deepEqual(parsed.cells, []);
});

test("schedule facade rejects an unrelated empty shell instead of overwriting cache", () => {
  assert.throws(
    () => parseRecognizedSchedule("<html><head><title>首页</title></head><body></body></html>"),
    (error: unknown) => error instanceof HttpError && error.status === 502,
  );
});

test("semester query sends the upstream empty all-weeks value explicitly", () => {
  const all = scheduleQuery({ semester: "2026-2027-1", week: "all" });
  assert.equal(all.has("zc"), true);
  assert.equal(all.get("zc"), "");
  assert.equal(all.get("xnxq01id"), "2026-2027-1");
  assert.equal(scheduleQuery({ week: "3" }).get("zc"), "3");
  assert.equal(scheduleQuery().has("zc"), false);
});
