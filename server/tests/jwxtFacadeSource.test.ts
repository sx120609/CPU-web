import assert from "node:assert/strict";
import test from "node:test";
import { modernFirst } from "../src/services/jwxtFacade";

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
