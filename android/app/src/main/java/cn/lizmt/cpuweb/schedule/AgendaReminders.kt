package cn.lizmt.cpuweb.schedule

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Reminders for the user's 日程 (ported from 药大拾间 NEXT). Each item keeps one
 * alarm for its next open occurrence; firing posts a notification and sets the
 * one after. The items come from [AgendaRemote]'s copy, so this works with the
 * app closed. Ticking an item off happens in the app, which saves it to the site.
 */
object AgendaReminders {
    const val CHANNEL_AGENDA = "agenda"
    private const val PREFS = "agenda_reminders"
    private const val KEY_SCHEDULED = "scheduled"
    internal const val ACTION_REMIND = "cn.lizmt.cpuweb.AGENDA_REMIND"
    internal const val ACTION_SNOOZE = "cn.lizmt.cpuweb.AGENDA_SNOOZE"
    internal const val EXTRA_ID = "id"
    internal const val EXTRA_DAY = "day"
    const val EXTRA_OPEN_AGENDA = "cn.lizmt.cpuweb.OPEN_AGENDA"
    const val EXTRA_OPEN_AGENDA_DAY = "cn.lizmt.cpuweb.OPEN_AGENDA_DAY"

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Whether any item asks for a reminder still ahead, so the app knows to ask for the notification permission. */
    fun wantsNotifications(items: List<AgendaItem>, now: LocalDateTime = LocalDateTime.now()): Boolean =
        items.any { it.nextReminder(now) != null }

    /** Alarms for every item's next reminder; items that no longer need one lose theirs. */
    fun sync(context: Context, items: List<AgendaItem> = AgendaRemote.readCache(context).second) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val prefs = prefs(context)
        val previous = prefs.getStringSet(KEY_SCHEDULED, emptySet()).orEmpty()
        val now = LocalDateTime.now()
        val scheduled = mutableSetOf<String>()
        items.forEach { item ->
            val (day, at) = item.nextReminder(now) ?: return@forEach
            setAlarm(alarms, remindIntent(context, item.id, day.toString(), snooze = false), at)
            scheduled += item.id
        }
        (previous - scheduled).forEach { id -> alarms.cancel(remindIntent(context, id, "", snooze = false)) }
        prefs.edit().putStringSet(KEY_SCHEDULED, scheduled).apply()
    }

    internal fun snooze(context: Context, id: String, day: String) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        setAlarm(alarms, remindIntent(context, id, day, snooze = true), LocalDateTime.now().plusMinutes(10))
    }

    private fun setAlarm(alarms: AlarmManager, intent: PendingIntent, at: LocalDateTime) {
        val millis = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
        runCatching {
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, intent)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, intent)
        }.onFailure {
            // A revoked exact-alarm grant between the check and the call.
            runCatching { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, intent) }
        }
    }

    private fun remindIntent(context: Context, id: String, day: String, snooze: Boolean): PendingIntent {
        val intent = Intent(context, AgendaReminderReceiver::class.java)
            .setAction(ACTION_REMIND)
            // The data keeps one pending intent per item (and one per snooze).
            .setData(Uri.parse("cpuagenda://${if (snooze) "snooze" else "item"}/$id"))
            .putExtra(EXTRA_ID, id)
            .putExtra(EXTRA_DAY, day)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    internal fun notifyItem(context: Context, item: AgendaItem, day: String) {
        if (!canNotify(context)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        ensureChannel(manager)
        val parts = mutableListOf<String>()
        val date = AgendaItem.parseDate(day)
        if (date != null && date != LocalDate.now()) parts += relativeDay(date)
        if (item.timed) parts += if (item.end.isNotEmpty()) "${item.start}–${item.end}" else item.start
        if (item.location.isNotBlank()) parts += item.location
        if (parts.isEmpty()) parts += "今天"
        val builder = NotificationCompat.Builder(context, CHANNEL_AGENDA)
            .setSmallIcon(R.drawable.ic_notification_agenda)
            .setContentTitle(item.title)
            .setContentText(parts.joinToString(" · "))
            .setCategory(if (item.timed) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, item.id, day))
        if (item.note.isNotBlank()) builder.setStyle(NotificationCompat.BigTextStyle().bigText(parts.joinToString(" · ") + "\n" + item.note))
        builder.addAction(0, "10 分钟后提醒", snoozeIntent(context, item.id, day))
        runCatching { manager.notify(item.id.hashCode(), builder.build()) }
    }

    internal fun dismiss(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java)?.cancel(id.hashCode())
    }

    private fun openIntent(context: Context, id: String, day: String): PendingIntent = PendingIntent.getActivity(
        context, id.hashCode(),
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .setData(Uri.parse("cpuagenda://open/$id"))
            .putExtra(EXTRA_OPEN_AGENDA, id)
            .putExtra(EXTRA_OPEN_AGENDA_DAY, day),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun snoozeIntent(context: Context, id: String, day: String): PendingIntent = PendingIntent.getBroadcast(
        context, 0,
        Intent(context, AgendaReminderReceiver::class.java).setAction(ACTION_SNOOZE)
            .setData(Uri.parse("cpuagenda://snooze-button/$id"))
            .putExtra(EXTRA_ID, id).putExtra(EXTRA_DAY, day),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun ensureChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(CHANNEL_AGENDA) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_AGENDA, "日程", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "你记下的日程到时间时提醒"
            })
        }
    }

    private fun relativeDay(date: LocalDate): String {
        val today = LocalDate.now()
        return when (date) {
            today.plusDays(1) -> "明天"
            today.plusDays(2) -> "后天"
            today.minusDays(1) -> "昨天"
            else -> "${date.monthValue}月${date.dayOfMonth}日"
        }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** Fires reminders and handles the notification's 稍后 button. */
class AgendaReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(AgendaReminders.EXTRA_ID).orEmpty()
        val day = intent.getStringExtra(AgendaReminders.EXTRA_DAY).orEmpty()
        when (intent.action) {
            AgendaReminders.ACTION_REMIND -> {
                val items = AgendaRemote.readCache(context).second
                val item = items.firstOrNull { it.id == id }
                if (item != null && !item.isDoneOn(day)) AgendaReminders.notifyItem(context, item, day)
                // Sets the next occurrence of a repeating item.
                AgendaReminders.sync(context, items)
            }
            AgendaReminders.ACTION_SNOOZE -> {
                AgendaReminders.snooze(context, id, day)
                AgendaReminders.dismiss(context, id)
            }
        }
    }
}

/** Alarms do not survive a reboot, a clock change or an update: set them again. */
class AgendaRescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> AgendaReminders.sync(context)
        }
    }
}
