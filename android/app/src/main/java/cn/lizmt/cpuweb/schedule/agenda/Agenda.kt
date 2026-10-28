package cn.lizmt.cpuweb.schedule.agenda

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeParseException

/**
 * Stored since 1.1.0, when events and to-dos were separate. Since 1.1.1 every
 * item behaves the same (any item may have a time, a date or neither, and any
 * item can be ticked off); the field is only read back from older data.
 */
enum class AgendaKind(val id: String, val title: String) {
    Event("event", "日程"),
    Todo("todo", "待办");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Event
    }
}

enum class AgendaRepeat(val id: String, val title: String) {
    None("none", "不重复"),
    Daily("daily", "每天"),
    Weekdays("weekdays", "工作日"),
    Weekly("weekly", "每周"),
    Monthly("monthly", "每月");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: None
    }
}

/** Minutes before the start (or due time) a reminder fires; [NONE] is no reminder. */
object AgendaRemind {
    const val NONE = -1
    val choices = listOf(NONE to "不提醒", 0 to "准时", 5 to "5 分钟前", 15 to "15 分钟前", 30 to "30 分钟前", 60 to "1 小时前", 1440 to "1 天前")
    fun label(minutes: Int): String = choices.firstOrNull { it.first == minutes }?.second ?: "$minutes 分钟前"
}

/**
 * Something the user plans outside the timetable: at a time, on a day, or not
 * yet dated; any of them can be ticked off. Repeating items keep one record and
 * remember which days were done.
 */
data class AgendaItem(
    val id: String,
    val kind: AgendaKind,
    val title: String,
    /** `yyyy-MM-dd`, or empty for an item without a day yet. */
    val date: String = "",
    /** `HH:mm`; empty for an item that takes the whole day. */
    val start: String = "",
    /** `HH:mm` after [start], optional. */
    val end: String = "",
    val location: String = "",
    val note: String = "",
    val remind: Int = AgendaRemind.NONE,
    val repeat: AgendaRepeat = AgendaRepeat.None,
    /** Last day of a repeat, inclusive; empty repeats forever. */
    val until: String = "",
    val done: Boolean = false,
    val doneDates: Set<String> = emptySet(),
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    /** "assistant" when 拾间AI proposed it and the user confirmed. */
    val origin: String = "user",
) {
    val timed: Boolean get() = start.isNotEmpty()
    val dated: Boolean get() = date.isNotEmpty()

    fun occursOn(day: LocalDate): Boolean {
        val first = parseDate(date) ?: return false
        if (day.isBefore(first)) return false
        parseDate(until)?.let { if (day.isAfter(it)) return false }
        return when (repeat) {
            AgendaRepeat.None -> day == first
            AgendaRepeat.Daily -> true
            AgendaRepeat.Weekdays -> day.dayOfWeek != DayOfWeek.SATURDAY && day.dayOfWeek != DayOfWeek.SUNDAY
            AgendaRepeat.Weekly -> day.dayOfWeek == first.dayOfWeek
            AgendaRepeat.Monthly -> day.dayOfMonth == first.dayOfMonth
        }
    }

    fun isDoneOn(day: String): Boolean = if (repeat == AgendaRepeat.None) done else day in doneDates

    companion object {
        fun parseDate(value: String): LocalDate? = if (value.length != 10) null else try {
            LocalDate.parse(value)
        } catch (_: DateTimeParseException) {
            null
        }

        fun parseTime(value: String): LocalTime? {
            if (!TIME.matches(value)) return null
            val (hour, minute) = value.split(':').map { it.toInt() }
            return if (hour in 0..23 && minute in 0..59) LocalTime.of(hour, minute) else null
        }

        private val TIME = Regex("^\\d{2}:\\d{2}$")
    }
}

/** One item on one day, as lists show it. */
data class AgendaOccurrence(val item: AgendaItem, val day: LocalDate) {
    val done: Boolean get() = item.isDoneOn(day.toString())
}

object AgendaCodec {
    const val VERSION = 1
    const val MAX_ITEMS = 600
    private val ID = Regex("^[a-z0-9]{6,24}$")

    fun newId(): String {
        val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
        return "a" + (1..11).map { alphabet.random() }.joinToString("")
    }

    fun toJson(item: AgendaItem): JSONObject = JSONObject()
        .put("id", item.id)
        .put("kind", item.kind.id)
        .put("title", item.title)
        .put("date", item.date)
        .put("start", item.start)
        .put("end", item.end)
        .put("location", item.location)
        .put("note", item.note)
        .put("remind", item.remind)
        .put("repeat", item.repeat.id)
        .put("until", item.until)
        .put("done", item.done)
        .put("doneDates", JSONArray(item.doneDates.sorted()))
        .put("createdAt", item.createdAt)
        .put("updatedAt", item.updatedAt)
        .put("origin", item.origin)

