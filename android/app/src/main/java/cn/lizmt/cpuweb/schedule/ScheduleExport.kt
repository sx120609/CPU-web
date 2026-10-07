package cn.lizmt.cpuweb.schedule

import android.content.Intent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Text sharing and ICS export of the selected week (ported from the HarmonyOS
 * `ScheduleExport`). Neither output contains a subscription address or any
 * login information.
 */
object ScheduleExport {
    fun text(store: ScheduleStore): String {
        val lines = mutableListOf("药大拾间 · ${store.semesterTitle()} 第 ${store.selectedWeek} 周")
        for (day in 1..7) {
            val blocks = store.blocksForDay(day)
            if (blocks.isEmpty()) continue
            lines += ""
            lines += "${WEEKDAY_LABELS[day - 1]} ${store.dayDate(day)}".trim()
            blocks.forEach { block ->
                lines += "${store.periodTime(block.startSlot).startTime}–${store.periodTime(block.endSlot).endTime} ${block.course.name}"
                block.course.location?.let { lines += it }
            }
        }
        return lines.joinToString("\n")
    }

    /** Throws with a user-facing message when the calendar lacks real dates. */
    fun calendar(store: ScheduleStore, now: Date = Date()): String {
        val week = store.calendarWeek() ?: throw IllegalStateException("当前校历没有明确日期，暂时无法导出日历")
        if (week.days.size < 7 || week.days.any { it.length < 10 }) throw IllegalStateException("当前校历没有明确日期，暂时无法导出日历")
        val lines = mutableListOf("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPU Time//Android Schedule//ZH", "CALSCALE:GREGORIAN")
        val stamp = utcFormat().format(now)
        for (day in 1..7) {
            store.blocksForDay(day).forEachIndexed { index, block ->
                val date = week.days[day - 1]
                val start = store.periodTime(block.startSlot).startTime
                val end = store.periodTime(block.endSlot).endTime
                lines += listOf(
                    "BEGIN:VEVENT",
                    "UID:$date-$day-${block.startSlot}-$index@android.cputime.cn",
                    "DTSTAMP:$stamp",
                    "DTSTART:${utcDate(date, start)}",
                    "DTEND:${utcDate(date, end)}",
                    "SUMMARY:${escape(block.course.name)}",
                    "LOCATION:${escape(block.course.location.orEmpty())}",
                    "DESCRIPTION:${escape(block.course.teacher.orEmpty())}",
                    "END:VEVENT",
                )
            }
        }
        lines += "END:VCALENDAR"
        return lines.joinToString("\r\n") { fold(it) } + "\r\n"
    }

    fun fileName(store: ScheduleStore) = "课表-${store.semesterTitle().replace(Regex("[\\\\/:*?\"<>|]"), "-")}-第${store.selectedWeek}周.ics"

    private fun utcFormat() = SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    /** School times are Beijing time regardless of the device zone. */
    internal fun utcDate(date: String, time: String): String {
        val local = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Shanghai") }
        val parsed = local.parse("$date $time") ?: throw IllegalStateException("课程日期或节次不完整，无法安全导出")
        return utcFormat().format(parsed)
    }

    internal fun escape(value: String): String =
        value.replace("\\", "\\\\").replace(Regex("\r?\n"), "\\\\n").replace(";", "\\;").replace(",", "\\,")

    /** RFC 5545 folding at 75 octets, counting UTF-8 bytes. */
    internal fun fold(line: String): String {
        val builder = StringBuilder()
        var bytes = 0
        var index = 0
        while (index < line.length) {
            val codePoint = line.codePointAt(index)
            val size = when {
                codePoint < 0x80 -> 1
                codePoint < 0x800 -> 2
                codePoint < 0x10000 -> 3
                else -> 4
            }
            if (bytes + size > 75) {
                builder.append("\r\n ")
                bytes = 1
            }
            builder.appendCodePoint(codePoint)
            bytes += size
            index += Character.charCount(codePoint)
        }
        return builder.toString()
    }
}

fun shareSchedule(activity: MainActivity, store: ScheduleStore = activity.schedule) {
    if (store.result == null) {
        activity.toast("请先加载课表")
        return
    }
    val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, ScheduleExport.text(store))
    runCatching { activity.startActivity(Intent.createChooser(intent, "分享课表")) }
        .onFailure { activity.toast("分享面板暂时不可用") }
}

fun exportSchedule(activity: MainActivity, store: ScheduleStore = activity.schedule) {
    if (store.result == null) {
        activity.toast("请先加载课表")
        return
    }
    val content = runCatching { ScheduleExport.calendar(store) }.getOrElse {
        activity.toast(it.message ?: "日历导出失败")
        return
    }
    activity.saveCalendarFile(ScheduleExport.fileName(store), content)
}
