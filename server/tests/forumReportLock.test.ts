import assert from "node:assert/strict";
import test from "node:test";
import { acquireForumReportTargetLock } from "../src/services/forumReportLock";

test("forum report locks execute without deserializing PostgreSQL void results", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const transaction = {
    async $executeRaw(query: TemplateStringsArray, ...values: unknown[]) {
      calls.push({ query: query.join("?"), values });
      return 0;
    },
  };

  await acquireForumReportTargetLock(transaction, "topic", 42);
  await acquireForumReportTargetLock(transaction, "reply", 43);
  await acquireForumReportTargetLock(transaction, "direct_message", 44);

  assert.deepEqual(calls, [
    { query: "SELECT pg_advisory_xact_lock(?, ?)", values: [73101, 42] },
    { query: "SELECT pg_advisory_xact_lock(?, ?)", values: [73102, 43] },
    { query: "SELECT pg_advisory_xact_lock(?, ?)", values: [73103, 44] },
  ]);
});
