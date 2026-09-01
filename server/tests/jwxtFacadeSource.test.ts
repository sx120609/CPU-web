import assert from "node:assert/strict";
import test from "node:test";
import { modernFirst, parseRecognizedSchedule } from "../src/services/jwxtFacade";
import { HttpError } from "../src/utils/response";

test("modern-first queries report the modern data source", async () => {
  const result = await modernFirst(
    async () => ({ list: ["modern"] }),
    async () => ({ list: ["legacy"] }),
  );

  assert.deepEqual(result, { list: ["modern"], source: "modern" });
});

test("modern-first queries report the legacy source after fallback", async () => {
  const result = await modernFirst(
    async () => { throw new Error("modern unavailable"); },
    async () => ({ list: ["legacy"] }),
  );

  assert.deepEqual(result, { list: ["legacy"], source: "legacy" });
});

test("modern-first preserves the real authorization failure instead of hiding it behind a legacy empty shell", async () => {
  const expired = new HttpError(401, 4001, "统一认证会话已失效，请重新登录");
  let legacyCalls = 0;

  await assert.rejects(
    () => modernFirst(
      async () => { throw expired; },
      async () => {
        legacyCalls += 1;
        return { list: [] };
      },
    ),
    (error: unknown) => error === expired,
  );
  assert.equal(legacyCalls, 0);
});

test("schedule facade accepts a recognized empty timetable for freshmen", () => {
  const parsed = parseRecognizedSchedule(`
    <html><head><title>个人课表信息</title></head><body>
      <table id="kbtable"><tr><th>时间</th><th>星期一</th></tr></table>
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
