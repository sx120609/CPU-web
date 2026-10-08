package cn.lizmt.cpuweb.schedule

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

/*
 * The couple timetable ("情侣课表"): two bound accounts see each other's
 * classes in one grid. The server keeps a snapshot of each side's term
 * (`/api/couple`, see docs/couple-schedule.md); this client uploads the
 * user's own and draws the partner's over the native grid by date.
 */

/** Whose course a tile is. `Both`: the two attend the same class; it is the user's tile, marked 一起. */
enum class CoupleOwner { Mine, Partner, Both }

data class CoupleMember(
    val nickname: String = "",
    /** One of [CoupleRules.COLORS]. */
    val color: String = "blue",
    /** When this side's timetable last reached the server; empty when it never did. */
    val syncedAt: String = "",
)

sealed interface CoupleStatus {
    /** Not asked yet. */
    data object Unknown : CoupleStatus
    data object None : CoupleStatus
    /** The user made an invite nobody accepted yet. */
    data class Pending(val code: String, val expired: Boolean) : CoupleStatus
    data class Active(val anniversary: String, val me: CoupleMember, val partner: CoupleMember) : CoupleStatus

    companion object {
        fun fromJson(json: JSONObject): CoupleStatus = when (json.optString("status")) {
            "pending" -> json.optJSONObject("invite").let { invite ->
                Pending(text(invite, "code"), invite?.optBoolean("expired", true) ?: true)
            }
            "active" -> Active(text(json, "anniversary"), member(json.optJSONObject("me")), member(json.optJSONObject("partner")))
            else -> None
        }

        private fun member(json: JSONObject?) = CoupleMember(
            nickname = text(json, "nickname").trim(),
            color = CoupleRules.color(text(json, "color")),
            syncedAt = text(json?.optJSONObject("snapshot"), "syncedAt"),
        )

        /** `optString` turns a JSON null into the word "null". */
        private fun text(json: JSONObject?, key: String): String = if (json == null || json.isNull(key)) "" else json.optString(key, "")
    }
}

class CoupleRequestException(message: String, val status: Int) : Exception(message)

/** One person's colours, as ARGB: every course of theirs is drawn in them. */
data class CoupleTint(val fill: Int, val border: Int, val text: Int)

/** A course of one day with its clock times, for "what is TA doing now". */
data class CoupleTimedCourse(val name: String, val start: String, val end: String)

/** The rules shared with the Web (`web/src/views/schedule/couple.ts`), kept free of Android types so they run in a unit test. */
object CoupleRules {
    private val WHITESPACE = Regex("\\s+")
    private val DATE = Regex("\\d{4}-\\d{2}-\\d{2}")
    private const val DAY_MS = 86_400_000L

    /** The colours a person can pick, with their hue. The same seven as the Web and the server. */
    val COLORS: List<Pair<String, Int>> = listOf(
        "blue" to 214, "pink" to 338, "purple" to 268, "teal" to 178, "green" to 138, "amber" to 42, "orange" to 22,
    )
    val COLOR_NAMES: Map<String, String> = mapOf(
        "blue" to "蓝", "pink" to "粉", "purple" to "紫", "teal" to "青", "green" to "绿", "amber" to "黄", "orange" to "橙",
    )

    /** A colour key as the server sent it; one this build does not know is blue. */
    fun color(value: String): String = if (COLORS.any { it.first == value }) value else "blue"

    /**
     * One person, one colour: all of a person's courses are drawn in it, so the
     * two timetables can be told apart at a glance (the Web's `couplePersonTone`).
     */
    fun personTone(color: String, dark: Boolean): CoupleTint {
        val hue = COLORS.firstOrNull { it.first == color }?.second ?: 214
        return if (dark) CoupleTint(hsl(hue, 48, 29), hsl(hue, 62, 50), 0xFFF5F7FF.toInt())
        else CoupleTint(hsl(hue, 88, 93), hsl(hue, 72, 77), hsl(hue, 58, 27))
    }

