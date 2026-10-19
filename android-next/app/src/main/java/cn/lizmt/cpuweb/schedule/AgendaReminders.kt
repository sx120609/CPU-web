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
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Reminders for the user's agenda and, when switched on, for the next class.
 * Each item keeps one alarm for its next occurrence; firing posts a
 * notification and schedules the one after. Alarms are exact where the system
 * allows it (reminder apps may), otherwise as close as Doze permits.
 */
object AgendaReminders {
    const val CHANNEL_AGENDA = "agenda"
    const val CHANNEL_COURSE = "course"
    private const val PREFS = "agenda_reminders"
    private const val KEY_SCHEDULED = "scheduled"
    private const val KEY_COURSE_MINUTES = "course_minutes"
    internal const val ACTION_REMIND = "cn.lizmt.cpuweb.next.AGENDA_REMIND"
    internal const val ACTION_DONE = "cn.lizmt.cpuweb.next.AGENDA_DONE"
    internal const val ACTION_SNOOZE = "cn.lizmt.cpuweb.next.AGENDA_SNOOZE"
    internal const val ACTION_COURSE = "cn.lizmt.cpuweb.next.COURSE_REMIND"
    internal const val EXTRA_ID = "id"
    internal const val EXTRA_DAY = "day"
    const val EXTRA_OPEN_AGENDA = "cn.lizmt.cpuweb.next.OPEN_AGENDA"
    val COURSE_CHOICES = listOf(-1 to "不提醒", 5 to "5 分钟前", 10 to "10 分钟前", 15 to "15 分钟前", 20 to "20 分钟前", 30 to "30 分钟前")

    fun courseMinutes(context: Context): Int = prefs(context).getInt(KEY_COURSE_MINUTES, -1)

    fun setCourseMinutes(context: Context, minutes: Int) {
        prefs(context).edit().putInt(KEY_COURSE_MINUTES, minutes).apply()
        syncCourse(context)
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Alarms for every item's next reminder; items that no longer need one lose theirs. */
    fun sync(context: Context, items: List<AgendaItem> = AgendaStore.get(context).items) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val prefs = prefs(context)
        val previous = prefs.getStringSet(KEY_SCHEDULED, emptySet()).orEmpty()
        val now = LocalDateTime.now()
        val scheduled = mutableSetOf<String>()
        items.forEach { item ->
            val (day, at) = item.nextReminder(now) ?: return@forEach
            setAlarm(context, alarms, remindIntent(context, item.id, day.toString(), snooze = false), at)
            scheduled += item.id
        }
        (previous - scheduled).forEach { id -> alarms.cancel(remindIntent(context, id, "", snooze = false)) }
        prefs.edit().putStringSet(KEY_SCHEDULED, scheduled).apply()
        syncCourse(context)
    }

