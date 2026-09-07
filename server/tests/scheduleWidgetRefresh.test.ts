import assert from "node:assert/strict";
import test from "node:test";
import { refreshScheduleWidget } from "../src/services/scheduleWidgetRefresh";

test("a slow school login returns saved courses before the widget times out and saves a later success", async () => {
  let resolve!: (value: string) => void;
  const refresh = new Promise<string>(done => { resolve = done; });
  let saved = "";
  const result = await refreshScheduleWidget(refresh, "saved-courses", async value => { saved = value; }, 10);
  assert.deepEqual(result, { value: "saved-courses", fallback: true });
  assert.equal(saved, "");
  resolve("fresh-courses");
  await new Promise(done => setImmediate(done));
  assert.equal(saved, "fresh-courses");
});

test("authentication failures retain cache but remain errors when no usable dates were saved", async () => {
  assert.deepEqual(await refreshScheduleWidget(Promise.reject(new Error("SSO expired")), "saved", async () => undefined), { value: "saved", fallback: true });
  await assert.rejects(refreshScheduleWidget(Promise.reject(new Error("SSO expired")), null, async () => undefined), /SSO expired/);
  assert.deepEqual(await refreshScheduleWidget(Promise.resolve("fresh"), "saved", async () => undefined), { value: "fresh", fallback: false });
});
