package cn.lizmt.cpuweb.schedule

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/*
 * The shared Web bridge returns `{ version: 1, source, fetchedAt, periods,
 * data, calendar, auth, completeSemester?, cancelled?, error? }`. The shapes
 * below mirror `NativeScheduleSnapshot` on iOS and HarmonyOS. Parsing is
 * tolerant: unknown fields are ignored and missing optional fields fall back
 * to the same defaults the other native clients use.
 */

data class ScheduleOption(val value: String, val label: String, val current: Boolean)

data class ScheduleCourse(
    val name: String,
    val nativeId: String? = null,
    val teacher: String? = null,
    val weeks: String = "",
    val weekList: List<Int> = emptyList(),
    val location: String? = null,
    val slotNote: String? = null,
    val startSlot: Int? = null,
    val endSlot: Int? = null,
    val sourceKey: String? = null,
    val customId: String? = null,
    val custom: Boolean = false,
    val orphaned: Boolean = false,
    /** The note the course arrived with; [slotNote] is replaced by the merged period label. */
    val sourceNote: String? = null,
) {
    /** The user's own note for the editor, without generated period labels (Web `noteFromCourse`). */
    val editableNote: String
        get() {
            val note = (sourceNote ?: slotNote)?.trim().orEmpty()
            return if (AUTO_SLOT_NOTE.matches(note)) "" else note
        }

    fun toJson(): JSONObject = JSONObject().apply {
        put("name", name)
        nativeId?.let { put("nativeId", it) }
        teacher?.let { put("teacher", it) }
        put("weeks", weeks)
        put("weekList", JSONArray(weekList))
        location?.let { put("location", it) }
        slotNote?.let { put("slotNote", it) }
        startSlot?.let { put("startSlot", it) }
        endSlot?.let { put("endSlot", it) }
        sourceKey?.let { put("sourceKey", it) }
        customId?.let { put("customId", it) }
        if (custom) put("custom", true)
        if (orphaned) put("orphaned", true)
    }
}

data class ScheduleCell(val day: Int, val bigSlot: Int, val courses: List<ScheduleCourse>) {
    fun toJson(): JSONObject = JSONObject()
        .put("day", day)
        .put("bigSlot", bigSlot)
        .put("courses", JSONArray().apply { courses.forEach { put(it.toJson()) } })
}

data class CalendarWeek(val week: Int, val days: List<String>, val monday: String, val sunday: String)

/**
 * A holiday or make-up day from the term calendar: `off` cancels the day's
 * classes, `swap` holds the classes of [source] (a real date, possibly in
 * another week) on [date].
 */
data class ScheduleAdjustment(val date: String, val kind: String, val source: String?, val note: String?)

data class ScheduleCalendar(
    val source: String? = null,
    val semesters: List<ScheduleOption> = emptyList(),
    val currentSemester: String? = null,
    val currentWeek: Int = 0,
    val semesterStart: String = "",
    val semesterEnd: String = "",
    val weeks: List<CalendarWeek> = emptyList(),
    val adjustments: List<ScheduleAdjustment> = emptyList(),
)

data class SchedulePeriod(val number: Int, val startTime: String, val endTime: String)

data class ScheduleResult(
    val source: String? = null,
    val semesters: List<ScheduleOption>,
    val weeks: List<ScheduleOption>,
    val currentSemester: String,
    val currentWeek: String,
    val cells: List<ScheduleCell>,
)

data class ScheduleSnapshot(
    val version: Int,
    val completeSemester: Boolean,
    val source: String?,
    val fetchedAt: Long,
    val periods: List<SchedulePeriod>,
    val data: ScheduleResult?,
    val calendar: ScheduleCalendar?,
    val authenticated: Boolean,
    val identity: String?,
    val account: String?,
    val error: String?,
    val cancelled: Boolean,
    /** The original payload, persisted verbatim so a restore reparses the same data. */
    val raw: String,
)

