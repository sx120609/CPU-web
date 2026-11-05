package cn.lizmt.cpuweb.schedule

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/*
 * The dorm timetable ("宿舍课表", docs/dorm-schedule.md) on the native screen:
 * up to eight roommates, when they are all free, and who has an 8 a.m. class.
 * The server keeps one timetable snapshot per member (`/api/dorm`); this
 * client uploads the user's own current term and lays out everyone's with
 * their own calendar, so make-up days and custom class times count.
 */

data class DormMember(
    val id: Int,
    val nickname: String,
    /** One of [DormRules.COLORS]. */
    val color: String,
    val owner: Boolean,
    /** When this member's timetable last reached the server; empty when it never did. */
    val syncedAt: String,
)

data class DormInvite(val code: String, val expired: Boolean)

sealed interface DormStatus {
    data object Unknown : DormStatus
    data object None : DormStatus
    data class Active(
        val name: String,
        val memberLimit: Int,
        val isOwner: Boolean,
        /** Only the owner gets the code. */
        val invite: DormInvite?,
        val me: DormMember,
        val members: List<DormMember>,
    ) : DormStatus

    companion object {
        fun fromJson(json: JSONObject): DormStatus {
            if (json.optString("status") != "active") return None
            val members = json.optJSONArray("members")?.let { array -> (0 until array.length()).mapNotNull { member(array.optJSONObject(it)) } }.orEmpty()
            val me = member(json.optJSONObject("me")) ?: return None
            val invite = json.optJSONObject("invite")?.let { DormInvite(text(it, "code"), it.optBoolean("expired", true)) }
                ?.takeIf { it.code.isNotEmpty() }
            return Active(text(json, "name").trim(), json.optInt("memberLimit", 6), json.optBoolean("isOwner"), invite, me,
                members.ifEmpty { listOf(me) })
        }

        private fun member(json: JSONObject?): DormMember? {
            val id = json?.optInt("id", 0) ?: return null
            if (id <= 0) return null
            return DormMember(id, text(json, "nickname").trim(), DormRules.color(text(json, "color")), json.optBoolean("isOwner"),
                text(json.optJSONObject("snapshot"), "syncedAt"))
        }

        /** `optString` turns a JSON null into the word "null". */
        internal fun text(json: JSONObject?, key: String): String = if (json == null || json.isNull(key)) "" else json.optString(key, "")
    }
}

/** A class of one day in minutes past midnight, with the periods it fills. */
data class DormCourse(val name: String, val start: Int, val end: Int, val startSlot: Int, val endSlot: Int)

/**
 * One roommate's timetable for the dorm maths. [coursesOn] is null for a day
 * the member has no data for (never synced, or outside their term): that day
 * they count neither as free nor as busy.
 */
class DormPerson(
    val id: Int,
    val nickname: String,
    val color: String,
    val periods: List<SchedulePeriod>,
    val weeks: List<CalendarWeek>,
    private val reader: (String) -> List<DormCourse>?,
) {
    val hasData: Boolean get() = weeks.isNotEmpty()
    private val cache = HashMap<String, List<DormCourse>?>()
    fun coursesOn(date: String): List<DormCourse>? = cache.getOrPut(date) { reader(date) }
    fun teachingWeek(date: String): Int? = weeks.firstOrNull { date in it.days }?.week
}

data class DormSpan(val start: Int, val end: Int)

data class DormFreeWindow(val start: Int, val end: Int, val freeIds: List<Int>)

data class DormDayAvailability(
    val date: String,
    val window: DormSpan,
    val knownIds: List<Int>,
    val unknownIds: List<Int>,
    val requiredFree: Int,
    /** More people are required free than have data that day. */
    val insufficientData: Boolean,
    val windows: List<DormFreeWindow>,
)

data class DormDuty(val id: Int, val course: String, val start: Int, val end: Int)

data class DormMorningDay(val date: String, val duties: List<DormDuty>, val knownCount: Int, val unknownCount: Int)

