import assert from "node:assert/strict";
import test from "node:test";
import { modernFirst } from "../src/services/jwxtFacade";
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