    /** CSS `hsl()` with whole-number hue, saturation and lightness, as opaque ARGB. */
    fun hsl(hue: Int, saturation: Int, lightness: Int): Int {
        val h = ((hue % 360) + 360) % 360
        val s = saturation / 100f
        val l = lightness / 100f
        val chroma = (1 - abs(2 * l - 1)) * s
        val x = chroma * (1 - abs((h / 60f) % 2 - 1))
        val (r, g, b) = when (h / 60) {
            0 -> Triple(chroma, x, 0f)
            1 -> Triple(x, chroma, 0f)
            2 -> Triple(0f, chroma, x)
            3 -> Triple(0f, x, chroma)
            4 -> Triple(x, 0f, chroma)
            else -> Triple(chroma, 0f, x)
        }
        val m = l - chroma / 2
        fun channel(value: Float) = ((value + m) * 255).roundToInt().coerceIn(0, 255)
        return (0xFF shl 24) or (channel(r) shl 16) or (channel(g) shl 8) or channel(b)
    }

    /** Two blocks are the same class when they fill the same periods under the same name. */
    fun key(block: PlacedBlock): String =
        "${block.block.startSlot}|${block.block.endSlot}|${block.course.name.replace(WHITESPACE, "")}"

    /**
     * One day of both timetables. A class both attend is the user's tile, drawn
     * once. Courses never share a column with the other person's: one of the
     * partner's that meets one of the user's gets no tile, it is written as a
     * line under the user's course ([PlacedBlock.notes]). The rest of the
     * partner's courses keep a full tile.
     */
    fun merge(mine: List<PlacedBlock>, theirs: List<PlacedBlock>): List<PlacedBlock> {
        val keys = mine.map(::key).toSet()
        val shared = theirs.map(::key).filter { it in keys }.toSet()
        val partner = theirs.filter { key(it) !in keys }.map { it.copy(owner = CoupleOwner.Partner) }
        fun meets(a: PlacedBlock, b: PlacedBlock) = a.startSlot <= b.endSlot && b.startSlot <= a.endSlot
        val own = mine.map { block ->
            block.copy(owner = if (key(block) in shared) CoupleOwner.Both else CoupleOwner.Mine, notes = partner.filter { meets(it, block) })
        }
        return own + partner.filter { block -> mine.none { meets(it, block) } }
    }

    /** The line under one of the user's courses: the partner's course then, or how many. */
    fun noteLabel(notes: List<PlacedBlock>): String = if (notes.size > 1) "${notes.size} 门课" else notes.firstOrNull()?.course?.name.orEmpty()

    /** The partner's side of a day: their own tiles, the courses written as notes, and the classes both attend. */
    fun partnerSide(merged: List<PlacedBlock>): List<PlacedBlock> {
        val noted = merged.flatMap { it.notes }.distinctBy { key(it) }
        val together = merged.filter { it.owner == CoupleOwner.Both }.map { it.copy(notes = emptyList()) }
        return SchedulePriority.place((merged.filter { it.owner == CoupleOwner.Partner } + noted).map { it.block }, emptyMap())
            .map { it.copy(owner = CoupleOwner.Partner) } + together.map { it.copy(lane = 0, lanes = 1) }
    }

    /** Day 1 is the anniversary itself. Null without one, or when it is not in the past. */
    fun daysTogether(anniversary: String, today: String): Int? {
        val start = epochDay(anniversary) ?: return null
        val end = epochDay(today) ?: return null
        return if (end < start) null else (end - start).toInt() + 1
    }

    private fun epochDay(date: String): Long? {
        if (!DATE.matches(date)) return null
        val calendar = java.util.GregorianCalendar(java.util.TimeZone.getTimeZone("UTC"), java.util.Locale.US).apply {
            clear()
            isLenient = false
        }
        return runCatching {
            calendar.set(date.substring(0, 4).toInt(), date.substring(5, 7).toInt() - 1, date.substring(8, 10).toInt())
            Math.floorDiv(calendar.timeInMillis, DAY_MS)
        }.getOrNull()
    }

