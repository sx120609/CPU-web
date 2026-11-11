package cn.lizmt.cpuweb.schedule

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

/**
 * One meeting of a course changed on its own: 这次停课, or 调整这一次 to
 * another date, other periods or another room. The server keeps them with the
 * schedule edits (`server/src/shared/scheduleOccurrences.ts`) and the site
 * writes them into the timetable before it reaches the app, so a cancelled
 * week is already gone from the course and a moved meeting is a one-week
 * course on its new date. The iOS counterpart is `NativeScheduleOccurrenceChange`.
 */
data class OccurrenceChange(
    /** The course's edit key (`jwxt|…`, or the `sourceKey` of an edited row). */
    val key: String,
    /** "yyyy-MM-dd", the meeting as it was meant to be held. */
    val date: String,
    val cancelled: Boolean = false,
    val toDate: String? = null,
    val startSlot: Int? = null,
    val endSlot: Int? = null,
    val location: String? = null,
    val note: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("key", key)
        put("date", date)
        if (cancelled) put("cancelled", true)
        toDate?.let { put("toDate", it) }
        startSlot?.let { put("startSlot", it) }
        endSlot?.let { put("endSlot", it) }
        location?.takeIf { it.isNotBlank() }?.let { put("location", it.trim()) }
        note?.takeIf { it.isNotBlank() }?.let { put("note", it.trim()) }
    }

    companion object {
        private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

        fun parse(json: JSONObject): OccurrenceChange? {
            val key = json.optString("key", "").trim()
            val date = json.optString("date", "").trim()
            if (key.isEmpty() || !DATE.matches(date)) return null
            return OccurrenceChange(
                key = key,
                date = date,
                cancelled = json.optBoolean("cancelled", false),
                toDate = json.optStringOrNull("toDate")?.takeIf { DATE.matches(it) },
                startSlot = json.optIntOrNull("startSlot"),
                endSlot = json.optIntOrNull("endSlot"),
                location = json.optStringOrNull("location"),
                note = json.optStringOrNull("note"),
            )
        }

        fun parseList(array: JSONArray): List<OccurrenceChange> =
            (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::parse) }

        fun toJsonArray(changes: List<OccurrenceChange>): JSONArray = JSONArray().apply { changes.forEach { put(it.toJson()) } }
    }
}

/** The rules of single-meeting changes, free of Android types so they run in a unit test. */
object OccurrenceRules {
    private val WHITESPACE = Regex("\\s+")
    private val ZONE: TimeZone = TimeZone.getTimeZone("Asia/Shanghai")

    /**
     * The edit key of a course row (web `courseEditKey`): its `sourceKey`, else
     * `jwxt|day|bigSlot|start|end|name|teacher|location|weeks`, with the week
     * text it came with when one of its meetings rewrote `weeks`.
     */
    fun editKey(day: Int, bigSlot: Int, course: ScheduleCourse): String {
        course.sourceKey?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        fun part(value: String?) = value.orEmpty().trim().replace(WHITESPACE, " ")
        return listOf(
            "jwxt", day.toString(), bigSlot.toString(), course.startSlot?.toString().orEmpty(), course.endSlot?.toString().orEmpty(),
            part(course.name), part(course.teacher), part(course.location), part(course.sourceWeeks ?: course.weeks),
        ).joinToString("|")
    }

    /** The keys a meeting of [block] is saved under: one per row of the timetable the site merged into it. */
    fun keys(block: CourseBlock): List<String> =
        block.course.editKeys.ifEmpty { listOf(editKey(block.day, block.bigSlot, block.course)) }

    /** The keys of a cancelled meeting, its change's own key included. */
    fun cancelledKeys(block: CourseBlock): List<String> =
        (keys(block) + listOfNotNull(block.cancelled?.key)).distinct()

    /** The keys of every row moved together with [key] on [from]. */
    fun movedKeys(changes: List<OccurrenceChange>, key: String, from: String): List<String> {
        val base = changes.firstOrNull { it.key == key && it.date == from } ?: return listOf(key)
        return changes.filter {
            it.date == from && (it.key == key || (it.toDate == base.toDate && it.startSlot == base.startSlot &&
                it.endSlot == base.endSlot && it.location == base.location))
        }.map { it.key }.distinct()
    }

    /** The saved change of a moved meeting. */
    fun existing(changes: List<OccurrenceChange>, course: ScheduleCourse): OccurrenceChange? {
        val key = course.occurrenceKey ?: return null
        val from = course.occurrenceFrom ?: return null
        return changes.firstOrNull { it.key == key && it.date == from }
    }

    /** The list after replacing the changes of [keys] on [date] by [change] for each key (none: back to the plan). */
    fun replace(
        changes: List<OccurrenceChange>, keys: Collection<String>, date: String, change: ((String) -> OccurrenceChange)?,
    ): List<OccurrenceChange> {
        val set = keys.toSet()
        val kept = changes.filterNot { it.key in set && it.date == date }
        return if (change == null) kept else kept + set.sorted().map(change)
    }

