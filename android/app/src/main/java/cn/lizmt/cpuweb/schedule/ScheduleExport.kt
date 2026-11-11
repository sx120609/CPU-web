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
                lines += "${store.startTime(block)}–${store.endTime(block)} ${block.course.name}"
                ScheduleStyleTime.location(block.course.location)?.let { lines += it }
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
                val start = store.startTime(block)
                val end = store.endTime(block)
                lines += listOf(
                    "BEGIN:VEVENT",
                    "UID:$date-$day-${block.startSlot}-$index@android.cputime.cn",
                    "DTSTAMP:$stamp",
                    "DTSTART:${utcDate(date, start)}",
                    "DTEND:${utcDate(date, end)}",
                    "SUMMARY:${escape(block.course.name)}",
                    "LOCATION:${escape(ScheduleStyleTime.location(block.course.location).orEmpty())}",
                    "DESCRIPTION:${escape(block.course.teacher.orEmpty())}",
                    "END:VEVENT",
                )
            }
        }
        lines += "END:VCALENDAR"
        return lines.joinToString("\r\n") { fold(it) } + "\r\n"
    }

    /**
     * The whole term as a calendar file: every meeting on its real date, after
     * days off, make-up days and single meetings cancelled or moved, a course's
     * own clock times over the bells (iOS `NativeScheduleICSExporter`).
     */
    fun semesterCalendar(meetings: List<ScheduleMeeting>, name: String, now: Date = Date()): String {
        if (meetings.isEmpty()) throw IllegalStateException("这个学期没有可以导出的课程")
        val lines = mutableListOf(
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPU Time//Android Schedule//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
            "X-WR-CALNAME:${escape(name)}", "X-WR-TIMEZONE:Asia/Shanghai",
        )
        val stamp = utcFormat().format(now)
        meetings.forEach { meeting ->
            val course = meeting.course
            // ASCII only: the key has course names in it.
            val uid = meeting.key.map { if (it.code < 128) it.toString() else "%02X".format(it.code) }.joinToString("")
            val details = listOfNotNull(
                "第 ${meeting.week} 周", course.teacher?.trim()?.takeIf { it.isNotEmpty() }, course.editableNote.takeIf { it.isNotEmpty() },
                meeting.sourceDate?.let { "调休补 $it 的课" },
            )
            lines += listOfNotNull(
                "BEGIN:VEVENT",
                "UID:${escape(uid)}@cputime.cn",
                "DTSTAMP:$stamp",
                "DTSTART:${utcDate(meeting.date, meeting.start)}",
                "DTEND:${utcDate(meeting.date, meeting.end)}",
                "SUMMARY:${escape(course.name.trim().ifEmpty { "课程" })}",
                ScheduleStyleTime.location(course.location)?.let { "LOCATION:${escape(it)}" },
                "DESCRIPTION:${escape(details.joinToString(" · "))}",
                "END:VEVENT",
            )
        }
        lines += "END:VCALENDAR"
        return lines.joinToString("\r\n") { fold(it) } + "\r\n"
    }

    fun semesterFileName(store: ScheduleStore) = "课表-${store.semesterTitle().replace(Regex("[\\\\/:*?\"<>|]"), "-")}-整学期.ics"

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

/** 导出整学期日历文件: the whole term the timetable has loaded, as a calendar file to save or import. */
fun exportSemesterSchedule(activity: MainActivity, store: ScheduleStore = activity.schedule) {
    val snapshot = store.completeSnapshot()
    if (snapshot == null) {
        activity.toast("整学期课表还没有加载完，请刷新课表后再试")
        return
    }
    val content = runCatching {
        ScheduleExport.semesterCalendar(ScheduleMeetings.make(snapshot), "课表-${store.semesterTitle()}")
    }.getOrElse {
        activity.toast(it.message ?: "日历导出失败")
        return
    }
    activity.saveCalendarFile(ScheduleExport.semesterFileName(store), content)
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
