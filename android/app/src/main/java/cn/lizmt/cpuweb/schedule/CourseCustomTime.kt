package cn.lizmt.cpuweb.schedule

/**
 * Courses that do not follow the periods (a lecture, a lab, a club meeting)
 * carry their own start and end, `customStartTime` / `customEndTime` in
 * 24-hour "HH:MM". Port of the Web `server/src/shared/scheduleCustomTime.ts`.
 *
 * The grid is still laid out by period, so such a course also keeps
 * `startSlot` / `endSlot`: the periods its time overlaps, or the nearest one
 * when it falls in a break or outside the bell schedule.
 */
object CourseCustomTime {
    private val CLOCK = Regex("^(\\d{1,2}):(\\d{2})$")

    /** "8:05" or "08:05" → 485; null when it is not a valid time of day. */
    fun minutes(value: String?): Int? {
        val match = CLOCK.matchEntire(value?.trim().orEmpty()) ?: return null
        val hours = match.groupValues[1].toInt()
        val minutes = match.groupValues[2].toInt()
        if (hours > 23 || minutes > 59) return null
        return hours * 60 + minutes
    }

    fun format(minutes: Int): String {
        val safe = minutes.coerceIn(0, 23 * 60 + 59)
        return "%02d:%02d".format(safe / 60, safe % 60)
    }

    /** Both times valid and the end after the start, written with two-digit hours; null otherwise. */
    fun range(start: String?, end: String?): Pair<String, String>? {
        val from = minutes(start) ?: return null
        val to = minutes(end) ?: return null
        if (to <= from) return null
        return format(from) to format(to)
    }

    /**
     * The periods this time is drawn on: the ones it overlaps, or the nearest
     * one when it overlaps none. Null for an invalid time or an empty schedule.
     */
    fun slotRange(start: String?, end: String?, periods: List<SchedulePeriod>): IntRange? {
        val (startText, endText) = range(start, end) ?: return null
        val from = minutes(startText)!!
        val to = minutes(endText)!!
        val timed = periods.mapNotNull { period ->
            val periodStart = minutes(period.startTime) ?: return@mapNotNull null
            val periodEnd = minutes(period.endTime) ?: return@mapNotNull null
            if (period.number > 0) Triple(period.number, periodStart, periodEnd) else null
        }.sortedBy { it.first }
        if (timed.isEmpty()) return null
        val overlapping = timed.filter { it.second < to && from < it.third }
        if (overlapping.isNotEmpty()) return overlapping.first().first..overlapping.last().first
        val nearest = timed.minByOrNull { if (it.third <= from) from - it.third else it.second - to } ?: return null
        return nearest.first..nearest.first
    }
}