data class DormWeekCell(val date: String, val period: SchedulePeriod, val freeIds: List<Int>, val busy: List<Pair<Int, List<String>>>, val unknownIds: List<Int>) {
    val known: Int get() = freeIds.size + busy.size
    /** Free share of the people with data; 0 without data. */
    val freeRatio: Float get() = if (known == 0) 0f else freeIds.size.toFloat() / known
}

data class DormWeekRow(val period: SchedulePeriod, val breakBefore: Boolean, val cells: List<DormWeekCell>)

data class DormWeekGrid(val monday: String, val dates: List<String>, val teachingWeek: Int?, val rows: List<DormWeekRow>)

/**
 * The free-time maths of the Web page (`web/src/views/schedule/dorm.ts` and
 * `dormWeek.ts`), in plain Kotlin so it runs in a unit test.
 */
object DormRules {
    /** Eight colours, one per member at most, the same as the server's DORM_COLORS. */
    val COLORS: List<Pair<String, Int>> = listOf(
        "blue" to 214, "pink" to 338, "purple" to 268, "teal" to 178, "green" to 138, "amber" to 42, "orange" to 22, "red" to 358,
    )
    val COLOR_NAMES: Map<String, String> = mapOf(
        "blue" to "蓝", "pink" to "粉", "purple" to "紫", "teal" to "青", "green" to "绿", "amber" to "黄", "orange" to "橙", "red" to "红",
    )
    val WEEKDAYS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")
    private val DEFAULT_WINDOW = DormSpan(8 * 60, 21 * 60 + 40)
    private const val BREAK_MINUTES = 30
    const val MIN_WINDOW_MINUTES = 20

    fun color(value: String): String = if (COLORS.any { it.first == value }) value else "blue"

    /** A person's colours (ARGB), as the couple timetable draws its two people; `name` reads on the page background. */
    fun tone(color: String, dark: Boolean): Triple<Int, Int, Int> {
        val hue = COLORS.firstOrNull { it.first == color }?.second ?: 214
        return if (dark) Triple(CoupleRules.hsl(hue, 48, 29), CoupleRules.hsl(hue, 62, 50), CoupleRules.hsl(hue, 75, 74))
        else Triple(CoupleRules.hsl(hue, 88, 93), CoupleRules.hsl(hue, 72, 77), CoupleRules.hsl(hue, 62, 30))
    }

    fun minutes(value: String): Int? = ScheduleStyleTime.clockMinutes(value)

    fun clock(value: Int): String = "%02d:%02d".format(value.coerceAtLeast(0) / 60, value.coerceAtLeast(0) % 60)

    fun span(window: DormFreeWindow): String = "${clock(window.start)}–${clock(window.end)}"

    fun addDays(date: String, days: Long): String = runCatching { LocalDate.parse(date).plusDays(days).toString() }.getOrDefault(date)

    fun weekday(date: String): Int = runCatching { LocalDate.parse(date).dayOfWeek.value }.getOrDefault(1)

    fun monday(date: String): String = addDays(date, (1 - weekday(date)).toLong())

    fun today(): String = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString()

    /** "今天", "明天" or the weekday. */
    fun dayName(date: String, today: String): String = when (date) {
        today -> "今天"
        addDays(today, 1) -> "明天"
        else -> WEEKDAYS[weekday(date) - 1]
    }

    /** The dorm's day: earliest start to latest end of everyone's periods, to five minutes; 08:00–21:40 without any. */
    fun dayWindow(people: List<DormPerson>): DormSpan {
        var start = Int.MAX_VALUE
        var end = Int.MIN_VALUE
        people.forEach { person ->
            person.periods.forEach { period ->
                val from = minutes(period.startTime) ?: return@forEach
                val to = minutes(period.endTime) ?: return@forEach
                if (to <= from) return@forEach
                start = minOf(start, from)
                end = maxOf(end, to)
            }
        }
        if (start == Int.MAX_VALUE || end <= start) return DEFAULT_WINDOW
        return DormSpan(start / 5 * 5, (end + 4) / 5 * 5)
    }

