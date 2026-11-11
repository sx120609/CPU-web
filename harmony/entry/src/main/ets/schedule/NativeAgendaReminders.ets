import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { common } from '@kit.AbilityKit';
import { NativeAgendaItem } from './NativeScheduleStore';
import { agendaReminders, NativeAgendaReminder } from './NativeAgenda';
import { ClassAlarm } from './ScheduleClassAlarms';

// 日程 reminders and 上课闹钟 through the system reminder agent, so they ring with the app closed. The
// system keeps at most 30 per app and both share them: the class alarms (at most 14, seven days of a
// morning and an afternoon one) come first, the 日程 of the coming month take the rest. Everything is
// published again whenever either list changes. A tap opens the app on its timetable.

const LIMIT = 30;
const HORIZON_MS = 30 * 86400000;
let askedForNotifications = false;
let running: Promise<void> = Promise.resolve();
let agendaItems: NativeAgendaItem[] = [];
let classAlarms: ClassAlarm[] = [];

export function syncAgendaReminders(context: common.UIAbilityContext, items: NativeAgendaItem[]): void {
  agendaItems = items;
  running = running.then(() => publish(context)).catch(() => undefined);
}

/** 上课闹钟: the planned alarms (planClassAlarms), [] to turn them off. */
export function syncClassAlarms(context: common.UIAbilityContext, alarms: ClassAlarm[]): void {
  if (JSON.stringify(alarms) === JSON.stringify(classAlarms)) return;
  classAlarms = alarms;
  running = running.then(() => publish(context)).catch(() => undefined);
}

/** How many reminders each kind gets of the system's 30: the alarms first, the 日程 the rest. */
export function reminderShares(alarms: number, agenda: number): number[] {
  const forAlarms = Math.min(alarms, LIMIT);
  return [forAlarms, Math.min(agenda, LIMIT - forAlarms)];
}

async function publish(context: common.UIAbilityContext): Promise<void> {
  const now = Date.now();
  const alarms = classAlarms.filter((alarm: ClassAlarm) => alarm.at > now);
  const wanted: NativeAgendaReminder[] = agendaReminders(agendaItems, now, now + HORIZON_MS, LIMIT);
  const shares = reminderShares(alarms.length, wanted.length);
  const reminders = wanted.slice(0, shares[1]);
  if ((reminders.length || alarms.length) && !askedForNotifications) {
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
  for (const alarm of alarms.slice(0, shares[0])) {
    const at = new Date(alarm.at);
    const request: reminderAgentManager.ReminderRequestCalendar = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(), hour: at.getHours(), minute: at.getMinutes(), second: 0 },
      title: '上课闹钟',
      content: alarm.title,
      // Rings like an alarm: a minute of sound, 关闭 and 再睡 5 分钟.
      ringDuration: 60,
      snoozeTimes: 2,
      timeInterval: 5 * 60,
      actionButton: [{ title: '关闭', type: reminderAgentManager.ActionButtonType.ACTION_BUTTON_TYPE_CLOSE },
        { title: '再睡 5 分钟', type: reminderAgentManager.ActionButtonType.ACTION_BUTTON_TYPE_SNOOZE }],
      wantAgent: { pkgName: context.abilityInfo.bundleName, abilityName: 'EntryAbility', parameters: { 'targetUrl': 'cpuweb://schedule?source=alarm' } },
    };
    try {
      await reminderAgentManager.publishReminder(request);
    } catch (_) {
      // Over the system's limit or not allowed: skip this one.
    }
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