    /**
     * What the partner is doing at `minutes` past midnight. `courses` is null
     * when today is outside the partner's term.
     */
    fun nowText(name: String, hasData: Boolean, courses: List<CoupleTimedCourse>?, minutes: Int, short: Boolean = true): String {
        val who = name.ifEmpty { "TA" }
        if (!hasData) return "$who 还没有同步课表"
        if (courses == null) return "$who 今天不在学期内"
        if (courses.isEmpty()) return "$who 今天没有课"
        fun clock(value: String) = ScheduleStyleTime.clockMinutes(value) ?: -1
        val ordered = courses.sortedBy { clock(it.start) }
        ordered.firstOrNull { clock(it.start) <= minutes && minutes < clock(it.end) }?.let {
            return if (short) "$who 在上《${it.name}》· ${it.end} 下课" else "在上《${it.name}》，${it.end} 下课"
        }
        ordered.firstOrNull { clock(it.start) > minutes }?.let {
            return if (short) "$who 下一节《${it.name}》· ${it.start}" else "下一节《${it.name}》${it.start} 开始"
        }
        return "$who 今天的课都上完了"
    }

    /** "3 小时前" for a server timestamp; empty when it cannot be read. */
    fun relative(iso: String, now: Long): String {
        val time = ScheduleJson.parseIsoTime(iso) ?: return ""
        val elapsed = now - time
        return when {
            elapsed < 60_000 -> "刚刚"
            elapsed < 3_600_000 -> "${elapsed / 60_000} 分钟前"
            elapsed < DAY_MS -> "${elapsed / 3_600_000} 小时前"
            elapsed < 30 * DAY_MS -> "${elapsed / DAY_MS} 天前"
            else -> SharedSchedule.updatedText(iso)?.removePrefix("更新于 ").orEmpty()
        }
    }

    /** A cheap fingerprint of an upload, to skip sending the same timetable again. */
    fun fingerprint(text: String): String {
        var hash = 0x811C9DC5.toInt()
        for (character in text) hash = (hash xor character.code) * 0x01000193
        return text.length.toString(36) + "-" + (hash.toLong() and 0xFFFFFFFFL).toString(36)
    }

    /** What the invite sheet sends: the code, where to type it, and the link that opens the Web page with it filled in. */
    fun invitation(code: String, origin: String): String =
        "我们来绑定情侣课表吧！邀请码 $code（24 小时内有效）。在药大拾间「课表 → 更多 → 情侣课表」里输入，" +
            "或者打开 ${origin.trimEnd('/')}/schedule?couple=1&code=$code 就能绑定。"
}

/**
 * The partner's timetable as the grid draws it. It is laid out with the
 * partner's own calendar and looked up by date, so a make-up day or a
 * different week numbering on their side still lands on the right column.
 */
class CoupleLayer(
    private val store: ScheduleStore,
    private val data: ScheduleResult,
    val myColor: String,
    val partnerColor: String,
    val partnerName: String,
) {
    val partnerStore: ScheduleStore get() = store

    /** The partner's courses on `date` ("yyyy-MM-dd"); null when the date is outside their term. */
    fun blocksOn(date: String): List<PlacedBlock>? {
        if (date.length != 10) return null
        val week = store.calendar?.weeks?.firstOrNull { date in it.days } ?: return null
        return store.placedBlocksForDay(week.days.indexOf(date) + 1, week.week.toString(), data)
    }

    /** The user's courses of `date` with the partner's beside them. */
    fun merge(mine: List<PlacedBlock>, date: String): List<PlacedBlock> = CoupleRules.merge(mine, blocksOn(date).orEmpty())

    /** One person, one colour: the user's courses in the user's, the partner's in the partner's. */
    fun tint(block: PlacedBlock, dark: Boolean): CoupleTint? = when (block.owner) {
        null -> null
        CoupleOwner.Partner -> CoupleRules.personTone(partnerColor, dark)
        else -> CoupleRules.personTone(myColor, dark)
    }

    /** The status line: what the partner is doing right now. */
    fun nowText(today: String, minutes: Int, short: Boolean = true): String {
        val courses = blocksOn(today)?.map {
            CoupleTimedCourse(it.course.name, store.periodTime(it.block.startSlot).startTime, store.periodTime(it.block.endSlot).endTime)
        }
        return CoupleRules.nowText(partnerName, true, courses, minutes, short)
    }
}