    private fun busySpans(person: DormPerson, date: String): List<DormSpan>? =
        person.coursesOn(date)?.filter { it.end > it.start }?.map { DormSpan(it.start, it.end) }?.sortedWith(compareBy({ it.start }, { it.end }))

    /**
     * When people are free on [date]: the day is cut at every class start and
     * end, each piece lists who has no class, and neighbouring pieces with the
     * same people join. [minFree] null asks for everyone with data.
     */
    fun availability(
        people: List<DormPerson>, date: String, minFree: Int? = null, minMinutes: Int = MIN_WINDOW_MINUTES, span: DormSpan? = null,
    ): DormDayAvailability {
        val window = span ?: dayWindow(people)
        val known = mutableListOf<Int>()
        val unknown = mutableListOf<Int>()
        val busy = HashMap<Int, List<DormSpan>>()
        people.forEach { person ->
            val spans = busySpans(person, date)
            if (spans == null) unknown += person.id else {
                known += person.id
                busy[person.id] = spans.map { DormSpan(maxOf(it.start, window.start), minOf(it.end, window.end)) }.filter { it.end > it.start }
            }
        }
        val points = sortedSetOf(window.start, window.end)
        busy.values.forEach { spans -> spans.forEach { points += it.start; points += it.end } }
        val sorted = points.toList()
        val segments = mutableListOf<DormFreeWindow>()
        for (i in 0 until sorted.size - 1) {
            val start = sorted[i]
            val end = sorted[i + 1]
            if (end <= start) continue
            val free = known.filter { id -> busy[id].orEmpty().none { it.start < end && it.end > start } }
            val last = segments.lastOrNull()
            if (last != null && last.end == start && last.freeIds == free) segments[segments.lastIndex] = last.copy(end = end)
            else segments += DormFreeWindow(start, end, free)
        }
        // An explicit number is never lowered to the people with data: "至少 3 人" cannot be told from two timetables.
        val required = maxOf(1, minFree ?: known.size)
        val insufficient = required > known.size
        val windows = if (insufficient) emptyList() else absorbShort(segments, required, minMinutes)
            .filter { it.end - it.start >= minMinutes && it.freeIds.size >= required }
        return DormDayAvailability(date, window, known, unknown, required, insufficient, windows)
    }

    /**
     * With fewer than everyone required, a piece shorter than [minMinutes] joins a neighbour whose
     * people were all free through it too, so the joined block is still one set of people.
     */
    private fun absorbShort(segments: List<DormFreeWindow>, required: Int, minMinutes: Int): List<DormFreeWindow> {
        val list = segments.toMutableList()
        var changed = true
        while (changed) {
            changed = false
            for (index in list.indices) {
                val short = list[index]
                if (short.end - short.start >= minMinutes) continue
                val candidates = listOf(index - 1, index + 1).filter { at ->
                    val neighbour = list.getOrNull(at) ?: return@filter false
                    neighbour.freeIds.size >= required && (neighbour.end == short.start || neighbour.start == short.end) &&
                        short.freeIds.containsAll(neighbour.freeIds)
                }
                if (candidates.isEmpty()) continue
                val target = candidates.reduce { best, at -> if (list[at].freeIds.size > list[best].freeIds.size) at else best }
                val into = list[target]
                list[target] = into.copy(start = minOf(into.start, short.start), end = maxOf(into.end, short.end))
                list.removeAt(index)
                var at = list.size - 1
                while (at > 0) {
                    val before = list[at - 1]
                    val after = list[at]
                    if (before.end == after.start && before.freeIds == after.freeIds) {
                        list[at - 1] = before.copy(end = after.end)
                        list.removeAt(at)
                    }
                    at -= 1
                }
                changed = true
                break
            }
        }
        return list
    }

    /** What a free block says: with someone missing data only "已同步的人都有空", never the whole dorm. */
    fun windowLabel(window: DormFreeWindow, day: DormDayAvailability): String = when {
        window.freeIds.size < day.knownIds.size -> "${window.freeIds.size} 人有空"
        day.unknownIds.isNotEmpty() -> "已同步的 ${window.freeIds.size} 人都有空"
        window.freeIds.size > 1 -> "全宿舍都有空"
        else -> "有空"
    }

