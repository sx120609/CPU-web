package cn.lizmt.cpuweb.schedule

import java.util.Calendar

/**
 * Every class meeting a snapshot holds, on its real date and clock times
 * (iOS `NativeScheduleOccurrences`). The semester calendar file and 找共同空闲
 * both read this, so a day off, a make-up day (调休), a course's own clock
 * times and the weeks it runs are settled in one place.
 */
data class ScheduleMeeting(
    val semester: String,
    /** Teaching week the meeting is held in. */
    val week: Int,
    /** 1 (Monday) to 7, the day it is held on. */
    val day: Int,
    /** "yyyy-MM-dd", the date it is held on. */
    val date: String,
    /** "HH:mm", Beijing time. */
    val start: String,
    val end: String,
    val startSlot: Int,
    val endSlot: Int,
    val course: ScheduleCourse,
    /** Set when a make-up day runs the courses of another date. */
    val sourceDate: String? = null,
) {
    /** Stable across exports of the same timetable; a changed room or teacher keeps it, a moved meeting does not. */
    val key: String
        get() = listOf(semester, week.toString(), day.toString(), startSlot.toString(), endSlot.toString(),
            course.nativeId ?: course.sourceKey ?: course.customId ?: course.name).joinToString("|")

    val startMinutes: Int? get() = OverlayTiming.minutes(start)
    val endMinutes: Int? get() = OverlayTiming.minutes(end)
}

object ScheduleMeetings {
    /** The meetings of every week the snapshot covers: the whole term for a complete one, else only its week. */
    fun make(snapshot: ScheduleSnapshot): List<ScheduleMeeting> {
        val data = snapshot.data ?: return emptyList()
        val calendar = snapshot.calendar?.takeIf { it.weeks.isNotEmpty() } ?: return emptyList()
        val periods = if (snapshot.periods.isEmpty()) BUNDLED_PERIODS else mergeSuppliedPeriods(snapshot.periods, snapshot.periodsComplete)
        val ordered = calendar.weeks.sortedBy { it.week }
        val weeks = if (snapshot.completeSemester) ordered else {
            val selected = data.currentWeek.toIntOrNull() ?: calendar.currentWeek
            ordered.filter { it.week == selected }
        }
        val semester = data.currentSemester.trim().ifEmpty { calendar.currentSemester.orEmpty() }
        val last = periods.maxOfOrNull { it.number } ?: SLOT_COUNT
        val result = mutableListOf<ScheduleMeeting>()
        for (week in weeks) {
            for (targetDay in 1..7) {
                val targetDate = week.days.getOrNull(targetDay - 1)?.takeIf { it.length == 10 } ?: continue
                val adjustment = calendar.adjustments.firstOrNull { it.date == targetDate }
                if (adjustment?.kind == "off") continue
                var sourceDay = targetDay
                var sourceWeek = week.week
                var sourceDate: String? = null
                if (adjustment?.kind == "swap") {
                    val source = adjustment.source ?: continue
                    val owner = calendar.weeks.firstOrNull { source in it.days } ?: continue
                    sourceDay = owner.days.indexOf(source) + 1
                    sourceWeek = owner.week
                    sourceDate = source
                }
                for (cell in data.cells) {
                    if (cell.day != sourceDay) continue
                    for (course in cell.courses) {
                        if (course.weekList.isNotEmpty() && sourceWeek !in course.weekList) continue
                        val startSlot = (course.startSlot ?: (cell.bigSlot * 2 - 1)).coerceIn(1, last)
                        val endSlot = (course.endSlot ?: (cell.bigSlot * 2)).coerceIn(startSlot, last)
                        // A course with its own clock times keeps them over the bell schedule.
                        val own = course.customTime
                        val start = own?.first ?: periods.firstOrNull { it.number == startSlot }?.startTime ?: continue
                        val end = own?.second ?: periods.firstOrNull { it.number == endSlot }?.endTime ?: continue
                        val from = OverlayTiming.minutes(start) ?: continue
                        val to = OverlayTiming.minutes(end) ?: continue
                        if (to <= from) continue
                        result += ScheduleMeeting(semester, week.week, targetDay, targetDate, start, end, startSlot, endSlot, course, sourceDate)
                    }
                }
            }
        }
        return result.sortedWith(compareBy({ it.date }, { it.startMinutes }, { it.startSlot }))
    }
}