/** A merged, positioned course occupying one or more small slots of one day. */
data class CourseBlock(
    val day: Int,
    val bigSlot: Int,
    val startSlot: Int,
    val endSlot: Int,
    val course: ScheduleCourse,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("day", day)
        .put("bigSlot", bigSlot)
        .put("startSlot", startSlot)
        .put("endSlot", endSlot)
        .put("course", course.toJson())
}

/** The university's twelve small periods, used until the calendar supplies its own. */
val BUNDLED_PERIODS: List<SchedulePeriod> = listOf(
    SchedulePeriod(1, "08:00", "08:45"), SchedulePeriod(2, "08:55", "09:40"),
    SchedulePeriod(3, "09:55", "10:40"), SchedulePeriod(4, "10:50", "11:35"),
    SchedulePeriod(5, "13:30", "14:15"), SchedulePeriod(6, "14:25", "15:10"),
    SchedulePeriod(7, "15:25", "16:10"), SchedulePeriod(8, "16:20", "17:05"),
    SchedulePeriod(9, "18:30", "19:15"), SchedulePeriod(10, "19:25", "20:10"),
    SchedulePeriod(11, "20:20", "21:05"), SchedulePeriod(12, "21:15", "22:00"),
)

const val SLOT_COUNT = 12
val WEEKDAY_LABELS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

object ScheduleJson {
    fun parseSnapshot(raw: String): ScheduleSnapshot? {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val auth = json.optJSONObject("auth")
        // A response without a readable time is treated as fetched now, and
        // that time is written into the kept JSON so an archived copy still
        // ages and expires instead of looking new on every restore.
        val parsedTime = parseTime(json.opt("fetchedAt"))
        val fetchedAt = parsedTime ?: System.currentTimeMillis()
        val kept = if (parsedTime == null) json.put("fetchedAt", fetchedAt).toString() else raw
        return ScheduleSnapshot(
            version = json.optInt("version", 0),
            completeSemester = json.optBoolean("completeSemester", false),
            source = json.optStringOrNull("source"),
            fetchedAt = fetchedAt,
            periods = parsePeriods(json.optJSONArray("periods")),
            data = json.optJSONObject("data")?.let(::parseResult),
            calendar = json.optJSONObject("calendar")?.let(::parseCalendar),
            authenticated = auth?.optBoolean("authenticated", false) ?: false,
            identity = auth?.optStringOrNull("identity"),
            account = auth?.optStringOrNull("account"),
            error = json.optStringOrNull("error"),
            cancelled = json.optBoolean("cancelled", false),
            raw = kept,
        )
    }

    private fun parseTime(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is String -> value.toLongOrNull() ?: parseIsoTime(value)
        else -> null
    }