    fun emptyText(day: DormDayAvailability): String = when {
        day.knownIds.isEmpty() -> "这天大家都没有课表数据。"
        day.insufficientData -> "这天只有 ${day.knownIds.size} 人有课表数据，凑不出 ${day.requiredFree} 人。"
        else -> "没有满足条件的空档，可以少要几个人再看。"
    }

    /** Has a class in period 1 that day: the couple timetable's rule, so a class moved to 07:40 in period 3 is not one. */
    fun duties(people: List<DormPerson>, date: String): List<DormDuty> = people.mapNotNull { person ->
        val first = person.coursesOn(date)?.firstOrNull { it.startSlot == 1 } ?: return@mapNotNull null
        DormDuty(person.id, first.name, first.start, first.end)
    }.sortedWith(compareBy({ it.start }, { it.id }))

    fun mornings(people: List<DormPerson>, from: String, days: Int = 7): List<DormMorningDay> = (0 until days).map { offset ->
        val date = addDays(from, offset.toLong())
        val unknown = people.count { it.coursesOn(date) == null }
        DormMorningDay(date, duties(people, date), people.size - unknown, unknown)
    }

    /** The next people to get up early: today's count while their class has not begun. */
    fun nextMorning(days: List<DormMorningDay>, today: String, minute: Int): DormMorningDay? {
        days.forEach { day ->
            if (day.duties.isEmpty()) return@forEach
            if (day.date == today) {
                val pending = day.duties.filter { it.start > minute }
                if (pending.isNotEmpty()) return day.copy(duties = pending)
                return@forEach
            }
            return day
        }
        return null
    }

    /** The grid's periods: the user's own, else the first member with a timetable, else the default twelve. */
    fun weekPeriods(people: List<DormPerson>, meId: Int): List<SchedulePeriod> {
        val source = people.firstOrNull { it.id == meId && it.hasData } ?: people.firstOrNull { it.hasData }
        return (source?.periods?.takeIf { it.isNotEmpty() } ?: BUNDLED_PERIODS).filter { period ->
            val start = minutes(period.startTime)
            val end = minutes(period.endTime)
            start != null && end != null && end > start
        }
    }

    /** One row per period, one column per day: who is free, who is in which class, who has no data. */
    fun weekGrid(people: List<DormPerson>, monday: String, meId: Int): DormWeekGrid {
        val dates = (0 until 7).map { addDays(monday, it.toLong()) }
        val periods = weekPeriods(people, meId)
        val rows = periods.mapIndexed { index, period ->
            val previous = periods.getOrNull(index - 1)
            val gap = previous?.let { (minutes(period.startTime) ?: 0) - (minutes(it.endTime) ?: 0) } ?: 0
            val from = minutes(period.startTime) ?: 0
            val to = minutes(period.endTime) ?: 0
            val cells = dates.map { date ->
                val free = mutableListOf<Int>()
                val busy = mutableListOf<Pair<Int, List<String>>>()
                val unknown = mutableListOf<Int>()
                people.forEach { person ->
                    val courses = person.coursesOn(date)
                    if (courses == null) { unknown += person.id; return@forEach }
                    // By minutes, so custom times and a roommate's different periods still count right.
                    val names = courses.filter { course ->
                        if (course.end > course.start) course.start < to && course.end > from
                        else course.startSlot <= period.number && course.endSlot >= period.number
                    }.map { it.name }.distinct()
                    if (names.isEmpty()) free += person.id else busy += person.id to names
                }
                DormWeekCell(date, period, free, busy, unknown)
            }
            DormWeekRow(period, previous != null && gap >= BREAK_MINUTES, cells)
        }
        val ordered = people.sortedByDescending { it.id == meId }
        val week = ordered.firstNotNullOfOrNull { person -> dates.firstNotNullOfOrNull { person.teachingWeek(it) } }
        return DormWeekGrid(monday, dates, week, rows)
    }

