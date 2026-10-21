import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { common } from '@kit.AbilityKit';
import { NativeAgendaItem } from './NativeScheduleStore';
import { agendaReminders, NativeAgendaReminder } from './NativeAgenda';

// 日程 reminders through the system reminder agent, so they ring with the app closed. The system
// keeps at most 30 per app: the next 30 of the coming month are published again whenever the list
// changes. A tap opens the app on its timetable, where the item is drawn.

const LIMIT = 30;
const HORIZON_MS = 30 * 86400000;
let askedForNotifications = false;
let running: Promise<void> = Promise.resolve();

export function syncAgendaReminders(context: common.UIAbilityContext, items: NativeAgendaItem[]): void {
  running = running.then(() => publish(context, items)).catch(() => undefined);
}

async function publish(context: common.UIAbilityContext, items: NativeAgendaItem[]): Promise<void> {
  const now = Date.now();
  const reminders: NativeAgendaReminder[] = agendaReminders(items, now, now + HORIZON_MS, LIMIT);
  if (reminders.length && !askedForNotifications) {
    askedForNotifications = true;
    try {
      if (!(await notificationManager.isNotificationEnabled())) await notificationManager.requestEnableNotification(context);
    } catch (_) {
      // Declined or not available: the reminders are still published for when it is allowed.
    }
  }
  try {
    await reminderAgentManager.cancelAllReminders();
  } catch (_) {
    // Nothing published yet.
  }
  for (const reminder of reminders) {
    const at = new Date(reminder.at);
    const request: reminderAgentManager.ReminderRequestCalendar = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(), hour: at.getHours(), minute: at.getMinutes(), second: 0 },
      title: reminder.title,
      content: reminder.text || reminder.title,
      wantAgent: { pkgName: context.abilityInfo.bundleName, abilityName: 'EntryAbility', parameters: { 'targetUrl': 'cpuweb://schedule?source=agenda' } },
    };
    try {
      await reminderAgentManager.publishReminder(request);
    } catch (_) {
      // Over the system's limit or not allowed: skip this one.
    }
  }
}
