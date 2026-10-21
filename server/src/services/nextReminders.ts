import { prisma } from "../prisma";
import { dispatchRecentQqNotifications } from "./qqbot";
import { dispatchRecentWechatNotifications } from "./wechatService";
import { AGENDA_SETTINGS_ID, agendaSettingsSchema, reminderPlanSchema } from "./nextSync";
import { agendaReminders, normalizeAgendaItem, type AgendaItem } from "../shared/agenda";
import { TOOL_QQ_NOTIFICATION_CATEGORY } from "./toolQqReminders";

/**
 * Sends 药大拾间 NEXT reminders from the server. Each phone that turns on
 * “微信和 QQ 也提醒” syncs its coming reminders (the `reminders` collection);
 * when one is due this creates a site notification for the user, which the
 * existing dispatch passes on to their bound WeChat and QQ — channels the phone
 * makers do not hold back the way they hold back NEXT itself.
 *
 * Accounts that turned the switch on for their agenda (the `settings` record,
 * set from the Web or any client) also get each agenda item's reminders worked
 * out here from the synced items, so items made on the Web or another client are
 * sent without a NEXT phone. They use NEXT's keys, so one already in a phone's
 * plan goes out once.
 */

export const NEXT_REMINDER_SOURCE = "拾间 NEXT 提醒";
/** A reminder found later than this (the server was down) is dropped, not sent late. */
const LATEST_MS = 10 * 60 * 1000;
const TICK_MS = 30 * 1000;

type DueReminder = { userId: number; key: string; at: number; title: string; text: string; link: string };

/** The reminders of these plans that fall in (since, now], not older than ten minutes. */
export function dueReminders(plans: Array<{ userId: number; data: string }>, since: number, now: number): DueReminder[] {
  const from = Math.max(since, now - LATEST_MS);
  const due: DueReminder[] = [];
  for (const plan of plans) {
    let parsed: unknown;
    try { parsed = JSON.parse(plan.data); } catch { continue; }
    const result = reminderPlanSchema.safeParse(parsed);
    if (!result.success) continue;
    for (const item of result.data.items) {
      if (item.at > from && item.at <= now) due.push({ userId: plan.userId, key: item.key, at: item.at, title: item.title, text: item.text, link: item.link });
    }
  }
  return due;
}

/** The agenda reminders of accounts that asked for them, due in (since, now]. */
export function dueAgendaReminders(
  settings: Array<{ userId: number; data: string }>,
  agenda: Array<{ userId: number; data: string }>,
  since: number,
  now: number,
): DueReminder[] {
  const from = Math.max(since, now - LATEST_MS);
  const relaying = new Set<number>();
  for (const record of settings) {
    try {
      if (agendaSettingsSchema.parse(JSON.parse(record.data)).relay) relaying.add(record.userId);
    } catch { /* a broken record relays nothing */ }
  }
  const byUser = new Map<number, AgendaItem[]>();
  for (const record of agenda) {
    if (!relaying.has(record.userId)) continue;
    let item: AgendaItem | null = null;
    try { item = normalizeAgendaItem(JSON.parse(record.data)); } catch { item = null; }
    if (!item) continue;
    const list = byUser.get(record.userId) ?? [];
    list.push(item);
    byUser.set(record.userId, list);
  }
  const due: DueReminder[] = [];
  for (const [userId, items] of byUser) {
    for (const reminder of agendaReminders(items, from, now)) {
      due.push({ userId, key: reminder.key, at: reminder.at, title: reminder.title, text: reminder.text, link: "/agenda" });
    }
  }
  return due;
}

export function reminderDedupeKey(reminder: Pick<DueReminder, "userId" | "key" | "at">) {
  return `next-reminder:${reminder.userId}:${reminder.key}:${reminder.at}`;
}

let lastTick = 0;
let running = false;

/** One pass: notifications for what came due since the last pass, each once. */
export async function relayNextReminders(now = Date.now()) {
  if (running) return { sent: 0 };
  running = true;
  try {
    const since = lastTick || now - TICK_MS * 2;
    lastTick = now;
    const plans = await prisma.nextSyncRecord.findMany({
      where: { collection: "reminders", deletedAt: null },
      select: { userId: true, data: true },
    });
    const settings = await prisma.nextSyncRecord.findMany({
      where: { collection: "settings", id: AGENDA_SETTINGS_ID, deletedAt: null },
      select: { userId: true, data: true },
    });
    const relayUsers = settings.map((record) => record.userId);
    const agenda = relayUsers.length ? await prisma.nextSyncRecord.findMany({
      where: { collection: "agenda", deletedAt: null, userId: { in: relayUsers } },
      select: { userId: true, data: true },
    }) : [];
    const planned = dueReminders(plans, since, now);
    const plannedKeys = new Set(planned.map(reminderDedupeKey));
    const due = [...planned, ...dueAgendaReminders(settings, agenda, since, now).filter((item) => !plannedKeys.has(reminderDedupeKey(item)))];
    let sent = 0;
    for (const reminder of due) {
      const dedupeKey = reminderDedupeKey(reminder);
      // Two phones of one account can carry the same reminder: the key is shared, so it goes out once.
      const existing = await prisma.notification.findFirst({
        where: {
          userId: reminder.userId,
          category: TOOL_QQ_NOTIFICATION_CATEGORY,
          createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
          payload: { contains: `"dedupeKey":"${dedupeKey}"` },
        },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.notification.create({
        data: {
          userId: reminder.userId,
          category: TOOL_QQ_NOTIFICATION_CATEGORY,
          level: "normal",
          title: reminder.title,
          content: reminder.text || reminder.title,
          payload: JSON.stringify({ type: "next-reminder", key: reminder.key, at: reminder.at, dedupeKey }),
          link: reminder.link,
          source: NEXT_REMINDER_SOURCE,
        },
      });
      sent += 1;
    }
    if (sent) {
      await Promise.allSettled([dispatchRecentQqNotifications(), dispatchRecentWechatNotifications()]);
    }
    return { sent };
  } finally {
    running = false;
  }
}

export function startNextReminderRelay() {
  const timer = setInterval(() => {
    relayNextReminders().catch((error) => console.warn("[next-reminders] relay failed", error instanceof Error ? error.message : error));
  }, TICK_MS);
  timer.unref?.();
  return timer;
}