    fun cellSummary(cell: DormWeekCell): String = when {
        cell.known == 0 -> "没有课表数据"
        cell.freeIds.isEmpty() -> if (cell.known > 1) "都在上课" else "在上课"
        cell.freeIds.size < cell.known -> "${cell.freeIds.size} 人有空"
        cell.unknownIds.isNotEmpty() -> "已同步的 ${cell.known} 人都有空"
        else -> if (cell.known > 1) "全宿舍都有空" else "有空"
    }

    /** What the invite sends: the code, where to type it, and the link that opens it. */
    fun invitation(code: String, origin: String): String =
        "来加入我们的宿舍课表吧！宿舍码 $code（24 小时内有效）。在药大拾间「课表 → 更多 → 宿舍课表」里输入，" +
            "或者打开 ${origin.trimEnd('/')}/schedule?dorm=1&code=$code 就能加入。"
}

class DormRequestException(message: String, val status: Int) : Exception(message)

/**
 * The dorm, everyone's timetable and the upload of the user's own. Background
 * requests fail quietly; the actions on the dorm report their failures.
 */
class ScheduleDormRoom(
    private val scope: CoroutineScope,
    private val preferences: SharedPreferences?,
    /** Runs one `CPUAndroidDorm` call in the page; null when the page cannot answer. */
    private val transport: suspend (JSONObject) -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    var status by mutableStateOf<DormStatus>(DormStatus.Unknown)
        private set
    var people by mutableStateOf<List<DormPerson>>(emptyList())
        private set
    var loadingPeople by mutableStateOf(false)
        private set

    private var account = ""
    private var checkedAt = 0L
    private var refreshing = false
    private var syncing = false

    val active: DormStatus.Active? get() = status as? DormStatus.Active

    /** Everything belongs to one account: another one signing in starts from nothing. */
    fun adopt(next: String) {
        if (next == account) return
        account = next
        checkedAt = 0L
        status = DormStatus.Unknown
        people = emptyList()
    }

    /** Asks the server for the dorm; unforced calls are spaced out (ten minutes without a dorm, one with). */
    suspend fun refresh(force: Boolean = false) {
        if (refreshing) return
        val now = clock()
        val pause = if (status is DormStatus.Active) 60_000L else 10 * 60_000L
        if (!force && checkedAt > 0 && now - checkedAt < pause) return
        refreshing = true
        try {
            apply(DormStatus.fromJson(request("status")))
            checkedAt = now
        } catch (_: DormRequestException) {
        } finally {
            refreshing = false
        }
    }

    private fun apply(next: DormStatus) {
        status = next
        if (next !is DormStatus.Active) {
            people = emptyList()
            preferences?.edit()?.remove(KEY_SYNC)?.apply()
        }
    }

    /** Everyone's timetable, each laid out with its own calendar. */
    suspend fun loadPeople() {
        val dorm = active ?: return
        loadingPeople = true
        try {
            val members = request("schedules").optJSONArray("members") ?: return
            val loaded = (0 until members.length()).mapNotNull { index ->
                val entry = members.optJSONObject(index) ?: return@mapNotNull null
                val id = entry.optInt("id", 0).takeIf { it > 0 } ?: return@mapNotNull null
                val member = dorm.members.firstOrNull { it.id == id }
                person(id, member?.nickname ?: DormStatus.text(entry, "nickname"), member?.color ?: DormRules.color(DormStatus.text(entry, "color")),
                    entry.optJSONObject("snapshot"))
            }
            people = dorm.members.map { member -> loaded.firstOrNull { it.id == member.id } ?: emptyPerson(member) }
        } catch (_: DormRequestException) {
        } finally {
            loadingPeople = false
        }
    }

    private fun emptyPerson(member: DormMember) = DormPerson(member.id, member.nickname, member.color, emptyList(), emptyList()) { null }

    private suspend fun person(id: Int, nickname: String, color: String, snapshot: JSONObject?): DormPerson {
        snapshot ?: return DormPerson(id, nickname, color, emptyList(), emptyList()) { null }
        // The share reader clamps everything a grid indexes with; a snapshot it refuses counts as no data.
        val document = JSONObject().put("code", "DORM").put("owner", nickname).put("semester", snapshot.optString("semester"))
            .put("schedule", snapshot.optJSONObject("schedule") ?: JSONObject())
            .put("calendar", snapshot.optJSONObject("calendar") ?: JSONObject())
        val shared = runCatching { SharedSchedule.read(document, clock()) }.getOrNull()
            ?: return DormPerson(id, nickname, color, emptyList(), emptyList()) { null }
        val store = ScheduleStore(scope, readOnly = true).apply {
            loader = { shared.snapshot() }
            markBridgeReady()
        }
        val data = withTimeoutOrNull(5_000) { snapshotFlow { store.result }.filterNotNull().first() }
            ?: return DormPerson(id, nickname, color, emptyList(), emptyList()) { null }
        return DormPerson(id, nickname, color, shared.periods.ifEmpty { BUNDLED_PERIODS }, shared.weeks) { date ->
            val week = shared.weeks.firstOrNull { date in it.days } ?: return@DormPerson null
            store.blocksForDay(week.days.indexOf(date) + 1, week.week.toString(), data).mapNotNull { block ->
                val start = DormRules.minutes(store.startTime(block)) ?: return@mapNotNull null
                val end = DormRules.minutes(store.endTime(block)) ?: return@mapNotNull null
                DormCourse(block.course.name, start, end, block.startSlot, block.endSlot)
            }
        }
    }

    /**
     * Uploads the user's whole current term for the roommates. The same content
     * goes again only after twelve hours, to keep its "synced" time fresh.
     */
    suspend fun sync(snapshot: ScheduleSnapshot?, force: Boolean = false): Boolean {
        if (active == null || snapshot == null || syncing) return false
        val body = runCatching { SharedSchedule.publishBody(snapshot, clockTimes = true) }.getOrNull() ?: return false
        val print = account + "|" + CoupleRules.fingerprint(body.toString())
        val now = clock()
        val last = preferences?.getString(KEY_SYNC, null).orEmpty().split('@')
        if (!force && last.size == 2 && last[0] == print && now - (last[1].toLongOrNull() ?: 0L) in 0 until 12 * 60 * 60_000L) return false
        syncing = true
        return try {
            request("sync", body = body)
            preferences?.edit()?.putString(KEY_SYNC, "$print@$now")?.apply()
            true
        } catch (_: DormRequestException) {
            false
        } finally {
            syncing = false
        }
    }

    // region Managing the dorm; these report their failures.

    /** Creates the dorm when there is none, otherwise makes a new code (owner only). */
    suspend fun invite() = change("invite")

    suspend fun cancelInvite() = change("cancelInvite")

    suspend fun join(code: String) = change("join", code = ScheduleDorm.inviteCode(code))

    suspend fun leave() = change("leave")

    suspend fun remove(member: DormMember) = change("remove", userId = member.id)

    /** Empty clears the name. */
    suspend fun rename(name: String) = change("settings", body = JSONObject().put("name", name.trim().let { if (it.isEmpty()) JSONObject.NULL else it }))

    /** Picking a colour a roommate uses swaps the two (the server does it). */
    suspend fun setColor(color: String) = change("settings", body = JSONObject().put("myColor", color))

    private suspend fun change(action: String, code: String = "", body: JSONObject? = null, userId: Int = 0) {
        apply(DormStatus.fromJson(request(action, code, body, userId)))
        checkedAt = clock()
    }

    // endregion

    private suspend fun request(action: String, code: String = "", body: JSONObject? = null, userId: Int = 0): JSONObject {
        val payload = JSONObject().put("action", action).put("code", code)
        body?.let { payload.put("body", it) }
        if (userId > 0) payload.put("userId", userId)
        val reply = transport(payload)?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: throw DormRequestException("网页会话还没有准备好，请稍后重试", 0)
        val error = reply.optString("error").ifEmpty { reply.optString("__error") }
        if (error.isNotEmpty()) throw DormRequestException(error, reply.optInt("status", 0))
        return reply.optJSONObject("data") ?: JSONObject()
    }

    private companion object {
        const val KEY_SYNC = "sync"
    }
}