    /**
     * Cancelled meetings of [date] that stand in the grey in their old place:
     * the course still runs in other weeks, so it is found among the cells of
     * that weekday by one of its edit keys. One block per course.
     */
    fun cancelledBlocks(
        changes: List<OccurrenceChange>?, date: String, day: Int, cells: List<ScheduleCell>, slotCount: Int,
    ): List<CourseBlock> {
        if (changes.isNullOrEmpty() || date.length != 10) return emptyList()
        val seen = mutableSetOf<String>()
        val blocks = mutableListOf<CourseBlock>()
        for (change in changes) {
            if (!change.cancelled || change.date != date) continue
            loop@ for (cell in cells) {
                if (cell.day != day) continue
                for (course in cell.courses) {
                    if (course.isMovedOccurrence) continue
                    if (change.key !in course.editKeys && editKey(cell.day, cell.bigSlot, course) != change.key) continue
                    val id = (course.editKeys.firstOrNull() ?: change.key) + "@" + change.date
                    if (seen.add(id)) {
                        val start = (course.startSlot ?: (cell.bigSlot * 2 - 1)).coerceIn(1, slotCount)
                        val end = (course.endSlot ?: (cell.bigSlot * 2)).coerceIn(start, slotCount)
                        blocks += CourseBlock(day, (start + 1) / 2, start, end, course, date = date, cancelled = change)
                    }
                    break@loop
                }
            }
        }
        return blocks
    }

    /** Where a moved meeting sat before, from the course's other weeks. */
    fun originalSlots(cells: List<ScheduleCell>, keys: Collection<String>): Pair<Int, Int>? {
        for (cell in cells) for (course in cell.courses) {
            if (course.isMovedOccurrence) continue
            if (course.editKeys.none { it in keys } && editKey(cell.day, cell.bigSlot, course) !in keys) continue
            val start = course.startSlot ?: (cell.bigSlot * 2 - 1)
            return start to (course.endSlot ?: maxOf(start, cell.bigSlot * 2))
        }
        return null
    }

    /** Why [date] cannot take the meeting, if it cannot. */
    fun dateProblem(calendar: ScheduleCalendar?, date: String): String? {
        val value = calendar ?: return null
        if (value.weeks.none { date in it.days }) return "这一天不在本学期内"
        val adjustment = value.adjustments.firstOrNull { it.date == date } ?: return null
        return if (adjustment.kind == "off") "这一天放假，课表上不会显示这节课" else "这一天是调休补课日，暂时不能把课调到这天"
    }

    /** Whether the meeting on [date] can be changed on its own: a site that keeps changes, a date of the term that is not adjusted. */
    fun canChange(changes: List<OccurrenceChange>?, calendar: ScheduleCalendar?, date: String): Boolean =
        changes != null && date.length == 10 && calendar?.adjustments?.none { it.date == date } != false

    /**
     * The change 调整这一次 saves for one key: the new date when it differs,
     * periods when they moved (or the date did), the room when it is a new
     * one and the note when there is one.
     */
    fun build(
        key: String, date: String, target: String, start: Int, end: Int, original: Pair<Int, Int>,
        location: String, originalLocation: String?, note: String,
    ): OccurrenceChange {
        val toDate = target.takeIf { it != date }
        val moved = (start to end) != original || toDate != null
        val room = location.trim().takeIf { it.isNotEmpty() && it != originalLocation.orEmpty().trim() }
        return OccurrenceChange(
            key = key, date = date, toDate = toDate,
            startSlot = if (moved) start else null, endSlot = if (moved) end else null,
            location = room, note = note.trim().takeIf { it.isNotEmpty() },
        )
    }

    /** "11月12日 周四". */
    fun dateText(date: String): String {
        val calendar = calendar(date) ?: return date
        val names = listOf("日", "一", "二", "三", "四", "五", "六")
        return "${calendar.get(Calendar.MONTH) + 1}月${calendar.get(Calendar.DAY_OF_MONTH)}日 周${names[calendar.get(Calendar.DAY_OF_WEEK) - 1]}"
    }

    fun slotsText(start: Int, end: Int): String = if (start == end) "第 $start 节" else "第 $start–$end 节"

    /** Noon of a "yyyy-MM-dd" in Beijing time, or null. */
    fun calendar(date: String): Calendar? {
        val parts = date.split('-').mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return null
        return GregorianCalendar(ZONE, Locale.US).apply {
            clear()
            isLenient = false
            set(parts[0], parts[1] - 1, parts[2], 12, 0)
        }.takeIf { runCatching { it.timeInMillis }.isSuccess }
    }

    fun format(calendar: Calendar): String = String.format(
        Locale.US, "%04d-%02d-%02d", calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
    )

    /** "yyyy-MM-dd" of a UTC midnight in milliseconds, as the date picker hands it back. */
    fun fromUtcMillis(millis: Long): String {
        val calendar = GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.US).apply { timeInMillis = millis }
        return format(calendar)
    }

    fun utcMillis(date: String): Long? {
        val parts = date.split('-').mapNotNull { it.toIntOrNull() }
        if (parts.size != 3) return null
        return GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.US).apply {
            clear()
            set(parts[0], parts[1] - 1, parts[2])
        }.timeInMillis
    }
}