    /** `java.time` needs API 26; the shell still supports Android 6. */
    fun parseIsoTime(value: String): Long? {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            val format = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val parsed = runCatching { format.parse(value) }.getOrNull()
            if (parsed != null) return parsed.time
        }
        return null
    }

    private fun parsePeriods(array: JSONArray?): List<SchedulePeriod> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val number = item.optInt("number", 0)
            val start = item.optString("startTime", "")
            val end = item.optString("endTime", "")
            if (number < 1 || start.length < 4 || end.length < 4) null else SchedulePeriod(number, start, end)
        }.sortedBy { it.number }
    }

    private fun parseOptions(array: JSONArray?): List<ScheduleOption> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val value = item.optString("value", "").trim()
            if (value.isEmpty()) null
            else ScheduleOption(value, item.optString("label", value).ifBlank { value }, item.optBoolean("current", false))
        }
    }

    fun parseResult(json: JSONObject): ScheduleResult? {
        val cellsArray = json.optJSONArray("cells") ?: return null
        val cells = (0 until cellsArray.length()).mapNotNull { index ->
            val cell = cellsArray.optJSONObject(index) ?: return@mapNotNull null
            val coursesArray = cell.optJSONArray("courses") ?: JSONArray()
            val courses = (0 until coursesArray.length()).mapNotNull { coursesArray.optJSONObject(it)?.let(::parseCourse) }
            val day = cell.optInt("day", 0)
            val bigSlot = cell.optInt("bigSlot", 0)
            if (day !in 1..7 || bigSlot < 1 || courses.isEmpty()) null else ScheduleCell(day, bigSlot, courses)
        }
        return ScheduleResult(
            source = json.optStringOrNull("source"),
            semesters = parseOptions(json.optJSONArray("semesters")),
            weeks = parseOptions(json.optJSONArray("weeks")),
            currentSemester = json.optString("currentSemester", ""),
            currentWeek = json.opt("currentWeek")?.toString()?.takeIf { it != "null" } ?: "",
            cells = cells,
        )
    }

    fun parseCourse(json: JSONObject): ScheduleCourse {
        val weekArray = json.optJSONArray("weekList")
        val weekList = if (weekArray == null) emptyList() else (0 until weekArray.length())
            .mapNotNull { weekArray.opt(it)?.toString()?.toDoubleOrNull()?.toInt() }
            .filter { it > 0 }.distinct().sorted()
        return ScheduleCourse(
            name = json.optString("name", "").ifBlank { "课程" },
            nativeId = json.optStringOrNull("nativeId"),
            teacher = json.optStringOrNull("teacher"),
            weeks = json.optString("weeks", ""),
            weekList = weekList,
            location = json.optStringOrNull("location"),
            slotNote = json.optStringOrNull("slotNote"),
            startSlot = json.optIntOrNull("startSlot"),
            endSlot = json.optIntOrNull("endSlot"),
            sourceKey = json.optStringOrNull("sourceKey"),
            customId = json.optStringOrNull("customId"),
            custom = json.optBoolean("custom", false),
            orphaned = json.optBoolean("orphaned", false),
        )
    }

    fun parseCalendar(json: JSONObject): ScheduleCalendar {
        val weeksArray = json.optJSONArray("weeks") ?: JSONArray()
        val weeks = (0 until weeksArray.length()).mapNotNull { index ->
            val item = weeksArray.optJSONObject(index) ?: return@mapNotNull null
            val daysArray = item.optJSONArray("days") ?: JSONArray()
            val days = (0 until daysArray.length()).map { daysArray.optString(it, "") }
            val week = item.optInt("week", 0)
            if (week < 1) null else CalendarWeek(week, days, item.optString("monday", ""), item.optString("sunday", ""))
        }
        return ScheduleCalendar(
            source = json.optStringOrNull("source"),
            semesters = parseOptions(json.optJSONArray("semesters")),
            currentSemester = json.optStringOrNull("currentSemester"),
            currentWeek = json.optInt("currentWeek", 0),
            semesterStart = json.optString("semesterStart", ""),
            semesterEnd = json.optString("semesterEnd", ""),
            weeks = weeks,
            adjustments = parseAdjustments(json.optJSONArray("adjustments")),
        )
    }

    private fun parseAdjustments(array: JSONArray?): List<ScheduleAdjustment> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val date = item.optString("date", "").trim()
            val kind = item.optString("kind", "").trim()
            if (date.length != 10 || (kind != "off" && kind != "swap")) null
            else ScheduleAdjustment(date, kind, item.optStringOrNull("source"), item.optStringOrNull("note"))
        }
    }
}

internal fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key, "").trim().takeIf { it.isNotEmpty() }
}

internal fun JSONObject.optIntOrNull(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    val value = opt(key)
    return when (value) {
        is Number -> value.toInt()
        is String -> value.trim().toDoubleOrNull()?.toInt()
        else -> null
    }?.takeIf { it > 0 }
}

/** Period labels generated by JWXT, the server or this app, e.g. `第 1-2 节`, `01-02节`, `09节`. */
private val AUTO_SLOT_NOTE = Regex("^(第\\s*\\d+\\s*(-\\s*\\d+)?\\s*节|\\d{1,2}(-\\d{1,2})?节)$")