    /** One alarm for the next class start minus the chosen lead, read from the local timetable. */
    fun syncCourse(context: Context) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val minutes = courseMinutes(context)
        val pending = courseIntent(context, null)
        alarms.cancel(pending)
        if (minutes < 0) return
        val next = nextCourse(context, minutes, LocalDateTime.now()) ?: return
        setAlarm(context, alarms, courseIntent(context, next.second), next.first)
    }

    private fun nextCourse(context: Context, minutes: Int, now: LocalDateTime): Pair<LocalDateTime, DashCourse>? {
        val days = DashboardSchedule.days(ScheduleWidgetLocalDays.read(context))
        var day = now.toLocalDate()
        repeat(21) {
            days[day.toString()]?.courses?.forEach { course ->
                val start = AgendaItem.parseTime(course.start) ?: return@forEach
                val at = LocalDateTime.of(day, start).minusMinutes(minutes.toLong())
                if (at.isAfter(now)) return at to course
            }
            day = day.plusDays(1)
        }
        return null
    }

    internal fun snooze(context: Context, id: String, day: String) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        setAlarm(context, alarms, remindIntent(context, id, day, snooze = true), LocalDateTime.now().plusMinutes(10))
    }

    private fun setAlarm(context: Context, alarms: AlarmManager, intent: PendingIntent, at: LocalDateTime) {
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

    private fun courseIntent(context: Context, course: DashCourse?): PendingIntent {
        val intent = Intent(context, AgendaReminderReceiver::class.java)
            .setAction(ACTION_COURSE)
            .setData(Uri.parse("cpuagenda://course"))
        if (course != null) {
            intent.putExtra("title", course.name)
                .putExtra("text", listOf("${course.start}–${course.end}", course.location).filter { it.isNotBlank() }.joinToString(" · "))
        }
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    internal fun notifyItem(context: Context, item: AgendaItem, day: String) {
        if (!canNotify(context)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        ensureChannels(context, manager)
        val notificationId = item.id.hashCode()
        val parts = mutableListOf<String>()
        val date = AgendaItem.parseDate(day)
        if (date != null && date != LocalDate.now()) parts += relativeDay(date)
        if (item.timed) parts += if (item.end.isNotEmpty()) "${item.start}–${item.end}" else item.start
        if (item.location.isNotBlank()) parts += item.location
        if (parts.isEmpty()) parts += if (item.kind == AgendaKind.Todo) "待办" else "今天"
        val builder = NotificationCompat.Builder(context, CHANNEL_AGENDA)
            .setSmallIcon(R.drawable.ic_notification_agenda)
            .setContentTitle(item.title)
            .setContentText(parts.joinToString(" · "))
            .setCategory(if (item.kind == AgendaKind.Event) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, item.id))
        if (item.note.isNotBlank()) builder.setStyle(NotificationCompat.BigTextStyle().bigText(parts.joinToString(" · ") + "\n" + item.note))
        if (item.kind == AgendaKind.Todo) builder.addAction(0, "完成", actionIntent(context, ACTION_DONE, item.id, day))
        builder.addAction(0, "10 分钟后提醒", actionIntent(context, ACTION_SNOOZE, item.id, day))
        runCatching { manager.notify(notificationId, builder.build()) }
    }

    internal fun notifyCourse(context: Context, title: String, text: String) {
        if (!canNotify(context) || title.isBlank()) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        ensureChannels(context, manager)
        val open = PendingIntent.getActivity(
            context, 2,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_SCHEDULE, true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_COURSE)
            .setSmallIcon(R.drawable.ic_notification_agenda)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        runCatching { manager.notify(COURSE_NOTIFICATION, notification) }
    }

    internal fun dismiss(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java)?.cancel(id.hashCode())
    }

    private fun openIntent(context: Context, id: String): PendingIntent = PendingIntent.getActivity(
        context, id.hashCode(),
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .setData(Uri.parse("cpuagenda://open/$id"))
            .putExtra(EXTRA_OPEN_AGENDA, id),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun actionIntent(context: Context, action: String, id: String, day: String): PendingIntent = PendingIntent.getBroadcast(
        context, 0,
        Intent(context, AgendaReminderReceiver::class.java).setAction(action)
            .setData(Uri.parse("cpuagenda://$action/$id"))
            .putExtra(EXTRA_ID, id).putExtra(EXTRA_DAY, day),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun ensureChannels(context: Context, manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(CHANNEL_AGENDA) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_AGENDA, "日程与待办", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "你在拾间里添加的日程和待办到时间时提醒"
            })
        }
        if (manager.getNotificationChannel(CHANNEL_COURSE) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_COURSE, "上课提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "下一节课开始前提醒"
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

    private const val COURSE_NOTIFICATION = 0x6352
}

/** Fires reminders and handles the notification's 完成 and 稍后 buttons. */
class AgendaReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val store = AgendaStore.get(context)
        val id = intent.getStringExtra(AgendaReminders.EXTRA_ID).orEmpty()
        val day = intent.getStringExtra(AgendaReminders.EXTRA_DAY).orEmpty()
        when (intent.action) {
            AgendaReminders.ACTION_REMIND -> {
                store.reload()
                val item = store.items.firstOrNull { it.id == id }
                if (item != null && !item.isDoneOn(day)) AgendaReminders.notifyItem(context, item, day)
                // Schedule the next occurrence of a repeating item.
                AgendaReminders.sync(context, store.items)
            }
            AgendaReminders.ACTION_DONE -> {
                store.reload()
                store.setDone(id, day, true)
                AgendaReminders.dismiss(context, id)
            }
            AgendaReminders.ACTION_SNOOZE -> {
                AgendaReminders.snooze(context, id, day)
                AgendaReminders.dismiss(context, id)
            }
            AgendaReminders.ACTION_COURSE -> {
                AgendaReminders.notifyCourse(context, intent.getStringExtra("title").orEmpty(), intent.getStringExtra("text").orEmpty())
                AgendaReminders.syncCourse(context)
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
