import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma";
import { ensureUserCanSpeak, isMuteActive, releaseExpiredMutes } from "../src/services/userModeration";

test("过期禁言的批量释放每个进程每分钟最多执行一次，并发调用共享同一次更新", async () => {
  const originalUpdateMany = prisma.user.updateMany;
  const originalNow = Date.now;
  let now = originalNow() + 10 * 60_000;
  let calls = 0;
  let finish = () => {};
  prisma.user.updateMany = (() => {
    calls += 1;
    return new Promise((resolve) => {
      finish = () => resolve({ count: 0 });
    });
  }) as unknown as typeof originalUpdateMany;
  Date.now = () => now;
  try {
    const first = releaseExpiredMutes();
    const second = releaseExpiredMutes();
    assert.equal(calls, 1);
    assert.equal(first, second);
    finish();
    await Promise.all([first, second]);

    now += 59_999;
    await releaseExpiredMutes();
    assert.equal(calls, 1);

    now += 1;
    const next = releaseExpiredMutes();
    assert.equal(calls, 2);
    finish();
    await next;
  } finally {
    Date.now = originalNow;
    prisma.user.updateMany = originalUpdateMany;
  }
});

test("批量释放失败不会向调用方抛错", async () => {
  const originalUpdateMany = prisma.user.updateMany;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 60 * 60_000;
  prisma.user.updateMany = (async () => {
    throw new Error("database unavailable");
  }) as unknown as typeof originalUpdateMany;
  try {
    await releaseExpiredMutes();
  } finally {
    Date.now = originalNow;
    prisma.user.updateMany = originalUpdateMany;
  }
});

test("禁言判断按截止时间实时生效", () => {
  const now = Date.now();
  assert.equal(isMuteActive({ status: "muted", mutedUntil: new Date(now + 1_000) }, now), true);
  assert.equal(isMuteActive({ status: "muted", mutedUntil: null }, now), true);
  assert.equal(isMuteActive({ status: "muted", mutedUntil: new Date(now) }, now), false);
  assert.equal(isMuteActive({ status: "muted", mutedUntil: new Date(now - 1_000).toISOString() }, now), false);
  assert.equal(isMuteActive({ status: "active", mutedUntil: new Date(now + 1_000) }, now), false);
});

test("禁言到期后立即允许发言，即使批量释放尚未执行", async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdateMany = prisma.user.updateMany;
  const updates: Array<{ where?: { id?: number } }> = [];
  let current: { id: number; status: string; mutedUntil: Date | null } = {
    id: 7,
    status: "muted",
    mutedUntil: new Date(Date.now() - 1_000),
  };
  prisma.user.findUnique = (async () => current) as unknown as typeof originalFindUnique;
  prisma.user.updateMany = (async (args: { where?: { id?: number } }) => {
    updates.push(args);
    return { count: 1 };
  }) as unknown as typeof originalUpdateMany;
  try {
    const user = await ensureUserCanSpeak(7);
    assert.equal(user.status, "active");
    assert.equal(user.mutedUntil, null);
    assert.ok(updates.some((args) => args.where?.id === 7));

    current = { id: 7, status: "muted", mutedUntil: new Date(Date.now() + 60_000) };
    await assert.rejects(ensureUserCanSpeak(7), /你已被禁言，截止到/);
    current = { id: 7, status: "muted", mutedUntil: null };
    await assert.rejects(ensureUserCanSpeak(7), /你当前已被禁言/);
    current = { id: 7, status: "active", mutedUntil: null };
    assert.equal((await ensureUserCanSpeak(7)).status, "active");
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.updateMany = originalUpdateMany;
  }
});
