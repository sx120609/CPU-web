import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

function replace(t: TestContext, target: any, key: string, value: any) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

async function flush(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("公告爬虫调度在分布式锁内等待各源抓取结束，单个源失败只记录日志", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { runWithDistributedLock } = await import("../src/services/cache");
  const { startScheduler } = await import("../src/services/schoolCrawler");
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  t.mock.method(console, "log", () => {});
  let finishSlowSource!: (value: null) => void;
  replace(t, prisma.schoolFeedSource, "findMany", async () => [
    { id: 1, slug: "broken", cronMinutes: 30 },
    { id: 2, slug: "slow", cronMinutes: 30 },
  ]);
  replace(t, prisma.schoolFeedSource, "findUnique", async ({ where }: any) => {
    if (where.id === 1) throw new Error("database timeout");
    return new Promise<null>((resolve) => { finishSlowSource = resolve; });
  });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

  startScheduler();
  t.mock.timers.tick(5_000);
  await flush();

  assert.equal((await runWithDistributedLock("school-crawler:tick", 1_000, async () => true)).acquired, false);
  assert.ok(warnings.some(([message]) => String(message).includes("[crawler:broken] run failed")));

  finishSlowSource(null);
  await flush();
  assert.equal((await runWithDistributedLock("school-crawler:tick", 1_000, async () => true)).acquired, true);
});
