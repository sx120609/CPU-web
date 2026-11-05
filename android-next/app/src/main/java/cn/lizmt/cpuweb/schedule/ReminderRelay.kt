package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** One reminder the server sends at [at] (epoch milliseconds). */
data class RelayReminder(val key: String, val at: Long, val title: String, val text: String, val link: String)

/**
 * The reminders this phone has coming, for the server to send through the
 * site's notifications (and so the user's bound WeChat and QQ). Built from the
 * same rules as the phone's own alarms: each item's reminder before each open
 * occurrence, and the class reminder before each class, for the next 30 days.
 */
object ReminderPlan {
    const val DAYS = 30L
    private const val MAX = 400

    fun build(items: List<AgendaItem>, days: Map<String, DashDay>, courseMinutes: Int, now: LocalDateTime, zone: ZoneId = ZoneId.systemDefault()): List<RelayReminder> {
        val result = mutableListOf<RelayReminder>()
        val until = now.plusDays(DAYS)
        for (item in items) {
            if (item.remind < 0 || !item.dated) continue
            var day = maxOf(AgendaItem.parseDate(item.date) ?: continue, now.toLocalDate())
            while (!day.isAfter(until.toLocalDate())) {
                if (item.occursOn(day) && !item.isDoneOn(day.toString())) {
                    val at = item.reminderAt(day)
                    if (at != null && at.isAfter(now) && at.isBefore(until)) {
                        val text = listOfNotNull(
                            dayText(day, now.toLocalDate()),
                            item.start.takeIf { it.isNotEmpty() }?.let { if (item.end.isNotEmpty()) "$it–${item.end}" else it },
                            item.location.takeIf { it.isNotBlank() },
                        ).joinToString(" · ")
                        result += RelayReminder("agenda:${item.id}:$day", at.atZone(zone).toInstant().toEpochMilli(), "日程提醒 · ${item.title}".take(60), text.take(120), "/")
                    }
                }
                if (item.repeat == cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.None) break
                day = day.plusDays(1)
            }
        }
        if (courseMinutes >= 0) {
            var day = now.toLocalDate()
            while (!day.isAfter(until.toLocalDate())) {
                days[day.toString()]?.courses?.forEach { course ->
                    val start = AgendaItem.parseTime(course.start) ?: return@forEach
                    val at = LocalDateTime.of(day, start).minusMinutes(courseMinutes.toLong())
                    if (!at.isAfter(now)) return@forEach
                    val text = listOfNotNull("${course.start}–${course.end}", course.location.takeIf { it.isNotBlank() }).joinToString(" · ")
                    result += RelayReminder("course:$day:${course.start}:${course.name.hashCode().toUInt().toString(36)}", at.atZone(zone).toInstant().toEpochMilli(),
                        "上课提醒 · ${course.name}".take(60), text.take(120), "/schedule")
                }
                day = day.plusDays(1)
            }
        }
        return result.sortedBy { it.at }.take(MAX)
    }

    fun toJson(plan: List<RelayReminder>): JSONObject = JSONObject().put("items", JSONArray(plan.map {
        JSONObject().put("key", it.key.take(80)).put("at", it.at).put("title", it.title).put("text", it.text).put("link", it.link)
    }))

    private fun dayText(day: LocalDate, today: LocalDate): String? = when (day) {
        today -> null
        today.plusDays(1) -> "明天"
        else -> "${day.monthValue}月${day.dayOfMonth}日"
    }
}
