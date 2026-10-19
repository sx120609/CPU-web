import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNextSyncCursor,
  nextSyncPushSchema,
  nextSyncWins,
  parseNextSyncCursor,
  sanitizeNextSyncRecord,
} from "../src/services/nextSync";

const now = Date.UTC(2026, 9, 19, 10, 0);
const item = { id: "abc123def456", title: "组会", date: "2026-10-23", start: "14:00", end: "15:30", remind: 15 };

test("agenda records keep their known fields and must match their id", () => {
  const record = sanitizeNextSyncRecord({ collection: "agenda", id: item.id, updatedAt: now, deleted: false, data: { ...item, secret: "x" } }, now);
  assert.ok(record.ok);
  const stored = JSON.parse(record.ok ? record.data : "{}");
  assert.equal(stored.title, "组会");
  assert.equal(stored.repeat, "none");
  assert.equal("secret" in stored, false);
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "agenda", id: "zzzzzz111111", updatedAt: now, deleted: false, data: item }, now), { ok: false, reason: "id" });
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "agenda", id: item.id, updatedAt: now, deleted: false, data: { ...item, start: "25:00" } }, now), { ok: false, reason: "format" });
});

test("unknown collections, bad ids and oversized records are refused; deletions carry no data", () => {
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "grades", id: "abc123def456", updatedAt: now, deleted: false, data: {} }, now), { ok: false, reason: "collection" });
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "__proto__", id: "abc123def456", updatedAt: now, deleted: false, data: {} }, now), { ok: false, reason: "collection" });
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "activity", id: "../etc", updatedAt: now, deleted: false, data: {} }, now), { ok: false, reason: "id" });
  const long = { title: "长对话", messages: Array.from({ length: 80 }, (_, index) => ({ id: `m${index}`, fromUser: index % 2 === 0, text: "字".repeat(2_000) })) };
  assert.deepEqual(sanitizeNextSyncRecord({ collection: "conversation", id: "conv-123456", updatedAt: now, deleted: false, data: long }, now), { ok: false, reason: "size" });
  const deleted = sanitizeNextSyncRecord({ collection: "conversation", id: "conv-123456", updatedAt: now, deleted: true, data: long }, now);
  assert.ok(deleted.ok && deleted.deleted && deleted.data === "");
});

test("conversations keep messages and proposal states; the log keeps what was done", () => {
  const conversation = sanitizeNextSyncRecord({
    collection: "conversation", id: "conv-123456", updatedAt: now, deleted: false,
    data: { title: "明天的安排", messages: [
      { id: "m1", fromUser: true, text: "明天下午提醒我去实验室" },
      { id: "m2", fromUser: false, text: "帮你准备好了", proposals: [{ id: "p1", action: { type: "agenda.create", item }, state: "Applied", note: "已添加到明天" }] },
    ] },
  }, now);
  assert.ok(conversation.ok);
  const stored = JSON.parse(conversation.ok ? conversation.data : "{}");
  assert.equal(stored.messages[1].proposals[0].state, "Applied");
  assert.deepEqual(stored.messages[0].links, []);
  const activity = sanitizeNextSyncRecord({
    collection: "activity", id: "act-123456", updatedAt: now, deleted: false,
    data: { at: now, conversationId: "conv-123456", proposalId: "p1", action: { type: "theme.mode", value: "dark" }, device: "Pixel 9" },
  }, now);
  assert.ok(activity.ok);
  assert.equal(JSON.parse(activity.ok ? activity.data : "{}").state, "applied");
});

test("a clock ahead of the server is pulled back, and only strictly newer edits win", () => {
  const ahead = sanitizeNextSyncRecord({ collection: "agenda", id: item.id, updatedAt: now + 86_400_000, deleted: false, data: item }, now);
  assert.equal(ahead.ok ? ahead.updatedAt : 0, now + 60_000);
  assert.equal(nextSyncWins(null, now), true);
  assert.equal(nextSyncWins({ clientUpdatedAt: new Date(now) }, now), false);
  assert.equal(nextSyncWins({ clientUpdatedAt: new Date(now) }, now + 1), true);
});

test("cursors round-trip and anything else starts from the beginning", () => {
  const cursor = formatNextSyncCursor({ updatedAt: new Date(now), collection: "agenda", id: item.id });
  assert.deepEqual(parseNextSyncCursor(cursor), { at: new Date(now), collection: "agenda", id: item.id });
  assert.equal(parseNextSyncCursor(""), null);
  assert.equal(parseNextSyncCursor("x:agenda:abc"), null);
  assert.equal(parseNextSyncCursor(["1:agenda:abc"]), null);
});

test("a push carries at most fifty records", () => {
  const records = Array.from({ length: 51 }, (_, index) => ({ collection: "agenda", id: `a${index}xxxxxx`, updatedAt: now, data: item }));
  assert.throws(() => nextSyncPushSchema.parse({ records }));
  assert.equal(nextSyncPushSchema.parse({ records: records.slice(0, 2) }).records[0].deleted, false);
});
