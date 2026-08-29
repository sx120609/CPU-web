import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStateStore } from "../src/state.mjs";

test("state is durable and an exclusive lock prevents overlapping runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-web-cdn-cert-"));
  try {
    const store = new JsonStateStore(path.join(directory, "state.json"));
    assert.deepEqual(await store.load(), { version: 1, domains: {} });
    await store.save({ version: 1, domains: { "img.cputime.cn": { phase: "deploying", deployRecordId: 12 } } });
    assert.equal((await store.load()).domains["img.cputime.cn"].deployRecordId, 12);

    const release = await store.acquireLock();
    await assert.rejects(() => store.acquireLock(), /Another CDN certificate run/);
    await release();
    const releaseAgain = await store.acquireLock();
    await releaseAgain();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
