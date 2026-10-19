import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

test("NEXT sync merges edits from two devices, remembers deletions and pages through changes on PostgreSQL", {
  skip: !process.env.NEXT_SYNC_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const url = new URL(process.env.NEXT_SYNC_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.searchParams.get("schema"), "next_sync_test");
  const serverRoot = path.resolve(__dirname, "..");
  await promisify(execFile)(process.execPath, [
    path.join(serverRoot, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(serverRoot, "prisma/schema.prisma"),
  ], { cwd: serverRoot, env: { ...process.env, DATABASE_URL: url.href } });
  const originalDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.href;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  (globalThis as any).prisma = db;
  const users: number[] = [];
  try {
    const sync = await import("../src/services/nextSync");
    const user = await db.user.create({ data: { username: `next-sync-${randomUUID()}`, passwordHash: "test", nickname: "Sync" } });
    const other = await db.user.create({ data: { username: `next-sync-other-${randomUUID()}`, passwordHash: "test", nickname: "Other" } });
    users.push(user.id, other.id);
    const item = (id: string, title: string, updatedAt: number) => ({ id, title, date: "2026-10-23", start: "14:00", updatedAt });
    const t = Date.now() - 10_000;

    // Phone A adds two items; phone B edits one later, then A's stale copy arrives.
    let result = await sync.applyNextSyncChanges(user.id, [
      { collection: "agenda", id: "aaaaaa000001", updatedAt: t, deleted: false, data: item("aaaaaa000001", "组会", t) },
      { collection: "agenda", id: "aaaaaa000002", updatedAt: t, deleted: false, data: item("aaaaaa000002", "体检", t) },
      { collection: "grades", id: "aaaaaa000003", updatedAt: t, deleted: false, data: {} },
    ]);
    assert.equal(result.applied.length, 2);
    assert.deepEqual(result.rejected, [{ collection: "grades", id: "aaaaaa000003", reason: "collection" }]);
    result = await sync.applyNextSyncChanges(user.id, [
      { collection: "agenda", id: "aaaaaa000001", updatedAt: t + 2_000, deleted: false, data: item("aaaaaa000001", "组会（改到三楼）", t + 2_000) },
    ]);
    assert.equal(result.applied.length, 1);
    result = await sync.applyNextSyncChanges(user.id, [
      { collection: "agenda", id: "aaaaaa000001", updatedAt: t + 1_000, deleted: false, data: item("aaaaaa000001", "组会", t + 1_000) },
    ]);
    assert.equal(result.applied.length, 0);
    assert.equal((result.newer[0].data as any).title, "组会（改到三楼）");

    // A deletion wins over older edits and stays as a tombstone.
    await sync.applyNextSyncChanges(user.id, [{ collection: "agenda", id: "aaaaaa000002", updatedAt: t + 3_000, deleted: true }]);
    result = await sync.applyNextSyncChanges(user.id, [
      { collection: "agenda", id: "aaaaaa000002", updatedAt: t + 2_500, deleted: false, data: item("aaaaaa000002", "体检", t + 2_500) },
    ]);
    assert.equal(result.newer[0].deleted, true);

    // A new device pulls everything, page by page, and nothing from the other account.
    await sync.applyNextSyncChanges(other.id, [{ collection: "agenda", id: "bbbbbb000001", updatedAt: t, deleted: false, data: item("bbbbbb000001", "别人的", t) }]);
    const seen = new Map<string, any>();
    let cursor = "";
    for (let page = 0; page < 5; page += 1) {
      const changes = await sync.listNextSyncChanges(user.id, cursor);
      for (const record of changes.records) seen.set(`${record.collection}:${record.id}`, record);
      cursor = changes.cursor;
      if (!changes.more) break;
    }
    assert.deepEqual([...seen.keys()].sort(), ["agenda:aaaaaa000001", "agenda:aaaaaa000002"]);
    assert.equal(seen.get("agenda:aaaaaa000002").deleted, true);
    const again = await sync.listNextSyncChanges(user.id, cursor);
    assert.equal(again.records.length, 0);
    assert.equal(again.cursor, cursor);

    // Conversations over the limit drop the oldest.
    const conversations = Array.from({ length: 50 }, (_, index) => ({
      collection: "conversation", id: `conv-${String(index).padStart(6, "0")}`, updatedAt: t + index, deleted: false,
      data: { title: `对话 ${index}`, messages: [{ id: "m1", fromUser: true, text: "你好" }] },
    }));
    await sync.applyNextSyncChanges(user.id, conversations);
    await sync.applyNextSyncChanges(user.id, conversations.map((record, index) => ({ ...record, id: `conv-${String(index + 50).padStart(6, "0")}`, updatedAt: t + 50 + index })));
    await sync.applyNextSyncChanges(user.id, [{ ...conversations[0], id: "conv-newest", updatedAt: t + 500 }]);
    const live = await db.nextSyncRecord.count({ where: { userId: user.id, collection: "conversation", deletedAt: null } });
    assert.equal(live, 100);
    const oldest = await db.nextSyncRecord.findUnique({ where: { userId_collection_id: { userId: user.id, collection: "conversation", id: "conv-000000" } } });
    assert.ok(oldest?.deletedAt);

    // A phone's reminder plan becomes one site notification at its time, even when two phones carry it.
    const relay = await import("../src/services/nextReminders");
    const dueAt = Date.now() - 5_000;
    const reminderPlan = { items: [{ key: "course:today:08:00", at: dueAt, title: "上课提醒 · 药理学", text: "08:00 · 药学楼 302", link: "/schedule" }] };
    await sync.applyNextSyncChanges(user.id, [
      { collection: "reminders", id: "phone-aaaaaa", updatedAt: Date.now(), deleted: false, data: reminderPlan },
      { collection: "reminders", id: "phone-bbbbbb", updatedAt: Date.now(), deleted: false, data: reminderPlan },
    ]);
    assert.equal((await relay.relayNextReminders(Date.now())).sent, 1);
    assert.equal((await relay.relayNextReminders(Date.now() + 1_000)).sent, 0);
    const notices = await db.notification.findMany({ where: { userId: user.id, source: relay.NEXT_REMINDER_SOURCE } });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].title, "上课提醒 · 药理学");
    await db.notification.deleteMany({ where: { userId: user.id } });

    assert.equal((await sync.clearNextSync(user.id)).deleted > 0, true);
    assert.equal(await db.nextSyncRecord.count({ where: { userId: other.id } }), 1);
  } finally {
    await db.nextSyncRecord.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    if (originalDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabase;
  }
});
