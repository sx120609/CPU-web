import assert from "node:assert/strict";
import test from "node:test";
import { dueReminders, reminderDedupeKey } from "../src/services/nextReminders";

const now = Date.UTC(2026, 9, 20, 0, 0);
const plan = (userId: number, items: unknown[]) => ({ userId, data: JSON.stringify({ items }) });

test("reminders due since the last pass go out; later and stale ones wait or are dropped", () => {
  const plans = [
    plan(1, [
      { key: "course:2026-10-20:08:00", at: now - 10_000, title: "上课提醒 · 药理学", text: "08:00–09:40 · 药学楼 302", link: "/schedule" },
      { key: "agenda:a1:2026-10-20", at: now + 60_000, title: "日程提醒 · 组会" },
      { key: "agenda:a2:2026-10-19", at: now - 20 * 60_000, title: "太久以前" },
    ]),
    { userId: 2, data: "not json" },
    plan(3, [{ key: "x", at: now - 1_000, title: "" }]),
  ];
  const due = dueReminders(plans, now - 30_000, now);
  assert.deepEqual(due.map((item) => item.key), ["course:2026-10-20:08:00"]);
  assert.equal(due[0].link, "/schedule");
  // After a long gap only the last ten minutes count.
  assert.deepEqual(dueReminders(plans, now - 60 * 60_000, now).map((item) => item.key), ["course:2026-10-20:08:00"]);
  assert.equal(reminderDedupeKey(due[0]), `next-reminder:1:course:2026-10-20:08:00:${now - 10_000}`);
});

test("accounts that turned on relaying get their agenda reminders from the synced items", async () => {
  const { dueAgendaReminders } = await import("../src/services/nextReminders");
  // 2026-10-20 08:00 in Shanghai; a meeting at 08:15 with a 15-minute reminder is due now.
  const at = Date.UTC(2026, 9, 20, 0, 0);
  const meeting = { id: "meeting00001", title: "组会", date: "2026-10-20", start: "08:15", remind: 15, location: "药学楼" };
  const settings = [{ userId: 1, data: JSON.stringify({ relay: true }) }, { userId: 2, data: JSON.stringify({ relay: false }) }];
  const agenda = [
    { userId: 1, data: JSON.stringify(meeting) },
    { userId: 1, data: JSON.stringify({ ...meeting, id: "later0000001", start: "09:00" }) },
    { userId: 2, data: JSON.stringify(meeting) },
    { userId: 1, data: "broken" },
  ];
  const due = dueAgendaReminders(settings, agenda, at - 30_000, at);
  assert.deepEqual(due.map((item) => [item.userId, item.key, item.link]), [[1, "agenda:meeting00001:2026-10-20", "/agenda"]]);
  assert.equal(due[0].title, "日程提醒 · 组会");
  assert.equal(due[0].text, "08:15 · 药学楼");
  assert.equal(due[0].at, at);
});