/** The partner's timetable while it is drawn over the grid, else null. */
internal val LocalScheduleCouple = staticCompositionLocalOf<CoupleLayer?> { null }

/**
 * The binding, the partner's snapshot and the upload of the user's own. Every
 * background request fails quietly: the couple timetable must never get in the
 * way of the timetable itself.
 */
class ScheduleCouple(
    private val scope: CoroutineScope,
    private val preferences: SharedPreferences?,
    /** Runs one `CPUAndroidCouple` call in the page; null when the page cannot answer. */
    private val transport: suspend (JSONObject) -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    var status by mutableStateOf<CoupleStatus>(CoupleStatus.Unknown)
        private set
    /** Whether the partner's courses are drawn in the grid; kept on this device. */
    var visible by mutableStateOf(preferences?.getBoolean(KEY_VISIBLE, true) ?: true)
        private set
    /** A store laid out with the partner's calendar; null while there is no snapshot of theirs. */
    var partnerStore by mutableStateOf<ScheduleStore?>(null)
        private set

    private var partnerPrint = ""
    private var account = ""
    private var checkedAt = 0L
    private var refreshing = false
    private var syncing = false

    val active: CoupleStatus.Active? get() = status as? CoupleStatus.Active

    /** Everything belongs to one account: another one signing in starts from nothing. */
    fun adopt(next: String) {
        if (next == account) return
        account = next
        checkedAt = 0L
        status = CoupleStatus.Unknown
        setPartner(null)
    }

    fun updateVisible(value: Boolean) {
        visible = value
        preferences?.edit()?.putBoolean(KEY_VISIBLE, value)?.apply()
    }

    /**
     * Asks the server who the user is bound to and fetches the partner's
     * timetable. Unforced calls are spaced out: an unbound account is asked
     * again after ten minutes, a bound one after a minute.
     */
    suspend fun refresh(force: Boolean = false) {
        if (refreshing) return
        val now = clock()
        val pause = if (status is CoupleStatus.Active) BOUND_PAUSE_MS else UNBOUND_PAUSE_MS
        if (!force && checkedAt > 0 && now - checkedAt < pause) return
        refreshing = true
        try {
            apply(CoupleStatus.fromJson(request("status")))
            checkedAt = now
            loadPartner()
        } catch (_: CoupleRequestException) {
        } finally {
            refreshing = false
        }
    }

    private fun apply(next: CoupleStatus) {
        status = next
        if (next !is CoupleStatus.Active) {
            setPartner(null)
            preferences?.edit()?.remove(KEY_SYNC)?.apply()
        }
    }

    private suspend fun loadPartner() {
        val bound = active ?: return
        val snapshot = request("schedules").optJSONObject("partner")
        if (snapshot == null) {
            setPartner(null)
            return
        }
        // The share reader clamps everything a grid indexes with; a snapshot it refuses is not drawn.
        val document = JSONObject().put("code", "COUPLE").put("owner", bound.partner.nickname)
            .put("semester", snapshot.optString("semester"))
            .put("schedule", snapshot.optJSONObject("schedule") ?: JSONObject())
            .put("calendar", snapshot.optJSONObject("calendar") ?: JSONObject())
        setPartner(runCatching { SharedSchedule.read(document, clock()) }.getOrNull())
    }

    private fun setPartner(schedule: SharedSchedule?) {
        val print = schedule?.let { CoupleRules.fingerprint(it.toJson().put("fetchedAt", 0).toString()) }.orEmpty()
        if (print == partnerPrint && (schedule == null) == (partnerStore == null)) return
        partnerPrint = print
        // A new store each time: the grid never shows one partner's courses while the next one's load.
        partnerStore = schedule?.let { value ->
            ScheduleStore(scope, readOnly = true).apply {
                loader = { value.snapshot() }
                markBridgeReady()
            }
        }
    }

    /** The partner's timetable ready to draw, when the user wants to see it. */
    fun layer(): CoupleLayer? {
        val bound = active ?: return null
        val store = partnerStore ?: return null
        val data = store.result ?: return null
        if (!visible) return null
        return CoupleLayer(store, data, bound.me.color, bound.partner.color, bound.partner.nickname)
    }

    /** The status line under the week title; null when the user is not bound. */
    fun statusText(today: String, minutes: Int): String? {
        val bound = active ?: return null
        val name = bound.partner.nickname
        val store = partnerStore ?: return CoupleRules.nowText(name, false, null, minutes)
        val data = store.result ?: return "${name.ifEmpty { "TA" }} 的课表加载中"
        return CoupleLayer(store, data, bound.me.color, bound.partner.color, name).nowText(today, minutes)
    }

    /**
     * Uploads the user's whole current term so the partner sees it. The same
     * content is sent again only after twelve hours, to keep its "synced" time fresh.
     */
    suspend fun sync(snapshot: ScheduleSnapshot?) {
        if (active == null || snapshot == null || syncing) return
        val body = runCatching { SharedSchedule.publishBody(snapshot) }.getOrNull() ?: return
        val print = account + "|" + CoupleRules.fingerprint(body.toString())
        val now = clock()
        val last = preferences?.getString(KEY_SYNC, null).orEmpty().split('@')
        if (last.size == 2 && last[0] == print && now - (last[1].toLongOrNull() ?: 0L) in 0 until UNCHANGED_RESYNC_MS) return
        syncing = true
        try {
            request("sync", body = body)
            preferences?.edit()?.putString(KEY_SYNC, "$print@$now")?.apply()
        } catch (_: CoupleRequestException) {
        } finally {
            syncing = false
        }
    }

    // region Managing the binding; these report their failures.

    suspend fun invite() = change("invite")

    suspend fun cancelInvite() = change("cancelInvite")

    suspend fun accept(code: String) = change("accept", code = code)

    suspend fun unbind() = change("unbind")

    /** An empty date clears the anniversary. */
    suspend fun setAnniversary(date: String) =
        change("settings", body = JSONObject().put("anniversary", if (date.isEmpty()) JSONObject.NULL else date))

    /** Picking the colour the partner is using swaps the two (the server does it). */
    suspend fun setColor(color: String) = change("settings", body = JSONObject().put("myColor", color))

    private suspend fun change(action: String, code: String = "", body: JSONObject? = null) {
        apply(CoupleStatus.fromJson(request(action, code, body)))
        checkedAt = clock()
        runCatching { loadPartner() }
    }

    // endregion

    private suspend fun request(action: String, code: String = "", body: JSONObject? = null): JSONObject {
        val payload = JSONObject().put("action", action).put("code", code)
        body?.let { payload.put("body", it) }
        val reply = transport(payload)?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: throw CoupleRequestException("网页会话还没有准备好，请稍后重试", 0)
        val error = reply.optString("error").ifEmpty { reply.optString("__error") }
        if (error.isNotEmpty()) throw CoupleRequestException(error, reply.optInt("status", 0))
        return reply.optJSONObject("data") ?: JSONObject()
    }

    private companion object {
        const val KEY_VISIBLE = "visible"
        const val KEY_SYNC = "sync"
        const val UNBOUND_PAUSE_MS = 10L * 60 * 1000
        const val BOUND_PAUSE_MS = 60L * 1000
        const val UNCHANGED_RESYNC_MS = 12L * 60 * 60 * 1000
    }
}