    /** [deleted]: when each removed item was removed, so other devices drop it too. */
    fun encode(items: List<AgendaItem>, deleted: Map<String, Long> = emptyMap()): String =
        JSONObject().put("v", VERSION).put("items", JSONArray(items.map(::toJson)))
            .put("deleted", JSONObject().apply { deleted.forEach { (id, at) -> put(id, at) } }).toString()

    fun decodeDeleted(raw: String?): Map<String, Long> {
        val json = runCatching { JSONObject(raw ?: return emptyMap()).optJSONObject("deleted") }.getOrNull() ?: return emptyMap()
        return json.keys().asSequence().filter { ID.matches(it) }.associateWith { json.optLong(it, 0) }.filterValues { it > 0 }
    }

    fun decode(raw: String?): List<AgendaItem> {
        val array = runCatching { JSONObject(raw ?: return emptyList()).optJSONArray("items") }.getOrNull() ?: return emptyList()
        val result = mutableListOf<AgendaItem>()
        for (index in 0 until array.length()) {
            val item = fromJson(array.optJSONObject(index) ?: continue) ?: continue
            if (result.none { it.id == item.id }) result += item
            if (result.size == MAX_ITEMS) break
        }
        return result
    }

    /** A stored or proposed item made safe: unknown values fall back, broken ones are dropped. */
    fun fromJson(json: JSONObject): AgendaItem? {
        val id = json.optString("id").takeIf { ID.matches(it) } ?: return null
        return normalize(
            AgendaItem(
                id = id,
                kind = AgendaKind.of(json.optString("kind")),
                title = json.optString("title"),
                date = json.optString("date"),
                start = json.optString("start"),
                end = json.optString("end"),
                location = json.optString("location"),
                note = json.optString("note"),
                remind = json.optInt("remind", AgendaRemind.NONE),
                repeat = AgendaRepeat.of(json.optString("repeat")),
                until = json.optString("until"),
                done = json.optBoolean("done", false),
                doneDates = json.optJSONArray("doneDates")?.let { dates ->
                    (0 until dates.length()).mapNotNull { dates.opt(it) as? String }.toSet()
                } ?: emptySet(),
                createdAt = json.optLong("createdAt", 0),
                updatedAt = json.optLong("updatedAt", 0),
                origin = if (json.optString("origin") == "assistant") "assistant" else "user",
            ),
        )
    }

    /**
     * Clips text, drops impossible dates and times, keeps an event's end after
     * its start and returns null for items that cannot be shown at all.
     */
    fun normalize(item: AgendaItem): AgendaItem? {
        val title = clip(item.title.trim().replace(Regex("\\s+"), " "), 60)
        if (title.isEmpty()) return null
        val date = item.date.takeIf { AgendaItem.parseDate(it) != null }.orEmpty()
        val start = item.start.takeIf { AgendaItem.parseTime(it) != null && date.isNotEmpty() }.orEmpty()
        val end = item.end.takeIf {
            start.isNotEmpty() && AgendaItem.parseTime(it)?.isAfter(AgendaItem.parseTime(start)) == true
        }.orEmpty()
        val repeat = if (date.isEmpty()) AgendaRepeat.None else item.repeat
        val until = item.until.takeIf { repeat != AgendaRepeat.None && (AgendaItem.parseDate(it)?.let { u -> !u.isBefore(AgendaItem.parseDate(date)) } == true) }.orEmpty()
        return item.copy(
            title = title,
            date = date,
            start = start,
            end = end,
            location = clip(item.location.trim(), 40),
            note = clip(item.note, 1_000),
            remind = item.remind.takeIf { (it == AgendaRemind.NONE || it in 0..10_080) && date.isNotEmpty() } ?: AgendaRemind.NONE,
            repeat = repeat,
            until = until,
            done = repeat == AgendaRepeat.None && item.done,
            doneDates = if (repeat == AgendaRepeat.None) emptySet() else item.doneDates.filter { AgendaItem.parseDate(it) != null }.takeLast(400).toSet(),
        )
    }

    private fun clip(value: String, codePoints: Int): String {
        if (value.codePointCount(0, value.length) <= codePoints) return value
        return value.substring(0, value.offsetByCodePoints(0, codePoints))
    }
}
