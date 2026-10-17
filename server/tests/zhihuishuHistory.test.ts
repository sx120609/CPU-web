import test from "node:test";
import assert from "node:assert/strict";
import { saveHistory, parseHistory, historyKey, mergeHistory, HISTORY_LIMIT } from "../../web/src/utils/zhihuishuHistory";
const entry = (id: string) => ({ id, at: "2026-10-17T12:00:00.000Z", kind: "skipped" as const, message: "已跳过第一章练习，未作答、未提交" });
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test("history survives reloads and reconnects, deduplicates polling and separates accounts", () => {
  const s = storage();
  saveHistory(s, "user-1", [], [entry("a")]);
  saveHistory(s, "user-1", [], [entry("a"), entry("b")]);
  const loaded = parseHistory(s.getItem(historyKey("user-1")));
  assert.equal(loaded.length, 2);
  assert.deepEqual(parseHistory(s.getItem(historyKey("user-2"))), []);
  assert.equal(saveHistory(s, "user-1", [], []).length, 2);
});
test("storage failures are reported and malformed existing data is not overwritten", () => {
  assert.throws(() => saveHistory({ getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } }, "user-1", [], [entry("a")]), /Quota/);
  let wrote = false;
  assert.throws(() => saveHistory({ getItem: () => "{invalid", setItem: () => { wrote = true; } }, "user-1", [], []));
  assert.equal(wrote, false);
});
test("stored records exclude unrelated fields and cap retained history", () => {
  const records = parseHistory(JSON.stringify([{ ...entry("a"), cookie: "SECRET" }, { id: "bad" }]));
  assert.equal(records.length, 1);
  assert.ok(!JSON.stringify(records).includes("SECRET"));
  assert.equal(mergeHistory(Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(String(i)))).length, HISTORY_LIMIT);
});