/**
 * 找共同空闲: the times on each day when nobody of the chosen timetables has a
 * class. Each timetable keeps its own bells and calendar (days off, make-up
 * days, single meetings moved or cancelled), so people at different schools
 * compare by clock time (iOS `ScheduleCommonFree`).
 */
object ScheduleCommonFree {
    data class Window(val date: String, val start: Int, val end: Int) {
        val minutes: Int get() = end - start
    }

    /** A day of the result: its free windows, and everybody's classes as minute ranges for the bar that shows the day. */
    data class Day(val date: String, val windows: List<Window>, val busy: List<IntRange>)

    /** The dates every timetable covers. */
    fun covered(snapshots: List<ScheduleSnapshot>): Pair<String, String>? {
        var lower: String? = null
        var upper: String? = null
        for (snapshot in snapshots) {
            val days = snapshot.calendar?.weeks.orEmpty().flatMap { it.days }.filter { it.length == 10 }.sorted()
            val first = days.firstOrNull() ?: return null
            val last = days.last()
            lower = maxOf(lower ?: first, first)
            upper = minOf(upper ?: last, last)
        }
        val from = lower ?: return null
        val to = upper ?: return null
        return if (from <= to) from to to else null
    }

    /**
     * The days from [from] to [to] (both included) inside every timetable's
     * term, with the windows of at least [minimum] minutes between [earliest]
     * and [latest]. On [today] nothing before [nowMinute] counts, rounded up to
     * the quarter hour; earlier days are left out.
     */
    fun days(
        snapshots: List<ScheduleSnapshot>, from: String, to: String, earliest: Int, latest: Int, minimum: Int,
        today: String, nowMinute: Int,
    ): List<Day> {
        if (snapshots.isEmpty() || from > to || earliest >= latest || minimum <= 0) return emptyList()
        val (lower, upper) = covered(snapshots) ?: return emptyList()
        val first = maxOf(from, lower)
        val last = minOf(to, upper)
        if (first > last) return emptyList()
        val busyByDate = mutableMapOf<String, MutableList<IntRange>>()
        for (snapshot in snapshots) {
            for (meeting in ScheduleMeetings.make(snapshot)) {
                if (meeting.date < first || meeting.date > last) continue
                val start = meeting.startMinutes ?: continue
                val end = meeting.endMinutes ?: continue
                if (end > start) busyByDate.getOrPut(meeting.date) { mutableListOf() } += start..end
            }
        }
        val result = mutableListOf<Day>()
        for (date in range(first, last)) {
            if (date < today) continue
            val busy = merge(busyByDate[date].orEmpty())
            var cursor = earliest
            if (date == today) cursor = maxOf(cursor, (nowMinute + 14) / 15 * 15)
            val windows = mutableListOf<Window>()
            for (range in busy) {
                if (range.last <= cursor || range.first >= latest) continue
                if (range.first - cursor >= minimum) windows += Window(date, cursor, range.first)
                cursor = maxOf(cursor, range.last)
            }
            if (latest - cursor >= minimum) windows += Window(date, cursor, latest)
            result += Day(date, windows, busy)
        }
        return result
    }

    /** Overlapping or touching ranges joined, in order. */
    fun merge(ranges: List<IntRange>): List<IntRange> {
        val merged = mutableListOf<IntRange>()
        for (range in ranges.sortedBy { it.first }) {
            val previous = merged.lastOrNull()
            if (previous != null && range.first <= previous.last) merged[merged.lastIndex] = previous.first..maxOf(previous.last, range.last)
            else merged += range
        }
        return merged
    }

    /** "1 小时 45 分". */
    fun durationText(minutes: Int): String {
        val hours = minutes / 60
        val rest = minutes % 60
        return when {
            hours == 0 -> "$rest 分钟"
            rest == 0 -> "$hours 小时"
            else -> "$hours 小时 $rest 分"
        }
    }

    /** Every date from [first] to [last], both included; at most a year. */
    fun range(first: String, last: String): List<String> {
        val result = mutableListOf<String>()
        val calendar = OccurrenceRules.calendar(first) ?: return result
        var current = first
        while (current <= last && result.size < 366) {
            result += current
            calendar.add(Calendar.DAY_OF_MONTH, 1)
            current = OccurrenceRules.format(calendar)
        }
        return result
    }

    fun shift(date: String, days: Int): String {
        val calendar = OccurrenceRules.calendar(date) ?: return date
        calendar.add(Calendar.DAY_OF_MONTH, days)
        return OccurrenceRules.format(calendar)
    }
}
